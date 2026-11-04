# Plan: Enable z/OS console commands via Zowe MCP

Two repos: `zowe/zowex` (local: `~/dev/c/zowe-native-proto`) and this repo (`zowe-mcp`).
Each step below is one reviewable PR. Steps marked ⚡ can start today, in parallel.

## Current state (why this plan is shaped this way)

- **zowe-mcp**: `runConsoleCommand` is fully built (tool, backend, mock, evals) but
  registration is commented out at `packages/zowe-mcp-server/src/server.ts:41` and
  `:554-569`, because the zowex server never dispatches the `consoleCommand` RPC.
  The SDK already ships `client.console.issueCmd(...)` — it returns METHOD_NOT_FOUND.
- **zowex**: console works only via the `zoweax` CLI. zoweax is the *entire* zowex
  binary (all commands + RPC server + plugin bridge) re-bound `AC=1` + `extattr +ap`
  (`native/c/makefile:386-397`). Master authority is hard-coded
  (`MGCRE AUTHCMDX=X'8000'`, `native/c/zcnm31.c:145`). There are zero SAF checks in
  the repo; access control = file permissions on zoweax. `zowex server` drops APF
  before running (`native/c/commands/core.cpp:219-230`, #958), so in-process RPC
  console is structurally impossible. zoweax is not in the SDK pax
  (`scripts/buildTools.ts:1102-1126`) and install never runs `extattr`.

## Target architecture

1. zoweax becomes a **minimal authorized helper**: console group + version/help only.
   No plugin bridge, no RPC server, no other command groups in the AC=1 module.
2. `zowex server` **spawns** `zoweax console issue ...` per RPC request
   (`zut_run_program`, same pattern as TSO → `tsocmd`, `native/c/ztso.cpp:37`).
   The server never holds APF authority.
3. **SAF replaces master authority**: drop `AUTHCMDX=X'8000'`; commands are
   authorized against OPERCMDS (`MVS.*`) profiles under the invoking user's ACEE
   (SDSF/z/OSMF model). Per-user default console name (gateable via
   `MVS.MCSOPER.<name>`), per-request CART (replaces fixed `ZOWECART`).
   APF stays (MCSOPER/MGCRE require it) — but only for the tiny helper.
4. **zoweax is never auto-deployed.** Sysprog installs it deliberately: protected
   directory (never `~/.zowe-server`), owner/mode as the access knob,
   `extattr +ap` (needs `BPX.FILEATTR.APF`), OPERCMDS profiles in the site ESM
   (RACF, ACF2, or TSS). Fail-closed: without `extattr +ap`, TESTAUTH fails →
   "Not authorized".
5. MCP tool gated at `full` capability tier + elicitation. Docs state explicitly:
   MCP patterns are UX guardrails; the ESM (RACF/ACF2/TSS) OPERCMDS check is the
   security boundary.

## Dependency graph

```text
⚡ M1 (mcp elicitation fix) ──────────────────┐
⚡ M2 (mcp pattern hardening) ────────────────┤
⚡ Z1 (slim zoweax) ────────────┬─→ Z4 (docs/packaging)
⚡ Z2 (SAF authority) ──→ Z3 (RPC) ──→ P1 (SDK pin) ──→ M3 (enable) ──→ M4 (docs/evals) ──→ R1 (release)
                        Z5 (tests, anytime after Z2)
```

**Minimum path to a working MCP console tool: Z2 → Z3 → P1 → M3.**
Z1 is strongly recommended before Z4/GA (don't document distributing the fat
APF binary), but Z3 works against either zoweax shape.

> STATUS: Z1+Z2+Z3 were implemented together on the `slim-zoweax` branch
> (one PR — chosen over separate PRs to verify the pieces work together).
> Extras landed with it: `extattr -s` on zoweax (filesystem-enforced no-shared-AS),
> per-user console name suffixing in the RPC handler (concurrency), `ZOWEAX_PATH`
> override, and version banner reports the invoked binary's name.

## Decisions to make before Z2

- [ ] Master-authority escape hatch: hard cutover (recommended) vs. deprecated
      `--master-authority` flag for one release?
- [ ] zoweax distribution: release-pax-only + docs (recommended) vs. also inert
      in the SDK pax?
- [ ] Extra MCP opt-in env var beyond `full` tier? (Recommend: no — SAF is the gate.)

---

## Phase 0 — start today, all parallel ⚡

### Step 1 (M1, zowe-mcp): console elicitation parity + plumbing

> STATUS: done (branch `console-prep-and-binary`, together with M2 and the
> binary-transfer backlog item; full test suite green).

Zero risk — tool stays unregistered.

- Fix elicitation in `tools/console/console-tools.ts:106-133` to match TSO
  (`tools/tso/tso-tools.ts:107-160`): pre-check `caps.elicitation`, `mode: 'form'`,
  `confirm` as `type: 'boolean'` + `required: ['confirm']`, require `confirm === true`.
- Add `operationContext` 5th arg to the native call in
  `zos/native/native-backend.ts:1723-1741` (parity with `listApfLibraries` at `:1760`).
- Done when: unit test covers the elicitation schema; no registration change.

### Step 2 (M2, zowe-mcp): pattern hardening

- Extend `tools/console/console-command-patterns.json`: `V`/`E`/`C` abbreviations,
  `DUMP`, `SLIP`, `CF`/`CONFIG`, `IPL`, ROUTE smuggling (`RO SYS1,P JOB` must be
  evaluated as its routed command, or elicit). WTOR replies (`R nn,...` /
  `REPLY nn,...`) are state-changing → classify as elicit (confirm), not blocked.
- New `__tests__/console-command-validation.test.ts` (pure pattern tests, follow
  `tso-command-validation.test.ts`).
- Done when: every dangerous/elicit/safe class has positive + negative test cases.

### Step 3 (Z1, zowex): slim zoweax

- New minimal `main()` for zoweax: registers console group + version/help only.
  Remove plugin bridge, server, and other command groups from the authorized link
  (`native/c/makefile:392-397` target keeps its name; new entry object).
- Update `native/c/test/zoweax.console.test.cpp`: privilege-drop tests
  (`zoweax version`) survive; any non-console-through-zoweax tests move to zowex.
- **Breaking (CHANGELOG)**: zoweax no longer runs non-console commands.
- Done when: `zoweax console issue "D T"` works on a test system; `zoweax data-set ...`
  cleanly errors; binary is materially smaller.

### Step 4 (Z2, zowex): SAF-mediated authority

- Remove `AUTHCMDX=X'8000'` (`native/c/zcnm31.c:145-146`) so MGCRE commands are
  checked against OPERCMDS under the caller's ACEE. Hard cutover — no
  code-level escape hatch (see next bullet for why none is needed).
- Console authority attribute: DO NOT add a CLI/RPC `AUTH=` knob. MCSOPER
  takes console attributes from the user's ESM **OPERPARM segment** first
  (macro-supplied values are only a fallback), so authority configurability
  already belongs to the ESM: `ALTUSER <id> OPERPARM(AUTH(...))`. A CLI flag
  would let any zoweax executor self-request MASTER — an anti-feature.
- **WTOR replies**: `R nn,...` keeps working via either (a) OPERCMDS grant on
  `MVS.REPLY.*` with an INFO console (SDSF model — preferred), or (b) an
  elevated `AUTH` in the user's OPERPARM segment where OPERCMDS isn't set up.
  Document both; add a REPLY test.
- Default console name → per-user (userid-derived), replacing shared `"zowex"`
  (`native/c/commands/console.cpp:83`).
- Per-request CART replacing `"ZOWECART"` (`zcnm31.c:150,338`).
- API compat: thread optional authority/name via `ZCN` reserved fields
  (`native/c/zcntype.h:37-48`, no struct size change) and defaulted `zcn_activate`
  params — `zcn.hpp` consumers (console.cpp, tests, `examples/zcn/demozcn.cpp`)
  stay source/ABI compatible.
- **Breaking (CHANGELOG, loud)**: behavior — commands that succeeded under blanket
  master authority now require OPERCMDS grants; sites with `MVS.MCSOPER.ZOWEX*`
  profiles must adjust for the new console name.
- Done when: user without OPERCMDS grant gets a system auth failure (visible in
  SMF 80); granted user succeeds; test on both cases.

---

## Phase 1 — zowex enablement

### Step 5 (Z3, zowex): console over RPC — after Z2 (rebase on Z1)

- Register `consoleCommand` in `native/c/server/rpc_commands.cpp` (TSO template at
  `:195-202`): handler spawns zoweax via `zut_run_program`
  (`native/c/zut.cpp:57-205`), `.validate<IssueConsoleCmdRequest, IssueConsoleCmdResponse>()`,
  `.read_stdout("data", false)`. Schemas already generated
  (`server/schemas/requests.hpp:146-150`, `responses.hpp:245-249`).
- Add zoweax to the noshareas list (`zut_private_command_requires_noshareas`,
  `native/c/zut.cpp:269+`) — `_BPX_SHAREAS=YES` breaks authorized spawn.
- Locate zoweax: `ZServer::get_exec_dir()` sibling → PATH → env override
  (e.g. `ZOWEX_AX_PATH`). Distinct, actionable errors: not found / not APF /
  SAF denied.
- Add optional `timeout` + `wait` to `packages/sdk/src/doc/rpc/console.ts`,
  run `npm run build:types` to regenerate C++ schemas. Non-breaking (optional).
- Done when: `client.console.issueCmd({commandText:"D T"})` over SSH returns data
  on a host with zoweax installed, and returns the actionable error on one without.

### Step 6 (Z4, zowex): packaging + security docs — after Z1, parallel with Z3

- Apply the distribution decision (release-pax-only recommended; SDK pax stays
  zowex-only per `scripts/buildTools.ts:1102-1126`).
- New `doc/zoweax-security.md` — two required parts:
  1. **Installation guide** ("how to install APF zoweax"): obtain the binary from
     the release artifact; install to a protected dir (explicitly never
     `~/.zowe-server`); owner/group/mode model (execute permission is the access
     knob); `extattr +ap` and what it requires (`BPX.FILEATTR.APF` in FACILITY,
     filesystem not mounted NOSETUID); verifying with `zoweax console issue "D T"`;
     upgrade (re-run extattr after replacing the binary — it's dropped on write)
     and uninstall.
  2. **ESM requirements — one section per ESM** with copy-pasteable commands for:
     console activation gate (`MVS.MCSOPER.<console>`), command authorization
     (OPERCMDS-class `MVS.*` profiles incl. `MVS.REPLY.*` for WTOR replies),
     `BPX.FILEATTR.APF` for the installer, and auditing notes:
     - **RACF**: `RDEFINE OPERCMDS ...` / `PERMIT ... ACCESS(...)` examples.
     - **ACF2**: `SET RESOURCE(OPR)` rule examples (OPERCMDS class mapped to
       ACF2 resource type), CLASMAP notes.
     - **Top Secret (TSS)**: `TSS ADDTO(...)` / `TSS PERMIT(...)` examples for
       the OPERCMDS resource class.
     Each section states the fail-closed behavior when nothing is defined
     (INFO-console fallback) and how to verify a grant took effect.
- Fix `doc/apis.md:88-96` console row; wire the existing CLI plugin
  `ConsoleCommand` into `packages/cli/src/issue/Issue.definition.ts:23` and relax
  `console-name` required→optional (matches RPC schema; non-breaking).

### Step 6b (Z6, zowex + zowe-mcp, optional): guided zoweax install skill

- **zowex**: skill beside `zowex-ssh` (or `zx doctor console` subcommand):
  preflight over SSH (detect ESM, check `BPX.FILEATTR.APF`, mount SETUID,
  `ls -E` for `ap`/no-`s` attributes, non-login-shell `command -v zoweax`),
  then GENERATE the privileged commands (`extattr +ap -s`, ESM profiles per
  doc/zoweax-security.md) for a human to run — never execute them — then
  verify each took effect and run the end-to-end `console issue "D T"` test.
  Failure decoding validated so far: `service_rc: 12` = SAF/MCSOPER denial;
  `service_rc: 4` = console name already active (check `D EMCS,FULL,CN=<name>`
  — a TSO session with SDSF ULOG holds the bare-userid console);
  `AUTHORITY INVALID, FAILED BY SECURITY PRODUCT` vs `FAILED BY MVS`
  distinguishes profile-denied from no-profile-matched; remind that permits
  don't affect established sessions (reconnect, incl. ControlMaster sockets).
- **zowe-mcp**: an MCP prompt in `src/prompts` with the same guided flow
  using the server's own tso/uss tools for diagnosis (works from any MCP
  client, not just Claude Code); M3's zoweax-missing error message points
  to it.
- Side benefit: running the flow on an ACF2 or TSS site field-tests the
  ESM sections of doc/zoweax-security.md.

### Step 7 (Z5, zowex): test enablement — anytime after Z2

- APF-bound test-runner target (unused `BIND_FLAGS_AUTH` at
  `native/c/test/makefile:23-25`; main target binds unauth at `:159`).
- Re-enable the ~200 commented lines in `native/c/test/zcn.test.cpp:43-256`.
- New tests: SAF-denied command, per-user console name, RPC-spawn path.

---

## Phase 2 — zowe-mcp enablement (after Z3 merges)

### Step 8 (P1, zowe-mcp): move the SDK pin

- Wait for the post-Z3 nightly (or main Build artifact), then:
  `node scripts/sdk-switch.js nightly --write-pin`
- Commit `resources/zowex-pin.json` + `packages/zowe-mcp-server/package.json` +
  `package-lock.json`. Note the console RPC in the pin's `note` field.
- (For pre-merge testing: `node scripts/sdk-switch.js pr <zowex-pr#>`.)

### Step 9 (M3, zowe-mcp): enable the tool

- Uncomment `server.ts:41` and `:554-569`.
- Map backend errors to actionable tool messages (METHOD_NOT_FOUND → "zowex server
  too old"; zoweax missing/unauthorized → "sysprog must install zoweax, see
  doc/zoweax-security.md"; SAF denial → surfaced as authorization failure, not retried).
- Add `runConsoleCommand` to EXECUTE examples in `buildCapabilityInstructions`
  (`src/capability-level.ts:275-281`).
- Tests: new `__tests__/console-tools.integration.test.ts` (mock backend) +
  cases in `__tests__/common.test.ts` (cross-transport).
- Done when: tool visible only at `full` tier; elicit-class command prompts;
  dangerous-class blocked; live `D T` works against a prepared test system.

### Step 10 (M4, zowe-mcp): docs + evals

- `docs/mcp-reference-inputs.yaml`: add `runConsoleCommand` entry; `npm run generate-docs`.
- Update `AGENTS.md:34`/`:76`, `docs/mock-zos-host.md:945`, safety doc
  `docs/mcp-safety-security-principles.md` §7/§10 (state: patterns are guardrails,
  the ESM OPERCMDS check is the boundary; link `doc/zoweax-security.md`). CHANGELOG.
- Evals: remove `config.skip` from `packages/zowe-mcp-evals/questions/console.yaml`;
  add live console prompt-injection vector (TODO.md:154).

### Step 11 (R1, zowe-mcp): release

- Standard flow per `docs/prepare-release.md` (set-version, changelogs,
  generate-docs, `release/vX.Y.Z` branch). Release notes must carry the two
  zowex breaking changes (zoweax scope, master authority → SAF) and link
  `doc/zoweax-security.md`.

---

## Related backlog (not console, discovered during this effort)

- **zowe-mcp binary file transfer — DONE** (branch `console-prep-and-binary`,
  with M1/M2): `binary: true` on read/write dataset/USS tools, base64 at the
  tool boundary, `encoding: "binary"` through the backends, mock + native
  support, round-trip integration tests. Remaining: verify the native path
  once against a live zowex (`readDataset`/`writeDataset` with
  `encoding: "binary"` — same RPC contract `zx ds put --binary` uses).

### Step 12: delete this plan

- When R1 ships, `git rm console-command-plan.md`. Everything durable has a
  better home by then: the security model in `doc/zoweax-security.md` (zowex),
  behavior changes in both changelogs, tool docs in `docs/mcp-reference.md`,
  and open follow-ups as GitHub issues. A finished plan left in the repo is
  just a document that slowly becomes wrong.

## Breaking-changes register (for release notes)

| Change | Step | Who's affected | Mitigation |
|---|---|---|---|
| zoweax runs console only | Z1 | scripts using zoweax for other commands | use zowex; CHANGELOG |
| Master authority removed | Z2 | any console user; sites without OPERCMDS profiles | doc profiles; optional escape hatch |
| Default console name change | Z2 | sites with `MVS.MCSOPER.ZOWEX*` profiles | doc new naming |
| Everything else | Z3/Z4/M3 | — | additive / optional |
