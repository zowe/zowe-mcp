# deploy/ — z/OS deployment targets

Per-system, per-service deployment configuration for
`npm run deploy:zos -- <target>` (see `scripts/deploy-zos.mjs`), which packs a
workspace package (the SAF IdP or the MCP server), ships one tgz over `scp`,
installs it on the LPAR, runs the environment `doctor` (IdP), restarts the
process, and verifies (startup log line, verify URL, optional real-credential
login smoke test executed on the LPAR — `/login` is loopback-only).

## The environment contract

On z/OS the environment a process inherits differs wildly by system, user, and
launch path: JCL/BPXBATCH, a login shell, cron, or non-interactive ssh (which
gets a bare `PATH=/bin` and no profile). So a deployment must not depend on
whatever happens to be inherited, and equally must not clobber everything:

- `runtimeEnv` declares **exactly the variables the runtime relies on**, set to
  their expected values (conversion/tagging: `_BPXK_AUTOCVT`, `_CEE_RUNOPTS`,
  `_TAG_REDIR_*`; module loading: `STEPLIB`; app settings: `ZOWE_MCP_*`).
  `__IPC_CLEANUP=1` is defaulted by the deploy script (a target may override
  it): the stop procedure is a kill, each killed z/OS node process leaks ~2
  IPC message queues (epoll emulation), and hitting the system `IPCMSGNIDS`
  cap stops *every* new node on the LPAR from starting
  (see docs/zos-stc-launch.md, stop semantics).
  Same-system zowex execution (a `local` systems entry, see
  `docs/zos-local-zowex-identity.md`) adds three contract variables:
  `ZOWE_MCP_LOCAL_SUB_IS_USERID=1` (the operator assertion that the JWT issuer
  authenticates against this system's SAF), `ZOWE_MCP_LOCAL_LAUNCHER`
  (absolute path of the program-controlled identity-switch launcher), and
  `ZOWE_MCP_LOCAL_ZOWEX` (absolute path of the shared zowex binary the
  launcher runs as the authenticated user — every permitted target user must
  be able to execute it). Check the host with `zowe-mcp-server doctor-local`.
- `prependPath` **prepends** to `PATH` — never replaces it.
- **Everything else is inherited untouched** — user-owned settings such as
  `TZ`, `LANG`, `HOME` stay exactly as the user expects them.
- The applied contract is logged by the deploy script, and the servers and the
  z/OS integration tests log their effective relied-on environment at startup —
  so the state a process actually ran with is always in its log.
- `remoteSetup` (sourcing a site script) still works but is discouraged: such
  scripts often set more than the runtime needs (compilers, `npm_config_*`),
  which makes the deployment silently depend on their contents.

## Layout

- `<target>.json` — one file per system/service (package, host, paths, ports,
  environment contract, start arguments). **Gitignored**: real targets carry
  internal hostnames and userids. Start from the committed `example-idp.json`.
- `.env` — secrets only (gitignored by the repo-wide `.env` rules), as
  `KEY=VALUE` lines. JSON values can reference them with `"${ENV:NAME}"`; the
  smoke test reads its credentials from the env names the target configures
  (`smokeLogin.usernameEnv` / `passwordEnv`). Never put a secret in a target
  JSON.

## Config fields

| Field | Purpose |
| --- | --- |
| `package` | Workspace package to deploy: `zowe-mcp-zos-saf-idp` (default) or `@zowe/mcp-server`. |
| `sshDest` | `user@host` for ssh/scp (key auth assumed). |
| `remoteDir` | Deployment directory on the LPAR. A private `package.json` is created there if missing — without one, npm walks up and installs into a parent package root. |
| `runtimeEnv` | The environment contract (see above) for every remote step and the started process. |
| `prependPath` | Directories prepended to the inherited `PATH` (the node install's `bin`). |
| `remoteSetup` | Optional site script to source first — prefer `runtimeEnv`. |
| `nodeFlags` | Node flags for every remote invocation (`--no-wasm-*` on memory-constrained LPARs). |
| `startArgs` | The service's own CLI arguments (port, issuer, `--saf-check`, or `--http --native ...`). |
| `startEntry` | Override for the started entry point (default `node_modules/<package>/dist/index.js`). |
| `logFile` | Startup/access log, relative to `remoteDir` (appended). |
| `stopPattern` | Fallback substring matched against `ps -ef` to stop an old process (the primary mechanism is the `.deploy.pid` pidfile the script writes). Keep it SHORT: z/OS `ps -ef` truncates command lines (e.g. at `node_modules/zowe-mcp-zos-saf`), so anything after the truncation point never matches. |
| `expectLog` | One line or a list of lines; deployment fails unless every one appears in the fresh log (e.g. `SAF check backend: native`, or `["AT-TLS aware mode: required", "AT-TLS client mode: required"]`). |
| `verifyUrl` | Fetched from the deploying machine after restart. |
| `verifyStatus` | Accepted HTTP statuses for `verifyUrl` (default `[200]`; the MCP server's `/mcp` answers `401` unauthenticated by design). |
| `doctor` | Run the `doctor` subcommand before restart (default: only for the IdP package). |
| `smokeLogin` | Optional (IdP): `{ port, usernameEnv, passwordEnv }` — POSTs a real `/login` on the LPAR's loopback when both env vars are set (use a disposable test account). |
| `launch` | `shell` (default) starts the service as a `nohup` background process over ssh; `jcl` submits a generated BPXBATCH batch job (see below). |
| `jclJobName` | JES jobname for `launch: "jcl"` (default: `Z` + target name, uppercased, non-alphanumerics stripped). |
| `jclAccount` | JOB-statement accounting field (default `ACCT#` — site-specific). |
| `jclJobCard` | Full replacement JOB statement (array of JCL lines) when the generated card doesn't fit site standards. |

## Flags

- `--skip-pack` — reuse the tgz already at the repo root.
- `--no-restart` — install + doctor only; leave the running process alone.
- `--launch=shell|jcl` — override the target's `launch` mode for this run.

## JCL launch mode

With `"launch": "jcl"` the restart step generates two files in `remoteDir` and
submits the job with `/bin/submit` instead of `nohup`:

- `.deploy-jcl.env` — the environment contract as a sourceable shell file
  (`runtimeEnv` + `prependPath`, values quoted). Written mode 600: unlike
  shell mode, the contract persists on disk, and `runtimeEnv` may carry
  secrets interpolated from `deploy/.env` (e.g. `ZOWE_MCP_TENANT_STORE_KEY`).
- `.deploy.jcl` — a BPXBATCH job whose `STDPARM` command is
  `cd <remoteDir> && . ./.deploy-jcl.env && echo $$ > .deploy.pid &&
  exec node <nodeFlags> <entry> <startArgs> >> <logFile> 2>&1`.

The submitted job id is kept in `.deploy.jobid`. Both launch modes share the
same stop/verify machinery: the shell writes its pid to `.deploy.pid` before
`exec`ing node (so after `exec` it IS the node pid), and killing that pid ends
the batch job, because BPXBATCH is waiting on the child. Modes are freely
interchangeable — a `--launch=shell` deploy cleanly stops a job-launched
server and vice versa.

Two z/OS specifics the generator is built around (validated on Host-A):

- **STDENV is deliberately not used.** BPXBATCH `SH` starts a *login* shell,
  so `/etc/profile` and `~/.profile` run after STDENV and override whatever it
  set (IBM documents this in "Passing environment variables to BPXBATCH"; in
  practice it silently dropped `PATH`). Sourcing the env file inside the
  command runs last and always wins.
- **STDPARM in-stream records are 80-column** and are concatenated with blanks,
  so no single token may exceed one record. Long values (the node install
  path, module paths) belong in `runtimeEnv`/`prependPath`, which end up in
  the env file where no length limit applies; the generator fails fast on any
  over-long token.

Old jobs accumulate held output (`MSGCLASS=X`) — purge them occasionally.
