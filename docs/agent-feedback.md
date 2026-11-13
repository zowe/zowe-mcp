# Zowe MCP — feedback from agent sessions

Observations from AI-agent sessions that use the Zowe MCP servers as a client (dogfooding),
recorded so tool-surface gaps and defects seen in real use reach the backlog. Dated entries,
newest first; grounded observations only — each entry says what was actually seen. Items worth
scheduling graduate to [TODO.md](../TODO.md); zowex/ZNP-side asks belong in
[zowe-native-feature-requests.md](zowe-native-feature-requests.md) instead.

## 2026-09-13 — AT-TLS aware-mode rollout session (Claude Code on Host-A)

### `zowe-mock` MCP server failed to connect at session start

The repo's own `.mcp.json` `zowe-mock` entry failed with `CONNECTION_CLOSED` while both
`zowe-host-a-*` servers connected fine in the same session. Not diagnosed further (the session
did not need the mock), but worth a check that the mock server starts cleanly from a fresh
checkout — a broken default entry costs every session a startup warning.

### Deployment/ops workflows bypass the MCP tools entirely

During the AT-TLS rollout (native addon build, doctor runs, service restarts, log forensics on
the LPAR), the session had `zowe-host-a-native` connected yet did all LPAR work over raw ssh,
because the workflow needs things the tool surface does not offer:

- **An environment contract around every command**: `export _BPXK_AUTOCVT/_CEE_RUNOPTS/STEPLIB`
  plus a PATH prepend before anything runs (without `STEPLIB=CEE.SCEERUN2.OVERRIDE`, node 24 on
  the target LPAR dies with CEE3561S). `runSafeUssCommand` takes a single `commandText` with no
  env input, so every invocation would lack the contract.
- **Short multi-step scripts run atomically** (`cd && build && run && capture rc`) — per-call
  tools with separate directory state can't express this.
- **Long-running process control**: `nohup` start, pidfile stop/status. All EXECUTE-effect,
  currently only expressible as non-allowlisted commands needing elicitation each time.

File transfer was not the blocker — `uploadFileToUssFile` + `chtagUssFile` cover it. Possible
directions: a per-system session env contract (set once, applied to every command tool), a
script-execution tool gated at the execute capability tier, or an explicit documented position
that control-plane/ops flows are out of scope and data-plane tools are the product. Any of the
three would have made the choice legible; today an agent just quietly falls back to ssh.

### Repo DX: root `npm install` fails without `--ignore-scripts`

`zowe-mcp-vscode`'s postinstall runs `npx @vscode/dts`, which fails in offline/sandboxed
environments and aborts the whole workspace install; `npm install --ignore-scripts` is the
workaround. Making that postinstall best-effort (or moving it to an explicit script) would
unbreak clean-room installs.
