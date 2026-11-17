# zos-attls

AT-TLS awareness for the z/OS HTTP services: fail-closed enforcement for both
directions (a server-side connection gate and a client-side outbound guard,
TypeScript) plus the `SIOCTTLSCTL` query addon (C, `native/`). AT-TLS fails
*open* — a connection no policy rule matches silently stays cleartext; this
package lets a service verify every accepted connection against the stack and
reject the ones AT-TLS did not secure, and verify every outbound connection
*before the first byte is written*.

Full design, verdict matrices, configuration contract, and rollout plan:
**`docs/zos-attls-aware-mode.md`** (inbound gate) and
**`docs/zos-attls-client-mode.md`** (outbound client guard).

- `src/attls-gate.ts` — `createAtTlsGate()`: middleware (403 for connections
  not secured by AT-TLS), upgrade guard, startup self-probe. Modes: `off` ·
  `monitor` (log-only) · `required`. Pure logic, query function injected —
  tested off-platform in `__tests__/`.
- `src/attls-client.ts` — `createAtTlsClientGuard()`: gates outbound sockets
  after `connect()` and before the first write (`gateSocket`/`connect`), a
  gated `http.Agent` (`createHttpAgent`) for plain `http.request`, and a
  post-flight `confirmSecured`. Same modes and injection pattern as the gate.
- `src/attls-load.ts` — addon loader (`ZOWE_MCP_ATTLS_MODULE`, same pattern
  as `ZOWE_MCP_IDP_RACF_MODULE`).
- `native/` — the addon, its `build.sh` (per-LPAR build, unprivileged), and
  on-platform `node:test` contract tests (`npm run test:zos`).

Configuration (details in the design doc § 5): `ZOWE_MCP_ATTLS`
(`off`/`monitor`/`required`), `ZOWE_MCP_ATTLS_MODULE` (addon path),
`ZOWE_MCP_ATTLS_LOOPBACK_CLEAR` (`reject` by default; `allow` opts loopback
peers out — required on hosts whose policy deliberately keeps loopback clear).
