# Running the Zowe MCP server on z/OS: research and test plan

> Overview of all z/OS components and deployment shapes: [`zos-overview.md`](./zos-overview.md).

Status: research + plan, 2026-09-08. Nothing here has run on real z/OS yet.
Audience: a Claude Code session (or a person) with SSH access to a z/OS LPAR.

## 1. Where the repo stands today

Everything below was checked on `main` at `7d366a7`.

- The server is a Node 24 program (`.nvmrc` is `24`, no `engines.node`), built with plain `tsc`. PR #111 (esbuild bundle of the npm package) is open and blocked on review; it is the shape we want on z/OS because it shrinks the install to 8 MB / ~4,800 files.
- Two transports: stdio (`src/transports/stdio.ts`) and MCP streamable HTTP with optional bearer JWT (`src/transports/http.ts`, default port 7542).
- Two backends: `mock` (filesystem) and `native`. The native backend always goes out over SSH to a `zowex server` process on the target host (`src/zos/native/ssh-client-cache.ts` → `ZSshClient.create`). There is no code path that runs `zowex` as a local child process.
- The zowex SDK's transport seam is small: `ZSshClient.create` builds an ssh2-shaped client via `ssh-rs/createClient(useNativeSsh)`, then calls `exec("<serverPath>/zowex server …")` and speaks newline-delimited JSON-RPC over the exec channel's stdin/stdout. `RpcStreamManager` moves bulk data with `exec("cat > pipe")` / `exec("cat pipe")`. A local implementation of that same duck-typed client (spawn instead of exec) is a contained change in the zowex repo, not here.
- Optional native addons in the dependency tree: `russh` (napi-rs, prebuilds for darwin/linux/win only) and ssh2's `cpu-features` (node-gyp). Neither has a z/OS build. Both are optional, so `npm install --omit=optional` must be the install mode on z/OS and the pure-JS ssh2 path is what will run.
- The repo never touches z/OS in CI. The only Marist access is in the **zowex** repo (`.github/workflows/zos-build.yml`): SSH secrets `SSH_MARIST_RACF_HOST` / `SSH_MARIST_ZNP_ID` / `SSH_MARIST_ZNP_PASS`, port 65522, deploy dir `/ZOWE/tmp/zowex`, Open XL C/C++ 2.1 at `/usr/lpp/IBM/cnw/v2r1/openxl/bin`. Its `scripts/buildTools.ts` (ssh2 + SFTP) is a ready-made way to push a tarball and run commands on that LPAR.
- No z/OS-runtime concerns (file tags, `_BPXK_AUTOCVT`, CCSIDs of the server's own stdio) appear anywhere in the code. The `chtag`/CCSID code that exists is about remote data on the target, not the server's own process.
- Existing timing tooling: `search-benchmark.test.ts` (wall clock, real z/OS, gated by `ZOWE_MCP_SEARCH_BENCHMARK=1`), the 61-test `native-stdio.e2e` suite (gated by `ZOWE_MCP_RUN_NATIVE_STDIO_E2E=1`, honours `ZOWE_MCP_E2E_SERVER_PATH`), and the `call-tool` CLI. No CPU or memory instrumentation.

## 2. Node.js on z/OS: the facts that shape the plan

Source for everything in this section unless noted: IBM Docs, *IBM Open Enterprise SDK for Node.js 24.0* (`https://www.ibm.com/docs/en/sdk-nodejs-zos/24.0.0`, IBM Docs API key `sdk-nodejs-zos/24.0.0`, product key `SSTRRS`).

**Product and support**

- Current release is 24.0 (Node 24, V8 13.6, OpenSSL 3.5.3, npm 11.6.1, undici 7.16). Earlier 22.0 and 20.0 docs still exist; 20.0 support ends 2026-04-30. Zowe v3 docs still say the app-server needs Node 20 or 22, so an LPAR with Zowe installed will likely have one of those, not 24.
- No license charge (pax download or SMP/E 5655-NDJ); optional paid S&S (5655-SDS). Also shipped as a container image for z/OS Container Platform (`icr.io/zoscp/node`).
- **Not zIIP-eligible.** IBM's product FAQ says so explicitly. Every CPU second the MCP server burns on z/OS is general-purpose CPU, i.e. MSUs. This is the single most important measurement target; the plan treats "CPU seconds per tool call" as the headline metric.
- Upstream `nodejs/node` no longer lists z/OS in its platform tier table; the port lives at `ibmruntimes/node-zos`. Expect occasional divergence from community Node behaviour.

**Prerequisites on the LPAR**

- z/OS 2.5, 3.1 or 3.2 with the listed PTFs (z/OS 3.2: UJ98023, UO04849, UO04938, UO06022; 3.1: UI94523, UI95833, UJ98024, UO04851, UO04934, UO06021; 2.5: UI78912, UI80156, UI81095, UI83424, UI95696, UO04933, UO06020).
- ICSF must be active (Node hangs silently at startup otherwise).
- `/usr/bin/env` must exist; `/tmp` needs 1 GB or `TMPDIR` pointed elsewhere.
- Address space at least 300 MB (`ulimit -A`; `SETOMVS MAXASSIZE` / RACF `OMVS(ASSIZEMAX)`), at least 2 GB above the bar (`ulimit -M`, MEMLIMIT). IBM recommends `--max-old-space-size=4096` which needs MEMLIMIT ≥ 4 GB.
- Bash recommended. Native addons need Open XL C/C++ 2.2 (or C/C++ for Open Enterprise Languages 3.0), Python 3.11+, GNU Make 4.4.1+. We plan to avoid addons entirely.
- Install is `pax -p p -r -f <file>`, `./setup.sh`, then `. <nodejs_dir>/.env` in every shell (it sets PATH, `_BPXK_AUTOCVT`, `_CEE_RUNOPTS` and the CC/CXX variables).

**Encoding behaviour that will bite a JSON-RPC server**

- The runtime treats any untagged file as EBCDIC unless `__UNTAGGED_READ_MODE` says otherwise (AUTO guesses, STRICT converts nothing, V6 forces 1047→819, WARN is AUTO plus a warning). npm-installed trees are normally fine; files copied in by SFTP or `pax` must be checked with `ls -T` and fixed with `chtag -tc 819` (text) or `chtag -b` (binary such as `server.pax.Z`).
- **stdin/stdout/stderr default to CCSID 1047.** `NODE_STDIN_CCSID`, `NODE_STDOUT_CCSID`, `NODE_STDERR_CCSID` override that; only 819 and 1047 work without `_BPXK_AUTOCVT=ALL`, which is needed for 1208. This directly affects the stdio transport: an MCP client that spawns the server over SSH from an ASCII workstation will see EBCDIC JSON unless the CCSID variables are set. Sockets are unaffected ("text data streamed to client connections is in UTF"), which is one reason HTTP is the sensible transport on z/OS.
- Writes: a "binary guess" feature auto-tags output files (`NODE_WRITE_GUESS_BINARY_SKIP` disables it). Relevant for the server's own log and cache files.
- A `cp1047` encoding exists on `fs` APIs for reading/writing EBCDIC regardless of tag.
- The `node --help` output on z/OS documents the ZOSLIB extensions; `node --zoslib-help` prints more.

**Limitations listed by IBM for 24.0**

- "The Node.js built-in profiler is not functional" (the V8 `--prof` tick profiler). Whether inspector-based `--cpu-prof` / `--heap-prof` work is not stated; the plan tests it.
- `fs.watch` on subdirectories unsupported.
- IBM Interactive Diagnostic Data Explorer unusable; use `heapdump` (`SIGUSR2`) and Language Environment `RPTSTG(ON)` storage reports instead.
- Node registers itself with SMF via IFAUSAGE (SMF type 89 product usage); `NODE_SMF89_*` variables control the messages.

**Operational facts from the troubleshooting topic**

- Leftover message queues after abnormal exits: `__IPC_CLEANUP=1` and raise `IPCMSGNIDS`.
- Spawning many processes can hit `MAXPROCUSER`.
- WASM code range failures: `--wasm-max-mem-pages=4096`.
- `unset STEPLIB` if CXXRT64 load errors appear.

## 3. Deployment shapes to test

| Shape | What runs where | Code change | Why test it |
|---|---|---|---|
| A. Loopback SSH | Node + MCP server on z/OS, native backend SSHes to `user@127.0.0.1` and spawns `zowex server` | none | Proves the runtime, encoding and dependency story with today's code. Baseline for the cost of the SSH hop. |
| B. Local spawn | Node + MCP server on z/OS, `zowex server` spawned directly as a child process, JSON-RPC over pipes | new local client in the zowex SDK (`ZSshClient`'s ssh2-shaped seam), plus a `--native --local` flag here | Removes sshd, two SSH crypto stacks and credential handling from the hot path. This is the "efficient" target. Identity becomes the address-space user. |
| C. HTTP front door | Shape A or B with `--http`, clients connect over streamable HTTP from workstations | none for plain HTTP; TLS and auth are design work (AT-TLS vs Node TLS, JWT via Keycloak/APIML, see `docs/future-zos-identity-mapping.md`) | The only transport that makes sense for clients that are not on z/OS. Also the shape for a started task. |
| D. Workstation reference | Today's model: server on a laptop or CI runner, SSH to z/OS | none | Control group. Every on-z/OS number is reported against this. |

Recommendation: run A and D first (no code), measure, then decide whether B's saving justifies the SDK change. C is where the product ends up, so at least smoke it in phase 2.

## 4. What to measure and how

### 4.1 Metrics

| Metric | Why | Primary source |
|---|---|---|
| Startup to first `initialize` response | Node boot on z/OS is slow; matters for stdio spawn-per-session clients | client-side timestamp; `process.hrtime` log line at ready |
| Per-tool wall-clock latency (p50/p95) for a fixed tool script | User-visible; compare A vs D | client-side timing (`call-tool` loop or the e2e suite with timing) |
| **GP CPU seconds per tool call** (node process, zowex process, sshd) | Not zIIP-eligible, so this is the MSU cost | SMF 30 interval/step records; fallback `ps -o atime` deltas and `process.cpuUsage()` |
| RSS, V8 heap, above-the-bar usage | Sizing MEMLIMIT/ASSIZEMAX | `process.memoryUsage()`, `ps -o vsz`, `RPTSTG(ON)` |
| Throughput under N concurrent MCP sessions | Shared-server scenario over HTTP | client-side; SMF 30 for CPU; `D OMVS,LIMITS` for process/thread pressure |
| Event-loop utilization and delay | Detects blocking in the server under load | `perf_hooks.performance.eventLoopUtilization()`, `monitorEventLoopDelay()` |
| Bytes on the wire per call | SSH/loopback vs pipes | zowex verbose log; ssh2 debug counters |

### 4.2 z/OS-side tools, in order of preference

1. **SMF type 30** (interval and step-end). Gives TCB+SRB CPU, zIIP time (expect 0), storage high-water marks, EXCPs per address space. Each Node process is its own BPXAS address space with jobname `<userid><n>`; give the measured process a distinctive name with `_BPX_JOBNAME=ZMCPSRV` so records are easy to select. Needs read access to the SMF dump data sets or a sysprog to extract them. Ask for this first; if it is available everything else is corroboration.
2. **SDSF DA / `D OMVS,U=<user>` / `D OMVS,PID=<pid>`** for live CPU time and storage of the address space. Scriptable from TSO REXX via the SDSF API (`ISFEXEC DA`) or through our own console tool.
3. **`ps -o pid,atime,vsz,thdcnt,args -u <user>`** on USS. Note that `pcpu` (CPU %) always shows a dash on z/OS; use `atime` deltas over a measured interval instead.
4. **In-process counters**: `process.cpuUsage()`, `process.resourceUsage()`, `process.memoryUsage()`, `perf_hooks`. These need no privileges, so they are the portable core of the benchmark. Add a small `--metrics-log <file>` option (or a hidden `getServerStats` tool) that dumps these as JSON per tool call. That instrumentation is also useful on the workstation.
5. **RMF Monitor III** (if RMF or z/OS Data Gatherer is active): OMVS and process views, plus Workload Activity if the process is classified into its own WLM report class. Ask whether a report class can be defined for the userid.
6. **SMF 89** (product usage, Node registers via IFAUSAGE) — confirms Node's registration; low value beyond that.
7. **V8 profiling**: try `node --cpu-prof` and `--heap-prof`; IBM only says the `--prof` tick profiler is broken. If `--cpu-prof` works, copy the `.cpuprofile` off-host and open it in Chrome DevTools. `heapdump` via `SIGUSR2` for memory.
8. **Language Environment**: `_CEE_RUNOPTS="RPTSTG(ON)"` for a heap/stack report at exit.

Not usable: IBM Application Performance Analyzer (no Node support), IDDE (IBM says so), z/OS `pcpu`.

### 4.3 Workload

- **Fixed tool script**: 20 calls covering `getContext`, dataset list/read/write, USS list/read, job submit + status + spool read, console command, search. Same script for every shape. Drive it with `call-tool` in a loop, or a 60-line Node client using `@modelcontextprotocol/sdk` that records per-call timings to JSON.
- **Regression suite as workload**: `native-stdio.e2e` (61 tests) with `ZOWE_MCP_E2E_SERVER_PATH` pointed at the on-z/OS install; pass/fail is the correctness gate, its duration is a coarse latency number.
- **Concurrency**: the HTTP shape with 1, 4 and 8 parallel clients running the fixed script.
- **Realistic**: one eval suite run from `packages/zowe-mcp-evals` against the on-z/OS HTTP endpoint (LM Studio model is free per the local-eval-runs note).

Report every number as a table with D (workstation) as the reference column and note the LPAR's capacity (`D M=CPU`, MSU rating if known) so CPU seconds can be turned into cost.

## 5. Phased plan for a session with z/OS access

Rules for whoever executes this: record every command's actual output in the results file, never trust exit codes alone (our airgap script prints SKIP and exits 0), and stop at each gate.

### Phase 0: discovery (30 min, no changes)

```sh
uname -srvI; oslevel 2>/dev/null; cat /etc/os-release 2>/dev/null
which node npm; node --version; npm --version
ls -d /usr/lpp/IBM/cnj* /ZOWE/* 2>/dev/null          # IBM Node install dirs, Zowe runtime
env | grep -E '^(_BPXK|_CEE|_TAG|NODE_|__UNTAGGED|STEPLIB|TMPDIR)'
ulimit -a; /bin/ulimit -A; /bin/ulimit -M
df -m /tmp $HOME
chtag -p $SSH_TTY
node -e 'console.log(process.versions, process.arch, process.platform)'
node -e 'const s=process.cpuUsage();for(let i=0;i<1e7;i++);console.log(process.cpuUsage(s),process.resourceUsage(),process.memoryUsage())'
node --cpu-prof -e '0' && ls *.cpuprofile        # does inspector-based profiling work?
node --zoslib-help | head -40
which zowex; ls ~/.zowe-server 2>/dev/null; ls /ZOWE/tmp/zowex 2>/dev/null
```

Gate: Node ≥ 20 present, `ulimit -A` ≥ 300 MB, `ulimit -M` ≥ 2 GB, ICSF up (Node prints a version instead of hanging). If Node is absent, the pax edition can be downloaded from `ibm.com/products/sdk-nodejs-compiler-zos` and installed into a user directory without sysprog help; note that in the results.

Also capture: z/OS release and PTF gaps against §2, whether RMF/Data Gatherer is running (`D OMVS,LIMITS`, `F RMF` needs authority; ask), whether SMF dumps are readable, MSU/capacity of the LPAR.

### Phase 1: get the server running (shape A)

1. On the workstation: `npm run pack:server` (do this on the PR #111 branch to get the bundle; also try `main`'s tarball to see the difference in install size and start time).
2. Copy the tarball with SFTP in binary mode (or reuse zowex's `buildTools.ts upload`). Verify `ls -T` shows `b binary`.
3. On z/OS, in a fresh dir:

   ```sh
   . /path/to/nodejs/.env
   mkdir -p ~/zmcp && cd ~/zmcp
   npm init -y >/dev/null
   time npm install --omit=optional --no-audit --no-fund ../zowe-mcp-server-*.tgz
   find node_modules -name '*.node' -o -name 'binding.gyp' | head     # expect nothing
   ls -T node_modules/@zowe/mcp-server/dist/index.js                   # expect ASCII tag or AUTO-readable
   ```

   Record install time, file count, bytes. If npm tries to build `cpu-features`, `--omit=optional` was not honoured; investigate before continuing.
4. Smoke without z/OS work: `node node_modules/@zowe/mcp-server/dist/index.js --version` and `--mock <dir>` with a tiny mock tree; send an `initialize` over stdio from a here-doc and check the reply is readable ASCII. If it comes out as EBCDIC, set `NODE_STDOUT_CCSID=819 NODE_STDIN_CCSID=819 NODE_STDERR_CCSID=819` and note which combination worked.
5. Loopback native: create `native-config.json` with `"systems": ["<user>@127.0.0.1:<sshport>"]`, set `ZOWE_MCP_ZOWEX_SERVER_PATH` to the existing zowex install if one exists (`/ZOWE/tmp/zowex/c/build-out` on Marist) or let auto-install deploy `server.pax.Z` from the SDK tarball. Run `call-tool --native --config native-config.json getContext`. Check `ps -ef | grep zowex` shows the child and `ls -T` on anything the deploy wrote.
6. Run the regression suite from the workstation against the on-z/OS server through an SSH-spawned stdio session: `ZOWE_MCP_E2E_SERVER_PATH` cannot point across hosts, so either run vitest on z/OS (heavy; try, and record if vitest itself works there) or wrap `ssh host 'cd ~/zmcp && . …/.env && node …/index.js --stdio --native …'` in a small shim script and point `ZOWE_MCP_E2E_SERVER_PATH` at the shim. The shim is the more useful artifact; commit it under `scripts/` if it works.
7. HTTP: `node …/index.js --http --port 7542 --http-host 0.0.0.0 --http-allow-no-auth --native --config native-config.json`, then from the workstation `npx @modelcontextprotocol/inspector` or `call-tool` against `http://host:7542/mcp` through an SSH tunnel. Record whether Express + streamable HTTP works unchanged and whether `fetch`/undici behaves (OIDC discovery in `http.ts` uses `fetch`).

Gate: `getContext` and one dataset read succeed in shape A; stdio encoding recipe documented; e2e suite pass count recorded (expect some failures, list them).

### Phase 2: measure

1. Add the in-process metrics option (small PR, see §4.2 item 4) and rebuild the tarball. Until then, wrap the run in a script that samples `ps -o pid,atime,vsz,thdcnt,args` every second into a file.
2. Set `_BPX_JOBNAME=ZMCPSRV` before starting the server so SMF 30 and SDSF show it under one name. Ask the sysprog for SMF 30 records for that jobname and the `zowex` children over the measurement window, or an SDSF DA screenshot before and after.
3. Run the fixed tool script (§4.3) three times in each of: D (workstation → Marist SSH), A (on-z/OS loopback), and if time allows the HTTP shape with 1/4/8 clients.
4. Collect: per-call latency JSON, `ps` samples, SMF 30 or DA CPU deltas, `process.cpuUsage` deltas, RSS, start-up time, `.cpuprofile` if step 0 showed `--cpu-prof` works.
5. Also run one `search-benchmark` and one `evals` smoke against the HTTP endpoint.

Gate: a table with CPU seconds per call and p50/p95 latency for A vs D, plus memory. Write it to `docs/zos-hosted-server-results.md`.

### Phase 3: operate like a product

- Started task: BPXBATCH/BPXBATSL JCL that sources `.env`, sets `_BPX_JOBNAME`, CCSID variables, `NODE_OPTIONS=--max-old-space-size=…`, and runs `--http`. Model it on Zowe's `ZWESLSTC` and `zwe` launcher (Zowe already runs Node this way for the app-server). Record the region and MEMLIMIT needed.
- TLS and auth for HTTP: AT-TLS policy vs Node TLS in-process; bearer JWT via Keycloak or APIML. Reuse `docs/remote-dev-keycloak.md` flows.
- Logging and cache directories: verify tags of files the server writes (`NODE_WRITE_GUESS_BINARY_SKIP` if guesses go wrong).
- Cleanup: remove the install dir, kill leftover `zowex server` and Node processes (`ps -u <user>`), check for leftover message queues (`ipcs`, `__IPC_CLEANUP=1`).

### Phase 4 (code, only if phase 2 justifies it): local spawn transport

In the zowex repo: a `LocalClient` implementing the ssh2-shaped interface `ZSshClient` consumes (`connect` → emits `ready`, `exec(cmd)` → `child_process.spawn` returning a stream with `stdout`/`stderr`/`stdin`/`close`, `end`), selected by an option on `ZSshClient.create`. `RpcStreamManager`'s `cat > pipe` trick works unchanged with spawn. In this repo: a `--native --local` flag (or `user@local` connection spec) that skips credentials. Then repeat phase 2 for shape B. Expected saving: the sshd address space, two SSH crypto stacks and the SFTP deploy check per session.

## 6. Folio additions to make first

Folio (`http://127.0.0.1:5174`) has no IBM Node.js-for-z/OS book today; the only hits are Zowe's prerequisite page and Db2's Node driver topic. Suggested `download_cobol_docs.py` entries (IBM Docs API, same mechanism as the COBOL and z/OS books):

| Book | IBM Docs API key | Size | Notes |
|---|---|---|---|
| IBM Open Enterprise SDK for Node.js | `sdk-nodejs-zos/24.0.0`, `22.0.0`, `20.0.0` | 32 topics each | product key `SSTRRS`; topic URL `https://www.ibm.com/docs/en/sdk-nodejs-zos/{ver}?topic={id}`. Small, high value: encoding, env vars, limits, troubleshooting. |
| z/OS RMF | subtree of `zos/3.2.0`, href `SSLTBW_3.2.0/com.ibm.zos.v3r2.erb/erb.htm` | ~2,010 topics | Monitor III reports, DDS API, Spreadsheet Reporter. |
| z/OS Data Gatherer | subtree `…v3r2.grb/grb.htm` | ~250 topics | The RMF-less gatherer and its REST services. |
| z/OS MVS Initialization and Tuning Guide + Reference | subtrees `…ieae100/abstract.htm`, `…ieae200/abstract.htm` | 186 + 846 | MEMLIMIT, IEFUSI, BPXPRMxx limits. |
| z/OS MVS Programming: Workload Management Services | subtree `…ieaw200/abstract.htm` | ~300 | Report classes for the measured process. |
| IBM Open Enterprise Foundation for z/OS (zoslib) | key `oefzos` (versions to be enumerated) | unknown | `_BPXK_AUTOCVT`/tag behaviour of the runtime layer. |

Already covered: SMF record layouts (type 30 is in `ibm-zos-mvs`), BPXBATCH and `ps` (in `ibm-zos-unix-system-services`), `_BPXK` variables, file tagging (in `ibm-zos-xl-c-cpp` and USS books).

## 7. Open questions for Petr

1. Which LPAR: Marist via the zowex secrets, or another system? Does that user have SMF dump read access, SDSF, and can a WLM report class or `_BPX_JOBNAME` be used?
2. Is Node already installed there (Zowe runtime under `/ZOWE` suggests yes) and which version? If it is 20/22, do we test on that or install 24 in a user directory?
3. Is the HTTP shape with JWT the intended product deployment, or is stdio-on-z/OS (for a future on-host agent) also a target? It changes whether the CCSID recipe matters beyond testing.
4. Should the in-process metrics option go in as its own small PR before the z/OS session, so the first run already produces numbers?
5. Is a zowex SDK change (phase 4) acceptable scope, or should this repo stay on the loopback SSH shape?

## 8. Packaging for z/OS and deployment helper commands

### 8.1 What the artifact is

The PR #111 tarball is already the right base artifact for z/OS. `bundle-for-pack.cjs` esbuild-inlines the server, keeps only the few packages that cannot be inlined as real dependencies, installs them with `--omit=dev --omit=optional`, and ships that `node_modules` inside the tarball (`bundledDependencies`). The result is pure JavaScript (no `.node` files, `russh` and `cpu-features` already dropped) and installs offline. It also carries the zowex z/OS binary as `@zowe/zowex-for-zowe-sdk/bin/server.pax.Z` (3.3 MB), so on z/OS the deploy step is a local `pax -rzf`, not an SFTP upload. One artifact therefore serves the workstation, CI and the host. Zowe's own z/OS Node component (the app-server) is delivered the same way: JavaScript plus `node_modules` in a pax, no compile step on the host.

| Option | Contents | Install on z/OS | Needs on host | Verdict |
|---|---|---|---|---|
| 1. npm tarball (PR #111) | `dist/` bundle + bundled `node_modules` + `server.pax.Z` | `npm install --omit=optional ./zowe-mcp-server-<v>.tgz` in any directory; IBM's npm tags files as it extracts (verify with `ls -T`) | IBM Node + npm | Base artifact. Use for phase 1 and for anyone who already runs npm on the host. |
| 2. z/OS pax (`zowe-mcp-server-<v>-zos.pax.Z`) | Option 1 pre-expanded into `zowe-mcp-server/` with `bin/*.sh`, `manifest.yaml`, `schema.json`, README | `pax -rzf`, then `bin/validate.sh` or `zowe-mcp-server zos doctor` | IBM Node only, no npm, no network | Built in CI from option 1 (a `pack:zos` script). This is the artifact for BPXBATCH shops and the Zowe component in option 3. File tags: build the pax on z/OS during LPAR validation so tags are preserved, or tag on install (`chtag -R -tc 819` for text, `-b` for `server.pax.Z`); `zwe components install --auto-encoding` does this for option 3. |
| 3. Zowe server component | Option 2 plus `manifest.yaml` `commands.validate/configure/start`, `apimlServices`, `schemas.configs` | `zwe components install -c zowe.yaml -o zowe-mcp-server-<v>-zos.pax.Z` | Zowe v3 runtime (which already brings Node 20/22 via `zowe.yaml node.home`) | The recommended product deployment for Zowe shops: runs as an address space under ZWESLSTC, configured in `zowe.yaml` under `components.zowe-mcp-server`, and can register with the API Mediation Layer so the gateway handles TLS and authentication in front of the HTTP transport. |
| 4. Container image | `FROM icr.io/zoscp/node` + option 1 | z/OS Container Platform (podman) | zOSCP entitlement | Later. Same artifact inside; nothing to design now. |
| Not viable now | Node single-executable (SEA) | | | Unverified on IBM's build (SEA injects a blob into the node binary; no evidence it works for z/OS load modules). Do not plan on it. |

Option 2's manifest is small: `name: zowe-mcp-server`, `id: org.zowe.mcp-server`, `commands: {validate: bin/validate.sh, start: bin/start.sh}`, `apimlServices.static` pointing at a registration template for the `/mcp` route, and `schemas.configs` for the component's config keys (port, host, JWT issuer, native systems, zowex path). Zowe's docs: "Packaging z/OS extensions", "Server component manifest file reference", "Zowe component runtime lifecycle" (validate, configure, start run from the component root, each in its own shell; `configure` may export variables for `start`).

### 8.2 Helper commands

The server already dispatches subcommands (`init-mock`, `call-tool`, `generate-docs`, `mock-zos`) to scripts under `dist/scripts`, so a `zos` group fits without new infrastructure. All of them must print what they found and use exit codes honestly; none may print SKIP and exit 0. The z/OS-only checks run only when `process.platform === 'os390'`; elsewhere the command says so and exits non-zero.

| Command | Runs on | Does | Phase it serves |
|---|---|---|---|
| `zos doctor [--json] [--zowe]` | host | Node version against 20/22/24, `process.platform`, `ulimit -A` ≥ 300 MB, `ulimit -M` ≥ 2 GB, ICSF (a `crypto` call with a timeout, since Node hangs without ICSF), `/usr/bin/env`, TMPDIR free space, tags of `dist/index.js` and a sample of `node_modules`, CCSID variables and `chtag -p` on the TTY, zowex binary present and `zowex -v` works, loopback SSH reachable (shape A), HTTP port free. `--zowe` reads `ZWE_*` variables instead of flags so `bin/validate.sh` is one line. | Phase 0 and every later run; becomes the component's `validate`. |
| `zos env [--for stdio\|http] [--shell sh\|bash]` | host | Prints the recommended environment: `. <nodejs>/.env`, `NODE_STDIN/STDOUT/STDERR_CCSID=819` (stdio only), `_BPX_JOBNAME=ZMCPSRV`, `NODE_OPTIONS=--max-old-space-size=<n>`, `__IPC_CLEANUP=1`, `NODE_WRITE_GUESS_BINARY_SKIP` if needed. Paste into a profile, a STDENV DD, or `bin/start.sh`. | Phase 1 |
| `zos install-zowex [--path ~/.zowe-server]` | host | Local twin of `ZSshUtils.installServer`: unpack the bundled `server.pax.Z` with `pax -rzf`, tag it binary, verify `zowex -v`. No SFTP. | Shape B, and shape A when `ZOWE_MCP_ZOWEX_SERVER_PATH` should point at a local copy. |
| `zos jcl [--stc\|--batch] [--jobcard <spec>] [--http --port …]` | anywhere | Generates BPXBATSL JCL (started task or batch job) with a STDENV DD from `zos env`, `STDOUT/STDERR` to files with the right tags, and the server command line. Reuses the job-card mechanism from `native-config.json`. Also emits a `bin/start.sh` for option 3. | Phase 3 |
| `zos install <user@host[:port]> --tarball <tgz> [--dir ~/zmcp] [--as-component --zowe-yaml <path>]` | workstation | SFTP the tarball in binary mode, run `npm install --omit=optional` (or `pax -rzf` for option 2, or `zwe components install` for option 3), tag fixups, run `zos doctor` remotely, print the start command. Uses the existing ssh2 stack and the same credential providers as `--native`. Generalises `test-airgap-install.sh --native`. | Phase 1 onward; the thing a Claude Code session runs first. |
| `zos bench [--script fixed20.json] [--sample-ps] [--out results.json]` | either | Runs the fixed tool script from §4.3 against a server (stdio child or HTTP URL), records per-call latency, `process.cpuUsage` and memory deltas from the server's metrics log, and samples `ps -o pid,atime,vsz,thdcnt,args` for node, zowex and sshd once a second when on z/OS. Emits JSON plus a Markdown table with the workstation run as the reference column. | Phase 2 |
| server flag `--metrics-log <file>` | host | Per tool call: wall time, `process.cpuUsage` delta, `memoryUsage`, event-loop utilization, bytes in/out. What `zos bench` and SMF 30 are correlated against. | Phase 2 |

Order of implementation: `doctor` and `env` before the first LPAR session (both cheap, both needed on day one), `--metrics-log` and `bench` with phase 2, `install` as soon as phase 1 shows the manual steps that actually work, `jcl` and the component scripts after phase 3 picks the started-task shape.

## 9. Using SAF instead of an identity provider (under consideration)

Status: everything in §9 and §10 is a candidate, not a decision. The established authentication model is the off-z/OS one in `docs/mcp-authentication-oauth.md`: an OAuth bearer token from an IdP at the HTTP layer, and separate SSH credentials for z/OS resolved from env, Vault, the tenant store or elicitation. That model does not change by moving the server onto z/OS, and nothing below is scheduled. The sections exist so the options and their z/OS primitives are written down once, with sources, before any product discussion.

Once the server runs on z/OS, the mainframe security manager could do both jobs an IdP does today: authenticate the caller and decide what they may touch. Three modes, in increasing effort. All three end with `zowex` running under the caller's own user ID, so every data set, job and USS action is authorized and audited by SAF as that user. That is the property to preserve.

### Mode 1: SAF through loopback SSH (no new native code)

The caller supplies a mainframe user ID and password, passphrase or MFA-generated code through the existing credential path (elicitation, header, or a `/login` on the HTTP transport). The server SSHes to `127.0.0.1` as that user; `sshd` verifies the credentials with SAF, and `zowex server` runs as the caller. Nothing else is needed. The HTTP layer issues its own short-lived session token bound to the cached SSH session, so the client sends the password once. This is the same trust model as today's workstation deployment, just with the SSH hop kept on-host. Cost: the server holds the password for the life of the session, and the SSH hop stays in the hot path (measured in phase 2).

### Mode 2: Zowe API Mediation Layer as the token issuer (candidate for Zowe shops)

Zowe's own recommendation for the Gateway is the SAF authentication provider: the Gateway validates credentials with SAF APIs and issues a Zowe JWT whose subject is the mainframe user ID. It also offers personal access tokens (scoped to services, up to 90 days, revocable) and MFA. Our HTTP transport already verifies bearer JWTs against a JWKS, so pointing issuer and JWKS at the Gateway gives an IdP-less mode with no mapping step: `sub` is the SAF user. For the zowex identity, register the server as an API ML service with the `httpBasicPassTicket` scheme; the Gateway then generates a PassTicket per request (PTKTDATA and APPL definitions, Gateway user permitted to `IRRPTAUTH`), and the server uses user ID plus PassTicket as the loopback SSH password. `__passwd` (the service `sshd` uses for password authentication) verifies PassTickets, but the PassTicket must be generated for `sshd`'s APPLID, which defaults to `OMVSAPPL`; confirm on the LPAR before relying on it. Packaging option 3 in §8 is what makes this mode a configuration exercise rather than code.

### Mode 3: direct SAF from the server (shape B, most efficient, needs a small native helper)

For the local-spawn shape there is no `sshd` to do the work. The documented primitives:

- `__passwd()` / `__passwd_applid()` (BPX1PWD) verifies a user ID's password, passphrase or PassTicket. Problem state, no special authority.
- After a successful `__passwd()` for a user, the same process may `setuid()` to that user without daemon authority ("Any user can issue a setuid() which follows a successful __passwd() call to the same target user ID"). `spawn()` with `_BPX_USERID=<user>` follows the same authorization rule as `setuid()`, and the child always gets its own address space.
- `BPX.DAEMON` would allow identity switches without a password, but only from a clean address space where every loaded program is program-controlled. IBM's Node.js is not shipped program-controlled and loads many DLLs, so treat daemon authority as unavailable to the Node process. Do not design around it.
- `auth_check_resource_np()` (BPX1ACK) checks a user's access to a RACF resource; needs READ on `BPX.SERVER` or UID 0. Useful later for tool-level gating through profiles such as `ZOWE.MCP.TOOL.<name>`; not required, because zowex running as the user already gets SAF authorization on every resource.

The clean design is a launcher, not a Node addon: a small native program (naturally a `zowex server --as-user <id>` mode in the zowex repo, built on Marist like the rest of zowex) reads the credential from stdin, calls `__passwd()`, then `setuid()` or re-spawns itself with `_BPX_USERID`, and continues as the JSON-RPC server. Node only spawns it, and the credential can be a password or an API ML PassTicket, so modes 2 and 3 compose. RACF needs nothing beyond an OMVS segment for each user. Zowe's ZSS does the same dance in C today.

### Possible follow-ups (none scheduled)

- Phase 1 exercises mode 1 mechanically because loopback SSH is how shape A works; whether the SSH login should ever double as the HTTP login (a `--http-auth saf` option) is a product decision, not part of the test plan.
- If mode 2 is pursued, phase 3 would configure it through the Zowe component manifest (`apimlServices`, PassTicket scheme) and verify the `sshd` APPLID question.
- If mode 3 is pursued, the `--as-user` launcher would be a sibling ask to the local client in the zowex repo.
- Independent of any of this: startup runs the same checks as `zos doctor` and refuses to start on a hard failure (`--skip-doctor` to bypass), so misconfiguration fails at boot with the doctor's message, not on the first tool call.

## 10. Who spawns it, SAF for the remote server, and how credentials arrive (under consideration)

Same status as §9: the baseline is the existing off-z/OS model; the rest are options on the table.

### Who spawns the server on z/OS

| Parent | Identity of the process | Auth already done by | Assessment |
|---|---|---|---|
| The user's own SSH session: an off-host MCP client whose stdio command is `ssh user@host node …/index.js --stdio --native …` | the user | `sshd` (key, password, MFA) | Technically the simplest (no token, no identity switching, zowex is a child of the same user), but **not favoured**: it puts an interactive SSH session and a per-user Node process on z/OS in the path of every off-host client, and Petr is not convinced that is a deployment we want. Keep it as a test vehicle for phase 1 only. |
| A started task: ZWESLSTC through the component manifest, or its own STC from `zos jcl` | a service user (like ZWESVUSR) | nothing yet; the HTTP layer must authenticate callers and zowex must be switched to the caller (§9 modes 2 and 3) | Shared server for many users, the product shape. |
| Batch or inetd | not applicable | | Not a fit for a long-lived JSON-RPC server. |

### SAF for the remote (off-platform) server

The server cannot call SAF from a workstation or a container; every SAF decision has to happen on z/OS, and there are two places it already does:

- **The SSH hop.** Today's remote deployment is already SAF-authenticated: `sshd` verifies whatever credential the server presents and zowex runs as that user. A "SAF login" for the HTTP layer would be the same check pulled forward: try the SSH login with the supplied credentials, and on success bind the HTTP session to the cached SSH session. Note the repo's stated policy in `docs/mcp-authentication-oauth.md`: the MCP server does not embed an OAuth authorization server. A session bound to a live SSH connection is not that, but it is a token issuer of a kind, so this needs an explicit decision.
- **Zowe API ML.** The Gateway's SAF provider works for an off-platform MCP server as well as an on-platform one: JWT verification only needs the Gateway's JWKS over HTTPS, personal access tokens are ordinary bearer tokens, and if the MCP server is onboarded as an API ML service the Gateway proxies to it wherever it runs and injects a PassTicket per request. The server then logs in to z/OS over SSH with user ID plus PassTicket, inside the ticket's validity window, and no password is stored anywhere. The SSH session cache must open the session on the first request and reuse it, because a PassTicket is single-use. Same APPLID caveat as §9.

SSH keys are the third credential `sshd` accepts. The workstation resolver already uses the user's own `~/.ssh` keys for local stdio (no password at all, SAF still decides what the key's user may do). A shared remote server would have to hold per-user private keys, which the existing Vault KV path can do, but that is a service-account pattern rather than a user one.

### How users provide credentials or tokens

| Deployment | What the client sends to the MCP server | How the server reaches z/OS |
|---|---|---|
| Local stdio on the workstation (today) | nothing | env vars or `ZOWE_MCP_CREDENTIALS`, Vault KV, workstation SSH keys, MCP elicitation (a form in the client) or URL-mode elicitation (a browser page the server serves), all existing code |
| stdio over SSH to z/OS | nothing; the SSH login is the credential | already the user; local zowex |
| Remote HTTP with an IdP (today) | OAuth bearer token; clients discover the authorization server from the protected-resource metadata the server already publishes | SSH credentials from the per-tenant store, Vault, or elicitation |
| HTTP with SAF, via API ML | a Zowe JWT from the Gateway login endpoint, or a personal access token (scoped, up to 90 days, revocable) pasted as a static bearer header in the client config, for example `claude mcp add --transport http --header "Authorization: Bearer …"`; or, when the Gateway fronts the server, whatever the Gateway accepts (SSO cookie, client certificate, MFA) | PassTicket injected by the Gateway |
| HTTP with SAF, no API ML (any deployment target: the SAF check runs in sshd on the target system, not in the server) | URL-mode elicitation: the server returns a login URL, the user enters mainframe ID and password or MFA code in the browser page, the server validates by opening the SSH session and binds it to the MCP session; no bearer token is minted, the MCP session ID is the handle and tools refuse until the login succeeds; needs TLS, rate limiting on the login page, and a non-loopback bind option gated on that login | that SSH session, one per target system |
| Never | HTTP Basic with the mainframe password on every request | |

Where this leaves things: the first two rows are the established model and stay the baseline. The API ML row is the most complete candidate for a shared server because it keeps passwords out of the server on and off platform, but it is a candidate. The browser-login row conflicts with the "no embedded authorization server" policy unless the policy is read narrowly, so it stays parked until that is decided. The SSH-spawned stdio row is a test vehicle, not a target.

## Sources

- IBM Docs, Open Enterprise SDK for Node.js 24.0: What's new, Migrating, Installing pax format, Container image, Tagging files for Enhanced ASCII support, Environment variable extensions, API extensions, Known issues and limitations, Common issues and solutions, Debugging, Capturing heap information, Generating reports of storage usage (`https://www.ibm.com/docs/en/sdk-nodejs-zos/24.0.0`).
- IBM product page FAQ on zIIP eligibility and pricing: `https://www.ibm.com/products/sdk-nodejs-compiler-zos`.
- Zowe docs 3.4, "Addressing Zowe server prerequisites" (Folio `zowe-docs/3.4/user-guide--install-nodejs-zos`).
- z/OS 3.2 UNIX System Services Command Reference, `ps` (Folio `ibm-zos-unix-system-services/3.2.0/descriptions-ps-return-status-process`): `pcpu` unsupported, `atime` is CPU time.
- z/OS 3.2 MVS SMF, record type 30 (Folio `ibm-zos-mvs/3.2.0/sr-record-type-30-x1e-common-address-space-work`).
- zowex repo: `.github/workflows/zos-build.yml`, `scripts/buildTools.ts`, `README.md` (Marist access, Open XL 2.1 choice, z/OS 2.5 minimum).
- This repo: `packages/zowe-mcp-server/src/transports/*`, `src/zos/native/ssh-client-cache.ts`, `node_modules/@zowe/zowex-for-zowe-sdk/lib/ZSshClient.js`, `docs/future-zos-identity-mapping.md`, `docs/search-benchmark-results.md`.
