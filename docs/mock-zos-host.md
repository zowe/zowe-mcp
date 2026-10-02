# Mock z/OS host

The mock z/OS host is a local test daemon. It provides an SSH service and an
optional z/OSMF HTTP service.

Use it to test the native Zowe MCP connection path without a z/OS system. The
MCP server uses `--native` and connects through SSH and `zowex-sdk`.

Do not use this daemon in production. It stores test passwords in plain text,
and its HTTP service does not use TLS.

## Choose a mock option

Zowe MCP provides two mock options:

| Option | Server argument | Use |
| --- | --- | --- |
| Direct mock backend | `--mock <dir>` | Test MCP tools quickly with local files. |
| Mock z/OS host | `--native --config <file>` | Test the native SSH and `zowex-sdk` path. |

Start with the [direct mock backend](mock-mode.md) for most development work.
Use the mock host for SSH, authentication, deployment, and protocol tests.

The two options can use the same fixture directory. Do not configure `--mock`
and `--native` on the same MCP server.

## Capabilities and limits

The SSH service provides:

- Password and public-key authentication.
- Authentication failure scenarios.
- A small interactive USS shell.
- The SFTP operations that `zowex-sdk` uses to upload its server package.
- The `zowex server` JSON-RPC channel.
- Native operations for data sets, USS files, jobs, TSO commands, and console commands.

The optional z/OSMF service provides:

- Login, logout, and system information.
- Data set listing.
- Sequential data set reads.
- PDS or PDS/E member reads.
- PDS or PDS/E member listing.

The mock host does not provide:

- A full USS shell or interactive terminal applications.
- General SFTP access to USS files.
- TLS for the z/OSMF service.
- z/OSMF write, job, console, or TSO APIs.
- Persistent z/OSMF tokens.

See the [MCP reference](mcp-reference.md) for the available MCP tools.

## Build and generate fixtures

The examples in this document use a source checkout. First, install the
packages and build the server:

```bash
npm install
npm run build -w @zowe/mcp-server
```

Generate the host fixtures:

```bash
node packages/zowe-mcp-server/dist/index.js mock-zos gen-fixtures \
  --mock-dir ~/mock-zos
```

The command creates this core fixture layout:

```text
~/mock-zos/
  systems.json
  _ssh/
    host_key
    host_key.pub
    users.json
    banner.txt
    motd.txt
  sys1/USER1/
    SAMPLE.COBOL/
    NOTES.TXT
  uss/sys1/u/user1/
```

The `SAMPLE.COBOL` directory represents a PDS/E. The `NOTES.TXT` file
represents a sequential data set.

The command keeps existing fixture files by default. Add `--force` to replace
them:

```bash
node packages/zowe-mcp-server/dist/index.js mock-zos gen-fixtures \
  --mock-dir ~/mock-zos --force
```

Use `--force` only when you want to reset the fixtures. This option also
replaces the local and cached host keys.

If you installed the package, run `zowe-mcp-server mock-zos ...` instead of
`node packages/zowe-mcp-server/dist/index.js mock-zos ...`.

## Start the host

Start the SSH service on port 4022:

```bash
node packages/zowe-mcp-server/dist/index.js mock-zos start \
  --mock-dir ~/mock-zos \
  --port 4022
```

The log contains this message:

```text
[info] SSH    listening on 127.0.0.1:4022
```

Press `Ctrl+C` to stop the host. Use `--port 0` when the operating system must
select an available port.

Set `--log-level debug` to show authentication events, commands, and RPC
methods. The available levels are `error`, `warn`, `info`, `debug`, and
`trace`.

## Test the SSH service

The default user is `USER1`. Its password is `password`.

Open an interactive session:

```bash
ssh USER1@127.0.0.1 -p 4022
```

Run one command:

```bash
ssh USER1@127.0.0.1 -p 4022 'ls -la /u/user1'
```

The shell supports a limited set of common USS commands. It also supports
simple pipes, redirection, `&&`, and `||`.

Test the default failure scenarios:

```bash
# Enter an incorrect password three times.
ssh USER1@127.0.0.1 -p 4022 pwd

# Use "password" for these users.
ssh EXPIRED@127.0.0.1 -p 4022 pwd
ssh LOCKED@127.0.0.1 -p 4022 pwd
```

The host writes recent authentication results to
`~/mock-zos/_ssh/last_auth.json`.

## Connect the MCP server

Create `~/native-mock.json` with this content:

```json
{
  "systems": ["USER1@127.0.0.1:4022"]
}
```

Set the test password:

```bash
export ZOWE_MCP_PASSWORD_USER1_127_0_0_1=password
```

Start the MCP server:

```bash
node packages/zowe-mcp-server/dist/index.js \
  --stdio \
  --native \
  --config ~/native-mock.json
```

The MCP server now uses its native client path. It connects to the mock host,
starts `zowex server`, and sends JSON-RPC requests through SSH.

You can use the same command in an MCP client configuration. See
[Standalone MCP clients](standalone-mcp.md) for client examples and other
credential options.

### Call one MCP tool

Use the `call-tool` command for a quick test:

```bash
ZOWE_MCP_PASSWORD_USER1_127_0_0_1=password \
  node packages/zowe-mcp-server/dist/index.js call-tool \
    --native \
    --config ~/native-mock.json \
    listDatasets dsnPattern="USER1.*"
```

Tool arguments use `key=value` syntax. Use the MCP reference for each tool's
arguments. The command uses the `read-strict` capability tier by default. Set
`ZOWE_MCP_CAPABILITY_TIER=full` to test mutating or execute tools such as
`runConsoleCommand`.

## Configure authentication scenarios

The generator creates these users in `_ssh/users.json`:

| User | Scenario | Result |
| --- | --- | --- |
| `USER1` | `normal` | Authentication succeeds. |
| `EXPIRED` | `passwordExpired` | Authentication fails with a password-expired message. |
| `LOCKED` | `racfRevoked` | Authentication fails with a revoked-user message. |
| `WARNING` | `passwordExpiresInDays` | Authentication succeeds with a three-day warning. |

The SSH and z/OSMF services use these scenarios. Add this object to the
`users` array when you need an authentication delay:

```json
{
  "username": "SLOWAUTH",
  "password": "password",
  "home": "/u/slowauth",
  "systemId": "sys1",
  "scenario": "authDelay",
  "scenarioValue": 5000
}
```

The value of `scenarioValue` is the delay in milliseconds. Restart the host
after you change `users.json`.

To use public-key authentication, add OpenSSH public keys to the user's
`authorizedKeys` array. Restart the host after the change.

```json
{
  "username": "USER1",
  "password": "password",
  "systemId": "sys1",
  "authorizedKeys": ["ssh-ed25519 AAAA... test-key"]
}
```

For native client key settings, see
[Standalone authentication](standalone-mcp.md#authentication-standalone).

## Start the z/OSMF service

Add `--http-port` to start the optional HTTP service:

```bash
node packages/zowe-mcp-server/dist/index.js mock-zos start \
  --mock-dir ~/mock-zos \
  --port 4022 \
  --http-port 8443
```

The log contains both listener messages:

```text
[info] SSH    listening on 127.0.0.1:4022
[info] z/OSMF listening on http://127.0.0.1:8443
```

The HTTP service binds to `127.0.0.1` by default. Use `--http-host` to select a
different address.

Do not expose the plain HTTP service to an untrusted network. Use a TLS reverse
proxy when a client requires HTTPS.

### Endpoints

| Method | Path | Result |
| --- | --- | --- |
| `POST` | `/zosmf/services/authenticate` | Create an `LtpaToken2` cookie. |
| `DELETE` | `/zosmf/services/authenticate` | Revoke the token and clear the cookie. |
| `GET` | `/zosmf/info` | Return mock system information. |
| `GET` | `/zosmf/restfiles/ds?dslevel=<pattern>` | List matching data sets. |
| `GET` | `/zosmf/restfiles/ds/<dsn>` | Read a sequential data set. |
| `GET` | `/zosmf/restfiles/ds/<dsn>(<member>)` | Read a PDS or PDS/E member. |
| `GET` | `/zosmf/restfiles/ds/<dsn>/<member>` | Read a member with the alternate path. |
| `GET` | `/zosmf/restfiles/ds/<dsn>/member` | List members. |

The login request uses Basic authentication. Other requests accept Basic
authentication or the login cookie.

The login, logout, and `restfiles` requests require a nonempty
`X-CSRF-ZOSMF-HEADER` header. The `/zosmf/info` endpoint accepts a request
without this header and writes a warning to the log.

Tokens remain in memory for 30 minutes. A host restart invalidates all tokens.

### Example requests

Log in and save the cookie:

```bash
curl -i -X POST http://127.0.0.1:8443/zosmf/services/authenticate \
  -u USER1:password \
  -H 'X-CSRF-ZOSMF-HEADER: x' \
  -c /tmp/mock-zos-cookies.txt
```

List data sets:

```bash
curl -i 'http://127.0.0.1:8443/zosmf/restfiles/ds?dslevel=USER1.*' \
  -H 'X-CSRF-ZOSMF-HEADER: x' \
  -b /tmp/mock-zos-cookies.txt
```

Read a PDS/E member:

```bash
curl -i 'http://127.0.0.1:8443/zosmf/restfiles/ds/USER1.SAMPLE.COBOL(HELLO)' \
  -H 'X-CSRF-ZOSMF-HEADER: x' \
  -b /tmp/mock-zos-cookies.txt
```

Log out:

```bash
curl -i -X DELETE http://127.0.0.1:8443/zosmf/services/authenticate \
  -H 'X-CSRF-ZOSMF-HEADER: x' \
  -b /tmp/mock-zos-cookies.txt
```

Use `--verbose` to log HTTP headers and bodies. The host redacts authentication
and cookie headers. It limits logged bodies to 4 KiB.

The host writes the last 100 HTTP request records to
`~/mock-zos/_ssh/last_http.json`.

## Manage the host key

The generator creates an RSA host key. The host reuses a key from the fixture
directory or the user cache when one is available.

Show the active fingerprint:

```bash
ssh-keyscan -t rsa -p 4022 127.0.0.1 | ssh-keygen -lf -
```

Generate a new key:

```bash
node packages/zowe-mcp-server/dist/index.js mock-zos gen-host-key \
  --mock-dir ~/mock-zos
```

A new key can cause an SSH host-key warning. Remove the old test entry from
`known_hosts` only after you confirm that you started the local mock host.

Use `--isolate-host-key` for tests that must not read or change the user key
cache.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| SSH reports `Permission denied` | Use a user and password from `_ssh/users.json`. |
| SSH reports that the host key changed | Confirm the host and port. Then remove the old local test key. |
| The native connection stops after authentication | Rebuild `@zowe/mcp-server` and restart both processes. |
| The server repeatedly deploys `zowex server` | Rebuild the server and reinstall its dependencies. |
| The z/OSMF port does not open | Add `--http-port`; the HTTP service is off by default. |
| `runConsoleCommand` is not available | Set `ZOWE_MCP_CAPABILITY_TIER=full`. If it is already set, rebuild or update the MCP server. |

For implementation details, see the
[mock host source](../packages/zowe-mcp-server/src/mock-host/).
