# Standalone server guide

This guide is for people who use Zowe MCP with an MCP client other than GitHub
Copilot in VS Code, such as Claude Code, Cursor, Kiro, or Roo Code. The client
starts the `zowe-mcp-server` program on your workstation and talks to it over
standard input and output (stdio).

- If you use GitHub Copilot in VS Code, install the
  [VS Code extension](../packages/zowe-mcp-vscode/README.md) instead. It
  contains the server.
- If you run one server for many users, see the
  [remote server guide](remote-mcp-server.md).

## Install the server

You need [Node.js](https://nodejs.org) 24 or later, which is the version the
project is built and tested with.

The npm package `@zowe/mcp-server` is not yet published to a public registry,
so `npx @zowe/mcp-server` and `npm install @zowe/mcp-server` do not work
outside a clone of this repository. Install the package file from a release:

1. Download `zowe-mcp-server-<version>.tgz` from the
   [latest release](https://github.com/zowe/zowe-mcp/releases/latest).
2. Install it globally:

   ```bash
   npm install -g ./zowe-mcp-server-<version>.tgz
   zowe-mcp-server --version
   ```

The package file contains all of its dependencies, so the installation does not
download anything else.

To run the server without installing it, point `npx` at the file. The name
after the package is the program name, `zowe-mcp-server`:

```bash
npx --package=file:/absolute/path/to/zowe-mcp-server-<version>.tgz zowe-mcp-server --version
```

To test a build that is not released yet, download the `zowe-mcp-server-npm`
artifact from a [CI run](https://github.com/zowe/zowe-mcp/actions/workflows/ci.yml),
or build the file from a clone as described in
[CONTRIBUTING.md](../CONTRIBUTING.md#build-the-release-files).

## Configure your MCP client

Add the server to the client's MCP configuration:

```json
{
  "mcpServers": {
    "zowe": {
      "command": "zowe-mcp-server",
      "args": ["--stdio", "--native", "--system", "USERID@sys1.example.com"]
    }
  }
}
```

- `--native` selects the SSH backend. `--system` names one connection in the
  form `user@host` or `user@host:port`. The default port is 22. Repeat
  `--system` for more connections.
- Some clients start the server without your shell's `PATH`, for example when
  Node.js is installed with nvm. If the client cannot find `zowe-mcp-server`,
  set `command` to the absolute path that `which zowe-mcp-server` prints.

Client-specific notes: [Claude Code](claude-code-mcp.md), [Kiro](kiro-mcp.md),
and [VS Code and GitHub Copilot](copilot-setup-guide.md).

## Authentication

Zowe MCP connects to z/OS over SSH with your own user ID. The server tries
these methods in order:

1. SSH key
2. Password from an environment variable
3. Password from HashiCorp Vault
4. Password prompt in the client

### SSH key (recommended)

If you can already run `ssh USERID@sys1.example.com` with a key, the server
uses the same key without any Zowe MCP configuration. It looks for a key in
this order:

1. The file named by `ZOWE_MCP_PRIVATE_KEY_<USER>_<HOST>`, if you set it.
2. The `IdentityFile` of the `Host` entry in `~/.ssh/config` whose alias or
   `HostName` matches the host.
3. A default key in `~/.ssh`: `id_ed25519`, `id_rsa`, `id_ecdsa`, or `id_dsa`.

Optional settings:

```bash
# Use a specific key for one connection
export ZOWE_MCP_PRIVATE_KEY_USERID_SYS1_EXAMPLE_COM=~/.ssh/id_mainframe

# Passphrase for an encrypted key
export ZOWE_MCP_KEY_PASSPHRASE_USERID_SYS1_EXAMPLE_COM='key passphrase'

# Never use SSH keys
export ZOWE_MCP_DISABLE_SSH_KEY=1
```

The server reads key files only. It does not use keys that are held only in
`ssh-agent`. An encrypted key without a passphrase variable is skipped, and the
server continues with the password methods.

### Password in an environment variable

Set one variable per connection. The name is `ZOWE_MCP_PASSWORD_<USER>_<HOST>`
with the user ID and host in uppercase and every character other than a letter
or digit replaced by `_`. The port is not part of the name.

| Connection | Variable |
| --- | --- |
| `USERID@sys1.example.com` | `ZOWE_MCP_PASSWORD_USERID_SYS1_EXAMPLE_COM` |
| `USER1@127.0.0.1:4022` | `ZOWE_MCP_PASSWORD_USER1_127_0_0_1` |

Put the variable in the `env` block of the client configuration, or in the
environment that starts the client:

```json
{
  "mcpServers": {
    "zowe": {
      "command": "zowe-mcp-server",
      "args": ["--stdio", "--native", "--system", "USERID@sys1.example.com"],
      "env": {
        "ZOWE_MCP_PASSWORD_USERID_SYS1_EXAMPLE_COM": "replace-with-secret"
      }
    }
  }
}
```

Do not commit a configuration file that contains a password.

To supply several passwords in one variable, set `ZOWE_MCP_CREDENTIALS` to a
JSON object that maps each connection to its password:

```json
{
  "USERID@sys1.example.com": "password-1",
  "OTHER@sys2.example.com:2222": "password-2"
}
```

A per-connection `ZOWE_MCP_PASSWORD_<USER>_<HOST>` variable takes precedence
over `ZOWE_MCP_CREDENTIALS`.

If z/OS rejects a password, the server does not try that password again until
you restart the server.

### Password in HashiCorp Vault

The server can read passwords from a
[HashiCorp Vault](https://developer.hashicorp.com/vault) KV version 2 secret.
Set the first three variables to enable the lookup:

| Variable | Purpose |
| --- | --- |
| `ZOWE_MCP_VAULT_ADDR` | Vault base URL, such as `https://vault.example.com`. |
| `ZOWE_MCP_VAULT_TOKEN` | Vault token. Treat it as a secret. |
| `ZOWE_MCP_VAULT_KV_PATH` | KV version 2 API path after `/v1/`, such as `secret/data/myapp/zowe-mcp`. |
| `ZOWE_MCP_VAULT_CACHE_TTL_MS` | Optional. How long the server caches the secret in memory. The default is `60000`. Set `0` to disable the cache. |

The secret uses the same JSON object as `ZOWE_MCP_CREDENTIALS`. The server only
reads from Vault. It never writes passwords to Vault.

### Password prompt

When no other method supplies a password, the server asks the client to prompt
you. This works only in clients that support
[MCP elicitation](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation).
In other clients the tool call fails, and you need a key or a password
variable.

A password that you enter in a prompt is kept in memory until the server
stops.

## Multiple systems and job cards

For more than one connection, or to supply JCL job cards, create a JSON
configuration file and pass it with `--config` instead of `--system`:

```json
{
  "systems": ["USERID@sys1.example.com", "USERID@sys2.example.com:2222"],
  "jobCards": {
    "USERID@sys1.example.com": [
      "//{jobname}  JOB (ACCT),'{programmer}',CLASS=A,MSGCLASS=X,NOTIFY=&SYSUID",
      "/*JOBPARM S=*"
    ]
  }
}
```

```json
"args": ["--stdio", "--native", "--config", "/absolute/path/to/zowe-mcp-config.json"]
```

- When a tool call does not name a system, the server uses the first
  connection in the list until the assistant calls `setSystem`. Set
  `ZOWE_MCP_REQUIRE_EXPLICIT_SYSTEM=1` to make the assistant choose a system
  explicitly. This is safer when the list mixes test and production systems.
- The server adds the job card when submitted JCL has no `JOB` statement. It
  replaces `{jobname}` and `{programmer}` with values from the tool call.

## Local file transfers

The upload and download tools read and write files only inside your workspace
folders. Most clients tell the server which folders are open. If your client
does not, set `ZOWE_MCP_WORKSPACE_DIR` to the absolute path of your workspace
folder.

## Try it without a mainframe

Replace `--native --system ...` with `--mock <directory>` to use sample data.
See [Mock mode](mock-mode.md).

## Server reference

Run `zowe-mcp-server --help` for the complete and current list of options. The
tables below describe the options that users set most often.

### Command-line options

| Option | Purpose |
| --- | --- |
| `--stdio` | Use the stdio transport. This is the default. |
| `--native` | Use the SSH backend. `--zowex` is the same option. |
| `--system <user@host[:port]>` | Add a z/OS connection. Repeat it for more connections. |
| `--config <file>` | Read connections and job cards from a JSON file. |
| `--mock <directory>` | Use the mock backend with the data in this directory. Cannot be combined with `--native`. |
| `--capability-tier <tier>` | Limit what the assistant can do: `read-strict` (default), `read`, `update`, `delete`, or `full`. |
| `--zowex-response-timeout <seconds>` | Time to wait for each z/OS request. The default is 60. |
| `--zowex-server-path <path>` | Location of the Zowe Remote SSH server component on z/OS. The default is `~/.zowe-server`. |
| `--zowex-server-auto-install=false` | Do not install the Zowe Remote SSH server component on z/OS when it is missing. |
| `--default-mvs-encoding <name>` | EBCDIC code page for data sets. The default is `IBM-037`. |
| `--default-uss-encoding <name>` | EBCDIC code page for USS files. The default is `IBM-1047`. |
| `--local-files-root <directory>` | Allow local file transfers in this directory. Repeat it for more directories. |
| `--response-cache-disable` | Turn off the cache of z/OS responses. By default, the server caches responses for 10 minutes. |
| `--version`, `--help` | Show the version or the help text. |

The options for the HTTP transport (`--http`, `--port`, `--http-host`, and
`--http-allow-no-auth`) are described in the
[remote server guide](remote-mcp-server.md).

### Subcommands

| Subcommand | Purpose |
| --- | --- |
| `zowe-mcp-server init-mock --output <directory>` | Create mock data. See [Mock mode](mock-mode.md). |
| `zowe-mcp-server call-tool --mock=<directory> [tool] [key=value ...]` | Call one tool from the command line, without an AI client. Without a tool name, it lists the tools. |

### Environment variables

| Variable | Purpose |
| --- | --- |
| `ZOWE_MCP_CAPABILITY_TIER` | Same as `--capability-tier`. |
| `ZOWE_MCP_MOCK_DIR` | Same as `--mock`. |
| `ZOWE_MCP_PASSWORD_<USER>_<HOST>` | Password for one connection. |
| `ZOWE_MCP_CREDENTIALS` | JSON object of passwords for several connections. |
| `ZOWE_MCP_PRIVATE_KEY_<USER>_<HOST>` | Private key file for one connection. |
| `ZOWE_MCP_KEY_PASSPHRASE_<USER>_<HOST>` | Passphrase for the private key of one connection. |
| `ZOWE_MCP_DISABLE_SSH_KEY` | Set to `1` to never use SSH keys. |
| `ZOWE_MCP_VAULT_ADDR`, `ZOWE_MCP_VAULT_TOKEN`, `ZOWE_MCP_VAULT_KV_PATH`, `ZOWE_MCP_VAULT_CACHE_TTL_MS` | HashiCorp Vault lookup. |
| `ZOWE_MCP_REQUIRE_EXPLICIT_SYSTEM` | Set to `1` to make the assistant choose a system explicitly. |
| `ZOWE_MCP_WORKSPACE_DIR` | Folder for local file transfers when the client does not report its folders. |
| `ZOWE_MCP_LOCAL_FILES_ROOT` | Same as `--local-files-root`. Separate several directories with commas. |
| `ZOWE_MCP_DEFAULT_MVS_ENCODING`, `ZOWE_MCP_DEFAULT_USS_ENCODING` | Same as the encoding options. |
| `ZOWE_MCP_ZOWEX_RESPONSE_TIMEOUT`, `ZOWE_MCP_ZOWEX_SERVER_PATH`, `ZOWE_MCP_ZOWEX_SERVER_AUTO_INSTALL` | Same as the `--zowex-*` options. |
| `ZOWE_MCP_LOG_LEVEL` | Minimum log level: `debug`, `info` (default), `notice`, `warning`, or `error`. The server writes its log to standard error. |
| `ZOWE_MCP_LOG_TOOL_CALLS` | Set to `1` to log the full input and output of every tool call. The log then contains mainframe data. |
| `ZOWE_MCP_DATA_MARKING` | Set to `0` to turn off the instruction that tells the assistant to treat mainframe content as data. |
