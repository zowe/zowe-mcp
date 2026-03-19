# PDS ↔ local directory (Zowe CLI) and PDS ↔ USS (`cp`): reference

This document consolidates **Zowe CLI** commands for uploading and downloading between a **local directory** and a **partitioned data set (PDS or PDS/E)**, and **IBM z/OS UNIX** `cp` behavior when copying between **MVS data sets** and **USS files**. It is **research and documentation only** for **directory-level** and **`cp`**-style workflows. Zowe MCP implements **single-path** local file tools only (`packages/zowe-mcp-server/src/tools/local-files/`); it does **not** implement bulk **directory → PDS** or **PDS → directory tree** in one step like Zowe CLI.

---

## 1. Zowe CLI: directory → PDS (`upload dir-to-pds`)

**Command:** `zowe zos-files upload dir-to-pds`

**Purpose (official):** Upload files from a **local directory** to a **partitioned data set**. Uses the z/OSMF Files API (not USS `cp` on the mainframe).

**Usage shape:**

```text
zowe zos-files upload dir-to-pds <inputdir> <dataSetName> [options]
```

**Positional arguments:**

| Argument       | Description                                      |
| -------------- | ------------------------------------------------ |
| `inputdir`     | Local directory path whose files are uploaded.   |
| `dataSetName`  | Target PDS (or PDS/E) data set name.             |

**Options (selected)** — see [Zowe web help: dir-to-pds](https://docs.zowe.org/stable/web_help/docs/zowe_zos-files_upload_dir-to-pds):

| Option | Role |
| ------ | ---- |
| `--binary` / `-b` | Binary mode: no conversion; records as-is. |
| `--encoding` / `--ec` | Text conversion per specified encoding. |
| `--record` / `-r` | Record mode: no conversion; record length prepended (conflicts with binary). |
| `--migrated-recall` / `--mr` | Migrated data set recall: `wait`, `nowait` (default), `error`. |
| `--volume-serial` / `--vs` | VOLSER when the data set is not cataloged. |
| `--response-timeout` / `--rto` | z/OSMF TSO servlet timeout (5–600 seconds). |

**Official examples** (from Zowe documentation):

```bash
# Upload local folder "src" into PDS ibmuser.src
zowe zos-files upload dir-to-pds "src" "ibmuser.src"

# Same, but wait for migrated data set recall
zowe zos-files upload dir-to-pds "src" "ibmuser.src" --migrated-recall wait
```

**Typical use cases (Zowe-oriented):**

- Promote a folder of **source members** (e.g. COBOL copybooks, macros) from a workstation into a **development PDS** without logging into TSO/ISPF.
- Bulk load **JCL** or **REXX** from a repo checkout into a `*.CNTL` library as part of a pipeline (often combined with SCM or a later job submit step).

---

## 2. Zowe CLI: PDS → local directory (`download all-members`)

**Command:** `zowe zos-files download all-members`

**Purpose (official):** Download **all members** of a partitioned data set into a **local folder**.

**Usage shape:**

```text
zowe zos-files download all-members <dataSetName> [options]
```

**Options (selected)** — see [Zowe web help: download all-members](https://docs.zowe.org/stable/web_help/docs/zowe_zos-files_download_all-members):

| Option | Role |
| ------ | ---- |
| `--directory` / `-d` | Target directory; created if missing. **Default layout** mirrors qualifiers (e.g. `ibmuser.new.cntl` → `ibmuser/new/cntl`). |
| `--binary` / `-b` | Binary download (no conversion). |
| `--encoding` / `--ec` | Encoding conversion for text. |
| `--extension` / `-e` | Local file extension (default `.txt`; use `""` for none). |
| `--overwrite` / `--ow` | Overwrite existing files. |
| `--fail-fast` / `--ff` | Stop on first failure (default true); set false to continue. |
| `--max-concurrent-requests` / `--mcr` | Parallelism (default 1; `0` = unlimited per docs — watch z/OSMF/TSO limits). |
| `--preserve-original-letter-case` / `--po` | Preserve case in generated paths (default false). |
| `--record` / `-r` | Record mode with length prefix. |
| `--volume-serial` / `--vs` | Uncataloged data sets. |

**Official examples:**

```bash
# Binary download of all members to ./loadlib/
zowe zos-files download all-members "ibmuser.loadlib" --binary --directory loadlib

# Text mode to ./jcl/
zowe zos-files download all-members "ibmuser.cntl" --directory jcl
```

**Typical use cases:**

- **Extract** a PDS to disk for editing in an IDE, scanning, or packaging.
- **Backup** or **mirror** a library before changes; pair with `upload dir-to-pds` for round-trip workflows.

---

## 3. Zowe CLI: how member names are derived (implementation detail)

The **stable Zowe web help** for `dir-to-pds` does **not** spell out member naming rules. The authoritative behavior is in **Zowe CLI / z/OS Files SDK** code (e.g. `Upload` + `ZosFilesUtils.generateMemberName` in the [zowe-cli repository](https://github.com/zowe/zowe-cli)):

1. Take the **file name only** (basename), not the path.
2. Convert to **uppercase**.
3. If the name contains **`.`**, use the part **before the first dot** as the member name stem (extension stripped for naming).
4. Remove any character **not** in the MVS member character set **`[A-Z0-9@#$]`**.
5. **Remove all digits** from the result.
6. **Truncate to 8 characters** (MVS member length).

**Implications:**

- `MyProg.cbl` → member `MYPROG` (extension dropped after normalization steps as implemented).
- Names that become empty after digit stripping can lead to **invalid** member names — treat directory contents accordingly.

**Directory depth:** File lists used for `dir-to-pds` are typically **non-recursive** (top-level files in the given directory only). Nested folders are **not** walked like `cp -r` on USS. For deep trees, use a packaging step, multiple invocations, or a different tool chain.

---

## 4. IBM z/OS UNIX: `cp` between MVS data sets and USS files

**Reference:** [cp — Copy a file (z/OS 3.1)](https://www.ibm.com/docs/en/zos/3.1.0?topic=descriptions-cp-copy-file)

### 4.1 What `cp` can do (MVS-related summary)

From IBM’s description:

- Copy **MVS data set → MVS data set**, **MVS → USS**, **USS → MVS**, and UNIX **tree** copies (`-r` / `-R`) within the file system.
- If **more than one** source file is specified, the **target** must be a **directory** or a **partitioned data set**.
- **`cp` does not support GDGs** as GDG names; use the **real data set name**.
- **`cp` does not support copying to a temporary PDSE** (IBM restriction).

Path syntax for MVS data sets in the shell commonly uses **double-slash** forms such as:

```bash
//'DATA.SET.NAME'
//'DATA.SET.NAME(MEMBER)'
```

(Exact quoting depends on shell; the IBM topic shows MVS path usage in context of `cp`.)

When copying **USS → existing PDS**, the **member name** is derived from the **final component** of the source path (with **MVS naming rules** applied — see options below).

### 4.2 Options often used for PDS ↔ USS bulk workflows

| Option | IBM meaning (summary) |
| ------ | --------------------- |
| **`-C`** | Truncate file name to **8 characters** for MVS member names. |
| **`-M`** | **Map** characters between UNIX and MVS member names: `-` ↔ `$`, `.` ↔ `#`, `_` ↔ `@`. |
| **`-A`** | Truncate **suffixes** from the first period to the end of the target name; interacts with `-M`/`-C`; affects `-S` precedence (see IBM topic). |
| **`-S`** | `d=suffix` **delete** suffix from name, or `a=suffix` **append** suffix; precedence vs `-M`/`-C`/`-A` is defined in the manual. |
| **`-U`** | When copying **MVS member → UNIX**, keep names **uppercase** (default is lowercase). |
| **`-F`** *format* | Treat data as **binary**, **text**, **record**, or specific **newline** conventions; affects newline stripping (UNIX→MVS) and delimiter addition (MVS→UNIX). IBM-1047 is involved for text end-of-line handling. |
| **`-B`**, **`-T`**, **`-X`** | Binary / text / executable; mutual exclusion rules apply vs `-F` (see IBM topic). |
| **`-O`** | Automatic conversion / tagging (`-O u` or `-O c=codeset`) — see IBM “Automatic conversion and file tagging behavior”. |

**Example pattern** (illustrative; verify on your z/OS level and shell):

```bash
# Copy many USS files into a PDS; map names and strip a suffix (IBM documents -S with d=)
cp -S d=.c dir/* "//'TURBO.GAMMALIB'"
```

Use **`-C`** when long UNIX basenames must be forced into **8-character** members; use **`-M`** when your naming convention uses **dots, dashes, underscores** and you want predictable MVS equivalents.

### 4.3 Use cases (IBM-oriented)

- **On-system** copy between **USS build directories** and **PDS libraries** without z/OSMF or a workstation (e.g. from an SSH session on z/OS).
- Preserve **executable** semantics with **`-X`**, or control **text vs binary** with **`-F` / `-B` / `-T`** when sharing source between USS and MVS.
- Large **directory trees** use **`-r` / `-R`** for **UNIX-to-UNIX** only (IBM documents these as UNIX-only clone operations — not for copying into a PDS as a recursive tree in the same way).

---

## 5. Zowe CLI vs z/OS `cp` (conceptual comparison)

| Aspect | Zowe `upload dir-to-pds` / `download all-members` | z/OS `cp` (USS ↔ MVS) |
| ------ | ----------------------------------------------- | ---------------------- |
| **Where it runs** | Workstation / CI with z/OSMF connectivity | z/OS UNIX shell (or script invoked there) |
| **Protocol / API** | z/OSMF REST (Files) | Local USS `cp` and MVS access services |
| **Recursive dirs** | Effectively **flat** upload of a single directory (per CLI implementation); not a full tree walk | **`-r`/`-R`** for **UNIX trees**; PDS targets are not “recursive folders” |
| **Member naming** | SDK rules (`generateMemberName`) | **`-C`**, **`-M`**, **`-A`**, **`-S`**, basename rules |
| **Use case** | DevOps from **laptop/CI**, profiles, tokens | **On-system** scripts, SMPE, USS-native pipelines |

---

## 6. Related Zowe commands (not full directory/PDS bulk)

- **`zowe zos-files upload file-to-data-set`** — single local file to a data set or member.
- **`zowe zos-files download data-set`** — single data set or member to a local file.
- **`zowe zos-files list data-set` / `list all-members`** — discovery before download/upload.

Use the [Zowe CLI web help index](https://docs.zowe.org/stable/web_help/docs/zowe_zos-files) for the exact options on your Zowe version.

---

## 7. References

| Topic | Link |
| ----- | ---- |
| Zowe: `upload dir-to-pds` | <https://docs.zowe.org/stable/web_help/docs/zowe_zos-files_upload_dir-to-pds> |
| Zowe: `download all-members` | <https://docs.zowe.org/stable/web_help/docs/zowe_zos-files_download_all-members> |
| IBM z/OS: `cp` | <https://www.ibm.com/docs/en/zos/3.1.0?topic=descriptions-cp-copy-file> |
| Zowe CLI source (member naming, upload helpers) | <https://github.com/zowe/zowe-cli> (packages under `zosfiles`) |

---

## 8. Disclaimer (this repository)

This file is **background material** for PDS ↔ directory and PDS ↔ USS copy behavior. **No feature described here is implied to exist in Zowe MCP** unless separately specified in product docs or code.
