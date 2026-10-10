# Started-task (STC) launch shape for the z/OS MCP server and SAF IdP

Status: **LIVE on Host-A since 2026-10-05** — both services run as started
tasks (`S ZMCPIDP` / `S ZMCPMCP`, PROCs in `PRODUCT.PROCLIB`) under the
dedicated `ZMCPSRV` userid; HTTPS healthy from off-LPAR. Operations get
`START`/`STOP`, the services no longer occupy JES initiators, and the server
identity is no longer a personal admin userid. The batch-job launch
(`launch: "jcl"`) remains available and interchangeable (same pidfile and
env-file contract). Validated 2026-10-05: OAuth e2e green under the new
identity (DCR → login → token `sub: ZMCPOAU` → tool call executing as the
JWT sub, proving ZMCPSRV's SURROGAT switch), and stop semantics — see below.

Two findings from the cutover worth keeping:

- **AT-TLS keyring access follows the application identity.** With the
  services running as ZMCPSRV, every TLS handshake was RESET until ZMCPSRV
  could read USERA's `ZMCPRING`. Fix (RACF Callable Services, R_datalib
  authorization): a ring-specific RDATALIB profile —
  `RDEFINE RDATALIB USERA.ZMCPRING.LST UACC(NONE)`, ZMCPSRV `ACCESS(UPDATE)`
  (list + private-key retrieval; ring modification is gated by `.UPD`
  profiles, not this one), and USERA `ACCESS(READ)` — once the specific
  profile exists it replaces the global `IRR.DIGTCERT.LISTRING` fallback the
  owner was relying on, so the owner needs an explicit permit too.
- **Starting an already-running task is harmless but overwrites
  `.deploy.pid`**: the duplicate's shell writes its pid before the port bind
  fails. If a deploy stop then misbehaves, re-point the pidfile at the real
  process (the `ps` fallback pattern still catches it either way).

> **Security review**: everything in this document is identity and privilege
> configuration (new server userid, STARTED mappings, SURROGAT permits). It is
> in scope for the mandatory security-specialist review of this branch and
> must not be treated as reviewed. The RACF command batch below is deliberately
> left for a human to approve and run.

## Design

- One **server userid `ZMCPSRV`** (protected: `NOPASSWORD`, OMVS segment,
  never logs on) runs both services. Today both run as USERA — a RACF
  SPECIAL personal admin ID, which is exactly what a server identity should
  not be.
- One **shared group `ZMCPGRP`** containing `ZMCPSRV` and the deploying user
  (USERA): deploys keep writing `node_modules`/env files as USERA, the STC
  reads them, and the few runtime-writable paths become group-writable.
- **STARTED class profiles** `ZMCPIDP.*` / `ZMCPMCP.*` map the tasks to
  `ZMCPSRV`. (STARTED is active and RACLISTed on Host-A; verified 2026-10-04.)
- The **PROCs reuse the deploy artifacts**: same `.deploy-jcl.env`, same
  BPXBATCH STDPARM command, same log and pidfile as the batch job — a redeploy
  refreshes `node_modules` and the env file, and the STC picks them up on its
  next restart. (In-stream `DD *` inside a cataloged PROC is fine on z/OS ≥
  2.1; Host-A is 3.1.)

## RACF setup (as a SPECIAL user — needs human approval)

```text
ADDGROUP ZMCPGRP OWNER(GRPOMVS) OMVS(AUTOGID) DATA('ZOWE MCP STC SHARED GROUP')
CONNECT USERA GROUP(ZMCPGRP)
ADDUSER ZMCPSRV NAME('ZOWE MCP STC SERVER') OWNER(GRPOMVS) DFLTGRP(ZMCPGRP) +
  NOPASSWORD OMVS(AUTOUID HOME(/u/users/zmcpsrv) PROGRAM(/bin/sh))
RDEFINE STARTED ZMCPIDP.* STDATA(USER(ZMCPSRV) GROUP(ZMCPGRP) TRACE(YES))
RDEFINE STARTED ZMCPMCP.* STDATA(USER(ZMCPSRV) GROUP(ZMCPGRP) TRACE(YES))
SETROPTS RACLIST(STARTED) REFRESH
PERMIT BPX.SRV.ZMCPOAU CLASS(SURROGAT) ID(ZMCPSRV) ACCESS(READ)
SETROPTS RACLIST(SURROGAT) REFRESH
```

Plus, for the *deploying* user to be able to start/stop the tasks from TSO
(no `zoweax` console helper is installed on Host-A, and `tsocmd` cannot route
MVS commands without this):

```text
PERMIT CONSOLE CLASS(TSOAUTH) ID(USERA) ACCESS(READ)
ALTUSER USERA OPERPARM(AUTH(SYS))
```

then `tsocmd "CONSOLE SYSCMD(S ZMCPIDP)"`. OPERCMDS is active on Host-A, so
`MVS.START.*`/`MVS.STOP.*` profiles (if any exist) may additionally gate this
— check on first use.

Notes gathered while designing (Host-A, 2026-10-04):

- `BPX.SERVER` is `UACC(ALTER)` on this LPAR — like the known `BPX.SUPERUSER
  UACC(ALTER)` issue, this is lab-box misconfiguration, not something to rely
  on. The launcher's identity switch is SURROGAT-based (see
  `zos-local-zowex-identity.md`); the explicit `BPX.SRV.*` permit above is the
  real requirement.
- UID 0 is **not** needed: BPXBATCH `SH` (unlike `BPXBATSL SH`) has no UID-0
  restriction.

## Filesystem changes (as root or USERA)

`ZMCPSRV` needs to *read* the deploy trees and *write* only the pidfiles,
logs, and the tenant store:

```sh
mkdir -p /u/users/zmcpsrv && chown ZMCPSRV /u/users/zmcpsrv && chmod 700 /u/users/zmcpsrv
cd /u/users/group/product/usera/zmcp
chgrp -R ZMCPGRP . saf-idp-oauth
chmod g+rx . saf-idp-oauth                 # traverse
chmod 640 .deploy-jcl.env saf-idp-oauth/.deploy-jcl.env   # group-read (holds the tenant-store key)
chmod g+w . saf-idp-oauth                  # pidfile create/unlink
chmod g+w *.log saf-idp-oauth/*.log .deploy.pid saf-idp-oauth/.deploy.pid
chown -R ZMCPSRV:ZMCPGRP tenant-store && chmod 770 tenant-store
```

Afterwards **re-verify `extattr +p`** on `zos-attls/.../attls.node` and the
`racf` addon (`ls -E`): program control must stay intact or the IdP/launcher
die silently (known rc=137 gotcha), and some file operations clear the bit.

## The PROCs (members ZMCPIDP / ZMCPMCP in PRODUCT.PROCLIB)

Identical to the generated `.deploy.jcl` minus the JOB card — e.g. the IdP:

```text
//ZMCPIDP  PROC
//* Zowe MCP SAF IdP (:8045) as a started task.
//* Env contract: /u/users/group/product/usera/zmcp/saf-idp-oauth/.deploy-jcl.env
//RUN      EXEC PGM=BPXBATCH,TIME=NOLIMIT,REGION=0M
//STDPARM  DD *
SH cd '/u/users/group/product/usera/zmcp/saf-idp-oauth' && .
./.deploy-jcl.env && echo $$ > .deploy.pid && exec node
--no-wasm-tier-up --no-wasm-dynamic-tiering
node_modules/zowe-mcp-zos-saf-idp/dist/index.js '--port' '8045'
'--host' '0.0.0.0' '--tls-terminated' '--issuer'
'https://host-a.example.com:8045' '--mcp-resource'
'https://host-a.example.com:8044/mcp' '--token-ttl' '900'
'--saf-check' 'auto' '--attls' 'required' >> 'idp-oauth-8045.log' 2>&1
/*
//STDOUT   DD SYSOUT=*
//STDERR   DD SYSOUT=*
```

(ZMCPMCP is the same transform of the MCP server's `.deploy.jcl`.)

Writing the members: USS/`OGET` writes allocate the PDS exclusively and fail
while JES2 holds the proclib — use the proven **batch IEBGENER with
`SYSUT2 DISP=SHR`** and the member content in-stream (same technique as the
PAGENT config member, see `zos-attls` notes).

## Stop semantics — validated 2026-10-05

**`P` (and by extension `C`) does NOT stop the server; the stop procedure is
`kill $(cat <deploy dir>/.deploy.pid)`** — the same mechanism the deploy
tooling uses, and killing the node pid also ends the STC (BPXBATCH is
waiting on it). Why `P` can't work with this PROC shape, both arms tested
live:

> **Because stop is a kill, the env contract MUST set `__IPC_CLEANUP=1`**
> (validated 2026-10-07). z/OS node emulates epoll with IPC message queues
> and a killed node process leaks ~2 of them; repeated restarts accumulate
> orphans under the STC userid until the system `IPCMSGNIDS` cap is hit —
> at which point **every new node process on the LPAR, any user, dies at
> startup** (`msgget EDC5133I No space left on device` → SIGABRT in
> `epoll_create1`). With `__IPC_CLEANUP=1` node reaps its own user's stale
> queues at startup (live queues of running processes are left alone).
> Recovery when already at the cap: restart the services whose user owns
> the orphans with the variable set.

- Plain BPXBATCH `SH` forks node into a separate BPXAS child; the STC
  address space holds only BPXBATCH, which has no STOP handler — `P ZMCPIDP`
  is simply ignored (task stays EXECUTING, service uninterrupted).
- The documented remedy, `_BPX_BATCH_SPAWN=YES` + `_BPX_SHAREAS=YES` via
  STDENV (read by BPXBATCH itself, so profiles can't override them), was
  tried and ALSO leaves node in a separate address space: **/bin/sh carries
  the sticky bit on z/OS** (`-rwxr-xr-t`), and a sticky-bit program is a
  documented condition under which `_BPX_SHAREAS=YES` silently falls back to
  a fork — the shell (and therefore the exec'd node) never lands in the STC
  address space.

A truly `P`-stoppable shape would be `BPXBATSL` with `PGM` launching the
node binary directly (node is not sticky): local spawn keeps node in the STC
address space and `P` delivers SIGTERM. But `PGM` mode means no shell — the
env contract must come from a KEY=VALUE STDENV USS file instead of the
sourced script, every path (entry, `--config`, logs via STDOUT/STDERR DDs)
must be absolute, there is no pidfile echo, and the deploy tooling's
`ps`-pattern stop breaks on z/OS command-line truncation of absolute paths.
That is a deliberate follow-up redesign, not a PROC tweak.

## Deploy tooling follow-up (after the prototype is proven)

A `launch: "stc"` mode in `scripts/deploy-zos.mjs`: stop = same pidfile kill;
start = `tsocmd "CONSOLE SYSCMD(S <jclJobName>)"` over ssh; PROC member
(re)written via a generated IEBGENER job only when the start command changes.
Open questions: console authority on other target systems, and whether the
STC should restart automatically after a deploy (today's JCL mode restarts as
part of the deploy; an STC restart is an operator action).
