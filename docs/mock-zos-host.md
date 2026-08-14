# Mock z/OS Host

A standalone, in-process **mock z/OS daemon** that behaves like a real z/OS host for
the Zowe MCP server. It always speaks real SSH (via the `ssh2` library) — accepting
the SFTP upload of `server.pax.Z` and serving the `~/.zowe-server/zowex server`
exec channel as an in-process JSON-RPC dispatcher backed by on-disk fixtures —
and **optionally** speaks a subset of the z/OSMF REST API on a configurable HTTP
port when you pass `--http-port <n>`.

You can drive it four ways:

1. **Directly with any SSH client** — `ssh USER1@127.0.0.1 -p 4022` for
   interactive USS commands, or `ssh ... -p 4022 'pwd'` for one-shot exec.
2. **From the Zowe MCP server** in `--native` mode — the MCP server has no idea
   it's a mock; the entire production code path (zowex-sdk + ssh2 + JSON-RPC
   over SSH) runs end-to-end.
3. **Via the `call-tool` CLI** — `node dist/index.js call-tool --native ...`
   for one-off tool exercising from the shell.
4. **Via z/OSMF over HTTP** — `curl -u USER1:password -H 'X-CSRF-ZOSMF-HEADER: x'
   -X POST http://127.0.0.1:8443/zosmf/services/authenticate` for Zowe SDK
   clients that talk to z/OSMF. Only the authentication lifecycle is mocked
   today (POST/DELETE `/zosmf/services/authenticate`, GET `/zosmf/info`).

The daemon is a subcommand of the existing `zowe-mcp-server` CLI — no new
binary, no new package. Both listeners share the same `<mockDir>/_ssh/users.json`
catalog so a single set of fixtures gates both transports identically.

---

## Contents

1. [What the mock provides](#what-the-mock-provides)
2. [One-time setup](#one-time-setup)
3. [Start and stop the daemon](#start-and-stop-the-daemon)
4. [Use directly with `ssh`](#use-directly-with-ssh)
5. [Use from the MCP server (production-equivalent path)](#use-from-the-mcp-server-production-equivalent-path)
6. [Use from `call-tool` (CLI smoke harness)](#use-from-call-tool-cli-smoke-harness)
7. [Use from VS Code (Copilot, Claude, MCP-aware extensions)](#use-from-vs-code-copilot-claude-mcp-aware-extensions)
8. [Auth scenarios and fault injection](#auth-scenarios-and-fault-injection)
9. [Directory layout](#directory-layout)
10. [Troubleshooting](#troubleshooting)

---

## What the mock provides

| Surface | Coverage |
|---|---|
| **SSH protocol** | Password + publickey auth; pre-auth banner; pinned `SSH-2.0-OpenSSH_7.6p1` ident; FOTS-coded disconnect messages (`FOTS1373` wrong password, `FOTS1668` expired, `FOTS0830` max attempts, `ICH408I` RACF revoked). |
| **SFTP subsystem** | Just enough to accept `fastPut` of `server.pax.Z` (the upload zowex-sdk does on first connect). Bytes are discarded; a sha256 + size is recorded to `_ssh/last_upload.json`. |
| **Exec channels** | `~/.zowe-server/zowex server` → JSON-RPC dispatcher. `pax -rzf server.pax.Z` → silent RC=0. `cat > /tmp/zrs-pipe-*` / `cat /tmp/zrs-pipe-*` → in-memory streaming for large reads/writes. Anything else → USS shell interpreter. |
| **Shell channel** | Interactive prompt `USER1:/u/user1>`; MOTD with last-login + `/etc/motd`; line-oriented USS commands (`pwd ls cat cd mkdir rm cp mv chmod echo head tail grep wc uname id whoami env exit` plus pipes/redirects/`&&`/`\|\|`). |
| **RPC methods (over `zowex server`)** | Datasets (list, listMembers, read/write, create, delete, copy, rename, getAttributes, toolSearch). USS (listFiles, readFile, writeFile, createFile, deleteFile, chmodFile, chownFile, chtagFile, copyUss, moveFile, unixCommand). Jobs (submitJob, submitJcl, submitUss, getJobStatus, listJobs, listSpools, readSpool, getJcl, cancelJob, holdJob, releaseJob, deleteJob). TSO (tsoCommand). Core (getInfo). |
| **Realistic output** | `uname -a` → `OS/390 SY1 28.00 03 8561 9672`. `id` → `uid=12345(USER1) gid=10(STCGROUP) groups=...`. Job spool files mimic JES2 (`IEF236I`, `IEF142I`, `IEF033I`, `IRR010I`). Errors use IBM message IDs (`IDC3012I`, `EDC5129I`, `ICH408I`, `IEFC452I` ...). |

What it does **not** provide:

- `consoleCommand` MCP tool — the real zowex server doesn't dispatch this method
  (see [zowe/zowe-native-proto](https://github.com/zowe/zowe-native-proto) `native/c/server/rpc_commands.cpp`).
  The mock does answer the wire RPC for direct testing, but `registerConsoleTools`
  in the production MCP server is intentionally still commented out.
- General SFTP browsing of USS — only the `server.pax.Z` upload path is wired.
  Use the `readFile` / `writeFile` RPCs (or the shell channel) for USS access.
- Full PTY / terminal apps (`vi`, `top`, …). The shell channel is line-buffered.

---

## One-time setup

```bash
# Build the MCP server package
npm install
npm run build -w @zowe/mcp-server

# Generate sample fixtures (idempotent; uses --force to overwrite)
node packages/zowe-mcp-server/dist/index.js mock-zos gen-fixtures \
  --mock-dir ~/mock-zos
```

`gen-fixtures` creates:

```text
~/mock-zos/
  systems.json                  # compatible with FilesystemMockBackend, too
  _ssh/host_key, host_key.pub   # RSA-3072 (generated on first start)
  _ssh/users.json               # USER1, EXPIRED, LOCKED, WARNING + scenarios
  _ssh/banner.txt               # pre-auth banner shown to ssh clients
  _ssh/motd.txt                 # post-auth MOTD shown on shell open
  sys1/USER1/SAMPLE.COBOL/      # sample PDS-E with HELLO.cbl and HELLOJCL.jcl
  sys1/USER1/NOTES.TXT          # sample sequential dataset
  uss/sys1/u/user1/README.txt   # sample USS file
```

Default users:

| User | Password | Scenario |
|---|---|---|
| `USER1` | `password` | normal — happy path |
| `EXPIRED` | `password` | `FOTS1668 PASSWORD EXPIRED FOR EXPIRED` on auth |
| `LOCKED` | `password` | `ICH408I REVOKED` on auth |
| `WARNING` | `password` | logs `Your password will expire in 3 days` then succeeds |

---

## Start and stop the daemon

```bash
# Foreground — Ctrl-C to stop
node packages/zowe-mcp-server/dist/index.js mock-zos start \
  --mock-dir ~/mock-zos --port 4022 --log-level info

# Background — choose your own port (0 = let the OS pick)
node packages/zowe-mcp-server/dist/index.js mock-zos start \
  --mock-dir ~/mock-zos --port 4022 --log-level error > /tmp/mock-zos.log 2>&1 &
echo $! > /tmp/mock-zos.pid
```

The startup line on stderr:

```text
Mock z/OS SSH host listening on 127.0.0.1:4022 (mockDir=/Users/petr/mock-zos)
```

Stop it:

```bash
kill "$(cat /tmp/mock-zos.pid)"          # or pkill -f mock-zos
```

Log levels: `error | warn | info | debug | trace`. Use `debug` to see auth
events, EXEC commands, and RPC method dispatch.

---

## Use directly with `ssh`

### Interactive shell

```bash
ssh USER1@127.0.0.1 -p 4022
# password: password
```

You'll see a z/OS-style session:

```text
*****************************************************************
*                  Zowe Mock z/OS SSH Host                      *
*                       https://zowe.org                        *
*                                                               *
*  Open source under the Eclipse Public License v2.0.           *
*  For development and testing only. Not for production use.    *
*  Unauthorized access prohibited.                              *
*****************************************************************
USER1@127.0.0.1's password:
Last successful login for USER1: Mon May 27 18:13:51 2026 from 127.0.0.1
ZWE0000I Welcome to the Zowe mock z/OS host. This system is for development only.
USER1:/u/user1>
```

> **Customize the banner.** The daemon reads the pre-auth banner in this order:
>
> 1. `--banner /path/to/file` (CLI override)
> 2. `<mockDir>/_ssh/banner.txt` (per-mock-dir, written by `gen-fixtures`)
> 3. Built-in default (the Zowe banner above)
>
> Edit `_ssh/banner.txt` to put your own organization's notice; restart the
> daemon to pick it up. The MOTD shown after login follows the same resolution
> with `_ssh/motd.txt`.

Try:

```sh
pwd
uname -a
id
ls -l /u/user1
echo hello > /tmp/x
cat /tmp/x
exit
```

### One-shot exec

```bash
ssh USER1@127.0.0.1 -p 4022 'ls -la /u/user1'
ssh USER1@127.0.0.1 -p 4022 'echo "hi" > /u/user1/note.txt && cat /u/user1/note.txt'
```

### Test auth failure paths

```bash
# Three wrong passwords → disconnect with FOTS1373 logged + FOTS0830 banner
ssh USER1@127.0.0.1 -p 4022 pwd      # type 'badpass' three times

# Expired-password scenario
ssh EXPIRED@127.0.0.1 -p 4022 pwd    # password: password → fails with FOTS1668

# Locked account
ssh LOCKED@127.0.0.1 -p 4022 pwd     # password: password → fails with ICH408I REVOKED
```

The reason for each failed/successful auth is appended to
`~/mock-zos/_ssh/last_auth.json` for easy assertion in tests.

---

## Use from the MCP server (production-equivalent path)

This is the **highest-fidelity** way to exercise the mock: the MCP server runs
in `--native` mode (production code path, real zowex-sdk, real `ssh2` client)
and connects to the mock as if it were a real z/OS host.

### 1. Create a `systems.json`

The MCP server's `--config` file. For one mocked system on port 4022:

```json
{
  "systems": ["USER1@127.0.0.1:4022"]
}
```

Save as `~/native-mock.json` or anywhere convenient.

### 2. Authenticate

The MCP server tries **SSH key auth first**, then a password. The mock host
accepts both.

**SSH key (preferred, exercises the key-auth path end-to-end).** Add the public
key to the mock user's `authorizedKeys` in `users.json`, then point the server at
a matching private key:

```jsonc
// <mockDir>/_ssh/users.json
{
  "users": [
    { "username": "USER1", "password": "password", "systemId": "sys1",
      "authorizedKeys": ["ssh-ed25519 AAAA... your test key"] }
  ]
}
```

```bash
# Use a default ~/.ssh key, a ~/.ssh/config IdentityFile, or pin one explicitly:
export ZOWE_MCP_PRIVATE_KEY_USER1_127_0_0_1=~/.ssh/id_mock
```

To test the **key→password fallback**, leave `authorizedKeys` empty (or use a key
the mock doesn't trust): key auth fails and the server falls back to the password.

**Password.** The connection-spec layer reads passwords from
`ZOWE_MCP_PASSWORD_<USER>_<HOST_NORMALIZED>`. Port is **not** in the env-var
name. For `USER1@127.0.0.1:4022`:

```bash
export ZOWE_MCP_PASSWORD_USER1_127_0_0_1=password
```

Alternatively, JSON map:

```bash
export ZOWE_MCP_CREDENTIALS='{"USER1@127.0.0.1:4022":"password"}'
```

(Set `ZOWE_MCP_DISABLE_SSH_KEY=1` to skip key auth entirely.)

### 3. Start the MCP server in stdio mode

```bash
node packages/zowe-mcp-server/dist/index.js \
  --native \
  --config ~/native-mock.json \
  --stdio
```

For HTTP transport instead:

```bash
node packages/zowe-mcp-server/dist/index.js \
  --native \
  --config ~/native-mock.json \
  --http --port 7542
```

The MCP server connects to the mock daemon at `127.0.0.1:4022`, runs
`~/.zowe-server/zowex server`, gets the readiness handshake, and is ready to
answer tool calls. No special "mock mode" — the server is unaware it's not
real z/OS.

---

## Use from `call-tool` (CLI smoke harness)

The `call-tool` subcommand is the fastest way to invoke a single MCP tool
from the shell.

```bash
ZOWE_MCP_PASSWORD_USER1_127_0_0_1=password ZOWE_MCP_CAPABILITY_TIER=full \
  node packages/zowe-mcp-server/dist/index.js call-tool \
    --native --config ~/native-mock.json \
    listDatasets system=USER1@127.0.0.1:4022 dsnPattern="USER1.*"
```

### Argument syntax cheat sheet

Tool args are `key=value`. Values get coerced as follows:

| Form | Type |
|---|---|
| `key=value` | string (unless number/bool — see below) |
| `key=true` / `key=false` | boolean |
| `key=42` | number |
| `key=[...]` or `key={...}` | JSON-parsed (arrays / objects) |
| `key=@-` | value read from **stdin** |
| `key=@FILE` | value read from file |
| `key:str=value` | force string (e.g. `mode:str=644`) |
| `key:int=value` | force number via `parseInt` |
| `key:bool=value` | force boolean |
| `key:json=value` | force JSON.parse |

**Special heuristic**: keys named `mode`, `perms`, `permissions`, or `umask`
that look like octal modes (e.g. `644`, `0755`) are kept as strings even
without `:str` — so `chmodUssFile path=/u/user1/x mode=644` works.

### Examples

```bash
# Datasets
call-tool ... listDatasets dsnPattern="USER1.*"
call-tool ... listMembers dsn=USER1.SAMPLE.COBOL
call-tool ... readDataset dsn="USER1.SAMPLE.COBOL(HELLO)"
call-tool ... writeDataset dsn=USER1.NEW.DATA \
              'lines=["line one","line two"]'
call-tool ... createDataset dsn=USER1.NEW.DATA type=PS recfm=FB lrecl=80
call-tool ... copyDataset sourceDsn=USER1.NOTES.TXT targetDsn=USER1.NOTES2.TXT
call-tool ... renameDataset dsn=USER1.NOTES2.TXT newDsn=USER1.NOTES3.TXT
call-tool ... deleteDataset dsn=USER1.NOTES3.TXT
call-tool ... searchInDataset dsn=USER1.SAMPLE.COBOL string="HELLO"

# USS
call-tool ... getUssHome
call-tool ... listUssFiles path=/u/user1
call-tool ... readUssFile path=/u/user1/README.txt
call-tool ... writeUssFile path=/u/user1/new.txt 'lines=["hello uss"]'
call-tool ... createUssFile path=/u/user1/dir1 isDirectory=true
call-tool ... chmodUssFile path=/u/user1/README.txt mode=644
call-tool ... copyUssFile sourcePath=/u/user1/README.txt targetPath=/u/user1/copy.txt
call-tool ... deleteUssFile path=/u/user1/copy.txt

# Jobs
call-tool ... submitJobFromDataset dsn='USER1.SAMPLE.COBOL(HELLOJCL)'
call-tool ... listJobs owner=USER1
call-tool ... getJobStatus jobId=JOB00001
call-tool ... listJobFiles jobId=JOB00001
call-tool ... readJobFile jobId=JOB00001 jobFileId=1
call-tool ... getJcl jobId=JOB00001
call-tool ... cancelJob jobId=JOB00001

# TSO
call-tool ... runSafeTsoCommand commandText=TIME
```

(Where `call-tool ...` stands for the full prefix:
`ZOWE_MCP_PASSWORD_USER1_127_0_0_1=password ZOWE_MCP_CAPABILITY_TIER=full
node packages/zowe-mcp-server/dist/index.js call-tool --native --config
~/native-mock.json system=USER1@127.0.0.1:4022`.)

### Use stdin for long content

```bash
echo "alpha
beta
gamma" | node dist/index.js call-tool ... writeUssFile \
  path=/u/user1/big.txt 'lines:json=@-'
```

`@-` reads stdin verbatim, then `:json` parses it. Or with a real JSON array:

```bash
echo '["alpha","beta","gamma"]' | call-tool ... writeUssFile \
  path=/u/user1/big.txt 'lines:json=@-'
```

---

## Use from VS Code (Copilot, Claude, MCP-aware extensions)

The mock daemon is invisible to the MCP client — it just looks like a native
z/OS connection. Configure your MCP-aware extension to launch the MCP server
in `--native` mode pointed at `127.0.0.1:4022`.

### Step 1 — Start the daemon

Keep it running in a separate terminal (or under `launchctl` / `systemd`):

```bash
node /path/to/zowe-mcp/packages/zowe-mcp-server/dist/index.js mock-zos start \
  --mock-dir ~/mock-zos --port 4022 --log-level info
```

### Step 2 — Tell VS Code's MCP extension how to launch the server

#### GitHub Copilot / Claude in VS Code (`settings.json`)

In your user or workspace `settings.json`:

```jsonc
{
  "mcp.servers": {
    "zowe-mock": {
      "command": "node",
      "args": [
        "/Users/you/workspace/zowe-mcp/packages/zowe-mcp-server/dist/index.js",
        "--stdio",
        "--native",
        "--config",
        "/Users/you/native-mock.json",
        "--capability-tier",
        "full"
      ],
      "env": {
        "ZOWE_MCP_PASSWORD_USER1_127_0_0_1": "password"
      }
    }
  }
}
```

With `native-mock.json` content:

```json
{
  "systems": ["USER1@127.0.0.1:4022"]
}
```

#### Generic `claude_desktop_config.json` / similar

The shape is the same:

```jsonc
{
  "mcpServers": {
    "zowe-mock": {
      "command": "node",
      "args": [
        "/abs/path/zowe-mcp/packages/zowe-mcp-server/dist/index.js",
        "--stdio",
        "--native",
        "--config", "/abs/path/native-mock.json",
        "--capability-tier", "full"
      ],
      "env": {
        "ZOWE_MCP_PASSWORD_USER1_127_0_0_1": "password"
      }
    }
  }
}
```

Restart the extension. The MCP server boots, connects to the mock daemon over
SSH, runs `zowex server`, and the LLM can list datasets, read JCL, submit
jobs, etc., as if talking to a real LPAR.

### Step 3 — (Optional) Use HTTP transport with multiple clients

If you want several editors to share one MCP server instance:

```bash
node packages/zowe-mcp-server/dist/index.js \
  --http --port 7542 \
  --native --config ~/native-mock.json
```

And point your MCP clients at `http://127.0.0.1:7542/mcp` (see
`docs/copilot-setup-guide.md` for HTTP transport details).

---

## z/OSMF mock REST API

The daemon ships a small subset of the z/OSMF REST API on a plain-HTTP
listener, gated on the same `<mockDir>/_ssh/users.json` catalog as SSH. The
listener is **off by default** — provide `--http-port <n>` (and optionally
`--http-host <addr>`, default `127.0.0.1`) to enable it.

```bash
zowe-mcp-server mock-zos start \
  --mock-dir ~/mock-zos \
  --port 4022 \
  --http-port 8443
```

stderr now prints both listener lines on startup:

```text
Mock z/OS host (SSH) listening on 127.0.0.1:4022 (mockDir=/Users/you/mock-zos)
Mock z/OS host (z/OSMF HTTP) listening on http://127.0.0.1:8443 (mockDir=/Users/you/mock-zos)
```

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/zosmf/services/authenticate` | Login. Basic auth → `Set-Cookie: LtpaToken2=...`. |
| `DELETE` | `/zosmf/services/authenticate` | Logout. Revokes the token; clears the cookie client-side. |
| `GET` | `/zosmf/info` | Token verification + system metadata JSON. |
| `GET` | `/zosmf/restfiles/ds?dslevel=<pattern>` | List data sets matching `dslevel` (Zowe Explorer / Zowe SDK shape). |
| `GET` | `/zosmf/restfiles/ds/<dsname>` | Read a sequential data set body as `text/plain`. Returns `ETag`. |
| `GET` | `/zosmf/restfiles/ds/<dsname>(<member>)` | Read a PDS / PDS-E member body (z/OSMF canonical parens form). Returns `ETag`. |
| `GET` | `/zosmf/restfiles/ds/<dsname>/<member>` | Same as the parens form; tolerant alternative. |
| `GET` | `/zosmf/restfiles/ds/<dsname>/member` | List members of a PDS / PDS-E (note the literal `member` keyword). Used by Zowe Explorer. |

`POST` and `DELETE` require `X-CSRF-ZOSMF-HEADER: <any non-empty value>` —
real z/OSMF rejects state-changing requests without it.
`GET /zosmf/restfiles/ds` also requires the header (real z/OSMF enforces it
on the `restfiles/*` family). `GET /zosmf/info` is **lenient** (warn-log if
missing, still 200) so clients that skip CSRF on the version-probe call still
work.

Tokens are opaque 64-hex strings with a **30-minute TTL**, in-memory only —
restarting the daemon invalidates all tokens.

### curl examples

```bash
# Login → 200 + Set-Cookie: LtpaToken2=...
curl -i -X POST http://127.0.0.1:8443/zosmf/services/authenticate \
  -u USER1:password \
  -H 'X-CSRF-ZOSMF-HEADER: x' \
  -c /tmp/cookies.txt

# Get system info using the cookie → 200 JSON
curl -i http://127.0.0.1:8443/zosmf/info \
  -H 'X-CSRF-ZOSMF-HEADER: x' \
  -b /tmp/cookies.txt

# List USER1.* data sets → 200 + {items, returnedRows, JSONversion:1}
curl -i "http://127.0.0.1:8443/zosmf/restfiles/ds?dslevel=USER1.*" \
  -H 'X-CSRF-ZOSMF-HEADER: x' \
  -b /tmp/cookies.txt

# Read a sequential data set → 200 + text/plain body + ETag
curl -i "http://127.0.0.1:8443/zosmf/restfiles/ds/USER1.NOTES.TXT" \
  -H 'X-CSRF-ZOSMF-HEADER: x' \
  -b /tmp/cookies.txt

# Read one member of a PDS / PDS-E (parens form — z/OSMF canonical)
curl -i "http://127.0.0.1:8443/zosmf/restfiles/ds/USER1.SAMPLE.COBOL(HELLO)" \
  -H 'X-CSRF-ZOSMF-HEADER: x' \
  -b /tmp/cookies.txt

# List members of a PDS / PDS-E → 200 + {items:[{member:"HELLO"},...]}
curl -i "http://127.0.0.1:8443/zosmf/restfiles/ds/USER1.SAMPLE.COBOL/member" \
  -H 'X-CSRF-ZOSMF-HEADER: x' \
  -b /tmp/cookies.txt

# Logout → 204 No Content; the cookie is cleared client-side
curl -i -X DELETE http://127.0.0.1:8443/zosmf/services/authenticate \
  -H 'X-CSRF-ZOSMF-HEADER: x' \
  -b /tmp/cookies.txt

# Subsequent calls with the revoked cookie → 401
curl -i http://127.0.0.1:8443/zosmf/info \
  -H 'X-CSRF-ZOSMF-HEADER: x' \
  -b /tmp/cookies.txt
```

### `GET /zosmf/restfiles/ds` query params + response shape

Query parameters:

| Param | Required | Notes |
|---|---|---|
| `dslevel` | **yes** | DSN pattern. `*` matches one qualifier, `**` matches zero or more. Trailing lone `*` is treated as `**` (ISPF 3.4 convention). |
| `volser` | no | Restrict the listing to one volume. |
| `start` | no | Pagination cursor — skip entries whose DSN sorts lexically before this value. Re-paginate by passing the last `dsname` from the previous batch. |

Request headers:

| Header | Notes |
|---|---|
| `X-CSRF-ZOSMF-HEADER` | Required (any non-empty value). |
| `X-IBM-Max-Items: <N>` | Optional. Caps the result count. |
| `X-IBM-Attributes: base \| csi \| vol` | Accepted but **not differentiated** in this mock — we always return the rich attribute set. Clients that key on the additional fields just see them populated. |

Response (`200 OK`):

```json
{
  "items": [
    {
      "dsname": "USER1.NOTES.TXT",
      "dsorg": "PS",
      "recfm": "FB",
      "lrecl": 80,
      "blksz": 27920,
      "vol": "VOL001",
      "vols": ["VOL001"],
      "cdate": "2026-05-27",
      "rdate": "2026-05-27",
      "edate": null,
      "migr": false,
      "mvol": false,
      "spacu": "TRACKS",
      "used": 0,
      "extx": 0,
      "sizex": 0,
      "dev": "3390",
      "dsntp": "BASIC",
      "catnm": "SYS1.MASTER.CATALOG"
    }
  ],
  "returnedRows": 1,
  "JSONversion": 1
}
```

Field names match the published IBM z/OSMF REST API exactly: `dsname` (not
`name`), `blksz` (not `blksize`), `vol` (primary) + `vols` (multi-volume
list). The ZNP/zowex-SDK names that come back over SSH-JSON-RPC are
deliberately **not** present here — the wire shapes are different by design.

Edge cases:

| Condition | Status | Body |
|---|---|---|
| No `dslevel` query param | **400** | `IZUF010E` JSON error |
| No matching datasets | **200** | `{items: [], returnedRows: 0, JSONversion: 1}` |
| Missing `X-CSRF-ZOSMF-HEADER` | **403** | `IZUM112E` |
| Missing auth | **401** | empty body + `WWW-Authenticate: Basic realm="z/OSMF"` |

### `GET /zosmf/restfiles/ds/<dsname>` (read content)

Reads the body of a sequential data set or a PDS / PDS-E member. Used by
Zowe Explorer to populate the editor when a user opens a dataset.

**Three URL shapes are accepted**, all mapping to the same handler:

| URL | Meaning |
|---|---|
| `/zosmf/restfiles/ds/USER1.NOTES.TXT` | Sequential dataset read. |
| `/zosmf/restfiles/ds/USER1.SAMPLE.COBOL(HELLO)` | PDS member read — z/OSMF canonical parens form (also accepts URL-encoded `%28HELLO%29`). |
| `/zosmf/restfiles/ds/USER1.SAMPLE.COBOL/HELLO` | PDS member read — slash form, tolerant alternative. |

Request headers:

| Header | Notes |
|---|---|
| `X-CSRF-ZOSMF-HEADER` | Required. |
| `X-IBM-Data-Type: text \| binary` | Optional. Default `text`; `binary` flips `Content-Type` to `application/octet-stream` (the mock stores UTF-8, so no actual encoding change happens). |
| `If-None-Match: "<etag>"` | Optional. When it matches the current ETag, server returns **304** with no body. |

Response (`200 OK`):

- `Content-Type: text/plain; charset=utf-8` (or `application/octet-stream` in binary mode)
- `ETag: "<md5-of-mtime>"` — same scheme used by the SSH/RPC transport
- `X-IBM-Data-Type: text` (or `binary`)
- Body: the data set / member contents as-is

Edge cases:

| Condition | Status | Body |
|---|---|---|
| Data set not found | **404** | `IZUF013E: Data set 'X' was not found.` |
| Member not found in a PDS | **404** | `IZUF013E: Member 'M' was not found in data set 'X'.` |
| Malformed DSN (`123foo`, etc.) | **400** | `IZUF010E` |
| Malformed member name | **400** | `IZUF010E` |
| Missing `X-CSRF-ZOSMF-HEADER` | **403** | `IZUM112E` |
| Missing auth | **401** | `IZUG1077E` + `WWW-Authenticate: Basic realm="z/OSMF"` |
| Cached client (If-None-Match hit) | **304** | empty body, `ETag` only |

### `GET /zosmf/restfiles/ds/<dsname>/member` — list members

Returns the list of members in a PDS or PDS-E. The literal word `member` is
a z/OSMF keyword — Zowe Explorer hits this URL to populate the member tree
under a partitioned dataset.

Request headers:

| Header | Notes |
|---|---|
| `X-CSRF-ZOSMF-HEADER` | Required. |
| `X-IBM-Max-Items: <N>` | Optional. Caps the result count. |
| `X-IBM-Attributes: member` | Accepted but **not differentiated** — the mock always returns just `{member: "<NAME>"}` per item. Real z/OSMF adds `vers`, `mod`, `c4date`, `m4date`, `cnorc`, `inorc`, `mnorc`, `user`, `mtime` when the caller passes this header. |

Optional `?pattern=<glob>` query param passes through to the backend's
member-name matcher (`*` and `%` wildcards).

Response (`200 OK`):

```json
{
  "items": [{ "member": "HELLO" }, { "member": "HELLOJCL" }],
  "returnedRows": 2,
  "JSONversion": 1
}
```

| Condition | Status | Body |
|---|---|---|
| Dataset isn't a PDS / PDS-E, or doesn't exist | **404** | `IZUF013E` |
| Malformed DSN | **400** | `IZUF010E` |
| Missing `X-CSRF-ZOSMF-HEADER` | **403** | `IZUM112E` |
| Missing auth | **401** | `IZUG1077E` + `WWW-Authenticate: Basic realm="z/OSMF"` |

### Verbose HTTP traces — `--verbose`

`mock-zos start --verbose` flips on full request + response logging at the
z/OSMF listener:

```text
[info] [mock-zosmf] --> GET /zosmf/restfiles/ds/USER1.SAMPLE.COBOL/member HTTP/1.1
[info] [mock-zosmf]     > host: 127.0.0.1:8499
[info] [mock-zosmf]     > user-agent: curl/8.7.1
[info] [mock-zosmf]     > cookie: <redacted: 75 chars>
[info] [mock-zosmf]     > x-csrf-zosmf-header: <redacted: 1 chars>
[info] [mock-zosmf] 127.0.0.1 - USER1 [...] "GET ... HTTP/1.1" 200 85 ...
[info] [mock-zosmf] <-- 200 OK
[info] [mock-zosmf]     < content-type: application/json; charset=utf-8
[info] [mock-zosmf]     < etag: W/"55-X2Aujy0NtpHp/2BxCdZXa0Q7J74"
[info] [mock-zosmf]     < body: {"items":[{"member":"HELLO"},{"member":"HELLOJCL"}],"returnedRows":2,"JSONversion":1}
```

Sensitive headers (`Authorization`, `Cookie`, `Set-Cookie`,
`X-CSRF-ZOSMF-HEADER`) are always emitted as `<redacted: N chars>` so log
copies stay safe. Bodies are truncated at 4 KiB. The flag is independent of
`--log-level` — turn it on selectively when you need to see what Zowe
Explorer / the Zowe SDK is actually sending without resorting to a TLS
intercept proxy.

### Scenario mapping (HTTP side)

The same `users.json` scenarios that govern SSH auth also gate HTTP auth:

| User | POST `/zosmf/services/authenticate` | Notes |
|---|---|---|
| `USER1` | **200** + `Set-Cookie: LtpaToken2=…` | happy path |
| `EXPIRED` | **401** + `IZUG1124E` | + `WWW-Authenticate: Basic realm="z/OSMF"` |
| `LOCKED` | **403** + `IZUG1167E` | RACF revoke equivalent |
| `WARNING` | **200** + `X-Password-Expiry-Days: 3` response header | login succeeds with a warning |
| `SLOWAUTH` | delays response by `scenarioValue` ms, then proceeds | same delay as SSH side |

Other error responses use IBM z/OSMF-style JSON bodies (`IZUG1126E` for bad
credentials, `IZUM112E` for missing CSRF, etc.) — see the catalog in
`src/mock-host/zosmf/errors.ts`.

### HTTP access log

Every finished z/OSMF HTTP request leaves two trails:

1. **stderr** — one line per request in nginx **combined** log format with a
   request-time suffix. Severity is bumped automatically: `info` for 2xx/3xx,
   `warn` for 4xx, `error` for 5xx:

   ```text
   [info] [mock-zosmf] 127.0.0.1 - USER1 [29/May/2026:01:13:16 +0200] "GET /zosmf/restfiles/ds?dslevel=USER1.* HTTP/1.1" 200 563 "-" "curl/8.7.1" 10ms
   [info] [mock-zosmf] 127.0.0.1 - USER1 [29/May/2026:01:13:16 +0200] "GET /zosmf/restfiles/ds/USER1.NOTES.TXT HTTP/1.1" 200 37 "-" "curl/8.7.1" 2ms
   [warn] [mock-zosmf] 127.0.0.1 - - [29/May/2026:01:13:16 +0200] "GET /zosmf/info HTTP/1.1" 401 0 "-" "Zowe-Explorer/3.0.0" 1ms
   ```

   Format: `<remote_addr> - <remote_user> [<time_local>] "<request>" <status> <bytes> "<referer>" "<user-agent>" <durationMs>ms`.
   `remote_user` is the resolved auth identity (cookie or Basic) or `-` when
   unauthenticated. Lines visible by default — no `--log-level debug` needed.

   On a TTY, the `[info]`/`[warn]`/`[error]` tag is colorized (green / yellow /
   red) and the `[mock-zosmf]` / `[mock-ssh]` subsystem tag is bolded. Honors
   `NO_COLOR=1` for plain output.

2. **`<mockDir>/_ssh/last_http.json`** — a 100-entry ring buffer paralleling
   `last_auth.json`, structured for test assertions:

   ```json
   [
     {
       "at": "2026-05-28T14:51:16.967Z",
       "method": "GET",
       "path": "/zosmf/restfiles/ds",
       "query": "dslevel=USER1.*",
       "status": 200,
       "username": "USER1",
       "durationMs": 13
     }
   ]
   ```

   Writes are serialized per-file so high-concurrency loops don't lose
   entries to read-modify-write races. The file is created lazily on first
   request and capped at the last 100 entries (oldest dropped).

### Limits in this iteration

- **No TLS.** Plain HTTP only. Clients that require HTTPS must use a reverse
  proxy or set `rejectUnauthorized: false` against the plain port. A `--tls`
  flag with a self-signed cert is planned.
- **Auth + dataset listing only.** Implemented: `POST/DELETE
  /zosmf/services/authenticate`, `GET /zosmf/info`, `GET /zosmf/restfiles/ds`.
  No `restfiles` read/write/create/delete, no `restjobs`, no `restconsoles`,
  no `resttso` — use the SSH layer + `zowex` RPC for those.
- **LtpaToken2 only** — the SDK supports `jwtToken` and `apimlAuthenticationToken`,
  but most clients accept `LtpaToken2`. Easy to add later if needed.
- **`zosmf_hostname` is fixed to `mock-zos.local`** — if a client validates
  hostname, this will trip. A future `--zosmf-hostname` flag could address it.

---

## Auth scenarios and fault injection

`~/mock-zos/_ssh/users.json` holds the auth catalog and scenarios. Default
shape (after `gen-fixtures`):

```jsonc
{
  "defaultSystemId": "sys1",
  "users": [
    { "username": "USER1",   "password": "password",
      "uid": 12345, "gid": 10, "primaryGroup": "STCGROUP",
      "groups": ["SYS1"], "home": "/u/user1", "systemId": "sys1",
      "scenario": "normal" },
    { "username": "EXPIRED", "password": "password",
      "home": "/u/expired", "systemId": "sys1",
      "scenario": "passwordExpired" },
    { "username": "LOCKED",  "password": "password",
      "home": "/u/locked",  "systemId": "sys1",
      "scenario": "racfRevoked" },
    { "username": "WARNING", "password": "password",
      "home": "/u/warning", "systemId": "sys1",
      "scenario": "passwordExpiresInDays", "scenarioValue": 3 }
  ]
}
```

Recognized scenarios:

| `scenario` | Effect |
|---|---|
| `normal` (or unset) | happy path |
| `passwordExpired` | reject auth, log `FOTS1668 PASSWORD EXPIRED` |
| `racfRevoked` | reject auth, log `ICH70001I` + `ICH408I REVOKED` |
| `passwordExpiresInDays` | log warning, then succeed |
| `authDelay` | sleep `scenarioValue` ms before responding (timeout tests) |

Add custom users by editing the JSON file — no restart needed (next connect
re-reads). To rotate the host key (force "REMOTE HOST IDENTIFICATION HAS
CHANGED" on the client side):

```bash
node dist/index.js mock-zos gen-host-key --mock-dir ~/mock-zos
```

Public-key auth: drop OpenSSH-format public keys in
`~/mock-zos/_ssh/authorized_keys/<USERNAME>` (one per line).

### Host key fingerprint (stable per machine)

The daemon's host key — and therefore the SSH fingerprint — is stable per OS
user account. Wiping `~/mock-zos` and re-running `gen-fixtures` does **not**
trigger `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED` on the client side.

Resolution order (first hit wins):

1. `--host-key /path/to/file` CLI flag
2. `ZOWE_MCP_MOCK_HOST_KEY` env var
3. `<mockDir>/_ssh/host_key` (per-mockDir copy, written by `gen-fixtures`)
4. `~/.zowe-mcp/mock-host_key` (machine cache — overrideable with
   `ZOWE_MCP_HOME`)
5. Generated RSA-3072, saved to **both** the mockDir and the machine cache,
   so every future mockDir on this user account inherits the same fingerprint.

Operations you may want:

```bash
# Inspect current fingerprint as ssh would see it
ssh-keyscan -t rsa -p 4022 127.0.0.1 | ssh-keygen -lf -

# Rotate the key (also updates the machine cache → all future mockDirs)
node dist/index.js mock-zos gen-host-key --mock-dir ~/mock-zos

# Use a specific pinned key (e.g. shared across CI machines)
ZOWE_MCP_MOCK_HOST_KEY=/etc/zowe/mock-host_key \
  node dist/index.js mock-zos start --mock-dir ~/mock-zos --port 4022

# Per-test isolation (don't touch the user cache, don't read from it)
node dist/index.js mock-zos start --mock-dir /tmp/test-N --port 0 --isolate-host-key
```

To share a single fingerprint across machines (e.g. a team-wide mock host),
commit the key file somewhere and point each user at it via
`ZOWE_MCP_MOCK_HOST_KEY` or `--host-key`.

---

## Directory layout

```text
~/mock-zos/
├── systems.json                       # legacy/shared catalog (also FilesystemMockBackend)
├── _ssh/
│   ├── host_key, host_key.pub         # RSA-3072
│   ├── users.json                     # auth + scenarios
│   ├── banner.txt                     # pre-auth banner
│   ├── motd.txt                       # post-auth MOTD
│   ├── lastlog/<USER>.json            # last successful login per user
│   ├── last_auth.json                 # ring buffer of last 100 auth outcomes
│   └── last_upload.json               # sha256 of last server.pax.Z upload
├── sys1/                              # one dir per "system"; <HLQ>/<rest.of.dsn>
│   └── USER1/
│       ├── SAMPLE.COBOL/              # PDS-E → directory
│       │   ├── HELLO.cbl
│       │   ├── HELLOJCL.jcl
│       │   └── _meta.json             # dsorg/recfm/lrecl/blksz/volser
│       └── NOTES.TXT                  # sequential dataset → file
├── uss/sys1/u/user1/...               # USS namespace mirrored on disk
└── jobs/sys1/                         # job state machine
    ├── counter.json                   # next JOBnnnnn ID
    └── JOB00001/
        ├── meta.json                  # status, retcode, phaseName, ...
        ├── jcl.txt
        └── spool/
            ├── 001.json, 001.txt      # JESMSGLG
            ├── 002.json, 002.txt      # JESJCL
            ├── 003.json, 003.txt      # JESYSMSG
            └── 004.json, 004.txt      # per-step SYSOUT
```

The mock layout is **interchangeable** with the existing `--mock <dir>`
filesystem-backend mode — the same `mockDir` works for both. Hand-edit files
to seed fixtures; the daemon and `FilesystemMockBackend` both pick up changes
on the next call.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Cannot parse privateKey: Unsupported key format` on daemon start | A PKCS#8 host key from an older build. Re-generate: `mock-zos gen-host-key --mock-dir ~/mock-zos`. |
| ssh client says `Permission denied (publickey,password).` | Wrong password for the user, or username typo. Default is `USER1` / `password`. Real password failures log `FOTS1373` to the daemon's stderr. |
| ssh client says `Connection corrupted` mid-handshake | Old build that wrote raw bytes to the encrypted socket — make sure your dist is fresh: `npm run build -w @zowe/mcp-server`. |
| MCP server `--native` hangs after `Authenticated USER1` | RPC dispatch never starts. Run the daemon with `--log-level debug` and check for `EXEC ~/.zowe-server/zowex server` and `RPC ready`. If those don't appear, the SDK isn't asking for the exec channel — verify your dist matches the daemon (rebuild both). |
| Log shows `RPC ready` then `zowex z/OS server is outdated, redeploying`, then hangs after `SFTP subsystem opened` | zowex-sdk (0.7.1+) compares the `version` field in the RPC readiness payload (`ZSshClient.serverVersion` / `ZSshUtils.checkIfOutdated`) against `ZSshConstants.BUNDLED_SSH_SERVER_VERSION`, and treats a missing/invalid version as outdated. `rpc-channel.ts` resolves and sends this `version` dynamically from the installed `@zowe/zowex-for-zowe-sdk`, so a mismatch here means your `dist` or `node_modules` are stale — rebuild. If the redeploy path *does* run (e.g. a genuinely older bundled SDK), the mock's SFTP subsystem must be listening on `session.on('sftp', …)`, not the generic `session.on('subsystem', …)` — the latter only yields a raw `Channel`, not an SFTP-protocol-parsing stream, so `fastPut` never completes and the client hangs indefinitely. |
| `call-tool` returns immediately but waits ~30 s before exiting | Old build of `call-tool.ts`. The current version calls `process.exit(0)` after work completes. Rebuild. |
| `Tool runConsoleCommand not found` | Expected. The MCP server intentionally does not register the tool (the real zowex server doesn't dispatch `consoleCommand`). The mock daemon handles the wire RPC for direct testing, but the MCP server tool is disabled. |
| Tool returns `Input validation error … expected string for 'mode'` | Numeric coercion. Pass `mode:str=644` or rely on the `mode\|perms\|permissions\|umask` heuristic (which keeps octal-looking strings). |
| Tool returns `Input validation error … expected array for 'lines'` | Pass as JSON: `'lines=["a","b"]'`. Or read from stdin: `'lines:json=@-'`. |
| `pkill -f mock-zos` doesn't kill it | Use the exact PID file you saved on start, or `lsof -nP -iTCP:4022 -sTCP:LISTEN` to find the listener. |

For more depth, see:

- [docs/research-zowex-pagination-caching.md](research-zowex-pagination-caching.md) — the underlying RPC protocol.
- [packages/zowe-mcp-server/src/mock-host/](../packages/zowe-mcp-server/src/mock-host/) — source for the daemon.
- [zowe/zowe-native-proto](https://github.com/zowe/zowe-native-proto) — the real zowex server (whose RPC dispatch table we mimic).
