# Vendor: Zowe — Agent Instructions

This directory contains Zowe community CLI bridge plugins.

## Plugins

### IBM Db2 for z/OS (`db2`)

The `@zowe/db2-for-zowe-cli` plugin is maintained by the **Zowe open source community** (not Broadcom)
and is hosted here for evaluation purposes.

**Files:**

- `cli-bridge-plugins/db2-tools.yaml` — MCP tools YAML (hand-authored)
- `cli-bridge-plugins/db2-commands.yaml` — CLI commands YAML (auto-generated, do not hand-edit)
- `eval-questions/db2.yaml` — Standard eval question set (10 questions, SYSIBM catalog)
- `eval-questions/db2-stress.yaml` — Stress eval question set (ambiguous prompts, multi-step)
- `e2e-tests/db2-native-stdio.e2e.test.ts` — E2E tests against real Db2 subsystem
- `docs/mcp-reference-vendor.md` — Generated reference documentation (Db2 CLI plugin tools only)

**Plugin name:** `db2`  
**Display name:** IBM Db2 for z/OS  
**Active description variant:** `optimized`

**Tools (5 total):**

| Tool | Type | Notes |
| --- | --- | --- |
| `db2ListConnections` | Profile management | Lists configured Db2 connection profiles |
| `db2SetConnection` | Profile management | Sets active Db2 connection |
| `db2ExecuteSql` | Operation (paginated) | Main tool — executes SQL and returns rows; `destructiveHint: true` |
| `db2CallProcedure` | Operation | Calls a stored procedure; `destructiveHint: true` |
| `db2ExportTable` | Operation (content) | Exports table as SQL INSERT statements |

**Regenerating the CLI commands YAML:**

```bash
# Apply ibm_db stub first (arm64 macOS only — skips native binary)
npm run generate-cli-bridge-yaml -- \
  --plugin db2 \
  --output vendor/zowe/cli-bridge-plugins/db2-commands.yaml
# Restore original odbc.js if you patched it
```

## Connection Details

Connection details (host, port, database, user, password) are **not** committed to this repository.
Set them in `.env` at the repo root (gitignored) and reference them via env vars in the eval YAML:

```bash
# .env (copy and fill in real values)
DB2_HOST=your-host.example.com
DB2_PORT=50000
DB2_USER=YOURUSER
DB2_DATABASE=YOURDB
ZOWE_MCP_PASSWORD_YOURUSER_YOUR_HOST_EXAMPLE_COM=yourpassword
```

The eval YAML files use `${DB2_HOST}`, `${DB2_PORT}`, `${DB2_USER}`, `${DB2_DATABASE}` — these
must be set in `.env` before running evals.

## Password Environment Variables

Passwords are **not** stored in the connection file. Set them in `.env` at the repo root
(already gitignored):

```bash
ZOWE_MCP_PASSWORD_<USER>_<HOST_WITH_DOTS_REPLACED_BY_UNDERSCORES>=...
```

## Apple Silicon (arm64) — Required Setup

The `ibm_db` ODBC driver **does not support arm64** natively. You must run the Zowe CLI
(and thus the MCP server) in x86_64 mode via Rosetta for any Db2 commands to work.

**One-time setup:**

```bash
# 1. Ensure aliases are in ~/.zshrc (already present):
alias intel="env /usr/bin/arch -x86_64 /bin/zsh --login"
alias arm="env /usr/bin/arch -arm64 /bin/zsh --login"

# 2. Install x86_64 Node via NVM in intel mode:
intel
source ~/.nvm/nvm.sh
nvm install 20

# 3. Fix broken brace-expansion dependency for node-gyp:
npm install brace-expansion --prefix ~/

# 4. Install Zowe CLI in x86_64 mode:
npm install -g @zowe/cli@zowe-v3-lts --registry https://zowe.jfrog.io/artifactory/api/npm/npm-release/

# 5. Install the Db2 plugin in x86_64 mode:
zowe plugins install @zowe/db2-for-zowe-cli@6.0.0 \
  --registry https://zowe.jfrog.io/artifactory/api/npm/npm-release/

# 6. Apply Authentication=SERVER fix (one-time, survives sessions):
CLIDIR=~/.zowe/plugins/installed/lib/node_modules/@zowe/db2-for-zowe-cli/node_modules/ibm_db/installer/clidriver
env /usr/bin/arch -x86_64 /bin/zsh -c "$CLIDIR/bin/db2cli writecfg add -parameter Authentication=SERVER"
```

**Every session** that uses `zowe db2 ...`:

```bash
env /usr/bin/arch -x86_64 /bin/zsh --login    # switch to x86_64 shell
source ~/.nvm/nvm.sh && nvm use 20            # use x86_64 node
source /path/to/zowe-mcp/.env                 # load passwords
export DB2CLIINIPATH=/tmp                     # point CLI driver to /tmp for ini cache
```

## IBM CLI Driver: Authentication=SERVER Fix

Without this fix all connections to Db2 for z/OS fail with `SQL1042C An unexpected system error
occurred. SQLSTATE=58004` even though `db2connectactivate` is applied on the server side.

**Root cause**: The IBM ODBC CLI driver performs a client-side license check during initialization
(`sqlofica`, probe 10) that the server-side `db2connectactivate` does NOT bypass (unlike the JDBC
driver). Setting `Authentication=SERVER` in `db2dsdriver.cfg` bypasses this check.

**The fix** (already applied to the clidriver installation):

```bash
CLIDIR=~/.zowe/plugins/installed/lib/node_modules/@zowe/db2-for-zowe-cli/node_modules/ibm_db/installer/clidriver
env /usr/bin/arch -x86_64 /bin/zsh -c "$CLIDIR/bin/db2cli writecfg add -parameter Authentication=SERVER"
```

This writes `Authentication=SERVER` to `clidriver/cfg/db2dsdriver.cfg` and is **permanent** —
it survives shell sessions and reboots. No Db2 Connect license file (`db2consv.lic`) is needed.

**Note**: This is the same fix documented in ibm_db's `installer/ifx.sh`:

```bash
# to avoid SQL1042C error from security layer.
db2cli writecfg add -parameter Authentication=SERVER
```

## Error Classification via retryableErrorPatterns

`db2-tools.yaml` sets `retryableErrorPatterns: ["\\[IBM\\]\\[CLI Driver\\]\\[DB2\\]"]` at the
plugin level. Any CLI error whose message contains `[IBM][CLI Driver][DB2]` (meaning Db2 itself
rejected the statement — syntax error, undefined table, etc.) is returned as a retryable
`isError: true` without `stop: true`, so the LLM can correct the SQL and retry.

Errors that do NOT match the pattern (driver-level failures without `[DB2]` in the message —
`SQL30081N` network error, `SQL1042C` driver init failure, `Failed to spawn 'zowe'`, etc.) fall
through to `defaultCliErrorFatal: true` (the default) and trigger the full fatal
`stop: true` pattern.

This replaces the former per-tool `fatalOnCliError: false` approach. All three operation tools
(`db2ExecuteSql`, `db2CallProcedure`, `db2ExportTable`) now benefit automatically.

## Quick Tool Testing via `call-tool`

```bash
# List configured connections
env /usr/bin/arch -x86_64 /bin/zsh -l -c "
  source ~/.nvm/nvm.sh && nvm use 20
  source /path/to/zowe-mcp/.env
  export DB2CLIINIPATH=/tmp
  cd /path/to/zowe-mcp
  node packages/zowe-mcp-server/dist/scripts/call-tool.js \
    --cli-plugin-configuration db2=/tmp/db2-conn.json \
    db2ListConnections
"

# Execute SQL
env /usr/bin/arch -x86_64 /bin/zsh -l -c "
  source ~/.nvm/nvm.sh && nvm use 20
  source /path/to/zowe-mcp/.env
  export DB2CLIINIPATH=/tmp
  cd /path/to/zowe-mcp
  node packages/zowe-mcp-server/dist/scripts/call-tool.js \
    --cli-plugin-configuration db2=/tmp/db2-conn.json \
    db2ExecuteSql \
    query='SELECT CURRENT DATE FROM SYSIBM.SYSDUMMY1'
"
```

## Eval Results (baseline)

First successful run against real Db2 (gemini-2.5-flash, `--no-cache`):

| Question | Pass rate | Notes |
| --- | --- | --- |
| list-tables | 5/5 | |
| list-columns | 5/5 | |
| current-date-time | 4/5 | Model used `CURRENT_TIMESTAMP` (ODBC form) — now in anyOf list |
| count-tables | 5/5 | |
| db2-version | 5/5 | Takes ~47s avg; model tries many catalog tables |
| list-routines | 5/5 | |
| list-views | 5/5 | |
| explore-then-query | 5/5 | |
| analytics-query | 5/5 | |
| list-connections | 5/5 | |
| **Overall** | **49/50 (98%)** | minSuccessRate: 0.7 — comfortably exceeded |

## Eval Sets

```bash
# Standard (10 questions, 5 reps, SYSIBM catalog queries) — no skip:
env /usr/bin/arch -x86_64 /bin/zsh -l -c "
  source ~/.nvm/nvm.sh && nvm use 20
  source .env && export DB2CLIINIPATH=/tmp
  npm run evals -- --set zowe/db2
"

# Stress (9 questions, 5 reps, ambiguous prompts) — has skip: by default
env /usr/bin/arch -x86_64 /bin/zsh -l -c "
  source ~/.nvm/nvm.sh && nvm use 20
  source .env && export DB2CLIINIPATH=/tmp
  npm run evals -- --set zowe/db2-stress
"

# Compare variants
env /usr/bin/arch -x86_64 /bin/zsh -l -c "
  source ~/.nvm/nvm.sh && nvm use 20
  source .env && export DB2CLIINIPATH=/tmp
  npm run eval-compare -- \
    --set zowe/db2 \
    --model gemini-2.5-flash \
    --label 'db2-baseline'
"
```

`db2.yaml` has no `skip:`. `db2-stress.yaml` has `skip:` (kept for manual runs of ambiguous
stress prompts).

## Known Issues and Skipped Tests

- **E2E tests**: `db2-native-stdio.e2e.test.ts` skips when `ZOS_PASSWORD`/`ZOWE_MCP_PASSWORD_*`
  is not set or when the server binary is not built. Run manually after `npm run build`.
- **db2-stress.yaml**: Has `skip:` because stress prompts with ambiguous phrasing are intended
  for manual verification runs. Remove `skip:` before running.
- **ibm_db arm64**: The plugin installs under arm64 only with `--ignore-scripts` (no native
  binary). The metadata extraction (`db2-commands.yaml` generation) uses a patched `odbc.js`
  stub that is restored after generation. This is documented in the Zowe docs:
  <https://docs.zowe.org/v3.0.x/user-guide/cli-db2-install-m1/>

## `db2-commands.yaml` Regeneration (arm64 workaround)

The `db2-commands.yaml` was generated using a temporary `ibm_db` stub to bypass the
arm64 binary requirement. To regenerate it:

```bash
# 1. Patch ibm_db to skip native binary load
DB2_PLUGIN=~/.zowe/plugins/installed/lib/node_modules/@zowe/db2-for-zowe-cli
cp "$DB2_PLUGIN/node_modules/ibm_db/lib/odbc.js" "$DB2_PLUGIN/node_modules/ibm_db/lib/odbc.js.bak"
cat > "$DB2_PLUGIN/node_modules/ibm_db/lib/odbc.js" << 'EOF'
module.exports = { Database: class {}, Pool: class {}, open: ()=>{}, openSync: ()=>{}, close: ()=>{} };
EOF

# 2. Generate the YAML
npm run generate-cli-bridge-yaml -- \
  --plugin db2 \
  --output vendor/zowe/cli-bridge-plugins/db2-commands.yaml

# 3. Restore original
cp "$DB2_PLUGIN/node_modules/ibm_db/lib/odbc.js.bak" "$DB2_PLUGIN/node_modules/ibm_db/lib/odbc.js"
```
