# Running `zowex` locally as the authenticated user (same-system deployment)

> Overview of all z/OS components and deployment shapes: [`zos-overview.md`](./zos-overview.md).

**Status: design, 2026-09-12; identity-switch mechanism revised the same day
(SURROGAT chosen, PassTickets dropped by decision, SAF IDTs investigated and
ruled out for unprivileged code).** This document turns the "Part 2" sketches
in [`zos-saf-idp.md`](./zos-saf-idp.md) and Phase 4 / Shape B of
[`zos-hosted-server-plan.md`](./zos-hosted-server-plan.md) into a concrete,
buildable design. It records a sequencing decision: build the **direct local
spawn** (previously "Option 2b, only if latency proves a problem") as the next
improvement, because it removes the loopback SSH hop *and* the second
credential entirely when `@zowe/mcp-server` runs on the same LPAR it operates
on.

Everything here changes authentication/credential handling and involves
identity switching, so it **requires a security/integrity specialist review
before production-shaped use** — required, not asserted to have happened. It
also touches zowe-native-proto (`zowex`), so the launcher design should be
discussed upstream in the Zowe community early.

## Goal and scope

When the MCP server runs **on z/OS** and a tool request targets **the same
system**, run `zowex` as a **local child process under the identity of the
authenticated user** — no SSH, no second password. The JWT's `sub` *is* the
z/OS userid because the token was minted by `zowe-mcp-zos-saf-idp`, which
authenticated that userid against this system's own SAF (and mints `sub` in
canonical uppercase form).

**Out of scope:** the general case where the token subject is a distributed
identity that must be mapped to a z/OS userid (RACMAP / IDMAP / API ML-style
distributed identity mapping) — see
[`future-zos-identity-mapping.md`](./future-zos-identity-mapping.md). Also out
of scope: cross-LPAR execution (the existing SSH backend keeps covering that).

## Deployment shapes (doctrine as of 2026-09-12)

Where the server runs and how it reaches z/OS work are separate decisions.
The supported shapes, in order of preference when the target is z/OS itself:

| # | Client | Server | Reaching z/OS work | Effective identity |
|---|--------|--------|--------------------|--------------------|
| 1 | Workstation, multi-user | On z/OS: HTTP behind **AT-TLS**, JWT from an IdP (e.g. `zowe-mcp-zos-saf-idp` on the same system) | `local` system — SURROGAT launcher | The JWT `sub`, per user |
| 2 | MCP client **on z/OS** | On the same z/OS: **stdio** | direct `zowex server` child spawn (stage 5) | The invoking user — inherited, no switch |
| 3 | Any | Anywhere | **SSH to a different system** | The SSH credential's user |
| — | ~~Any~~ | ~~On z/OS, dialing itself over loopback SSH~~ | deprecated fallback | One shared functional user |

- **Shape 1** is the multi-user z/OS deployment and is validated end to end on
  a live RACF LPAR (AT-TLS HTTPS → OAuth login → JWT `sub` → SURROGAT switch →
  zowex as that user). Its prerequisites are operator/RACF work, not code:
  an AT-TLS policy for the port (TLS 1.3 needs ICSF — without it, pin TLS 1.2
  with `TLS_RSA_*` suites; see docs/zos-saf-idp.md), the IdP with
  `--tls-terminated`, `BPX.SRV.<userid>` SURROGAT permits for every allowed
  user, the program-controlled launcher, one shared zowex binary, and
  `ZOWE_MCP_TENANT_STORE_DIR` for persistent per-user connections.
- **Shape 2** needs none of that: a stdio server spawned by a z/OS-resident
  client already *runs as* the right user, so the identity is inherited —
  no launcher, no SURROGAT, no JWT, no program control, and the per-user
  `~/.zowe-server` zowex default works again (the shared-binary constraint
  exists only because the launcher's target user is per-request). Implemented
  as stage 5.

  > **Known limitation (validated on Host-A, 2026-10-07/08): shape 2 is NOT
  > supported for multi-MB payloads.** A z/OS node process needs 512–768 MB
  > of above-bar storage just to run, and against a typical 2 GB MEMLIMIT
  > the margins are thin enough that a multi-MB `readDataset` kills or
  > wedges the stdio server: an uncaught C++ exception in the runtime
  > (console-only diagnostics — `EDC6010S`, then abend `U4083` or `S0C4` in
  > CELQLIB; nothing reaches the USS session), a `RangeError` at
  > `Buffer.from`, or a hang on the following call, depending on ambient
  > storage pressure. zowex itself is innocent, and the same read works
  > through the HTTP server shape (shape 1). Until the server streams large
  > payloads instead of buffering whole responses, route multi-MB dataset
  > work through shape 1 or cap payload sizes on shape 2 clients. Full
  > analysis: the perf campaign's finding 9
  > (docs/zos-perf-test-results.md on the perf-harness branch).
- **Shape 3** is unchanged: SSH remains the transport for *cross-system*
  work — from a workstation-local server, or from a z/OS server fanning out
  to other LPARs.
- **Loopback SSH to the same system is deprecated** as a same-system
  mechanism: every user acts as one functional identity (the flaw this whole
  design exists to fix), it drags sshd/key/password machinery into a hop that
  goes nowhere, and it costs an extra credential surface. It remains a
  documented *fallback* only for shops that cannot get SURROGAT permits or
  `extattr +p` approved — always with the shared-identity caveat stated.

"Not local via SSH" applies only when server and target are the same z/OS
system; a workstation-local server reaching z/OS over SSH (shape 3) is the
normal remote-development setup and is unaffected.

## What exists today (verified against the code, 2026-09-12)

- `zowex` is never spawned by this repo. The SDK starts it over an SSH exec
  channel: `ssh-client-cache.ts` builds an `SshSession` and calls
  `ZSshClient.create()`; the SDK execs `<serverPath>/zowex server` and speaks
  newline-delimited JSON-RPC over the channel
  (`packages/zowe-mcp-server/src/zos/native/ssh-client-cache.ts:206`,
  `@zowe/zowex-for-zowe-sdk` `ZSshClient.js:93-108`).
- Every tool operation funnels through `NativeBackend.withNativeClient()` →
  `getSpec()` → `credentialProvider.getCredentials()` →
  `connectAndRunOperation()` → `clientCache.getOrCreate()`
  (`src/zos/native/native-backend.ts:529-708`). That is the single seam.
- The authenticated identity stops short of the backend: `verifyBearerJwt()`
  binds `sub` to the MCP session (`src/transports/http.ts:227-235`) and
  `tenantSub` reaches `CreateServerOptions`, but it is used only as a
  cache/persistence key (`src/server.ts:433-442`) — never as a z/OS userid.
  Each `sub` does already get an isolated per-tenant `NativeSetup`
  (`src/index.ts:1428-1442`).
- Nothing establishes "this server runs on the same system the IdP
  authenticates against". Today that is operator convention encoded in
  `deploy/<target>.json` (issuer/audience pairing), not a machine-checkable
  fact. The server has no self-identification (`os390` checks exist only in
  the IdP package).

## Design overview

Three cooperating pieces:

1. **A `local` system entry** in the native config that binds a system id to
   "this host, as the authenticated user" — activated only under an explicit
   operator assertion (env contract below).
2. **A `LocalClient` transport**: `zowex server` as a direct child process,
   same JSON-RPC protocol over the child's stdin/stdout, duck-typed at the
   `ssh-client-cache` seam (or contributed upstream as a real SDK client —
   preferred; see "Where the code lives").
3. **An identity-switching launcher** — the security-sensitive core. The Node
   server never changes identity and never holds daemon authority; a small,
   program-controlled child does the switch under **SURROGAT authority**, then
   `exec`s `zowex server`.

### The identity switch: SURROGAT (`BPX.SRV.<userid>`) + identity spawn

The mechanism rests on the documented non-daemon identity rule (*setuid
(BPX1SUI, BPX4SUI)*, z/OS UNIX Assembler Callable Services 3.2.0, verified via
Folio 2026-09-12): if the caller is **not** a daemon, the identity change is
allowed when either the target user was authenticated by the password service
in the same process, **or** "the caller of the setuid service has read access
to the `BPX.SRV.userid` profile in the SURROGATE class". This design uses the
SURROGAT arm — no credential of any kind crosses into the launcher.

**The switch itself is an identity spawn** (`__spawn2()` + `SPAWN_SETUSERID`
— `_BPX_USERID` semantics, whose "authorization … is the same as that for the
setuid() function"), NOT `setuid()`+`exec()`. Live-LPAR validation 2026-10-08
proved that surrogate `setuid()` changes the MVS identity but does **not**
rebuild the POSIX supplementary group list: the switched process (and its
exec'd/spawned children, even in new address spaces) kept the invoker's
groups, and the leaked list carried real USS authority (a group-readable file
of the server identity was readable as the target). `initgroups()`/
`setgroups()` fail `EPERM` without daemon authority or the target's password,
and a `__login()` environment does not survive `exec()` and refuses
`spawn()`. The identity spawn creates the child in a new address space dubbed
under the target's complete security environment — verified: the child's
group list is exactly the target's connections and the invoker-group file
read is denied (`test.sh` keeps a regression test).

The clean-address-space requirement still applies when `BPX.DAEMON` is
defined: the launcher and everything loaded with it must be
program-controlled — the exact environment already built and validated for
node-racf (see `zos-saf-idp.md`, Part 1 validation, including the
PROGRAM-class STEPLIB lesson).

Per request for a not-yet-running user session, the flow is:

```text
Node (@zowe/mcp-server, runs as the server ID, no special USS attributes)
  │  validates the JWT (iss/aud/exp/sub) — this is the authentication
  │  spawn(launcher), _BPX_SHAREAS off (fresh address space)
  ▼
launcher (program-controlled binary, still the server ID)
  1. reads <userid> from stdin (never argv/env), validates its shape
  2. getpwnam(userid)  — resolves the UID; refuses UID 0
  3. __spawn2(zowex, SPAWN_SETUSERID userid, SPAWN_SETCWD target home)
     — authorized by the server ID's READ on BPX.SRV.<userid> in
     SURROGAT; SAF-audited; the child is a NEW address space dubbed
     under the target's complete security environment (UID, GID,
     supplementary groups from the target's connections)
  4. HOME/USER/LOGNAME set from the OMVS segment before the spawn
  5. stays resident: forwards SIGTERM/SIGINT/SIGHUP, mirrors the
     child's exit status
  ▼
zowex server, running AS the authenticated user (fresh address space)
  JSON-RPC over inherited stdin/stdout ↔ Node's LocalClient
```

Trust model, stated plainly: **the SAF-level authentication happens in the IdP
at login; the MCP server's JWT validation carries it to the request; the
launcher itself does not re-authenticate anybody.** The launcher trusts the
userid its parent writes to it. What bounds that trust:

- The SURROGAT grant is scoped to the **server's RACF ID** and to the
  **permitted target userids** — per-user `BPX.SRV.<userid>` profiles (or a
  narrow generic) choose the blast radius explicitly, and every switch is a
  SAF-auditable SURROGAT access.
- The launcher binary is program-controlled, owned by the server ID, mode
  `0700` — only processes already running as the server can exec it, and they
  could equally well hold the SURROGAT authority themselves.
- The residual risk — anything that achieves code execution as the server ID
  can become any *permitted* user — is the same risk sshd-based Option 2a had
  (a compromised server could replay credentials), now visible as one RACF
  access list instead. This is the item for the security review to weigh.

**Alternatives considered:**

- *PassTicket + `__passwd_applid()` + `setuid()`* (the password-service arm of
  the same setuid rule; the launcher would mint a one-time PassTicket via
  `R_GenSec` and authenticate it before switching). Verified feasible from
  problem state (R_GenSec "supports problem state callers"; generation needs
  UPDATE on `IRRPTAUTH.<applid>.<userid>` in PTKTDATA), and it would add a
  per-request SAF authentication event plus APPL-class gating. **Dropped by
  decision 2026-09-12**: it brings PTKTDATA key management (SSIGNON secured
  signon keys or ICSF key labels) and profile setup for infrastructure the
  SURROGAT arm doesn't need. Revisit only if a per-request SAF authentication
  event becomes a hard requirement.
- *SAF Identity Tokens (IDT)* — investigated 2026-09-12 as the requested
  alternative to PassTickets. An IDT is a SAF-native JWT (`iss: "saf"`,
  `sub`, `aud`=APPL, `exp` default 5 min, `amr` method claims), signed with an
  ICSF-managed key configured via IDTDATA-class profiles, and designed for
  exactly our shape of problem: *"authenticate a user and receive proof of
  that authentication"* that can later be passed *"instead of other
  authentication credentials like a password"* (RACF 3.2.0, *Activating and
  using the IDTA parameter*). Conceptually ideal — the IdP could mint an IDT
  at login (when it holds the password) and the launcher could redeem it. It
  fails on authorization, twice: IDTs are generated and consumed only through
  `RACROUTE REQUEST=VERIFY` (IDTA keyword) or `initACEE`, and **RACROUTE
  REQUEST=VERIFY requires an authorized caller — APF, system key 0–7, or
  supervisor state** (RACF message 683); meanwhile the problem-state services
  our processes can call (`__passwd`/BPX1PWD, `__login`/BPX1SEC) accept
  password, phrase, or PassTicket — **no IDT input**. Adopting IDTs therefore
  means an APF-authorized launcher (a full z/OS-authorized-code integrity
  surface, the biggest possible step up) or a dependency on an authorized
  intermediary such as Zowe ZSS — which is precisely how Zowe API ML's "SAF
  IDT" provider does it. Ruled out for this deliberately-unprivileged design;
  worth revisiting if ZSS is already present in the target deployment or if
  IBM ever exposes IDT redemption through an unauthorized service.
- *`_BPX_USERID` / BPXYINHE `INHEUSERID` spawn directly from Node.* Requires
  the *spawner* to hold the identity-change privilege — i.e. daemon authority
  in the Node process. Rejected (spawn fails `EPERM`/`JRNoChangeIdentity`
  otherwise; *spawn (BPX1SPN)*, USS Callable Services 3.2.0), and the plan doc
  already ruled BPX.DAEMON out for Node ("Do not design around it").
- *`pthread_security_np()` thread-level security.* Already ruled out in
  `zos-saf-idp.md` — fits a C server, not Node's event loop.
- *JWT validation inside the launcher* (the original 2b sketch). RS256 + JWKS
  in C is a lot of new security-sensitive code; it remains a possible
  hardening layer over the SURROGAT design later (it would shrink the "trusts
  its parent" residual risk above).

### Where the code lives

- **Launcher**: prototype first as a standalone small C program in this repo
  (`packages/zowe-mcp-server/zos-launcher/`, precedent: the standalone
  `__passwd` tester used for Part 1 validation), validated on the Host-A LPAR.
  Long-term it is naturally a mode of `zowex` itself (upstream
  zowe-native-proto), e.g. `zowex server --as-user`, reading the userid from
  stdin and doing the switch internally — one binary to program-control,
  already deployed next to the server, already C++. The plan doc reached the
  same conclusion.
- **`LocalClient`**: ideally upstream in the zowex SDK at the client-factory
  seam (`ssh-rs/index.js` `createClient()`), selected by an option on
  `ZSshClient.create`. Until upstream lands it, duck-type in this repo at
  `connectAndRunOperation()` (`native-backend.ts:699`) — the returned client
  only needs the request/response surface the backend uses; widen the
  `ZSshClient` type at the cache boundary.

### Same-system assertion and identity plumbing (`@zowe/mcp-server`)

"Same LPAR" and "`sub` is a local userid" are **operator assertions**, exactly
like the issuer/audience pairing already is — explicit configuration, not
hostname heuristics:

- New connection-spec form `local` (no `user@`, no host) in
  `native-config.json` `systems` / `--system`, valid only when **all** hold,
  checked at startup with actionable errors:
  1. `process.platform === 'os390'`;
  2. HTTP transport with JWT auth enabled (`ZOWE_MCP_JWT_ISSUER` set) — in
     stdio or no-auth mode there is no authenticated `sub`, so `local` is
     refused;
  3. `ZOWE_MCP_LOCAL_SUB_IS_USERID=1` — the explicit acknowledgment that the
     configured issuer authenticates against *this* system's SAF (same
     pattern as the IdP's `--allow-nonloopback`).
- The **effective userid for the `local` system is the session's `tenantSub`**
  (already canonical uppercase from the IdP — see `saf-userid.ts`),
  propagated from `CreateServerOptions` into the per-tenant `NativeSetup` so
  `getSpec()` can resolve it. No credentials are looked up for `local` — the
  credential-provider chain is bypassed entirely.
- New env vars join the explicit environment contract (`deploy/README.md`)
  and must be added to the startup `runtimeEnvSnapshot`
  (`src/index.ts:1211-1222`): `ZOWE_MCP_LOCAL_SUB_IS_USERID`,
  `ZOWE_MCP_LOCAL_LAUNCHER` (path to the launcher binary).

### Process lifecycle

With sshd out of the picture, the server owns child lifecycle where sshd used
to: one `zowex server` child per authenticated user (keyed like today's
client cache, `local` + userid), reaped on session close (`onClose` already
exists in the cache), plus an idle timeout so abandoned sessions do not pin
address spaces. Child exit must invalidate the cache entry the same way SSH
disconnects do today. `_BPX_SHAREAS` must be forced off for the launcher spawn
(fresh address space is required both for program control and because
`setuid` is unsupported in multi-process address spaces).

### RACF / USS setup (admin runbook, printed by a doctor — never executed)

```text
/* Surrogate authority: the server ID may become exactly these users.
   One profile per permitted user keeps the blast radius explicit;
   a generic BPX.SRV.* grant would let the server become anyone. */
SETROPTS CLASSACT(SURROGAT)            /* if not already active */
RDEFINE SURROGAT BPX.SRV.<userid> UACC(NONE)
PERMIT BPX.SRV.<userid> CLASS(SURROGAT) ID(<server-id>) ACCESS(READ)
SETROPTS RACLIST(SURROGAT) REFRESH     /* if SURROGAT is RACLISTed */

/* Program control for the launcher's address space */
extattr +p <launcher>            (READ on BPX.FILEATTR.PROGCTL)
/* plus the PROGRAM-class coverage for any STEPLIB the launcher loads from —
   the CEE.SCEERUN2.OVERRIDE lesson from Part 1 applies unchanged */
```

Following the established split (IdP doctor precedent): a
**doctor** check verifies platform, launcher present + `+p`, and a SURROGAT
probe for a configured userid; **RACF commands are printed for the
administrator, never executed**.

### Credential-handling rules (carried over from the IdP work)

- The target userid crosses the process boundary via **stdin only** — never
  argv (visible in `ps`), never env (inherited by children). No password,
  ticket, or token crosses at all in the SURROGAT design.
- Launcher failures map to distinct operator-actionable errors: dirty address
  space (program control / JRENVDIRTY), `EPERM` on setuid (missing SURROGAT
  permit), unknown user / no OMVS segment. Client-facing errors stay generic.
- A `local` request with no authenticated `sub` is a hard 401-shaped refusal,
  never a fallback to a shared identity.

### Testing

- Off-platform: unit tests for spec parsing, gating (the three activation
  conditions), `LocalClient` protocol framing against a scripted fake
  launcher/`zowex` (mock child process).
- **On-platform contract tests** (the pattern `zowe-mcp-zos-saf-idp`
  established): launcher end-to-end with a disposable account (stdin userid →
  `setuid` → child runs as the user, verified via `id` output — including
  checking what happens to **supplementary groups**, which the setuid doc
  leaves ambiguous for the surrogate path), missing-permit `EPERM`, unknown
  user, and dirty-environment failures produce the mapped errors; then a full
  JWT → `tools/call` → dataset access *as the user* on the validation LPAR.
- Sequencing with the live Host-A deployment: validate the launcher standalone
  first (like the Part 1 `__passwd` tester), then wire `LocalClient`, then
  the end-to-end path.

### Stage 2 validation results (live RACF LPAR, 2026-09-12)

The standalone launcher (`packages/zowe-mcp-server/zos-launcher/`) was built
and contract-tested on the validation LPAR. All eight tests pass; everything
below was observed, not assumed.

- **The SURROGAT switch works exactly as documented**: a problem-state,
  non-daemon, program-controlled process running as the server ID switched to
  the disposable target account via `setuid()` with only a discrete
  `BPX.SRV.<target>` `UACC(NONE)` profile + READ permit (SURROGAT was already
  active, generic-enabled, and RACLISTed on this LPAR — the
  `SETROPTS RACLIST(SURROGAT) REFRESH` after the permit is required). A
  pre-existing generic `BPX.SRV.**` `UACC(NONE)` provided the deny-by-default
  baseline: an unpermitted existing user fails `EPERM`.
- **Program control is enforced for the surrogate path too**: an unmarked
  copy of the same binary fails `setuid` with `EMVSERR`,
  `errno2=0b8802af` (JRENVDIRTY) — same remediation as the Part 1 node-racf
  work. The launcher's hint text triggers on exactly this signature.
- **Stdin passthrough holds**: bytes after the first (userid) line reach the
  exec'd program untouched — the property the `LocalClient` JSON-RPC stream
  relies on.
- Build notes (IBM Open XL, `ibm-clang64`): z/OS headers need
  `_UNIX03_SOURCE` for `setenv()`; `initgroups()`/`setgroups()` ARE declared
  (`_OPEN_SYS` + `<grp.h>`) but need superuser or the target's password.
- **RESOLVED 2026-10-08 — supplementary groups**: with the invoker in
  `ZMCPGRP` and the target not, surrogate `setuid()` demonstrably did NOT
  rebuild the group list (the leak carried real file authority); the
  launcher was redesigned around the identity spawn, which does. `test.sh`
  test 9 is the permanent regression check.
- A target account whose OMVS home directory does not exist gets a warning
  (`chdir` fails) and keeps running with `HOME` set from the OMVS segment —
  acceptable for `zowex`, visible in the operator log.

## Implementation stages

1. ✅ **IdP: normalize `sub` to the uppercase RACF userid** (2026-09-12 —
   `saf-userid.ts`; OIDC `accountId`, legacy `/login` mint, and the rate-limit
   key all fold; verifiers still receive the typed form).
2. ✅ **Standalone launcher prototype** (2026-09-12, redesigned 2026-10-08
   around the identity spawn after the groups finding —
   `packages/zowe-mcp-server/zos-launcher/`, all nine contract tests pass on
   the validation LPAR; see the validation subsection above).
3. ✅ **Server plumbing** (2026-09-12 — `src/zos/native/local-system.ts` /
   `local-doctor.ts`): the `local` systems entry (registered per tenant with
   the JWT `sub` as its only identity; refused in `addZosConnection`), startup
   gating with the full actionable error list (os390 + HTTP/JWT +
   `ZOWE_MCP_LOCAL_SUB_IS_USERID=1` + existing absolute
   `ZOWE_MCP_LOCAL_LAUNCHER`), credential-provider bypass at the backend seam
   (a `local` operation currently fails with an explicit
   "transport not available yet" error — stage 4 replaces that with the
   launcher spawn), both env vars in the startup `runtimeEnvSnapshot` and the
   deploy env contract, and the `zowe-mcp-server doctor-local` checks
   (platform, gating, launcher mode/`extattr +p`; opt-in `--probe-user` runs a
   real SAF-audited SURROGAT probe; RACF runbook printed, never executed).
   A `sub` that is not a canonical SAF userid gets **no** `local` system —
   never a shared-identity fallback. `doctor-local` validated on the live RACF
   LPAR the same day: all static checks pass against the deployed launcher, a
   permitted probe performs the real switch (`id` as the target), a denied
   probe surfaces the launcher's `EPERM` hint plus the printed SURROGAT
   runbook with the actual server userid.
4. ✅ **`LocalClient`** (2026-09-12 — `src/zos/native/local-client.ts`,
   duck-typed at the `SshClientCache.getOrCreate` seam as designed): extends
   the SDK's `RpcClientApi`, so every RPC namespace is upstream code and only
   the transport differs — spawn the launcher (`_BPX_SHAREAS=NO` forced),
   userid as the first stdin line, wait for zowex's ready banner (launcher
   stderr kept separate: a chdir warning for a missing target home is
   non-fatal), then the same newline JSON-RPC framing over the child's pipes.
   Launcher exits map to distinct operator errors (shared
   `describeLauncherFailure`, also used by the doctor probe); stream transfers
   are refused up front; child exit evicts the cache entry. Findings that
   changed the design in small ways:
   - The launcher requires an **absolute** program path, so the per-user
     `~/.zowe-server` default cannot name the binary for a per-request userid —
     a third contract variable **`ZOWE_MCP_LOCAL_ZOWEX`** (absolute path of one
     shared zowex, executable by every permitted target user; it runs *after*
     the switch, so it needs no `+p`) joins the gating, the env snapshot, the
     deploy contract, and `doctor-local` (exists + a group/other-execute hint).
   - The tool layer resolves a (system, user) context through
     `credentialProvider.getCredentials` before any operation, so `loadNative`
     hands the tool layer a local-aware wrapper returning an **identity-only
     stub** (the sub, no secret) for the `local` system; the backend keeps the
     unwrapped provider and, for local specs, never consults it. Local errors
     are excluded from the invalid/expired-password classification (a launcher
     `EPERM` must never mark credentials invalid).
   - Target users should have an existing OMVS home: zowex logs to
     `$HOME/.zowex/logs`, and while a missing home is tolerated end to end
     (warning + a logged non-JSON line), it is visible noise in the operator
     log.

   **End-to-end validated on the live RACF LPAR 2026-09-12**: JWT minted by the
   SAF IdP for the disposable account → MCP `initialize` → `tools/call
   runSafeUssCommand whoami` on system `local` returned the *authenticated
   user's* userid (real SURROGAT switch, no SSH, no second credential), and
   `listDatasets SYS1.MACLIB` ran over the same `zowex server` child. Off
   platform, the transport is covered by unit tests against a scripted fake
   launcher (startup, denial exits, stderr-before-banner, RPC round trip,
   error mapping, timeout, child death, dispose). Note: the IdP's legacy
   `POST /login` now audience-binds its tokens to `--mcp-resource` (RFC 8707),
   matching the OAuth-flow tokens; the server's `ZOWE_MCP_JWT_AUDIENCE` is
   mandatory and must equal that resource URL.
5. ✅ **Stdio same-user local mode** (2026-09-12 — deployment shape 2): accept the
   `local` systems entry on the **stdio** transport when running on z/OS, with
   the identity resolved from the *process* (the invoking user), not a JWT.
   No launcher, no SURROGAT, no `ZOWE_MCP_LOCAL_SUB_IS_USERID` assertion —
   there is no identity switch to authorize. (The gating split itself still
   falls under the review-scope rule below, precisely to confirm the relaxed
   stdio arm can never be reached by the HTTP path.) Sketch:
   - Gating (`checkLocalGating`) splits by transport: stdio + os390 requires
     only a resolvable zowex (an explicit `ZOWE_MCP_LOCAL_ZOWEX`, or the
     per-user `~/.zowe-server` default — usable again here because the user is
     fixed for the process lifetime); the HTTP path keeps the full JWT +
     launcher + assertion list unchanged.
   - Transport: `LocalClient` minus the identity preamble — spawn
     `zowex server` directly as a child (no userid stdin line, no launcher
     exit-code mapping), same JSON-RPC framing, same exit → evict flow. Either
     a `launcherPath`-less variant of `LocalClient.create` or a sibling class
     sharing the pipe plumbing.
   - Identity plumbing: the `local` system registers with the process user
     (from `process.env.USER`/`getuid` resolution) as its only identity;
     `addZosConnection` keeps refusing it.
   - Doctor: a `doctor-local` variant that checks only platform + zowex
     presence/executability for the stdio case.

   Implemented exactly per the sketch: `checkLocalGating` splits on the
   transport (the stdio arm requires only a resolvable invoking user —
   `resolveProcessUserid`, an upper-fold of `os.userInfo().username`, safe for
   an OS-provided name unlike a JWT `sub` — plus a zowex from
   `ZOWE_MCP_LOCAL_ZOWEX` or `~/.zowe-server/zowex` via
   `resolveStdioZowexPath`); the spec carries `sameUser: true` so the cache
   spawns `LocalClient` without a `launcherPath` (direct `zowex server` child,
   no `_BPX_SHAREAS` forcing, no userid stdin preamble, plain exit reporting
   instead of launcher exit-code mapping); `loadNative` takes
   `localSameUser`; and `doctor-local --stdio` checks the stdio arm.
   Unit-tested off platform (a direct-spawn fixture proves no preamble is
   ever written), and **validated on the live RACF LPAR 2026-09-12**: the
   stdio server started with `{"systems":["local"]}` and no `ZOWE_MCP_LOCAL_*`
   env at all — `doctor-local --stdio` all green, `runSafeUssCommand whoami`
   returned the invoking user, `getUssHome` its home — zowex spawned straight
   from the per-user `~/.zowe-server` default.
6. **Upstream**: propose `zowex server --as-user` and an SDK `LocalClient` in
   zowe-native-proto; swap the interim pieces when accepted.

Each stage that touches the launcher, the SURROGAT setup, or the gating logic
is inside the mandatory security/integrity review scope.
