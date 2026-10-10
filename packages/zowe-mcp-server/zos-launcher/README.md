# zowex-launcher (z/OS identity-switching launcher — prototype)

A ~200-line C program that runs another program **as a different z/OS user**
under **SURROGAT authority**, built for the same-system deployment design in
[`docs/zos-local-zowex-identity.md`](../../../docs/zos-local-zowex-identity.md):
`@zowe/mcp-server` running on z/OS spawns `zowex server` as a local child under
the identity of the JWT-authenticated user (`sub` = local SAF userid), with no
SSH hop and no second credential.

**Status: validated on a live RACF LPAR 2026-10-08 — all nine contract tests
pass**, including the group-leak regression test (see "The groups finding"
below), **and wired into the server since stage 4**: the `LocalClient` transport
(`src/zos/native/local-client.ts`) spawns it for the `local` system
(`ZOWE_MCP_LOCAL_LAUNCHER` + `ZOWE_MCP_LOCAL_ZOWEX`, checked by
`zowe-mcp-server doctor-local`). The C source is still not shipped in the npm
package (`files: ["dist/"]`) — build it on the host — and, like everything on
this path, it needs a security/integrity specialist review before
production-shaped use.

## How it works

```text
printf 'USERID\n<rest of stdin>' | zowex-launcher /absolute/path/prog [args]
```

1. Reads the target userid as the **first stdin line** (byte-by-byte, so the
   rest of the stream reaches the launched program — a JSON-RPC stream can
   follow on the same pipe). Never argv (visible in `ps`), never env.
2. `getpwnam()` — resolves the UID and refuses UID 0 targets.
3. `__spawn2()` with `SPAWN_SETUSERID` — **identity spawn**: the child is
   created in a new address space dubbed under the **target user's complete
   security environment** (UID, GID, and the supplementary group list built
   from the target's group connections). Authorization is the same as for
   `setuid()`: the invoker's READ on `BPX.SRV.<userid>` in the SURROGAT
   class. No password, PassTicket, or token is involved (see the design doc
   for why PassTickets and SAF IDTs were not used).
4. `HOME`/`USER`/`LOGNAME` are set from the OMVS segment, the child's cwd is
   the target home (`SPAWN_SETCWD`), and the launcher stays resident as a
   transparent middleman: it forwards SIGTERM/SIGINT/SIGHUP to the child and
   mirrors the child's exit status (or terminating signal).

It validates the userid shape and exits with distinct codes (2 usage, 3 bad
input, 4 unknown user, 5 switch failed, 6 UID 0 refused, 127 could not run the
program), printing `errno`/`errno2` and a remediation hint on failure.

## The groups finding (why identity spawn, not setuid+exec)

The original design did `setuid()` then `exec()`. Live-LPAR validation
(2026-10-08) proved that z/OS `setuid()` on the surrogate path changes the MVS
identity (ACEE) but does **not** rebuild the POSIX supplementary group list —
the switched process (and everything it exec'd or spawned, even into new
address spaces) kept the invoker's groups, and that leaked list carried REAL
USS authority: a group-readable file of the server identity was readable as
the target user. The usual fixes are unavailable without daemon authority:
`initgroups()`/`setgroups()` fail `EPERM` for a non-superuser without the
target's password, and a `__login()` process-level environment cleans
`getgroups()` but does not survive `exec()` and refuses `spawn()`. Identity
spawn (`__spawn2` + `SPAWN_SETUSERID`, the documented replacement for the
`initgroups`+`setgid`+`setuid`+`exec` sequence, same SURROGAT authorization)
was verified to give the child exactly the target's groups — the
invoker-group file read is denied, and `test.sh` keeps a regression test on
it.

## RACF / USS setup

As a RACF SPECIAL administrator, per permitted target user:

```text
RDEFINE SURROGAT BPX.SRV.<target> UACC(NONE)
PERMIT BPX.SRV.<target> CLASS(SURROGAT) ID(<server-userid>) ACCESS(READ)
SETROPTS CLASSACT(SURROGAT)            /* if not active */
SETROPTS RACLIST(SURROGAT) REFRESH     /* if SURROGAT is RACLISTed */
```

Program control (required whenever `BPX.DAEMON` is defined in FACILITY —
without it the identity spawn fails with `EMVSERR`/`JRENVDIRTY`):

```sh
extattr +p zowex-launcher      # needs READ on BPX.FILEATTR.PROGCTL
chmod 700 zowex-launcher       # only the server userid may exec it
```

Every STEPLIB dataset the process loads from must be covered in the PROGRAM
class — on a Node-24 LPAR with `STEPLIB=CEE.SCEERUN2.OVERRIDE` that dataset
needs a `RALTER PROGRAM * ADDMEM(...)` entry (already done on the validation
LPAR for the node-racf work).

## Build and test (on z/OS)

```sh
./build.sh            # IBM Open XL C/C++; override path with IBM_CLANG
extattr +p zowex-launcher && chmod 700 zowex-launcher
./test.sh <target-userid> [denied-userid] [uid0-userid]
```

The test script covers: the positive switch (printing full `id` output),
stdin passthrough, environment rebuild, unknown/invalid userids, the
missing-permit `EPERM` case, UID 0 refusal, that an unmarked
(non-program-controlled) copy of the binary cannot switch, and the
**group-leak regression**: the switched child's process group list may not
contain any group the target userid is not connected to in the security
database.

## Trust model (short form — the design doc has the full version)

The launcher does **not** re-authenticate anyone: SAF authentication happened
in the IdP at login, the MCP server's JWT validation carries it to the
request, and the launcher trusts the userid its parent pipes in. The bounds
are the SURROGAT access list (which users the server ID may become — one
profile per user, deliberately no generic `BPX.SRV.*`), file permissions on
the binary, and SAF audit of every surrogate switch.
