# zowe-mcp-zos-saf-idp

A standalone, **dev/test-only** OAuth 2.1 / OIDC authorization server for
[Zowe MCP](https://github.com/zowe/zowe-mcp) HTTP deployments on z/OS,
authenticating users against SAF/RACF — natively via the z/OS `__passwd()`
service (IBM's [node-racf](https://github.com/ibmruntimes/node-racf) addon,
loaded lazily when present), or via a portable connect-only SSH check against
the LPAR's own `sshd` (`--saf-check auto|native|ssh`). It plays the role
Keycloak or another IdP would play off-platform, so the full MCP OAuth flow —
VS Code's included — can be tested with nothing installed outside z/OS.

Built on [`oidc-provider`](https://github.com/panva/node-oidc-provider)
(OpenID-certified, pure JavaScript). Implements the authorization-code flow
with PKCE (S256 required), OIDC + RFC 8414 discovery, Dynamic Client
Registration behind a redirect-URI allowlist, JWT access tokens bound to the
MCP server (RFC 8707), refresh tokens with rotation, and a dependency-free
browser login/consent UI. Signing keys and all state are in-memory only — a
restart invalidates everything, by design.

Quick start:

```sh
zowe-mcp-zos-saf-idp --port 8089 --mcp-resource http://127.0.0.1:7542/mcp
```

Then set on the MCP server: `ZOWE_MCP_JWT_ISSUER=http://127.0.0.1:8089`,
`ZOWE_MCP_JWT_AUDIENCE=http://127.0.0.1:7542/mcp`,
`ZOWE_MCP_OAUTH_RESOURCE=http://127.0.0.1:7542/mcp`.

Full documentation — flags, endpoints, the VS Code walkthrough with SSH
tunnels, z/OS deployment gotchas (WASM/MEMLIMIT node flags, STEPLIB), security
posture and scope: [`docs/zos-saf-idp.md`](../../docs/zos-saf-idp.md).

**Not a production identity provider.** This package needs a security/integrity
specialist review before use beyond a developer's own test session; this README
does not assert that review has happened.
