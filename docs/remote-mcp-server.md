# Remote server guide

This guide is for administrators who run one Zowe MCP server for a team. Users
connect to it over HTTPS from their MCP clients and do not install anything on
their workstations.

If you only want to use Zowe MCP yourself, follow the
[quick start](../README.md#quick-start) instead. A local server needs none of
the settings on this page.

## How a remote server works

A remote server authenticates two separate connections:

| Connection | Authentication | Configured by |
| --- | --- | --- |
| MCP client to Zowe MCP | [OAuth 2.1](https://oauth.net/2.1/) access token (a JWT) from your identity provider | The administrator |
| Zowe MCP to z/OS | SSH key or password of a z/OS user ID | Each user |

- Zowe MCP validates tokens but does not issue them. You need an
  [OpenID Connect](https://openid.net/developers/how-connect-works/) identity
  provider, such as Keycloak, Microsoft Entra ID, or Okta.
- The token identifies the person. It does not grant z/OS access. Each user
  adds a z/OS connection with their own user ID, and z/OS security decides what
  that user ID can do.

## Before you start

- A host with [Node.js](https://nodejs.org) 24 or later that can reach z/OS
  over SSH.
- The server package, installed as described in
  [Install the server](standalone-mcp.md#install-the-server).
- An identity provider with an issuer URL and a JWKS URL.
- A TLS certificate, and a reverse proxy that terminates HTTPS in front of the
  server. Zowe MCP itself listens on plain HTTP.

## Start the server

```bash
export ZOWE_MCP_JWT_ISSUER=https://idp.example.com/realms/zowe
export ZOWE_MCP_JWKS_URI=https://idp.example.com/realms/zowe/protocol/openid-connect/certs
export ZOWE_MCP_TENANT_STORE_DIR=/var/lib/zowe-mcp/tenants
export ZOWE_MCP_OAUTH_RESOURCE=https://zowe-mcp.example.com/mcp
export ZOWE_MCP_PUBLIC_BASE_URL=https://zowe-mcp.example.com

zowe-mcp-server --http --native --port 7542
```

| Setting | Purpose |
| --- | --- |
| `--http` | Serve MCP over Streamable HTTP at the `/mcp` path instead of stdio. |
| `--native` | Connect to z/OS over SSH. |
| `--port` | Listening port. The default is 7542. |
| `ZOWE_MCP_JWT_ISSUER`, `ZOWE_MCP_JWKS_URI` | Turn on token validation. Set both. |
| `ZOWE_MCP_TENANT_STORE_DIR` | Directory where the server saves each user's z/OS connections. It also registers the `addZosConnection` and `removeZosConnection` tools. |
| `ZOWE_MCP_OAUTH_RESOURCE` | Public URL of the MCP endpoint. Clients read it to find your identity provider. |
| `ZOWE_MCP_PUBLIC_BASE_URL` | Public base URL of the server. The server uses it to build the browser page where a user enters a z/OS password. |

With token validation on, the server listens on all network interfaces. Set
`--http-host` or `ZOWE_MCP_HTTP_HOST` to bind to one address, such as
`127.0.0.1` when the reverse proxy runs on the same host.

The server refuses to start in HTTP mode without token validation unless you
pass `--http-allow-no-auth`. That option is for testing on your own machine. It
binds to `127.0.0.1` only, and anyone who can reach the port can use every
tool.

## What users do

1. Add the server URL, such as `https://zowe-mcp.example.com/mcp`, to their MCP
   client. See
   [Manual client config](remote-http-mcp-registry.md#4-manual-client-config-cursor--vs-code-mcpjson).
2. Sign in to the identity provider when the client asks.
3. Ask the assistant to add their z/OS connection, such as
   `USERID@sys1.example.com`. The assistant calls `addZosConnection`.
4. Enter their z/OS password when the client prompts. A client that supports
   URL-mode elicitation opens a page on the server in the browser, so the
   password does not pass through the AI client.

## Decide how the server gets z/OS credentials

The server looks for z/OS credentials in the same order as a local server: SSH
key, password environment variable, HashiCorp Vault, and then a prompt to the
user.

On a shared server, let each user enter their own password in the prompt.
Credentials that you place on the server are found by the connection name
(`user@host`), not by the signed-in person. Any signed-in user who adds that
connection uses that credential. This also applies to SSH keys in the home
directory of the account that runs the server. Set `ZOWE_MCP_DISABLE_SSH_KEY=1`
if that account has keys that users must not use.

See [Authentication](standalone-mcp.md#authentication) for the credential
settings.

## Choose the capability tier

The default tier, `read-strict`, registers read-only tools. Set
`--capability-tier` or `ZOWE_MCP_CAPABILITY_TIER` to allow more. The tier
applies to every user of the server. See
[Safety and security](../README.md#safety-and-security).

## More detail

| Topic | Document |
| --- | --- |
| Token validation, the per-user connection store, and store encryption | [Authentication and z/OS access](mcp-authentication-oauth.md) |
| Reverse proxy settings, client configuration, and MCP registry entries | [Remote HTTP MCP: registry and clients](remote-http-mcp-registry.md) |
| A complete test environment on one machine with Keycloak and HTTPS | [Remote server test environment with Keycloak](remote-dev-keycloak.md) |
| A test MCP registry on one machine | [Local MCP registry](local-registry-setup.md) |
| The security model | [Safety and security principles](mcp-safety-security-principles.md) |
