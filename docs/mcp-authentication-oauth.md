# Authentication and z/OS access

Zowe MCP authenticates two connections:

| Connection | Authentication | Purpose |
| --- | --- | --- |
| MCP client to Zowe MCP HTTP | Bearer JWT | Controls access to the remote MCP server and identifies the user. |
| Zowe MCP to z/OS | SSH key or password | Controls access to data sets, jobs, and USS resources. |

An OAuth token never replaces an SSH credential. Local stdio connections do not
use OAuth because the client starts the server as a local process.

## Protect a remote HTTP server

Use JWT authentication for an HTTP server that other users or hosts can reach.
Use HTTPS between the client and the reverse proxy or MCP server.

Set these variables on the MCP server:

| Variable | Purpose |
| --- | --- |
| `ZOWE_MCP_JWT_ISSUER` | Expected value of the token's `iss` claim. |
| `ZOWE_MCP_JWKS_URI` | URL for the issuer's signing keys. |
| `ZOWE_MCP_JWT_AUDIENCE` | Optional expected value of the token's `aud` claim. |
| `ZOWE_MCP_OAUTH_RESOURCE` | Optional public MCP URL in OAuth metadata. |

Set both `ZOWE_MCP_JWT_ISSUER` and `ZOWE_MCP_JWKS_URI`. The server exits if you
set only one variable.

Clients must send this header on each `/mcp` request:

```http
Authorization: Bearer <access-token>
```

The server accepts RS256 tokens. It checks the signature, issuer, expiry time,
and optional audience and `nbf` claims. Each token must contain a `sub` claim.

The first token on an MCP session sets the user for that session. Later requests
on the session must use the same `sub` value.

The server publishes OAuth protected resource metadata when JWT authentication
is active. Set `ZOWE_MCP_OAUTH_RESOURCE` if the generated URL does not match the
public URL. See [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) for the
metadata format.

Do not expose an HTTP server without authentication. The
`--http-allow-no-auth` option is for local development. Without JWT
configuration, the server binds to loopback unless you set another host.

For TLS and reverse proxy settings, see
[Remote HTTP MCP](remote-http-mcp-registry.md#https-reverse-proxies-and-public-urls).
For a local Keycloak environment, see
[Remote HTTP MCP with local Keycloak](remote-dev-keycloak.md).

## Save connections per user

The server uses the JWT `sub` value to find the user's saved connections. Each
MCP session keeps its own active system. Sessions for the same user use the same
saved connection list.

Per-user connection tools require all of these settings:

- HTTP transport;
- JWT authentication;
- the native SSH backend; and
- `ZOWE_MCP_TENANT_STORE_DIR`.

Without the store directory, the server keeps SSH sessions and password prompts
separate for each user. It does not save connections. It also does not register
`addZosConnection` or `removeZosConnection`.

Set an absolute path for the store:

```bash
export ZOWE_MCP_TENANT_STORE_DIR=/var/lib/zowe-mcp/tenants
```

The server can start without `--system` or `--config` when the per-user store is
active. A user can then call `addZosConnection` with `user@host` or
`user@host:port`.

`addZosConnection` checks the connection format and saves it. The tool does not
check the network or the SSH credential. The user calls `setSystem` when the
connection is ready.

`removeZosConnection` removes a connection from the user's file. It cannot
remove a connection from `--system` or `--config`.

Connections from `--system` and `--config` are bootstrap connections. Every
user can see them. The server adds each user's saved connections to this common
list.

See the [MCP reference](mcp-reference.md) for the tool inputs and outputs.

### Store contents

Each user file can contain:

- saved connection names;
- saved job cards; and
- the last update time.

The file does not contain SSH passwords, private keys, or OAuth tokens. The
server gets SSH credentials from keys, environment variables, Vault KV, or an
MCP prompt.

A job card from `--config` is common to all users. A job card from an MCP prompt
is saved only for that user.

The server hashes `sub` to create the filename. Where supported, it creates new
directories with mode `0700` and new files with mode `0600`. It replaces files
atomically.

### Encrypt the store

The files contain plaintext JSON by default. Set `ZOWE_MCP_TENANT_STORE_KEY` to
encrypt them with AES-256-GCM.

Use a random 32-byte key. Supply it as 64 hexadecimal characters or as base64.

Keep the same key after a restart. If you lose or change the key, the server
cannot read the existing files. Keep the key and file backups in separate
locations.

The server does not rotate keys or delete old user files. Removing a connection
does not remove saved job cards.

### Deployment limits

The store uses the local file system. It is not a shared database.

HTTP sessions and memory caches belong to one server process. Route each MCP
session to one process. Do not let processes update the same user file at the
same time because the store does not synchronize writes.

The store does not grant access to z/OS. Use SAF and other z/OS controls to
limit each SSH account.

## Provide z/OS credentials

The native backend tries these methods in order:

1. SSH key;
2. password environment variable;
3. HashiCorp Vault KV; and
4. MCP password prompt.

For variable names, Vault settings, and password prompts, see
[Standalone MCP authentication](standalone-mcp.md#authentication-standalone).

## Related documentation

| Task | Document |
| --- | --- |
| Register or configure a remote HTTP server | [Remote HTTP MCP](remote-http-mcp-registry.md) |
| Run the local Keycloak environment | [Remote HTTP MCP with local Keycloak](remote-dev-keycloak.md) |
| Configure a local registry | [Local registry setup](local-registry-setup.md) |
| Configure SSH keys, passwords, or Vault | [Standalone MCP clients](standalone-mcp.md#authentication-standalone) |
| Review the security model | [MCP safety and security principles](mcp-safety-security-principles.md) |
