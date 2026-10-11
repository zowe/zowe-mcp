# `zowe-mcp-zos-saf-idp`: a SAF/RACF-backed OAuth 2.1 / OIDC authorization server for dev/test

> Overview of all z/OS components and deployment shapes: [`zos-overview.md`](./zos-overview.md).

`packages/zowe-mcp-zos-saf-idp` is a **standalone, separate package** that gives a
Zowe MCP HTTP deployment on z/OS its own OAuth 2.1 / OIDC authorization server —
the role Keycloak, Azure AD, or Okta would play off-platform — authenticating
users against z/OS's own security manager (SAF/RACF). With it, the full MCP
OAuth flow (VS Code included) can be tested with **nothing installed outside
z/OS** besides the client.

It is built on [`oidc-provider`](https://github.com/panva/node-oidc-provider)
(OpenID-certified, pure JavaScript — its whole dependency tree is `koa`, `jose`,
`debug`, no native modules or WASM), pinned to an exact version. It wires into
`@zowe/mcp-server` with **zero server-side coupling**: the resource server just
points `ZOWE_MCP_JWT_ISSUER` at it, the same as any other IdP.

## Policy: dev/test only, and the resource server stays AS-free

[`docs/mcp-authentication-oauth.md`](./mcp-authentication-oauth.md) states the
product policy that Zowe MCP **does not embed** an OAuth 2.0 Authorization
Server. The decision recorded there (2026-09): this package is compatible with
that policy because it is a separate, opt-in, **dev/test-only** package that
`@zowe/mcp-server` never imports — the resource server itself remains AS-free,
and production deployments still bring their own IdP. Do not deploy this
package as a production identity provider.

## What it implements

- **OAuth 2.1 authorization-code flow with PKCE (S256, required)** — `/auth`,
  `/token`, browser login + consent pages. No implicit, no password grant.
- **OIDC & RFC 8414 discovery** — `/.well-known/openid-configuration`, with
  `/.well-known/oauth-authorization-server` served as an alias of the same
  document (VS Code tries the RFC 8414 path first).
- **Dynamic Client Registration (RFC 7591)** at `/reg`, no initial access token,
  guarded by a redirect-URI allowlist: loopback `http(s)` URIs on any port/path
  plus `https://vscode.dev/redirect` and `https://insiders.vscode.dev/redirect`
  (extend with `--redirect-allow`). Anything else is rejected with
  `invalid_redirect_uri`. (Client ID Metadata Documents — CIMD, the successor
  to DCR in MCP spec 2026-07-28 — are a possible follow-up; DCR remains
  supported by VS Code through the deprecation window.)
- **SAF login via the interaction UI**: the browser login form verifies
  credentials through the same backend and rate limiter as the legacy `/login`.
  Two backends, selected by `--saf-check` (default `auto`): **native** — the
  z/OS `__passwd()` service via IBM's node-racf addon, with distinct outcomes
  (an expired password gets its own actionable message; a misconfigured
  program-control environment gets a 503 plus an operator log with remediation
  hints) — and **ssh** — the portable connect-only SSH probe (SSH auth success
  == SAF verdict; never runs a remote command). `auto` picks native on z/OS
  when the addon loads, ssh otherwise.
- **JWT access tokens bound to the MCP server** (RFC 8707 resource indicators):
  RS256, `iss` = this issuer, `sub` = the SAF userid in canonical uppercase
  form (a lowercase login is folded, the way SAF itself folds it — downstream
  consumers use `sub` as a z/OS userid), `aud` = `--mcp-resource`.
  `@zowe/mcp-server`'s existing verifier accepts them unchanged. The userinfo
  endpoint is deliberately disabled so access tokens can never degrade to
  opaque userinfo tokens.
- **Refresh tokens with rotation** (8 h TTL by default): VS Code refreshes
  short-lived access tokens without re-login; a replayed (already-used) refresh
  token is rejected.
- **Consent page** shown once per grant (skip with `--auto-consent`).
- The **legacy `POST /login`** direct mint is kept for scripts and tests,
  unchanged: loopback-only regardless of bind address, generic errors, same
  signing key as the OAuth tokens.

## Scope and non-goals

- **Credential check only** (as above) — never touches `zowex`. The native
  backend calls `__passwd()` in-process; the SSH backend never runs a remote
  command. Unknown user and wrong password stay indistinguishable to clients
  on both backends (node-racf's ESRCH throw is folded into the generic
  failure); only *expired password* — reported by RACF solely for a correct
  password, so no guessing oracle — is surfaced distinctly.
- **No key rotation, keys never persisted.** A single RSA keypair (and the
  session-cookie keys) are generated fresh in memory at process start. A
  restart invalidates every outstanding token and cookie. Explicit, accepted
  tradeoff — it also sidesteps the on-disk `fs.readFileSync` EBCDIC-corruption
  bug found on z/OS USS, since there is no key file to read.
- **In-memory persistence only.** DCR-registered clients, authorization codes,
  grants, and sessions live in oidc-provider's default in-memory adapter and
  are lost on restart; VS Code recovers by re-registering and
  re-authenticating. Static clients can be supplied via
  `ZOWE_MCP_IDP_STATIC_CLIENTS` (inline JSON, deliberately **not** a file path —
  see the EBCDIC bug above).
- **Loopback bind by default, non-loopback needs an explicit acknowledgment.**
  The server refuses a non-loopback `--host` without `--allow-nonloopback`,
  because SAF passwords would transit plain HTTP. The recommended way to reach
  it from a workstation is an SSH tunnel (see the walkthrough below); behind a
  TLS-terminating reverse proxy, add `--trust-proxy`; under z/OS AT-TLS (or any
  terminator that forwards a plain socket with no proxy headers), add
  `--tls-terminated` with an `https://` issuer instead — see "HTTPS via AT-TLS"
  below.
- **Rate limiting ships from v1, not deferred.** Every failed login attempt —
  browser form or `/login` — is a real RACF authentication attempt against a
  live LPAR. Without a limiter it is a password-guessing oracle that risks
  locking out real RACF IDs. Both endpoints share one limiter: 5 attempts per
  15 minutes per (username, source IP), then a generic `429` with
  `Retry-After`.
- **Generic errors.** Login failures never distinguish "no such user" from
  "wrong password". Passwords are never logged and never appear in argv,
  environment variables, or on disk.

## Running it

```sh
node --no-wasm-tier-up --no-wasm-dynamic-tiering dist/index.js \
  --port 8089 --host 127.0.0.1 \
  --mcp-resource http://127.0.0.1:7542/mcp --token-ttl 300
```

(The `--no-wasm-*` node flags matter on memory-constrained LPARs — see the known
issue below.)

| Flag / env | Default | Purpose |
| --- | --- | --- |
| `--port` / `--host` | `8089` / `127.0.0.1` | Listener. Non-loopback `--host` additionally requires `--allow-nonloopback`. |
| `--issuer <url>` | `http://<host>:<port>` | Issuer URL — must match exactly what clients and the MCP server use. |
| `--token-ttl <seconds>` | `300` | Access-token lifetime. Longer = bigger leak window; fine for a personal test session, not for shared deployments. |
| `--mcp-resource <url>` | `http://127.0.0.1:7542/mcp` | The MCP server URL tokens are bound to (JWT `aud`, RFC 8707 resource). |
| `--redirect-allow <uri>` (repeatable) | — | Extra exact-match redirect URIs allowed in DCR. |
| `--auto-consent` | off | Skip the consent page after login. |
| `--trust-proxy` | off | Honor `X-Forwarded-*` behind a TLS-terminating proxy. Mutually exclusive with `--tls-terminated`. |
| `--tls-terminated` | off | TLS is terminated outside the process with no proxy headers on the wire (z/OS AT-TLS). Treats every request as https (client-supplied `X-Forwarded-*` are dropped), requires an `https://` issuer (and defaults the issuer to `https://<host>:<port>`), and lifts the non-loopback refusal — the wire is only protected if an AT-TLS policy actually covers the port. |
| `--allow-nonloopback` | off | Acknowledge plain-HTTP password exposure on a non-loopback bind. |
| `--system-name <name>` | `os.hostname()` | System name shown on the login form ("Sign in to …"). |
| `--security-product <name>` | auto-detected | ESM name shown on the login form. On z/OS the CLI probes non-destructively (`LISTUSER` → RACF, `TSS WHOAMI` → Top Secret); otherwise, or when probes fail (e.g. no TSO segment, or ACF2 — which has no safe non-interactive probe), it falls back to "the system security manager (SAF)". |
| `--login-notice <text>` | testing-only disclaimer | Purpose banner shown on the login form. |
| `--saf-check <mode>` | `auto` | SAF verification backend: `native` (node-racf / `__passwd`; startup fails with an actionable error if the addon can't load), `ssh` (the portable connect probe), or `auto` (native on z/OS when node-racf loads, else ssh). The chosen backend is logged at startup. |
| `ZOWE_MCP_IDP_RACF_MODULE` | — | Explicit path to a built node-racf module, for deployments that build the addon out-of-tree (it is not a dependency of this package — see the native-backend design section). |
| `ZOWE_MCP_IDP_STATIC_CLIENTS` | — | Inline JSON array of statically configured OAuth client metadata. |

Then point `@zowe/mcp-server`'s HTTP transport at it — keep the **consistency
triangle** aligned: the IdP's `--mcp-resource`, the server's
`ZOWE_MCP_OAUTH_RESOURCE`, and `ZOWE_MCP_JWT_AUDIENCE` must all be the same URL.

```sh
export ZOWE_MCP_JWT_ISSUER="http://127.0.0.1:8089"
# Optional — resolved from the issuer's discovery document when unset:
export ZOWE_MCP_JWKS_URI="http://127.0.0.1:8089/jwks"
export ZOWE_MCP_JWT_AUDIENCE="http://127.0.0.1:7542/mcp"
export ZOWE_MCP_OAUTH_RESOURCE="http://127.0.0.1:7542/mcp"
```

## VS Code walkthrough (everything on z/OS, tunnel from the workstation)

1. On the LPAR, start the IdP (above) and the MCP server (`--http`, JWT env vars
   set, same `--no-wasm-*` node flags), both bound to loopback.
2. On the workstation, open one SSH tunnel for both ports:

   ```sh
   ssh -L 8089:127.0.0.1:8089 -L 7542:127.0.0.1:7542 <user>@<lpar>
   ```

   The tunnel keeps passwords and tokens inside SSH encryption, makes every URL
   a loopback URL (browsers treat those as secure contexts), and — because the
   connections arrive on the LPAR from 127.0.0.1 — satisfies the loopback-only
   guards.

3. In VS Code, add the MCP server (`mcp.json`):

   ```jsonc
   { "servers": { "zowe-zos": { "type": "http", "url": "http://127.0.0.1:7542/mcp" } } }
   ```

4. On connect, VS Code receives a `401` with a `WWW-Authenticate:
   Bearer resource_metadata="…"` challenge, fetches the protected-resource
   metadata, discovers this IdP, registers itself via DCR, and opens the
   browser to the SAF login page. Sign in with a RACF userid/password, approve
   the consent page, and the MCP tools work; the token refreshes automatically
   after `--token-ttl` without re-login.
5. Restarting the IdP invalidates everything (by design); VS Code re-registers
   and re-authenticates on the next use.

### Known issue: JWT auth can crash `@zowe/mcp-server` on memory-constrained LPARs

Enabling JWT auth on `@zowe/mcp-server` (i.e. setting `ZOWE_MCP_JWT_ISSUER`/
`ZOWE_MCP_JWKS_URI`, which pulls in `fetch`/undici for the JWKS lookup) can crash
the server with `Fatal process out of memory: Zone` — a background V8 WASM
optimizing-compile job exhausting Zone memory — on z/OS LPARs with an OMVS
`MEMLIMIT` at or near 2048 MB (IBM recommends 4 GB). Confirmed reproducible on
a validation LPAR (see `docs/zos-hosted-server-results.md`). Workaround: start
`@zowe/mcp-server` with `node --no-wasm-tier-up --no-wasm-dynamic-tiering`.
**`--jitless` is not a substitute** — it disables `WebAssembly` entirely, and
`ssh2`'s pure-JS crypto fallback references the global `WebAssembly` object
unconditionally at module-load time with no `try/catch`, so the process crashes
even earlier and harder.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/.well-known/openid-configuration` | Full OIDC discovery document (served by oidc-provider). |
| `GET` | `/.well-known/oauth-authorization-server` | RFC 8414 alias — internally rewritten to the OIDC discovery path, one source of truth. |
| `GET` | `/jwks` | The active signing key as a JWK Set (oidc-provider's route). |
| `GET` | `/.well-known/jwks.json` | Legacy alias serving the **same** key. |
| `GET` | `/auth` | Authorization endpoint (code + PKCE S256 only). |
| `POST` | `/token` | Token endpoint (`authorization_code`, `refresh_token`; public clients allowed). |
| `POST` | `/reg` | Dynamic client registration, behind the redirect-URI allowlist guard. |
| `POST` | `/token/revocation` | RFC 7009 token revocation. |
| `GET`/`POST` | `/interaction/:uid[/login\|/confirm\|/abort]` | Browser login and consent pages (dependency-free string-literal HTML, strict CSP, no-store). |
| `POST` | `/login` | Legacy direct mint: `{ username, password }` → `{ access_token, token_type, expires_in }`; generic `401`/`429` otherwise. **Loopback-only, no exception.** |

## Before running this anywhere beyond a developer's own test session

This is new code that handles real SAF credentials and mints bearer tokens. It
needs a security/integrity specialist review before it runs anywhere beyond
the author's own test LPAR session — that review has not been asserted to have
happened by writing this document.

## Design: native SAF integration when running on z/OS

Today two separate hops need the real RACF password: the SSH login the IdP
performs to produce the SAF verdict, and (separately) the SSH hop
`@zowe/mcp-server`'s native transport makes to actually run `zowex` on behalf
of the authenticated user. Both are SSH-shaped because SSH is a convenient,
platform-independent way to ask "is this password valid for this user" — but
when the processes already run *on* z/OS, USS has purpose-built services for
both halves. **Status: Part 1 is implemented (`--saf-check`, native backend
via node-racf) and validated on a live RACF LPAR (2026-09-11) — see the
validation subsection below. Part 2 remains design-only.** Every option here
changes authentication/credential handling or privilege posture, so **each one
needs a security/integrity specialist review before production-shaped use** —
noted here, not asserted to have happened.

### Part 1: native credential verification (replaces the SSH probe) — implemented

The canonical service is **`__passwd()` / `__passwd_applid()`** (callable
services `BPX1PWD`/`BPX4PWD`; also in the C runtime library). It verifies a
password, password phrase, **or PassTicket**, is callable from problem state,
and — unlike the SSH probe's binary verdict — returns distinct errors:
`EACCES` (wrong password), `EMVSEXPIRE` (expired password), `ESRCH` (userid
has no OMVS segment), plus RACF return/reason codes such as "not authorized to
the APPL". (Reference: *z/OS UNIX System Services Programming: Assembler
Callable Services*, `__passwd` topic.)

What that buys over the SSH probe:

- **Works when sshd forbids password logins.** Hardened LPARs commonly set
  `PasswordAuthentication no`; the SSH probe silently breaks there.
- **Better login UX**: the form can say "password expired" instead of a
  generic failure, and PassTickets are accepted as credentials for free.
- **APPL scoping** via `__passwd_applid`: registering an APPL profile (e.g.
  `ZOWEMCP`) gives SAF-side control over *who may use this IdP at all*, and is
  the anchor PassTickets need in Part 2.
- **Lower latency**: no TCP connection + SSH key exchange per attempt.

**The one hard constraint**: when `BPX.DAEMON` is defined in the `FACILITY`
class (it is, on essentially every hardened system), **every module loaded in
the calling address space must be program-controlled**, or `__passwd` fails
with `EMVSERR` / reason `JRENVDIRTY`. Two ways to satisfy that:

**Option 1a — IBM's `node-racf` module (chosen path — try this first).**
IBM publishes [`node-racf`](https://github.com/ibmruntimes/node-racf)
(npm: [`racf`](https://www.npmjs.com/package/racf)) alongside the IBM Open
Enterprise SDK for Node.js: `authenticate(userid, password)` does the
credential check, and `checkPermission()` additionally does SAF resource
authorization (e.g. gate access on a `ZOWEMCP.ACCESS` profile). Its own README
documents the program-control requirement — *"you must set the Program Control
bit on Node and its dependent DLLs using `extattr +p <file>`"* — and ships a
`setup.sh` that does the marking (running it needs READ on
`BPX.FILEATTR.PROGCTL` in `FACILITY`; `checkPermission()` needs READ on
`BPX.SERVER`). So marking `node` with `+p` **is** the IBM-documented path when
using SAF from inside Node — analogous to Java, where the IBM z/OS Java SDK
ships its binaries program-controlled at install time.

The accepted trade-off: the *whole* Node address space must stay clean —
`node` plus **every native addon we ever load** needs `+p`, and any future npm
dependency with an unmarked native binding dirties the environment and breaks
auth at runtime with `JRENVDIRTY`. The IdP's dependency tree is deliberately
pure-JS today (see above), which is exactly why it's the right process to try
this in. Guardrails for the implementation: `node-racf` must be an **optional,
lazily-loaded backend** (the package still installs and runs off-platform),
the SSH probe stays as the portable fallback behind a `--saf-check
native|ssh|auto` switch, and a `JRENVDIRTY` failure must produce an actionable
operator error naming the unmarked module rather than a generic 401.

**Option 1b — spawned helper (fallback if 1a's constraint bites).** Put the
`__passwd` call in a small program-controlled helper binary the IdP spawns per
attempt — either a new `verify-credentials` command in zowe-native-proto's
`zowex` (already C++, already built for z/OS, already deployed next to the
server) or a ~100-line standalone C helper in this package. A spawned child
gets a fresh address space, so only the helper needs `+p`; Node stays
unprivileged and unmarked, immune to the dependency-tree problem. More moving
parts, but the robust long-term shape if 1a proves fragile. (Prior art: Zowe
ZSS does its `/login` this way, natively in C.)

Plan: **prototype 1a on the validation LPAR first** to shake out the RACF
setup, and decide afterwards whether to keep it or move the call into `zowex`.

### Part 1 validation results (live RACF LPAR, 2026-09-11)

Option 1a was validated end-to-end in isolation (a standalone test script, no
server code) on the same LPAR that runs the dev/test deployment. Everything
below was observed, not assumed.

**Building node-racf for Node 24 on z/OS:**

- Its declared `node-addon-api` `^1.7.1` does not compile under the C++20 the
  Node 24 gyp config mandates (an out-of-range enum cast that modern compilers
  reject). **Swap in `node-addon-api` 8.x** — the addon's code compiles against
  it unchanged.
- The compiler is IBM **Open XL C/C++** (`ibm-clang++64`); plain `xlclang` is
  not what the Node 24 gyp config targets. The LPAR had no GNU make (z/OS
  `/bin/make` rejects node-gyp's Makefiles), so the two compiles + one shared
  link were run directly with the flags from the gyp-generated
  `racf.target.mk` — a build script checked into the test directory reproduces
  this. IBM's Node SDK ships its own headers (`include/node`) and `node-gyp`,
  so no network access is needed at build time.
- Do **not** try to satisfy program control by copying the node launcher or
  `libnode.137.so` out of the install: every layout tried (flat, mirrored
  `bin/`+`lib/`, marked or unmarked) dies at addon load with a silent SIGKILL
  or `CEE3501S`, and copies also lose the `extattr +s` (shared library region)
  attribute. Mark the real install.

**RACF / attribute setup that actually made it work:**

1. `extattr +p` on `racf.node`, the `node` binary, `libnode.137.so`, and
   `libzoslib.so` (needs READ on `BPX.FILEATTR.PROGCTL`).
2. **The non-obvious one:** any *dataset* the runtime loads modules from must
   be in the RACF **PROGRAM class**. On the validation LPAR, Node 24 requires
   `STEPLIB=CEE.SCEERUN2.OVERRIDE` (a newer LE runtime library), and that
   dataset was not covered by the `PROGRAM *` profile — so the address space
   stayed dirty (`JRENVDIRTY`) no matter what was marked in USS. Fixed with
   `RALTER PROGRAM * ADDMEM('CEE.SCEERUN2.OVERRIDE'//NOPADCHK)` +
   `SETROPTS WHEN(PROGRAM) REFRESH`. **This generalizes: any shop running Node
   with an LE STEPLIB override hits the same trap.**

A minimal standalone C `__passwd` tester (clean address space by construction)
was used to separate the mechanism from Node-environment problems: unmarked it
fails with `errno2=090C02AF` (JRENVDIRTY); marked `+p` it returns the real
verdicts (success / `EACCES` / `ESRCH`), confirming `__passwd` verification
works from problem state with no special RACF authority beyond program
control.

**Observed node-racf behavior the implementation accounts for:**

- `authenticate()` returns `true`/`false` only for success/`EACCES`; **every
  other `__passwd` failure is thrown** with the C runtime's `EDC*I` message.
  In particular an **unknown user throws `ESRCH`** ("EDC5143I No such
  process.") — the backend folds that into the generic invalid-credentials
  outcome so clients still cannot distinguish it from a wrong password.
- A lowercase userid is accepted (folded to uppercase on the RACF side).
- `JRENVDIRTY` surfaces as a thrown "EDC5157I An internal error has occurred."
  — the backend maps it to a 503 for the client and an operator log entry
  naming the remediation (extattr list + PROGRAM class).
- `checkPermission()` threw `ESRCH` even in a clean environment; its source
  appears to pass the access-level string where `__check_resource_auth_np`
  expects the class name. **Do not rely on `checkPermission()`** until that is
  investigated/fixed upstream; the implementation uses `authenticate()` only.

**Resulting implementation** (this package): `--saf-check auto|native|ssh`
(default `auto`: native on z/OS when node-racf loads, else the SSH probe);
node-racf is loaded lazily and is deliberately **not** a dependency — deploys
build it out-of-tree and can point `ZOWE_MCP_IDP_RACF_MODULE` at it;
`--saf-check native` fails startup with an actionable error rather than
silently degrading. New login outcomes: *expired password* (correct password
required to trigger it, so safe to show) renders an actionable message on the
login form and `{"error":"password_expired"}` on `POST /login`; a backend
failure renders a generic 503 with the detail going only to the operator log.

### The no-credential environment probe, the doctor, and z/OS integration tests

**The probe.** Verifying a reserved, implausible userid (`ZWEMCPRB`) needs no
real password yet distinguishes the two states that matter: an *unknown user*
verdict (ESRCH) can only come back after `__passwd` actually reached RACF from
a clean, program-controlled address space, while a dirty environment fails
first with `JRENVDIRTY`. The probe runs at startup for `--saf-check native`
(fail fast, actionable error) and `auto` (fall back to SSH with a loud log) —
so a misconfigured environment is a startup condition, not a stream of 503s at
login time.

**`zowe-mcp-zos-saf-idp doctor [--fix]`.** Environment checks separated from
setup, because setup needs different authority:

- *Checks* (read-only, always safe): platform, node-racf loadable, the
  no-credential probe.
- *`--fix`* performs only what the invoking user may be able to do alone:
  `extattr +p` on the node binary, its `lib/*.so`, and `racf.node` (needs READ
  on `BPX.FILEATTR.PROGCTL` and file ownership), then re-probes.
- *RACF changes are never executed* — they are system-wide security policy.
  The doctor prints the exact commands for the RACF administrator instead: a
  `RALTER PROGRAM * ADDMEM(...)` per dataset it finds in the process's actual
  `STEPLIB`, the `SETROPTS WHEN(PROGRAM) REFRESH`, and the
  `BPX.FILEATTR.PROGCTL` PERMIT if `extattr` itself is refused.

**z/OS integration tests** (`dist/zos-integration-test.js`, also
`npm run test:zos`): the unit suite runs off-platform against *recorded* z/OS
behavior, which cannot catch a contract drift across z/OS versions, ESM
configurations, or node-racf releases — so the contract itself is validated by
tests that run ON z/OS. They are built on `node:test` with zero dependencies
(vitest/esbuild cannot run on z/OS) and ship compiled in the tarball. The
contract tests (module load, ESRCH mapping via the probe, `auto` resolution)
need no credentials; the credential tests (`EACCES` mapping, uppercase
folding, an end-to-end native `POST /login` minting a real JWT) read
`ZOWE_MCP_IT_USER` / `ZOWE_MCP_IT_PASSWORD` and must use a **disposable**
account — the wrong-password case records one failed attempt (cleared by the
success that follows). Run them after any z/OS upgrade, ESM change, node
SDK update, or node-racf rebuild. Validated 2026-09-11 on the live RACF LPAR:
all five pass, doctor all-OK.

### Part 2: running tools as the authenticated user without their password

> **Update 2026-09-12:** the concrete design for this — direct local spawn of
> `zowex` under the authenticated user via a SURROGAT (`BPX.SRV.<userid>`)
> `setuid()` launcher, superseding the "2b only if latency proves a problem"
> sequencing below — now lives in
> [`zos-local-zowex-identity.md`](./zos-local-zowex-identity.md), including
> why PassTickets were dropped and why SAF Identity Tokens (investigated)
> need authorized code. The text below is kept as the original option
> analysis.

After the IdP mints a JWT, `@zowe/mcp-server` knows *who* the caller is but
still needs their password again to SSH-run `zowex` as them. Two mechanisms
remove that, in increasing order of privilege required:

**Option 2a — PassTicket bridge (recommended first step).** The server mints a
one-time **PassTicket** for the JWT's `sub` (via the `R_GenSec` /
`R_ticketserv` SAF callable services) and uses it as the SSH password to
loopback — sshd validates it through the same `__passwd` path, which accepts
PassTickets natively; no sshd configuration is involved. RACF setup: a
`PTKTDATA` profile for the application (`SSHD` APPL by default for sshd
logins — to be confirmed on the validation LPAR) with a secured signon key,
plus UPDATE access for the server's RACF ID on
`IRRPTAUTH.<applid>.<userid>` (or `.*`) in the `PTKTDATA` class. This is how
Zowe API ML does downstream single sign-on for extending services, so it is
Zowe-idiomatic with documented ESM setup for RACF, ACF2, and Top Secret
(see *zowe-docs*, "Enabling single sign on for extending services via
PassTicket configuration"). The win: **zero changes to the execution path** —
same SSH → `zowex` flow, same sshd audit trail and process isolation; only the
credential provider changes (a PassTicket minter instead of env/Vault/
elicitation — one small native call, sharable with Part 1's helper if 1b is
built). JWT in → tools run as the user → no stored password, no prompt.

**Option 2b — direct local spawn under the client's identity (the full "cut
out sshd" step).** The `spawn()` service honors `_BPX_USERID=<userid>` (or
`INHEUSERID` in the BPXYINHE inheritance structure) and creates the child
process under that identity — all dataset/USS access decisions are then made
as the client (failing `EPERM` / `JRNoChangeIdentity` without authority). The
requirements are what sshd itself has: UID 0, READ on `BPX.DAEMON` in
`FACILITY`, and a program-controlled (clean) address space in the *spawner*.
Design consequence: **never give the Node server daemon authority** — isolate
the identity switch in a small setuid, program-controlled launcher binary that
*itself validates the caller's JWT against the IdP's JWKS* before switching,
so the trust chain is cryptographic rather than "whoever can exec the
launcher". (The thread-level alternative — `pthread_security_np()`, callable
service `BPX1TLS`, governed by `BPX.SERVER` READ/UPDATE plus per-user
`BPX.SRV.<userid>` `SURROGAT` profiles for password-less contexts — fits a
C server like ZSS, not Node's single-threaded event loop; ruled out.)

### Sequencing

1. ✅ **Native verify via `node-racf`** (1a) behind `--saf-check`, SSH fallback
   kept — implemented and validated (see the validation subsection above).
2. **PassTicket credential provider** (2a) in `@zowe/mcp-server` for the
   same-system case — reuses the entire existing SSH/`zowex` machinery.
3. **Direct spawn via a JWT-validating launcher** (2b) only if the SSH
   loopback hop ever proves a real latency/throughput problem — it is the most
   RACF setup and the most new security-sensitive code for the least
   functional gain over step 2.

Steps 1–3 all touch authentication / credential handling, and 2b adds
privilege elevation; each needs the security/integrity specialist review
called out above, and — since parts touch zowe-native-proto and Zowe
conventions — an early design discussion upstream in the Zowe community.

## Real-world deployment findings on a live z/OS LPAR (details generalized)

Validating this against a real LPAR surfaced two findings that generalize beyond
this package. Hostnames, userids, and vendor product names from the validation
environment are intentionally not reproduced here — this section uses generic
placeholders (`Host-A`, `Service-A`, `Service-B`) for anything specific to that
one environment.

### A "no free port" perimeter firewall can still be worked around

Some z/OS LPARs sit behind a perimeter firewall that allows only a small, fixed
allowlist of ports — not a range — and every port on that allowlist may already
be bound by an existing vendor service. On `Host-A`, binding an arbitrary new
port for testing was confirmed reachable at the TCP/IP stack level (z/OS itself
accepted the `bind()` with no complaint), but never reachable from outside the
firewall, because the perimeter only forwards to the pre-approved port list.

The firewall was confirmed to key on **port number alone**, not on which job
owns it. Stopping a currently-idle vendor service (`Service-A`) that was
listening on one of the allowlisted ports — confirmed via an operator "list
active address spaces" command (`D A,L`) — freed that port immediately, and a
replacement listener bound to the same port was reachable from outside the
firewall right away, no firewall change needed. The same held for a second
service (`Service-B`) bound to the LPAR's real network interface rather than
`0.0.0.0` — a replacement listener needs to bind that same specific address,
not just loopback or all-interfaces, to stay reachable the same way.

This is a real option on a lab/demo LPAR where a given allowlisted service
isn't needed continuously, but it stops a real (possibly licensed) service —
treat it as a decision for whoever owns that LPAR, not something to do by
default, and restore the original service afterward if anyone else might
depend on it.

### Getting Node.js to actually run under a constrained OMVS MEMLIMIT

On a memory-constrained z/OS LPAR (OMVS `MEMLIMIT` well under IBM's recommended
minimum — see the WASM-OOM finding above), reaching for a Node.js install other
than the one already validated on that LPAR can fail in a very misleading way:
every real script execution — even `node -e "console.log(1)"` — gets killed
outright (`SIGKILL`, exit 137) with **zero output**, while `node --version`
alone looks completely fine, because it doesn't reach the code path that dies.
This looks exactly like an OOM kill and can burn a lot of time chasing
memory-limit theories (`--jitless`, `--max-old-space-size`, RACF
program-control checks — none of it was the cause here).

The actual cause: the LPAR's Language Environment runtime library was
back-level for the Node.js version in the already-working install, and Node
needs an explicit `STEPLIB` override pointing at a newer LE runtime library to
resolve an external function the base library is missing
(`CEE3561S External function ... was not found in DLL CRTEQCXS` is the
underlying LE message when the override isn't set — that message just never
reaches the shell as anything more diagnostic than a silent kill). A working
Node.js install on a shop-specific z/OS LPAR is likely to ship with (or need)
a small activation script that sets this `STEPLIB` override, plus the usual
z/OS Unicode/tagging environment variables (`_BPXK_AUTOCVT=ON`,
`_CEE_RUNOPTS="... FILETAG(AUTOCVT,AUTOTAG) POSIX(ON)"`, `_TAG_REDIR_*=txt`).
**Source that script rather than hand-rolling `PATH`/`LIBPATH`**, and if a
fresh Node invocation dies with no output at all, check for a missing
`STEPLIB` override before spending time on memory-limit theories.

### HTTPS via AT-TLS (no TLS in Node.js)

Both listeners (IdP and MCP server) can serve HTTPS without the Node processes
ever touching key material, by letting z/OS Communications Server AT-TLS
terminate TLS in the TCP/IP stack (z/OS CS IP Configuration Guide,
"Application Transparent Transport Layer Security data protection"). This is
the durable fix for clients that refuse or silently upgrade plain http
(managed Chrome's HTTPS-Only mode broke the OAuth flow this way).

- **Certificates stay in RACF**: a local CA and a server certificate (SAN =
  the LPAR hostname — browsers ignore CN) created with `RACDCERT`, connected
  to a keyring owned by the ID that runs the Node processes. AT-TLS reads the
  ring under that identity; nothing is exported to the filesystem except the
  CA's public certificate for client trust stores.
- **AT-TLS policy**: Policy Agent with one `TTLSRule` matching the two local
  ports, `Direction Inbound`, `HandshakeRole Server`. Loopback
  traffic is excluded from the rule (`RemoteAddr` condition), so on-LPAR smoke
  tests and `curl` against `127.0.0.1` keep speaking plain http.
- **No ICSF ⇒ TLS 1.2 with RSA key exchange only.** On an LPAR without ICSF,
  System SSL has no EC crypto: TLS 1.3 (ECDHE groups) and ECDHE TLS 1.2 suites
  fail the handshake with alert 40 while the TLS record layer works — a
  confusing signature (`openssl s_client` shows `Protocol: TLSv1.3, Cipher is
  (NONE)`). The policy pins `TLSv1.3 Off` plus an explicit
  `TLS_RSA_WITH_AES_*_GCM_*` cipher list (AES-GCM itself is CPACF, no ICSF
  needed); mainstream clients (browsers, Node) still accept static-RSA suites.
  Re-enable TLS 1.3 and drop the pin if ICSF is started.
- **Integrating with an existing Policy Agent**: a running PAGENT STC may be
  invisible to a non-root `ps` (z/OS shows only your own processes) — it
  refuses a second copy ("can not run more than one copy"). Add a `TTLSConfig`
  statement to its existing main config instead, and refresh with `F
  PAGENT,REFRESH` or a `SIGHUP` (both documented). Editing a config member in
  a dataset held by started tasks fails from USS (`fopen` for write allocates
  the PDS exclusively — EDC5061I errno2 0xC00B0403); a batch IEBGENER step
  with `SYSUT2 ... DISP=SHR` and the content instream does it cleanly.
- **The IdP runs with `--tls-terminated`** and an `https://` issuer: AT-TLS
  forwards a plain socket with no proxy headers, so the app forces the request
  scheme itself (dropping any client-supplied `X-Forwarded-*`) to satisfy
  oidc-provider's https-issuer checks and Secure cookies.
- **The MCP server needs no code change**: `ZOWE_MCP_JWT_ISSUER` /
  `_AUDIENCE` / `_OAUTH_RESOURCE` flip to `https://` URLs. Its OIDC
  discovery/JWKS fetch to the IdP then goes out as an ordinary Node HTTPS
  *client* call, which needs the local CA in `NODE_EXTRA_CA_CERTS` (part of
  the deployment env contract).

## Testing

- **z/OS integration tests**: `node dist/zos-integration-test.js` on the LPAR
  (see the doctor/integration-tests subsection in the design section above) —
  validates the native SAF contract against the real security manager;
  all five passed on a live RACF LPAR 2026-09-11, including an end-to-end
  native `POST /login` minting a real JWT.
- Unit + integration: `npm test -w packages/zowe-mcp-zos-saf-idp` — mocked SAF
  check; a real sign→verify round trip against `@zowe/mcp-server`'s actual
  `verifyBearerJwt`; `/login` route behavior (rate limiting, generic errors, no
  credential leakage); discovery/JWKS consistency (RFC 8414 alias identical,
  both JWKS routes expose the same key, no private material); DCR policy
  (VS Code-shaped registration accepted, disallowed redirects rejected,
  malformed/oversized bodies handled); and a **full scripted
  authorization-code + PKCE flow** (DCR → `/auth` → login form → consent →
  code → `/token`) asserting the JWT claims, verification by the real MCP
  server verifier, refresh-token rotation (replay rejected), wrong PKCE
  verifier rejected, and in-flow rate limiting.
- Opt-in e2e (`ZOWE_MCP_ZOS_IDP_E2E=1`, modeled on
  `keycloak-http-jwt.e2e.test.ts`): a real `/login` against a real SSH-reachable
  account → real JWT → `@zowe/mcp-server`'s real `startHttp()` configured with
  this IdP's issuer/JWKS → a real `tools/call` succeeds with the minted token.
- **VS Code validated end-to-end against a real z/OS LPAR** (2026-09-11), with
  **no tunnel**: the IdP ran on a firewall-allowlisted port on the LPAR's real
  interface (`--allow-nonloopback`; a freed vendor-service port — see the
  deployment findings below) and the MCP server's issuer env pointed at that
  public URL. VS Code hit the `401` challenge, discovered the IdP, registered
  via DCR (its real redirect set: `https://vscode.dev/redirect`,
  `https://insiders.vscode.dev/redirect`, port-less `http://127.0.0.1/` — the
  ephemeral-port loopback callback is matched per RFC 8252 §7.3), opened the
  browser to the SAF login, and completed consent → code → token → working MCP
  tools. Two findings from getting there:
  - **Do not put `form-action` in the interaction pages' CSP.** Chromium
    (Edge/Chrome) enforces `form-action` against every redirect following a
    form POST, and the consent submission's chain deliberately ends on the
    OAuth client's own origin — `form-action 'self'` silently kills the
    navigation right after "Allow" (the scripted test client doesn't enforce
    CSP, so only a real browser catches this). CSRF remains covered by the
    interaction-cookie/`:uid` binding.
  - VS Code caches its dynamic client registration; because this IdP is
    in-memory, every IdP restart requires "Manage Dynamic Authentication
    Providers" → remove the entry → Reload Window before reconnecting.
- **OAuth AS validated end-to-end on a real z/OS LPAR** (2026-09-10): the full
  oidc-provider-based server was packed with bundled dependencies
  (`npm pack -w zowe-mcp-zos-saf-idp`), transferred as **one** 1.4 MB `.tgz`
  (binary `scp`, ~10 s vs ~10 min for a file-by-file copy) and installed with
  `npm install ./<file>.tgz` — npm decompresses with Node's own zlib, so the
  LPAR's missing `gzip` only rules out shell-level `tar -xzf`, not the tarball
  route (npm's allow-scripts blocked ssh2's native-accelerator build; the pure-JS
  fallback is what z/OS needs anyway). Running loopback-only with the
  `--no-wasm-*` flags, a scripted client from a workstation through one SSH
  tunnel then exercised: discovery + RFC 8414 alias → anonymous DCR
  (VS Code-shaped redirect set) → `/auth` → the browser login page with a
  disposable RACF account's real password (real sshd/SAF verdict) → consent →
  code → `/token` (RS256 JWT, `iss`/`sub`/`aud` all correct) → refresh →
  rotation replay correctly rejected — and the access token was then accepted
  by the already-running `@zowe/mcp-server` HTTP endpoint on the same LPAR for
  a real `tools/call getContext` (`backend: "zowex"`). The IdP process stayed
  up with no WASM Zone OOM across repeated flows.
- **Manually validated end-to-end on a real z/OS LPAR** (2026-09-09, v1
  `/login`-only build): a
  disposable RACF test account's real password → real `/login` → real RS256
  JWT → `@zowe/mcp-server`'s real HTTP transport (JWT + native SSH both
  enabled) → a real `tools/call getContext` succeeded, and the same request
  without a Bearer token was correctly rejected with `401`. Full transcript,
  deployment gotchas (no `gzip`/`bash` on this LPAR, `scp` EBCDIC-conversion
  trap), and the WASM-OOM finding above are recorded in
  `docs/zos-hosted-server-results.md`.
- **Follow-up the same day**: moved `@zowe/mcp-server`'s HTTP endpoint off a
  loopback-only bind (which needed an SSH tunnel to reach from a client
  machine) onto a firewall-allowlisted port on the same LPAR's real network
  interface, directly reachable with no tunnel — see "Real-world deployment
  findings" above for how that port was freed and what running Node.js there
  actually took. `saf-idp` itself stays loopback-only: its `/login` route
  checks the actual TCP source address of every request and rejects anything
  non-loopback regardless of bind address, by design (see "Scope and
  non-goals" above) — minting a token still needs a tunnel or a local shell
  on the LPAR either way.
