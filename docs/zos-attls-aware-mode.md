# AT-TLS aware mode: fail-closed transport security for the z/OS HTTP services

Status: **rolled out on Host-A in `required` mode** (2026-09-13): gate + addon
(§ 3-4) validated on the LPAR (`native/README.md`), both services wired
(§ 4.3, § 5), IdP doctor section live (§ 6), § 8.2 tests all pass on-platform
(test 5, the fail-closed proof: real gate rejects cleartext loopback with 403
at the strict default). Deployed per § 7/§ 9 — `monitor` first (only rows 1-2
observed, zero would-rejects), then `required` with `expectLog` on the mode
line; row-1 `secure` decode validated from live off-LPAR traffic
(`TLSv1.2`/`009D`). One § 3.4 correction found during rollout: co-resident
with node-racf the addon must be `extattr +p` program-controlled. Outstanding:
the § 11 human security review (not yet performed) and the optional
PAGENT-down drill (§ 8.3, needs an operator). Related: `docs/zos-saf-idp.md`
(§ "HTTPS via AT-TLS"), `docs/zos-local-zowex-identity.md`,
`deploy/README.md`.

## 1. Problem

On z/OS both HTTP services — the SAF IdP (`:8045`) and the MCP server
(`:8044`) — listen on plain HTTP and rely on AT-TLS (basic, application-unaware
mode) to wrap every remote connection in TLS. AT-TLS **fails open**:

> "When AT-TLS is enabled and a newly established connection is first used, the
> TCP layer of the stack searches for a matching AT-TLS policy installed from
> the Policy Agent. If no policy is found, the connection is made without
> AT-TLS involvement."
> — z/OS CS IP Configuration Guide, *AT-TLS configuration in PROFILE.TCPIP*
> (`ibm-zos-comm-server-ip-config` 3.2.0, topic
> `protection-tls-configuration-in-profiletcpip`)

So any of the following silently downgrades both services to cleartext —
including OAuth bearer tokens and `/login` passwords on the wire:

- PAGENT not running, or the AT-TLS policy failing to install;
- a rule-mapping mistake (port range, direction, priority);
- `TCPCONFIG NOTTLS` after a profile refresh.

**Goal**: make the services *AT-TLS aware* — each accepted connection is
verified against the stack ("was this connection actually secured by AT-TLS?")
and rejected if not, turning the fail-open into fail-closed. The existing
`--tls-terminated` flag on the IdP is the operator's *assertion* that AT-TLS
covers the port; aware mode is that assertion's *enforcement*.

## 2. Mechanism (verified facts)

The stack exposes connection security state through the `SIOCTTLSCTL` ioctl
with request type `TTLS_QUERY_ONLY`, issued by the socket owner against the
accepted socket's fd. **No policy change, no special authority, no program
control is needed** — unlike node-racf's `__passwd`, a query-only ioctl has no
clean-address-space requirement, and `ApplicationControlled Off` in the policy
only blocks *control* requests (`INIT_CONNECTION` etc.), not queries
(per the SIOCTTLSCTL error-code table, `ibm-zos-comm-server-ip-diagnosis`
3.2.0, topic `tls-siocttlsctl-ioctl-return-codes`).

From `/usr/include/ezbztlsc.h` (read from Host-A, CSV2R4 level — the addon
includes this header, nothing is replicated by hand):

```c
#define SIOCTTLSCTL       0xC038D90B
struct TTLS_IOCTL { TTLSi_Ver, TTLSi_Req_Type, TTLSi_Stat_Policy,
                    TTLSi_Stat_Conn, TTLSi_SSL_Protocol, TTLSi_Neg_Cipher[2],
                    TTLSi_Sec_Type, TTLSi_UserID_Len, TTLSi_UserID[9],
                    TTLSi_FIPS140, ..., TTLSi_Neg_Cipher4[4], ... };
```

Query-only call: zero the struct, `TTLSi_Ver = TTLS_VERSION1`,
`TTLSi_Req_Type = TTLS_QUERY_ONLY (0x0000)`, no buffer. Outputs:

| Field | Values (from the header) |
| --- | --- |
| `TTLSi_Stat_Policy` | 1 `POL_OFF` (stack TTLS off) · 2 `POL_NO_POLICY` · 3 `POL_NOT_ENABLED` (rule matched, `TTLSEnabled Off`) · 4 `POL_ENABLED` · 5 `POL_APPLCNTRL` |
| `TTLSi_Stat_Conn` | 1 `CONN_NOTSECURE` · 2 `CONN_HS_INPROGRESS` · 3 `CONN_SECURE` |
| `TTLSi_SSL_Prot` | `0x0303` TLS 1.2, `0x0304` TLS 1.3, … |
| `TTLSi_Neg_Cipher4` | negotiated cipher (2-char field says `4X` when 4-char applies) |
| `TTLSi_Sec_Type` | 2 Server, 3–6 Server with client auth (PassThru/Full/Required/SAFCheck) |
| `TTLSi_UserID`/`_Len` | SAF user ID associated with the partner cert (client-auth policies) — future use, § 10 |

Error contract that matters at runtime (diagnosis book, same topic):
`EWOULDBLOCK` = handshake in progress on a non-blocking socket (Node sockets
are non-blocking); `ENOTCONN` = connection gone; `EPROTOTYPE` = not a TCP
socket. Because the gate runs **when the first HTTP request arrives** (not at
accept), the handshake is already finished for secured connections and
cleartext bytes have already surfaced for unsecured ones — `EWOULDBLOCK`
should not occur and is treated as "not secure" defensively.

### 2.1 The loopback constraint

The live Host-A policy (`…/zmcp/attls/zmcp-ttls.pol`) deliberately maps loopback
to clear (`TTLSRule zmcp-loopback-clear`, priority 256, `TTLSEnabled Off`) so
on-LPAR smoke tests — including the deploy pipeline's loopback-only `/login`
smoke (`deploy/README.md`, `smokeLogin`) and the IdP's loopback-gated `/login`
route (`src/routes/login.ts:48`) — keep speaking plain HTTP. A blanket
"reject everything not secure" would break the deployment pipeline. The gate
therefore supports an explicit, logged loopback-cleartext exemption (§ 4.2).
Per the strict-by-default decision it is **off by default** — hosts that rely
on loopback cleartext (Host-A's smoke login) must opt in via
`ZOWE_MCP_ATTLS_LOOPBACK_CLEAR=allow` in their deployment contract, which
keeps the exemption visible in the target JSON and the startup log. Exempted
connections report the diagnosable status `POL_NOT_ENABLED` (policy present,
explicitly clear) — distinct from `POL_NO_POLICY` (the fail-open accident).

## 3. Component 1: the `zos-attls` native addon

Node exposes no socket ioctl, so a minimal N-API addon does the query.

### 3.1 Location and files

One new workspace package **`packages/zos-attls`** holds everything AT-TLS:
the TS gate + loader (consumed by both services as a workspace dependency,
§ 4.1) and the C addon source (never packed; built on-LPAR):

```text
packages/zos-attls/
  package.json        # name "zos-attls"; devDep node-addon-api ^8.5.0
  src/
    attls-gate.ts     # enforcement gate (§ 4)
    attls-load.ts     # addon loader (ZOWE_MCP_ATTLS_MODULE, duck-typing)
    index.ts
  native/
    attls.cc          # the addon, ~120 lines
    build.sh          # plain sh, Open XL, no GNU make (see 3.4)
    test.mjs          # on-platform node:test smoke (see § 8)
    README.md         # status, build, error contract, deploy path
  __tests__/          # off-platform vitest for the gate (fake queryFn)
```

Like node-racf and the zowex-launcher, the addon is **never packed into the
npm tarballs** (`bundle-for-pack.cjs` already strips `*.node`); it is built
once per LPAR and referenced by absolute path via `ZOWE_MCP_ATTLS_MODULE`
(same pattern as `ZOWE_MCP_IDP_RACF_MODULE`).

### 3.2 JS API contract

```js
const attls = require(process.env.ZOWE_MCP_ATTLS_MODULE);

// fd: integer file descriptor of a connected TCP socket.
// Returns synchronously (the ioctl is a local, fast kernel call).
attls.query(fd) -> {
  policyStatus: 'off' | 'noPolicy' | 'notEnabled' | 'enabled' | 'applControlled',
  connStatus:   'notSecure' | 'handshakeInProgress' | 'secure',
  // present only when connStatus === 'secure':
  protocol?: 'TLSv1.2' | 'TLSv1.3' | ...,   // decoded from TTLSi_SSL_Prot
  protocolCode?: number,                     // raw 0x0303 etc.
  cipher?: string,                           // TTLSi_Neg_Cipher4 (ASCII)
  fips140?: number,
  securityType?: 'client'|'server'|'serverClientAuthPassThru'|'…Full'|'…Required'|'…SAFCheck',
  partnerUserId?: string,                    // ASCII, only when the stack returned one
}
```

Error contract (mirrors node-racf's "errors are transport problems, statuses
are data"): `query()` **never throws for an insecure connection** — that is a
status. It throws `Error` with `code` (errno name: `'ENOTCONN'`,
`'EPROTOTYPE'`, `'EWOULDBLOCK'`, `'EINVAL'`, …) and numeric `errno` when the
ioctl itself fails. Calling on a non-z/OS platform throws
`code: 'ENOSYS'` (the addon only builds on z/OS anyway; this covers a
mis-copied binary).

### 3.3 C implementation sketch

```cpp
#include <napi.h>
#include <sys/types.h>
#include <sys/ioctl.h>
#include <ezbztlsc.h>       // SIOCTTLSCTL + struct TTLS_IOCTL, verified on Host-A
#include <string.h>
#include <errno.h>

Napi::Value Query(const Napi::CallbackInfo& info) {
  int fd = info[0].As<Napi::Number>().Int32Value();
  struct TTLS_IOCTL ioc;
  memset(&ioc, 0, sizeof(ioc));
  ioc.TTLSi_Ver = TTLS_VERSION1;          // v2 only needed for quadruplet gets (§10)
  ioc.TTLSi_Req_Type = TTLS_QUERY_ONLY;   // BufferPtr/Len stay 0
  if (ioctl(fd, SIOCTTLSCTL, (char*)&ioc) < 0) {
    /* throw Napi::Error with errno + strerror name */
  }
  /* map TTLSi_Stat_Policy / TTLSi_Stat_Conn / protocol / cipher / userid
     into the result object */
}
```

Implementation notes:

- Compile with `-D_ALL_SOURCE` (the header uses `u_char`/`u_short`) plus the
  flag set from the racf `build.sh` (feature-test macros, `-m64`).
- **EBCDIC**: `TTLSi_UserID` and the cipher character fields come back in
  IBM-1047 from the stack; the addon runs in Node's ASCII mode — convert with
  `__e2a_l()` before handing strings to JS. Verify on Host-A with a live secure
  connection (cheap to check, easy to get wrong silently).
- `TTLS_VERSION1` struct is fixed-size; the compiler owns the layout
  (including the LP64 pointer alignment) because we include the real header.

### 3.4 Build (delta from the node-racf recipe)

Reuse the validated Host-A recipe (`docs/zos-saf-idp.md` § building node-racf;
memory: node-addon-api **8.5.0**, Open XL `ibm-clang++64` at
`/usr/lpp/IBM/cnw/v2r2/openxl/bin`, no GNU make → `build.sh` replicates the
gyp flag set). Differences, all simplifications:

- The ioctl itself is unprivileged — no PROGRAM-class profile, no clean
  address space needed for the query. **But co-residency with node-racf adds a
  constraint** (found on Host-A, 2026-09-13): in a process that also calls
  `__passwd`, every loaded DLL must be program-controlled — an uncontrolled
  `attls.node` loaded *before* the racf probe dirties the address space
  (JRENVDIRTY, native SAF backend degrades), and loaded *after* a successful
  `__passwd` it gets the process killed outright (silent rc=137). So on hosts
  running the IdP: `extattr +p …/build/Release/attls.node` (re-run after every
  rebuild; the doctor's extattr instructions and `--fix` include it). The
  standalone MCP server (no node-racf) has no such requirement.
- Single self-contained `.cc`, no third-party C dependencies.
- Suggested install dir on Host-A: `/u/users/group/product/usera/zmcp/zos-attls/`
  with the standard `node_modules/zos-attls/build/Release/attls.node` layout so
  `ZOWE_MCP_ATTLS_MODULE=/u/…/zmcp/zos-attls/node_modules/zos-attls` mirrors
  the RACF module convention.

## 4. Component 2: the enforcement gate (TypeScript)

### 4.1 Where the code lives

The gate lives in the new **`zos-attls`** workspace package (§ 3.1); both the
MCP server and the IdP add it as a workspace dependency. For the IdP this is
its first workspace dep — verify at implementation time that
`bundle-for-pack.cjs` inlines it correctly into the tarball (its
`stripNativeArtifacts` already removes any `*.node`, so the packaging
invariant — no native binaries in the tgz — is preserved automatically).

The gate module is pure logic with the query function **injected**
(`(fd) => AtTlsQueryResult`), so all verdict tests run off-platform with a
fake (§ 8.1).

### 4.2 Verdict matrix

Evaluated once per socket, on the socket's **first HTTP request**; the verdict
is cached on the socket under a `Symbol` and reused for keep-alive requests
(AT-TLS status cannot change mid-connection).

| # | Query outcome | Remote addr | `required` | `monitor` |
| --- | --- | --- | --- | --- |
| 1 | `connStatus: 'secure'` | any | **allow** (debug-log protocol/cipher once) | allow |
| 2 | not secure, any policyStatus | loopback, and `LOOPBACK_CLEAR=allow` explicitly set (default: not set → fall through to rows 3-4) | **allow** (debug: "cleartext loopback allowed, policy=…") | allow |
| 3 | `notSecure`, `policyStatus: 'notEnabled'` | any not exempted by row 2 | **reject** — warn: "explicit clear rule matched but cleartext not permitted here" | allow + warn "would reject" |
| 4 | `notSecure`, `policyStatus: 'noPolicy'` \| `'off'` | any not exempted by row 2 | **reject** — warn: "AT-TLS fail-open detected (PAGENT down / no rule / NOTTLS)" | allow + warn |
| 5 | `handshakeInProgress` or `EWOULDBLOCK` | any | **reject** (defensive; should not occur at request time) | allow + warn |
| 6 | ioctl error (`ENOTCONN`, `EINVAL`, …) or socket fd unavailable | any | **reject** + error log | allow + warn |

Loopback = `remoteAddress ∈ {127.0.0.0/8, ::1, ::ffff:127.x.x.x}` (reuse/extract
the IdP's `isLoopbackAddress`, `src/routes/login.ts:30`).

Rejection = HTTP `403`, JSON body
`{"error":"connection_not_secured_by_attls"}`, `Connection: close`, then the
warn log carries the decoded `policyStatus` — this is what makes a PAGENT
outage (`noPolicy`) instantly distinguishable in the log from an intended
clear rule (`notEnabled`).

The distinction between rows 3 and 4 is deliberately *log-only*: in
`required` mode cleartext is never accepted — even when the policy explicitly
says clear (defense in depth against an over-broad clear rule), and even from
loopback unless the operator opted in via `LOOPBACK_CLEAR=allow`. The only
cleartext exemption is that explicit row-2 opt-in, which is restricted to
loopback peers regardless of what the policy exempts. Operators who truly
want remote cleartext set the mode to `off`.

### 4.3 Gate API and hook points

```ts
export interface AtTlsGate {
  mode: 'off' | 'monitor' | 'required';
  /** Express middleware — install FIRST, before any parsing/auth/logging. */
  middleware: RequestHandler;
  /** Destroys not-secure upgrade attempts in required mode (defensive). */
  attachUpgradeGuard(server: http.Server): void;
  /** One loopback self-connection after listen; logs the policy verdict.
   *  (Takes the server too — it queries the accepted socket from a one-shot
   *  'connection' listener, § 4.4.) */
  startupSelfProbe(server: http.Server, port: number): Promise<void>;
}
export function createAtTlsGate(opts: {
  mode: AtTlsMode;
  queryFn?: (fd: number) => AtTlsQueryResult;  // injected for tests
  modulePath?: string;                          // ZOWE_MCP_ATTLS_MODULE
  allowLoopbackClear: boolean;                  // default false (strict)
  log: (level, msg, fields?) => void;
}): AtTlsGate;
```

fd extraction: `(socket as any)._handle?.fd` — internal but stable on POSIX
libuv; a missing fd is verdict row 6. Confirm on Host-A in the on-platform test
(§ 8.2) before relying on it.

**MCP server** (`packages/zowe-mcp-server/src/transports/http.ts`):

- Create the gate in `startHttp` and `app.use(gate.middleware)` immediately
  after `const app = express()` (`http.ts:151`) — *before* the body parsers
  (`:152-153`) and before any route reaches `verifyBearerOrRespond`
  (`:199-253`), so bearer tokens are never parsed off a cleartext connection.
- `gate.attachUpgradeGuard(httpServer)` next to `app.listen`
  (`http.ts:410-413`).
- `gate.startupSelfProbe(port)` from `onListening` (`:375-408`), which also
  logs the mode line.

**SAF IdP** (`packages/zowe-mcp-zos-saf-idp/src/server.ts`):

- `app.use(gate.middleware)` as the very first middleware in `createIdpApp`,
  before the `tlsTerminated` header scrub (`server.ts:171-185`). The gate
  reads only `req.socket` — it does not consume the body, respecting the
  no-app-level-body-parser rule (`server.ts:200-202`).
- Upgrade guard + self-probe in `startIdpHttp` around `app.listen`
  (`server.ts:271-273`).

### 4.4 Startup behavior (fail fast, log the contract)

| Situation | `required` | `monitor` |
| --- | --- | --- |
| non-z/OS platform (`process.platform !== 'os390'`) | **refuse to start** with actionable message (mirror `saf-verify.ts:92-100`) | warn + degrade to `off` |
| addon missing / load failure | **refuse to start** (message: build with `packages/zos-attls/native/build.sh`, set `ZOWE_MCP_ATTLS_MODULE`) | warn + degrade to `off` |
| addon loads | proceed | proceed |

After `listen`, `startupSelfProbe` opens one loopback connection to the
service's own port, queries the **accepted** (server side) socket directly
from a one-shot `'connection'` listener, and closes both ends — no HTTP
request is sent, so the probe is *log-only* and works regardless of the
`LOOPBACK_CLEAR` setting (with the strict default, a probe going through the
request path would just be rejected by its own gate). The ioctl itself
triggers the policy mapping ("policy was not mapped before ioctl call" is a
documented error condition, i.e. the mapping happens on the call), so no
data needs to flow first. Because the AT-TLS rules are port-scoped, this
probes the real policy state at the real port without needing PAGENT
authority:

- `policyStatus: 'notEnabled'` (Host-A: the loopback clear rule matched) or
  `'enabled'` → log `AT-TLS self-probe: policy installed (status=…)`.
- `'noPolicy'` / `'off'` → in `required` mode log **error**
  `AT-TLS self-probe: NO POLICY AT PORT — remote connections will be
  rejected until PAGENT installs the policy` (the service keeps running;
  remote traffic is already fail-closed, and PAGENT may come up later).

Startup logging per package convention:

- Server: add `attls: { mode, module, allowLoopbackClear }` to the
  `runtimeEnvSnapshot` block (`index.ts:1255-1284`) and one human line in
  `onListening`: `AT-TLS aware mode: required (loopback-clear: allow)`.
- IdP: add `ZOWE_MCP_ATTLS_MODULE` to `RUNTIME_ENV_VARS`
  (`saf-doctor.ts:147-157`) so it lands in startup logs, doctor, and the z/OS
  integration test automatically; print the same mode line next to the
  existing "TLS terminated externally" message (`index.ts:124-135`).

## 5. Configuration contract

| Name | Kind | Services | Values / default | Meaning |
| --- | --- | --- | --- | --- |
| `ZOWE_MCP_ATTLS` | env (server: also `--attls` via `applyEnvOverrides`, `index.ts:244`) | both | `off` (default) · `monitor` · `required` | Enforcement mode |
| `--attls <mode>` | CLI flag | IdP (its convention is flags, `index.ts:36-62`) | same, default `off` | Same; flag wins over env |
| `ZOWE_MCP_ATTLS_MODULE` | env | both (one shared name, one shared build per LPAR) | absolute path | Addon location, `require()`d like `ZOWE_MCP_IDP_RACF_MODULE` |
| `ZOWE_MCP_ATTLS_LOOPBACK_CLEAR` | env | both | `reject` (default) · `allow` | Row-2 exemption, **off by default** (strict): every connection must be AT-TLS secure. Hosts whose policy deliberately keeps loopback clear (Host-A) set `allow` in the deployment contract or the loopback smoke breaks |

Coupling rules:

- IdP: `--attls required|monitor` without `--tls-terminated` is a
  configuration error (aware mode *is* the enforcement of that assertion) —
  validate next to the existing issuer checks (`server.ts:129-142`).
- Server: `ZOWE_MCP_ATTLS != off` is only meaningful with `--http`; warn and
  ignore for stdio transport (stdio same-user mode has no TCP sockets).

## 6. Doctor integration

Extend the IdP `doctor` (`saf-doctor.ts:164`, subcommand wiring
`index.ts:66-72`) with an AT-TLS section, active when mode ≠ `off`:

1. platform is `os390`;
2. `ZOWE_MCP_ATTLS_MODULE` set, addon loads, `query()` on a scratch
   `socketpair`/self-connected TCP socket returns a decodable result
   (any policy status is a pass — this checks the addon, not the policy);
3. print the build instructions block on failure (pattern:
   `BUILD_INSTRUCTIONS`, `saf-doctor.ts:154-159`).

Policy state itself is checked by the startup self-probe (§ 4.4) — doctor
can't bind the live port while the service runs, and the port-scoped rules
make any other port's answer meaningless.

For the MCP server, the same checks fold into a `doctor-attls` sibling of
`doctor-local`, or simply into startup fail-fast (required mode already
refuses to start on every doctor-detectable failure) — decide at
implementation time; startup fail-fast is the minimum.

## 7. Deployment changes (Host-A)

Both gitignored targets gain, in `runtimeEnv`:

```json
"ZOWE_MCP_ATTLS": "required",
"ZOWE_MCP_ATTLS_MODULE": "/u/users/group/product/usera/zmcp/zos-attls/node_modules/zos-attls",
"ZOWE_MCP_ATTLS_LOOPBACK_CLEAR": "allow"
```

The `LOOPBACK_CLEAR=allow` opt-in is required on Host-A because its policy
deliberately keeps loopback clear (§ 2.1) and the deploy pipeline's
`smokeLogin` plus the on-LPAR probes speak plain HTTP over loopback; the
strict default (`reject`) stays for any target that doesn't declare
otherwise. (IdP: `--attls required` appended to `startArgs` instead of the
env mode, per its flag convention.) During rollout `expectLog` moves to the
new startup line, e.g. `"AT-TLS aware mode: required"` — so a deploy fails
if the mode silently didn't take. With the opt-in set, the loopback
`smokeLogin` keeps working (row 2) and the `verifyUrl` HTTPS checks exercise
the secure path (row 1) from the deploy machine.

One-time per LPAR: run `packages/zos-attls/native/build.sh` (as any user; no
RACF setup), place the module dir, done.

## 8. Test plan

### 8.1 Off-platform (vitest, `__tests__/*.test.ts`)

Gate logic with an injected fake `queryFn` — table-driven over the § 4.2
matrix: every row × `required`/`monitor`/`off`; 403 body and
`Connection: close` shape; per-socket verdict caching (two requests, one
query call); throwing `queryFn` → row 6; loopback classification (IPv4, IPv6,
mapped); startup fail-fast on non-z/OS in `required` (mode factory refuses).

### 8.2 On-platform contract tests (node:test — vitest can't run on z/OS)

Added to `zos-integration-test.ts` (IdP) / `packages/zos-attls/native/test.mjs`
for the addon itself, with `skipOffZos` guards (`zos-integration-test.ts:52-61`):

1. addon loads from `ZOWE_MCP_ATTLS_MODULE`;
2. `query()` on a pipe fd throws `EPROTOTYPE`-class error (error contract);
3. `socket._handle.fd` exists on an accepted socket (the fd-extraction
   assumption, § 4.3);
4. ephemeral-port self-connection (no TTLS rule at that port):
   `policyStatus: 'noPolicy'`, `connStatus: 'notSecure'` — proves the decoded
   statuses match the header semantics on a live stack;
5. gate at the strict default (no loopback opt-in) + cleartext loopback
   request → `403 connection_not_secured_by_attls`; with
   `LOOPBACK_CLEAR=allow` → `200`. **Test 5 at the default is the
   fail-open-closed proof** — it is exactly the PAGENT-down shape (cleartext
   reaching Node) being refused.

### 8.3 End-to-end on Host-A (manual/e2e, documented in the runbook)

- Off-LPAR `curl https://Host-A…:8044/.well-known/oauth-protected-resource` →
  works; server log shows the row-1 debug line (`secure TLSv1.2`,
  cipher).
- Existing OAuth flow test (`deploy/oauth-flow-test.mjs`) unchanged.
- Optional destructive drill (needs operator): stop PAGENT →
  off-LPAR request → connection now reaches Node as cleartext → `403` +
  `fail-open detected` in the log; restart PAGENT (`FLUSH PURGE` re-applies).

## 9. Rollout

1. Build the addon on Host-A; run the on-platform addon tests.
2. Deploy both services with `monitor` — watch logs for a day of normal use:
   expect only row-1 (secure) and row-2 (loopback) lines; any "would reject"
   warn is a policy bug to fix *before* enforcement.
3. Flip to `required`, move `expectLog` to the mode line, redeploy, rerun the
   OAuth e2e + smoke.

## 10. Future work unlocked

- **AT-TLS aware client (outbound)**: DONE (2026-09-14) — researched and
  prototype-validated on Host-A, `createAtTlsClientGuard` shipped in this
  package, and the MCP server's JWT upstream calls (OIDC discovery, JWKS)
  are wired through it via `ZOWE_MCP_ATTLS_CLIENT`. See
  `docs/zos-attls-client-mode.md`.
- **Client-cert → SAF identity**: with `HandshakeRole ServerWithClientAuth`
  and `ClientAuthType SAFCheck`, the same query returns `TTLSi_UserID` — the
  RACF user ID mapped from the client certificate (config book, topic
  `considerations-tls-aware-application`). A cert-authenticated alternative to
  the OAuth flow with identity established by the stack; blocked on Host-A
  today by no-ICSF (client-auth ciphersuites are fine with RSA, so possibly
  not blocked — verify).
- **Rule-name diagnostics**: `TTLS_VERSION2` quadruplet gets
  (`TTLSK_TTLSRuleName`, `TTLSK_TTLSEnvironmentActionName`) would let the
  reject log name the exact policy rule that matched — worth adding if
  policy debugging on more LPARs becomes routine.

## 11. Review note

This changes trust-boundary input handling (what the servers accept before
auth runs). Human review of the gate's verdict matrix and the addon's errno
handling is required before `required` mode guards anything real; the
on-platform test 8.2(5) must be green on the target LPAR first.
