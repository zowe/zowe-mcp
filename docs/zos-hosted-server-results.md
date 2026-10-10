# Running the Zowe MCP server on z/OS: Phase 0/1 results (Host-A)

> Overview of all z/OS components and deployment shapes: [`zos-overview.md`](./zos-overview.md).

Status: Phase 0 (discovery) and Phase 1 (shape A — loopback SSH, and shape C —
HTTP transport) complete on `Host-A` (z/OS V3R1, RACF). Also
includes a real end-to-end test of the standalone SAF-backed IdP
(`packages/zowe-mcp-zos-saf-idp`) against a real RACF account on this LPAR.
Phase 2 (measurement) and Phase 3/4 not started. See
`docs/zos-hosted-server-plan.md` for the full plan this reports against.

## Phase 0: discovery — deltas from the plan's assumptions

- **Node version.** The plan guessed a Zowe-installed LPAR "will likely have
  Node 20 or 22, not 24." Host-A only had SMP/E-target **Node 18** (18.17.1 →
  18.19.0, under `/usr/lpp/IBM/cnj/v18r0/`) — older than even 20/22, and not a
  usable runtime (see the CRTEQCXS finding below, which predates and blocks
  even this older install). Node 24.18.1 was installed fresh (see "Getting
  Node 24 onto Host-A" below).
- **ICSF.** Node 18's `node -e '...'` hung indefinitely with no output. This
  was initially attributed to ICSF being inactive, per the plan's own
  warning. That attribution was **wrong** — `setup.sh` for the Node 24 pax
  independently confirms ICSF is active on Host-A. The Node 18 hang's real
  cause is unexplained; that install may simply be broken/incomplete.
- **`/tmp` size.** 256 MB `(TEMP)` filesystem, fully allocated — below the
  plan's 1 GB floor. Used `/u/users/group` (329 GB free) instead for
  everything in this session; did not test whether `TMPDIR` redirection
  alone is sufficient for `npm install` at scale.
- **MEMLIMIT.** `ulimit -M` = 2048 MB — meets the plan's stated minimum but
  below IBM's recommended 4 GB for `--max-old-space-size=4096`. Not hit in
  practice for the fixed tool script in this session.
- **`/usr/lpp/IBM` is read-only.** Not a permission-bit issue — the whole
  tree is a separate **read-only-mounted zFS** (`ZFS, Read Only`), and so are
  sub-mounts like `/usr/lpp/IBM/cnw` (an existing Open XL C/C++ 2.2 install
  by another engineer). `su` to root does not help; remounting read-write
  would be an LPAR-wide sysprog action, not attempted. This is why the
  shared installs below live under `/u/users/group/product/` instead, which
  is genuinely writable (`drwxrwxrwx`, zFS R/W) and where the existing
  `PRODnnn` service accounts also live.
- **`zowex` was already deployed** at `~/.zowe-server/zowex`
  (v0.9.0+c513179, 2026-09-03), independent of this session's work — shape A
  had something to point `ZOWE_MCP_ZOWEX_SERVER_PATH`-equivalent config at
  immediately.
- **IBM's Node.js z/OS pax is not in the internal corporate Artifactory** (checked
  `<internal-artifactory-host>` across all repos for `os390`/`s390x`/
  `sdk-nodejs`/`cnj` — only Linux `s390x` packages exist, e.g.
  `esbuild-linux-s390x`). It has to come from IBM's entitled download portal
  (`early-access.ibm.com`), which required an IBM ID approval that took
  under a day.
- **Host-B** (a second LPAR, z/OS V2R3, older than Host-A) already has
  SMP/E Node **22.22.3** and its own `zowex` (v0.9.0+7a44a49) — closer to
  what the plan assumed a "Zowe-installed LPAR" would have. Not tested for
  the CRTEQCXS issue below; Host-A and Host-B do **not** share DASD/catalogs
  (different master catalogs: `ICF.MASTER.VCATLOG` vs `ICF.MASTER.VMVCAC1`),
  so nothing found on one automatically applies to the other.

## Getting Node 24 onto Host-A

Downloaded `ibm-node-v24.18.1-os390-s390x-202608141439.pax.Z` (IBM Open
Enterprise SDK for Node.js 24.0, PTF 4) via IBM's entitled download portal.
SHA-256 verified before and after transfer.

**Blocker found: Node 24 does not run out of the box.**

```text
CEE3561S External function _ZNSt5__1_a13__hash_memoryEPKvm was not found
         in DLL CRTEQCXS.
```

Root cause: the base `CEE.SCEERUN2` copy of the `CRTEQCXS` runtime module is
back-level for what Node 24's binary needs. Host-A already has a
`CEE.SCEERUN2.OVERRIDE` dataset (a pre-existing PTF-refresh library) with a
fixed copy. Fix:

```sh
export STEPLIB=CEE.SCEERUN2.OVERRIDE
```

`unset STEPLIB` (the plan doc's own suggested fix for `CXXRT64`-style load
errors) does **not** help here — STEPLIB was already empty; the fix is to
*add* the override, not remove an existing one.

Installing the separate "IBM C/C++ for Open Enterprise Languages on z/OS
3.0" pax was **not** necessary to fix this — it's a compiler, not a
runtime-library patch, and is only needed for building native Node addons
(which this plan avoids). Its own `prerequisite_test.sh` independently
confirms **PTF UO04934 is not installed** on Host-A — one of the exact PTFs
the plan's §2 lists as required for z/OS 3.1. `ibm-clang++ --version` still
runs despite the failed check; not pushed further.

### Shared install (world-readable, no entitlement/root needed to use)

Installed under `/u/users/group/product/` rather than the (read-only)
`/usr/lpp/IBM`, following the same "activate script" convention as this
site's decade-old Node-on-z/OS precedent (a 2018 internal wiki page for a
different pair of LPARs, `/z/masserv/node/activate.sh` — that install is
long dead, but the pattern is worth keeping):

```sh
. /u/users/group/product/nodejs-zos/activate.sh    # Node 24.18.1 + STEPLIB fix
. /u/users/group/product/opencxx-zos/activate.sh   # IBM C/C++ for Open Enterprise Languages 3.0
```

Verified working end-to-end logged in as **User-B**, a separate non-admin
RACF user — confirms this is genuinely usable by others, not just the
installing user.

## Phase 1: shape A (loopback SSH, no code changes)

Built the npm tarball from the `feat/bundle-npm-package` branch (PR #111, the
esbuild bundle), per the plan's recommendation to use that branch for phase 1.

| Step | Result |
|---|---|
| `npm run pack:server` (workstation) | 8.3 MB packed / 25.1 MB unpacked, 4,845 files, 168 bundled deps. No `.node` binaries in the tree (only ssh2's optional `binding.gyp` source, never built). |
| `scp` to Host-A | 8.3 MB in ~23s. |
| `npm install --omit=optional` on Host-A (Node 24) | 18.85s. ssh2's `install.js` script correctly skipped by `npm`'s allow-scripts gate — no native build attempted, confirming `--omit=optional` is honoured. |
| `ls -T dist/index.js` | Tagged `ISO8859-1`, `T=on` — correct out of the box. |
| `node dist/index.js --version` | `0.11.0-dev` |
| stdio `initialize`, `--mock <dir>` | **Clean JSON response, no EBCDIC garbling.** The plan worried stdio would need explicit `NODE_STDIN/STDOUT_CCSID=819`; not needed here — the SDK's own `.env` (`_BPXK_AUTOCVT=ON`, `_CEE_RUNOPTS "FILETAG(AUTOCVT,AUTOTAG) POSIX(ON)"`) was sufficient. Full tool-registration log (capability tier, mock backend, systems) also correct. |
| Loopback native, `getContext` | Works without a live SSH connection (no credential needed for this tool). |
| Loopback native, `listDatasets` (real SSH → real zowex → real z/OS) | **Works.** See below — required setting up a credential and finding/fixing two bugs first. |

### Credential for the loopback connection: SSH key auth is broken on this Node build

The native backend prefers SSH key auth (auto-detects `~/.ssh/id_{ed25519,rsa,ecdsa,dsa}`)
over passwords. Generated a dedicated loopback keypair for User-A (self-trust
against its own `authorized_keys` — no RACF password ever needed for this
part) and confirmed it works for a plain `ssh` login. The MCP server's own
key-based auth still fell through to the password flow every time
(`SSH key file is not a usable private key; skipping`).

**Root cause: a real IBM z/OS Node 24 bug.** `fs.readFileSync` (and even raw
`fs.readSync`) corrupts the private key's bytes — each ASCII byte comes back
substituted with its EBCDIC-codepoint equivalent — **regardless of the
file's tag** (`chtag -b` / binary, meant to disable all conversion, made no
difference) **and regardless of `_BPXK_AUTOCVT`** (tested explicitly set to
`OFF`, still corrupted). Confirmed the on-disk bytes are correct plain ASCII
via `od -c` (a non-Node reader) — the corruption is specific to this Node
build's `fs` read path. Not resolved; worked around by using password auth
for this session's testing instead. This is a `zowe-mcp`-relevant risk
beyond just SSH keys: **any file this server reads via `fs.readFileSync` on
z/OS may be silently corrupted**, not just credentials.

Password auth itself hit two more real issues before it worked:

1. **`call-tool.ts`'s error logging was broken.** `log.error('Error', error)`
   on a raw `Error` object serializes to `{}` (message/stack aren't
   enumerable), so every CLI failure was invisible. Fixed to log
   `{message, stack}` explicitly — this was necessary to diagnose everything
   below. See PR (call-tool.ts error logging fix, targeted at `main`).
2. **User-A's RACF password was expired.** `FOTS1668 WARNING: Your password
   has expired` / `FOTS1669 Password change required but no TTY available` —
   non-interactive SSH exec can't do the interactive change prompt. This is
   the same gotcha already documented in the personal Host-A runbook. Reset
   via `ALTUSER User-A PASSWORD(...) NOEXPIRED` (User-A is RACF SPECIAL, can
   alter its own profile) — this specific action needs a human with RACF
   authority; an agent should not do it unprompted (it was blocked by this
   session's own permission classifier on the first attempt).

Once past both of those, `listDatasets` against `SYSPROG.PARMLIB.NOTES`
returned correct, real z/OS metadata (`dsorg: PO`, `recfm: VB`, `lrecl: 255`,
`blksz: 23476`) matching what plain `LISTDS` shows independently. Round trip:
2.4s.

Also found along the way: `call-tool`'s argument syntax is `key=value` pairs
(`system=... dsnPattern=...`), not a JSON blob — passing JSON produces
`Invalid argument "...": expected key=value`, and the tool's actual
parameter name is `dsnPattern`, not `pattern`.

## Gate check (plan §3, Phase 1)

> Gate: `getContext` and one dataset read succeed in shape A; stdio encoding
> recipe documented; e2e suite pass count recorded (expect some failures,
> list them).

- `getContext`: ✅
- One dataset read (`listDatasets`) succeeds: ✅
- stdio encoding recipe: documented above — **no explicit CCSID env vars
  needed** for the stdio JSON-RPC transport itself; they may still matter
  for other file I/O per the `fs.readFileSync` finding above.
- e2e suite (`native-stdio.e2e`, 61 tests) against the on-z/OS install: **not
  run this session.**

## Shape C: HTTP transport smoke test (loopback, no-auth)

Closes the last open Phase 1 gate item ("HTTP shape (C) not smoke-tested").
Reused the same install and `native-config.json` from shape A — **no code
changes** were needed to bring HTTP up on z/OS; it is pure configuration:

```sh
node node_modules/@zowe/mcp-server/dist/index.js \
  --http --http-allow-no-auth --http-host 127.0.0.1 --port 7542 \
  --native --config native-config.json
```

Server log confirmed clean startup: native SSH mode enabled against
`127.0.0.1`, the expected no-auth warning
("Any client that can reach this port has full access"), and the
DNS-rebinding guard reported enabled (`hostAllowlist: true`) before the
listener came up.

**No `curl` on this LPAR** (`PATH=/bin` only, no `curl`/`wget` under `/bin` or
`/usr/bin`). Used a small Node script (`node:http`, no dependencies) run
through the same activated Node 24 runtime instead — equivalent to the
planned `curl` transcript, and consistent with how this codebase's own tests
avoid `curl`.

Real MCP round trip against `http://127.0.0.1:7542/mcp`:

1. `initialize` → `200`, real `serverInfo`/capabilities/instructions payload,
   `mcp-session-id` header returned.
2. `notifications/initialized` → `202`.
3. `tools/call` `getContext` → `200`, real structured content: `backend:
   "zowex"`, the configured system `127.0.0.1` listed under `allSystems`.
4. **Negative check** — spoofed `Host: evil.example.com` + matching `Origin`
   on an `initialize` request → **`403`**,
   `{"error":{"code":-32000,"message":"Invalid Host header: evil.example.com"}}`.
   Confirms the DNS-rebinding guard (`transports/http.ts`, active whenever
   there's no `jwtAuth`) is live on z/OS, not just in the test suite.

`native-config.json`'s `fs.readFileSync` was checked with `od -c` (same method
used earlier for the SSH key): plain ASCII, byte-for-byte as written
(`{"systems":["User-A@127.0.0.1:22"]}\n`), and the server log confirms it
parsed correctly (`Native (SSH) mode enabled {"systems":["127.0.0.1"]}`) — the
EBCDIC-corruption bug from the shape-A session does **not** reproduce here.

Server process was stopped after the test (no HTTP listener left running on
the shared LPAR).

## SAF-backed IdP (`packages/zowe-mcp-zos-saf-idp`): real end-to-end test on Host-A

Full real round trip against a real RACF account, on this LPAR — the proof
that the standalone SAF IdP package (see `docs/zos-saf-idp.md`) actually works
against real z/OS, not just against a mocked SSH check in unit tests.

**Deployment gotchas** (all worth remembering for anyone doing this again):

- `npm pack` produces a `.tgz`; Host-A has **no `gzip`/`tar -z`/`pax` support** in
  `/bin` (`PATH=/bin` only, minimal toolset) — `tar -xzf` fails with `tar:
  decompress: FSUM6636 not in compressed format` even though the `.tgz` itself
  transferred byte-exact (verified via `od -c` gzip magic bytes). Worked around
  by skipping the tarball entirely and `scp`-ing the plain `dist/*.js` +
  `package.json` files directly.
- **Legacy `scp -O` silently EBCDIC-converts text files** even though the byte
  *count* stays identical — this is the exact `.pub`-transfer gotcha already in
  the Host-A runbook, just hit via a different transfer path. Default
  (SFTP-protocol) `scp` does **not** convert, but it also refuses to
  recursively create missing parent directories (`realpath ... No such file` /
  `path canonicalization failed` for every subdirectory) — so the fix is:
  `mkdir -p` the full destination tree first (via `sh -s` — **no `bash` on this
  LPAR either**, only `/bin/sh`), then `scp -r` (no `-O`) into the pre-created
  tree.
- **`cat`/`head`/`od -c` over this SSH session are not reliable content
  checks** even for genuinely correct files — the runbook already says this
  for `.pub` keys, and it reproduced here for plain `.js` source: `od -c`
  showed apparent garbage for a file that `node --check` parsed with zero
  errors. Trust `node --check` / actually running the code, not any terminal
  dump, exactly as the runbook already warns.
- `express`+`ssh2` aren't present as installable packages anywhere in the
  existing `@zowe/mcp-server` install on Host-A — PR #91's esbuild bundling
  inlines them into the packed tarball's chunk files, so there's nothing to
  reuse. Installed them separately in a scratch dir (`npm install
  --omit=dev`), then **stripped `cpu-features` and `ssh2`'s
  `sshcrypto.node`** before copying — both are optional native accelerators
  built for the dev machine's arch (macOS/arm64), and ssh2 wraps loading them
  in a bare `try {} catch {}` (`lib/protocol/crypto.js`), so removing them
  just makes it fall back to pure JS. Confirmed no other `.node` files existed
  in the copied tree before shipping it.

**New finding — enabling JWT auth crashes the server on this LPAR's memory
limit, `--jitless` is not a viable workaround:**

Starting `@zowe/mcp-server --http --native` with `ZOWE_MCP_JWT_ISSUER`/
`ZOWE_MCP_JWKS_URI` set (i.e. anything that exercises `fetch`/undici, which
JWKS lookup does) logs a clean startup — `listening on 127.0.0.1:7543` — and
then aborts moments later with `Fatal process out of memory: Zone`, inside a
background Turboshaft WASM optimizing-compile job
(`BackgroundCompileJob::Run` → `ExecuteTurboshaftWasmCompilation` →
`LoopUnrollingPhase`). Host-A's OMVS `MEMLIMIT` is 2048 MB (`ulimit -M`; not
raisable by this user — `ulimit -M unlimited` → `EDC5121I Invalid argument`),
below the 4 GB IBM recommends and already flagged in the Phase 0 findings
above.

- `node --jitless` is **not** a fix — it disables `WebAssembly` entirely, and
  `ssh2`'s pure-JS `poly1305`/ChaCha20 fallback (`lib/protocol/crypto/
  poly1305.js`) references the global `WebAssembly` object **unconditionally
  at module-load time**, with no `try/catch` at that layer, so the process
  crashes even earlier and harder (`ReferenceError: WebAssembly is not
  defined`) before ever reaching the HTTP listener.
- The actual working fix: `node --no-wasm-tier-up --no-wasm-dynamic-tiering`.
  This keeps WASM on the baseline Liftoff compiler (cheap, no background
  Zone-hungry optimizing pass) while leaving `WebAssembly` itself intact, so
  `ssh2`'s fallback still loads. `--no-liftoff` on top of those two flags is
  **worse**, not better — it forced a slow interpreter path that immediately
  hit heap GC pressure instead.
- This only reproduced with JWT auth (Part 1's plain `--http-allow-no-auth`
  run earlier this session never touched `fetch`/undici and never hit it) —
  so it's specific to the JWT/resource-server code path, not native SSH mode
  by itself.

**The real round trip**, using a disposable RACF test account (`TestAcct-A`,
`NOSPECIAL`, `ADDUSER ... OMVS(AUTOUID HOME(/u/users/testacct-a)
PROGRAM(/bin/sh))` — classic RACF passwords are capped at 8 characters, and
`HOME` must be set but does **not** need to already exist, since the SAF
check only does the SSH auth handshake and disconnects, never opening a shell
channel that would `chdir` into it):

1. `POST /login` with real `TestAcct-A` credentials → `200`, real RS256 JWT,
   `sub: "TestAcct-A"` (decoded and confirmed).
2. `POST /mcp initialize` with **no** `Authorization` header → `401
   Unauthorized: missing Bearer token`.
3. Same request **with** `Authorization: Bearer <token>` → `200`, real
   `serverInfo`/capabilities, real `mcp-session-id`.
4. `tools/call getContext` with the same token → `200`, real structured
   content (`backend: "zowex"`, `127.0.0.1` listed under `allSystems`).

Both servers (the IdP on 8189, the JWT-authenticated MCP server on 7543) were
stopped after the test; the `TestAcct-A` test account is deleted (`DELUSER
TestAcct-A`) once this session's testing is confirmed done.

## Open items for a follow-up session

- Run the 61-test `native-stdio.e2e` suite against this install.
- Decide whether/how to fix or work around the `fs.readFileSync` EBCDIC
  corruption bug (affects more than just SSH keys — worth raising upstream
  with IBM or `ibmruntimes/node-zos`, and worth a `zowe-mcp` code path audit
  for anything else read via `fs.readFileSync`/`readSync` in native mode).
- Decide whether/how to work around the JWT-auth WASM Zone-OOM finding above
  for real deployments on memory-constrained LPARs — document the
  `--no-wasm-tier-up --no-wasm-dynamic-tiering` workaround somewhere a
  deployer would find it (e.g. `docs/mcp-authentication-oauth.md` or a
  z/OS-hosting doc), or raise it upstream against V8/Node if it reproduces
  off z/OS too.
- Phase 2 measurement (SMF 30 / CPU seconds per call) not started.
- PTF UO04934 gap: flag to whoever manages SMP/E on Host-A.
