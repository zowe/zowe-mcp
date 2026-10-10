# zos-attls native addon

Queries the AT-TLS security state of a connected TCP socket via the
`SIOCTTLSCTL` ioctl with `TTLS_QUERY_ONLY` — the mechanism behind the
fail-closed AT-TLS aware mode (`docs/zos-attls-aware-mode.md`).

Status: **built and validated on Host-A (2026-09-12)** — all four contract
tests pass on-platform (load, errno contract, `_handle.fd`, live
`noPolicy`/`notSecure` decode). The `secure` path (row 1: protocol/cipher
decode, EBCDIC conversion) still needs a live AT-TLS connection — covered by
the service-integration round.

## Build (on the LPAR)

```sh
sh build.sh
```

- Compiler: IBM Open XL C/C++ (`ibm-clang++64`); no GNU make needed — the
  script runs the compile + link directly with the gyp-equivalent flag set
  validated for node-racf (`docs/zos-saf-idp.md`).
- Needs the IBM Node SDK headers (`NODEDIR`) and `node-addon-api` 8.x
  (`NAPI_INC`); both default to the Host-A locations.
- Includes the real `<ezbztlsc.h>` — no struct or constant is replicated.
- The query ioctl is unprivileged (no PROGRAM class, no clean address space
  for the query itself). **Co-residency caveat**: in a process that also uses
  node-racf/`__passwd` (the SAF IdP), the addon must be program-controlled —
  `extattr +p build/Release/attls.node`, re-run after every rebuild — or z/OS
  kills the process when the DLL loads (observed on Host-A: silent rc=137;
  loaded first instead, it dirties the address space and the native SAF
  backend degrades to unavailable). Standalone use (the MCP server) needs no
  setup.
- Source files must be **ASCII-tagged** (`chtag -tc ISO8859-1`) on the LPAR —
  Open XL crashes on EBCDIC input; `build.sh` itself runs fine either way.
- The addon uses **no C++ std-lib types** (plain char buffers): Host-A's C++
  runtime DLL (`CRTEQCXS`) predates the Open XL 2.2 libc++ headers and lacks
  symbols like `__hash_memory`, which fail at addon load with `CEE3561S`.

Output: `build/Release/attls.node`. This directory (with its `package.json`)
is the deployable module — copy it to the LPAR and point
`ZOWE_MCP_ATTLS_MODULE` at it, e.g.
`/u/users/group/product/usera/zmcp/zos-attls/node_modules/zos-attls`.
Like node-racf, the binary is never packed into npm tarballs.

## API and error contract

```js
const attls = require(process.env.ZOWE_MCP_ATTLS_MODULE);
attls.query(fd); // synchronous
// -> { policyStatus: 'off'|'noPolicy'|'notEnabled'|'enabled'|'applControlled',
//      connStatus: 'notSecure'|'handshakeInProgress'|'secure',
//      protocol?, protocolCode?, cipher?, fips140?, securityType?, partnerUserId? }
```

`query()` never throws for an insecure connection — that is a status. It
throws an `Error` with `code` (errno name) and numeric `errno` when the ioctl
itself fails: `EWOULDBLOCK` (handshake in progress on a non-blocking socket),
`ENOTCONN`, `EPROTOTYPE` (not a TCP socket), `ENOSYS` (not z/OS).
Character fields (`cipher`, `partnerUserId`) are converted from the stack's
EBCDIC with `__e2a_l`.

## Test (on the LPAR)

```sh
export STEPLIB=CEE.SCEERUN2.OVERRIDE   # node24 needs the newer LE runtime
node --test test.mjs
```

Covers load, the errno contract on a non-socket fd, the `socket._handle.fd`
assumption the gate relies on, and live decoding (ephemeral port →
`noPolicy`/`notSecure`). Tests skip everywhere except z/OS.
