# AT-TLS aware client: fail-closed outbound TLS for z/OS service-to-service calls

Status: **Host-A-validated, guard API implemented, and wired into the MCP
server** (2026-09-14) — outbound AT-TLS rules secure a plain-HTTP client
transparently, and the same `zos-attls` query addon (unchanged) gates
outbound sockets fail-closed *before the first byte is written*. The reusable
guard is `createAtTlsClientGuard` (§ 6); the MCP server routes its upstream
calls (OIDC discovery, JWKS) through it when `ZOWE_MCP_ATTLS_CLIENT` is set
(§ 6.1). The SAF IdP makes no production outbound HTTP calls, so it has
nothing to wire. **Live on Host-A since 2026-09-14**: the MCP server (:8044)
fetches the IdP's JWKS and discovery over `http://…:8045` under an outbound
AT-TLS rule with `ZOWE_MCP_ATTLS_CLIENT=required` — rollout and measured
results in § 6.2.
Prototype: `deploy/attls-client-probe.mjs`; policy: the
`zmcp-proto-*` rules in Host-A's `…/zmcp/attls/zmcp-ttls.pol`.
Companion to `docs/zos-attls-aware-mode.md` (server side; shared mechanism in
its § 2).

## 1. Problem

The server-side story (aware mode, `required` on Host-A) covers *inbound*
connections. But the services also make *outbound* calls — the MCP server
fetches the IdP's JWKS and OIDC discovery documents; a future tool could call
another API server. Today those go over `https://` with Node's own TLS
(`NODE_EXTRA_CA_CERTS`). If a deployment instead speaks plain `http://` and
*assumes* an outbound AT-TLS rule wraps it, AT-TLS fails open exactly as on
the inbound side: no rule mapped (PAGENT down, rule typo, `TCPCONFIG NOTTLS`)
→ the request — bearer tokens, client secrets — leaves the stack in
cleartext, silently.

**Questions answered here**

1. Can outbound plain-HTTP calls be transparently secured by AT-TLS? → yes
   (§ 2, § 5 stage A).
2. Can the caller *enforce* that ("AT-TLS aware client"), fail-closed? → yes,
   with the same `SIOCTTLSCTL TTLS_QUERY_ONLY` ioctl, queried after
   `connect()` and **before the first write** (§ 3).
3. Does AT-TLS validate the server's *identity*, or just wrap bytes in TLS? →
   only if the client rule pins `HostReferenceIdDNS` (RFC 6125 check done by
   System SSL during the handshake, § 2.2); without it the client accepts any
   certificate that chains to the keyring's CAs.

## 2. Mechanism (verified facts)

### 2.1 Outbound rules and handshake timing

A `TTLSRule` with `Direction Outbound` + a `TTLSEnvironmentAction` with
`HandshakeRole Client` applies TLS to connections the application initiates.
The client keyring needs only the CA chain — "The partner application
designated as HandshakeRole Client must have a key ring that contains the
root certificates required to authenticate the server's certificate. The
client does not need access to the private keys of any certificate. Clients
can share this key ring." (`ibm-zos-comm-server-ip-config` 3.2.0, topic
`security-picking-handshake-roles`). On Host-A the existing `USERA/ZMCPRING`
(which carries CERTAUTH `ZMCPCA`) serves both roles.

Timing, measured on Host-A (§ 5): with `ApplicationControlled Off` (the
default), the outbound handshake runs **as part of connection setup** — by
the time the application's `connect()` completes, a query already reports
`connStatus=secure` with the client role, protocol, and cipher filled in.
So on this stack (z/OS 3.1) the pre-flight query at connect is a *finished*
verdict, exactly like the server side's — the gate does not have to reason
about a promise that hasn't run yet. (§ 3 still defines a defensive rule for
a `notSecure`+`enabled` snapshot in case other releases sequence the
handshake later; it was never observed on Host-A.) The flip side: a handshake
*failure* also surfaces at connect — see § 2.2.

`TTLS_INIT_CONNECTION` (forcing the handshake from the app, before any write)
exists but requires `ApplicationControlled On` in the policy
(`considerations-tls-controlling-application`) — not needed for this design
and not used: query-only keeps the addon unprivileged and the policy
transparent.

### 2.2 Server identity: `HostReferenceIdDNS`

By default an AT-TLS client validates only that the server's certificate
chains to a CA on the keyring — *any* cert signed by `ZMCPCA` would pass,
regardless of which host presented it. Pinning the expected identity is a
policy parameter on the client rule (`TTLSEnvironmentAdvancedParms` or
`TTLSConnectionAdvancedParms`):

```text
HostReferenceIdDNS  host-a.example.com
```

System SSL then performs RFC 6125 domain-based validation during the
handshake — SAN DNS entries first, subject CN only when no SAN DNS is present
— and "the TLS handshake will fail with GSK_ERR_SERVER_REF_ID_NO_MATCH if the
server identity cannot be verified" (config book, topic
`security-validating-host-name-against-certificate`; parameters
`HostReferenceIdDNS`, `HostReferenceIdCN`, `HostRefWildcardValidation`).
This is the AT-TLS analogue of Node's `checkServerIdentity` and closes the
MITM-with-any-signed-cert gap. Verified live in § 5 stage C: because the
handshake runs at connection setup (§ 2.1), the mismatch surfaces to the
application as **`connect()` failing with `ECONNRESET`** — the app never
gets a writable socket.

There is also an ioctl-side variant (`TTLSK_Host_Status` get with
`TTLS_QUERY_ONLY`, same topic) for checking the hostname *after* the
handshake from the app; the policy-side pin is strictly stronger (the
handshake itself fails) and needs no addon change, so the prototype uses only
the policy parameter.

### 2.3 The query on an outbound socket

`SIOCTTLSCTL TTLS_QUERY_ONLY` is symmetric: issued against a *connected*
outbound socket it returns the same `TTLSi_Stat_Policy` / `TTLSi_Stat_Conn`
pair the server gate decodes (aware-mode doc § 2), with
`TTLSi_Sec_Type = client` once secure. The existing `attls.node` addon and
its `query(fd)` contract are reused **unchanged**.

## 3. The client-side verdict (pre-flight, then post-flight)

Two checks, both with the existing addon:

**Pre-flight — after `connect()`, before the first write.** This is the
fail-closed gate; nothing may be written unless the stack proves a TLS
mapping:

Rows as implemented in `src/attls-client.ts` (logged as `row: n`):

| Row | Pre-flight result | Verdict |
| --- | --- | --- |
| 1 | `connStatus=secure` | proceed (the Host-A-measured normal: handshake ran at connect, § 2.1) |
| 2 | cleartext to a loopback peer with explicit `allowLoopbackClear` opt-in | proceed (mirror of the server gate's row 2) |
| 3 | `connStatus=notSecure`, `policyStatus=enabled` | defensive row, not observed on Host-A: proceed with post-flight verification flagged (a stack that sequences the handshake at first send would look like this; data cannot leave in clear once a TLS rule is mapped) |
| 4 | `policyStatus=notEnabled` (explicit clear rule) | reject |
| 5 | `policyStatus=noPolicy` / `off` | **reject: destroy the socket, write nothing** (the silent-cleartext hazard) |
| 6 | `policyStatus=applControlled` | reject (this client never issues `INIT_CONNECTION`, so TLS would never start) |
| 7 | handshake still in progress after `handshakeWaitMs` (re-queried, incl. `EWOULDBLOCK`) | reject |
| 8 | query throws / fd unavailable | reject (defensive, mirrors server row 6) |

`notEnabled` (explicit clear rule) is a reject on the client side too — an
outbound call that requires TLS must not be downgraded by an over-broad clear
rule. Note that a successful `connect()` by itself proves nothing: TCP setup
succeeds identically with and without a mapped policy (§ 5 stages A vs B);
only the query distinguishes them.

**Post-flight — after the response (or first successful read).** Confirm the
promise was kept: `connStatus=secure`, log `protocol`/`cipher`/
`securityType=client` (the client analogue of the server's row-1 debug line).
A `notSecure` post-flight with data exchanged would mean the pre-flight logic
mis-read the mapping — treat as an error, not a warning.

## 4. Prototype

`deploy/attls-client-probe.mjs` — one process on the LPAR, three plain-HTTP
toy servers plus an aware client driving outbound connections at the stack's
real IP (so outbound rules apply; loopback is also probed). Each toy server
answers with the AT-TLS query of *its* accepted socket, so a successful
response also proves the passive side's view. Policy delta (appended to
`zmcp-ttls.pol`, backup `zmcp-ttls.pol.bak-20260914`):

- `:8046` — inbound TLS-server rule (`env-zmcp-server`, reused) + outbound
  client rule `env-zmcp-client` with the **correct**
  `HostReferenceIdDNS host-a.example.com`;
- `:8047` — deliberately no rules (fail-open negative control);
- `:8049` — inbound TLS-server rule + outbound client rule
  `env-zmcp-client-badref` with `HostReferenceIdDNS wrong-host.example.com`.

Run (as USERA on Host-A):

```sh
. /u/users/group/product/nodejs-zos/activate.sh
cd /u/users/group/product/usera/zmcp/attls/staging
ZOWE_MCP_ATTLS_MODULE=/u/users/group/product/usera/zmcp/zos-attls/node_modules/zos-attls \
  node attls-client-probe.mjs
```

## 5. Results (Host-A, 2026-09-14)

**Before the policy refresh** (PAGENT's file monitor, default 30-min
interval, had not yet picked up the new rules) the probe demonstrated the
exact hazard: all four stages saw `policyStatus=noPolicy`, and stage C's
"assumed TLS" request went through **end-to-end in cleartext with a 200
response** — both app layers happily unaware. The pre-flight gate (stages
A/B) refused before writing, which is the entire point.

**After the refresh** (PAGENT `kill -HUP` by the operator; the live
`:8044`/`:8045` policies survived the re-parse — verified with TLS requests
from off-LPAR before running the probe) — **4/4 stages passed**:

| Stage | Result (measured) |
| --- | --- |
| A `:8046` correct reference id | query **at connect** already `enabled`+`secure`, `TLSv1.2`, cipher `009D` (TLS_RSA_WITH_AES_256_GCM_SHA384), `securityType=client`; unchanged after 300 ms idle and post-response; server view `secure`+`server`, same protocol/cipher |
| B `:8047` no policy | pre-flight `noPolicy`+`notSecure` → fail closed, **0 bytes reached the server** |
| C `:8049` wrong reference id | **`connect()` itself fails, `ECONNRESET`** — the RFC 6125 abort happens during connection setup; the app never holds a writable socket |
| D `:8046` via `127.0.0.1` | the outbound rule (no `RemoteAddr` filter) **does catch loopback**: secure end-to-end, response received — on-LPAR service-to-service calls get TLS too, unless the policy carves loopback out |

## 6. The client guard API (`packages/zos-attls`)

`createAtTlsClientGuard(opts)` in `src/attls-client.ts` — the outbound
counterpart of `createAtTlsGate`, same `off`/`monitor`/`required` modes,
injected `queryFn` (off-platform vitest coverage of the § 3 matrix in
`__tests__/attls-client.test.ts`), same startup fail-fast (`required` refuses
to start off z/OS or on addon-load failure; `monitor` degrades to `off` —
shared logic in `src/attls-runtime.ts`).

- `gateSocket(socket)` — the § 3 pre-flight on a connected socket, before
  anything is written. Resolving means proceed; in `required` mode a rejected
  socket is destroyed and the promise rejects with `AtTlsClientError`
  (`code: 'ATTLS_CLIENT_REJECTED'`, carries the verdict). Verdicts are cached
  per socket (AT-TLS status cannot change mid-connection), and
  `handshakeInProgress`/`EWOULDBLOCK` is polled up to `handshakeWaitMs`
  (default 2 s) — on Host-A the handshake finishes during connect, so this is
  headroom, not a normal wait.
- `connect(options)` — `net.connect` + `gateSocket` in one step.
- `createHttpAgent(agentOptions?)` — an `http.Agent` whose async
  `createConnection` callback delivers the socket only after the gate passes,
  so plain `http.request(url, { agent })` gets the
  write-nothing-unless-secured guarantee end to end (tested against a real
  loopback server: rejected connections leave the server with 0 bytes seen).
- `confirmSecured(socket)` — post-flight: requires `connStatus=secure`
  (throws in `required` mode otherwise). For the defensive § 3 row 3 and
  belt-and-braces after a response.
- `allowLoopbackClear` mirrors the server gate's loopback opt-in (verdict
  row 2, loopback peers only).

### 6.1 MCP server wiring (`ZOWE_MCP_ATTLS_CLIENT`)

The MCP server's only production outbound HTTP calls are the JWT upstream
calls to the IdP — OIDC discovery (`resolveJwksUriFromIssuer`) and the JWKS
fetch (`fetchJwks`), both in `src/auth/bearer-jwt.ts`. Both now go through
`atTlsAwareJsonGet` (`src/auth/attls-client-http.ts`):

- `ZOWE_MCP_ATTLS_CLIENT` = `off` (default) · `monitor` · `required` selects
  the guard mode; `ZOWE_MCP_ATTLS_MODULE` and
  `ZOWE_MCP_ATTLS_LOOPBACK_CLEAR` are shared with the inbound gate (one
  host-level fact each). The effective contract is logged at startup
  (`AT-TLS client mode: …`, plus the env snapshot line), and `required`
  fails startup fast off z/OS or without the addon — the guard is created
  *before* the discovery fetch, so the very first upstream byte is gated.
- Routing: `https://` URLs always use Node TLS (global fetch) — AT-TLS
  client mode is about plain-`http://`-over-AT-TLS transports; `http://`
  URLs go through the guard's gated `http.Agent` when the mode is active
  and through global fetch when it is `off` (dev/test setups unchanged).
- Stdio transport never makes these calls; a set `ZOWE_MCP_ATTLS_CLIENT` is
  warned about and ignored there, mirroring `--attls`.
- The SAF IdP has no production outbound HTTP (its only `fetch` calls are in
  its on-LPAR integration test, loopback) — nothing to wire there.

### 6.2 Deploying it (applied to Host-A's live MCP server, 2026-09-14)

The issuer *identity* stays `https://…` (the `iss` claim in tokens and the
advertised metadata); only the *transport* of the upstream fetches moves to
plain http + AT-TLS. The existing `ZOWE_MCP_JWKS_URI` override is the split
point — when set, discovery is skipped entirely:

```text
ZOWE_MCP_JWT_ISSUER=https://host-a.example.com:8045      # claim, unchanged
ZOWE_MCP_JWKS_URI=http://host-a.example.com:8045/jwks    # transport via AT-TLS
ZOWE_MCP_ATTLS_CLIENT=required
ZOWE_MCP_ATTLS_MODULE=…/zos-attls/node_modules/zos-attls    # already set
```

plus one outbound TTLS rule — on Host-A, `zmcp-out-idp` in `zmcp-ttls.pol`:
`RemoteAddr 192.0.2.50` + `RemotePortRange 8045`, `Direction Outbound`,
reusing `env-zmcp-client` (`HandshakeRole Client`, keyring, the
`HostReferenceIdDNS host-a.example.com` pin). **Scope the rule to the
IdP's real address**: an unscoped remote-port-8045 rule also catches loopback
smoke traffic (whose inbound side is deliberately clear → handshake stall)
and any unrelated outbound to some other host's :8045.

Two findings from the Host-A rollout:

- **Every on-LPAR consumer of the IdP port must move to the http transport.**
  Once the outbound rule exists, an in-process-TLS (`https://`) client on the
  same host gets double-wrapped — its ClientHello rides inside AT-TLS's TLS
  and the plain-http IdP behind AT-TLS sees garbage. Observed live: the
  best-effort registration-endpoint discovery in `transports/http.ts` failed
  with `fetch failed` until it, too, derived its base from the JWKS origin
  and rode `atTlsAwareJsonGet`. Off-LPAR https clients are unaffected (the
  outbound rule only governs connections leaving this stack).
- Rollout per aware-mode § 9: `monitor` first (with `ZOWE_MCP_LOG_LEVEL=debug`
  to see the row-1 lines) — observed only row 1, zero would-refuses: startup
  discovery and the JWKS fetch during a full OAuth e2e both
  `secured by AT-TLS (192.0.2.50:8045) TLSv1.2/009D`. Then `required`:
  OAuth e2e green under enforcement (DCR → login → token → MCP tools as the
  JWT sub). `deploy/host-a-mcp.json` now asserts both startup lines
  (`expectLog` accepts a list). `NODE_EXTRA_CA_CERTS` stays for the deploy
  script's off-LPAR verify, though the server no longer needs it for JWKS.

Per-deployment decision: outbound TLS can stay with Node (`https://` +
`NODE_EXTRA_CA_CERTS`, works today, certificate hostname check in-process)
or move to AT-TLS (uniform policy + SAF-managed keyrings, no CA file on
disk, but *requires* this guard to be fail-closed). They are equivalent in
security only when the AT-TLS variant both pins `HostReferenceIdDNS` and
gates pre-flight.

## 7. Cleanup / review note

The `zmcp-proto-*` rules and the `staging/` directory on Host-A are prototype
scaffolding — inert (the three ports are otherwise unused) but should be
removed with the toy servers when this work productizes or is dropped.

The § 6 guard and its MCP-server wiring touch credential-bearing outbound
traffic (JWKS/discovery — the inputs to token verification) and need the same
human security review as the server gate (aware-mode doc § 11) before
`required` client mode guards anything real. That review has NOT been
performed; nothing in this doc asserts it has.
