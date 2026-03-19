# Comparison: Gestell-AI/zowe-mcp vs This Repository

<!-- markdownlint-disable MD060 -->

This document compares [Gestell-AI/zowe-mcp](https://github.com/Gestell-AI/zowe-mcp) (a Zowe CLI–based MCP server) with the Zowe MCP server in this repository (Zowe Native Proto over SSH), and summarizes what this repo can learn from Gestell.

---

## Part 1: Side-by-Side Comparison

### Architecture and z/OS Access

| Aspect | Gestell-AI/zowe-mcp | This repository |
|--------|---------------------|------------------|
| **z/OS connectivity** | **Zowe CLI** → z/OSMF or API ML gateway | **Zowe Native Proto SDK** over **SSH** (no z/OSMF required) |
| **Flow** | User ↔ AI ↔ MCP ↔ Server ↔ **Zowe CLI** ↔ z/OS | User ↔ AI ↔ MCP ↔ Server ↔ **ZNP over SSH** ↔ z/OS |
| **Setup** | `zowe config init` or `zowe config auto-init`, profiles, optional APIML login | Native: `user@host` (and optional port); config file or VS Code `zoweMCP.nativeConnections` |
| **Runtime** | Node + **bun** (install/build) | Node.js 22+, **npm** workspaces |

**Summary:** Gestell wraps the existing Zowe CLI (zosmf/APIML); this repo uses Zowe Native Proto over SSH, with no z/OSMF in the path.

### Scope and Packaging

| Aspect | Gestell-AI/zowe-mcp | This repository |
|--------|--------------------|------------------|
| **Packaging** | Single package, npm `@gestell/zowe-mcp` | **Monorepo**: `zowe-mcp-server`, `zowe-mcp-vscode`, `zowe-mcp-common`, `zowe-mcp-evals` |
| **VS Code** | MCP client config only (e.g. Claude Desktop, Codex) | **Full VS Code extension**: registers MCP (VS Code + Cursor), pipe for passwords/log level/mock, Zowe Explorer “open in editor” |
| **Transports** | Stdio (implied from MCP client config) | **Stdio** and **HTTP Streamable** (multi-session, port 7542) |

### Tools

| Area | Gestell-AI/zowe-mcp | This repository |
|------|--------------------|------------------|
| **Count** | **19 tools** | **55 tools** (plus conditional Zowe Explorer open-in-editor) |
| **Datasets** | List, list members, read, search, upload file, upload dir → PDS | List, list members, read, write, search, get attributes, create, create temp, delete, delete under prefix, copy, rename, restore, temp prefix/name; **local workspace**: `downloadDatasetToFile` / `uploadFileToDataset` (single PS or PDS/E member via path under MCP roots — not directory → PDS bulk) |
| **Jobs** | List, get status, get output (with error analysis), list spool files, get spool file (paged), submit from dataset | Submit (from JCL/dataset/USS), get status, list jobs, list job files, read job file, get output, search job output, get JCL, cancel, hold, release, delete; **local workspace**: `downloadJobFileToFile` (spool → file under roots) |
| **TSO / Console** | TSO command, console command (with guardrails) | `runSafeTsoCommand`; console tool present but **disabled** (ZNP doesn’t support it yet) |
| **USS** | — | Full set: list, read, write, create, delete, chmod, chown, chtag, copy, run command, temp dir/file helpers, get home, change directory; **local workspace**: `downloadUssFileToFile` / `uploadFileToUssFile` |
| **Context** | — | `getContext`, `listSystems`, `setSystem` (multi-system, multi-connection) |
| **Extras** | `zowe_explain_error`, `zowe_list_error_codes`; async task tools (wait, get, list) | No dedicated “explain error” tools; optional **Zowe Explorer** open dataset/USS/job in editor |

### Safety and Behavior

| Aspect | Gestell-AI/zowe-mcp | This repository |
|--------|--------------------|------------------|
| **Safety** | Explicit guardrails: SAFE / CAUTIOUS / BLOCKED (e.g. block DELETE, CANCEL, PURGE) | Pattern-based: TSO and USS commands evaluated (e.g. `tso-command-patterns.json`, hardstop-patterns); destructive tools annotated |
| **Errors** | **Automatic error analysis** (ABEND/return code explanation) | No dedicated “explain error” tool; errors returned as usual |
| **Pagination** | Spool file paging | **Structured pagination**: list (offset/limit), line-windowed (startLine/lineCount), `_result.hasMore` and server instructions for agents |
| **Output** | — | **Zod output schemas** and optional `structuredContent`; response envelope (`_context`, `_result`, `data`, `messages`) |

### Prompts and Resources

| Aspect | Gestell-AI/zowe-mcp | This repository |
|--------|--------------------|------------------|
| **Prompts** | **5**: onboarding, diagnose-job-failure, explore-codebase, code-review, daily-ops-check | **4** (e.g. `reflectZoweMcp`, `reviewJcl`, `explainDataset`, `compareMembers`; see `docs/mcp-reference.md`) |
| **Resources** | **5** reference URIs: dataset-types, jcl-basics, cobol-structure, abend-codes, zowe-cli | **2** resource templates: data set content, member content (`zos-ds://{system}/{dsn}` and `(member)`) |

Gestell emphasizes pre-built workflows and z/OS reference docs; this repo emphasizes tool coverage and MCP resource templates for data set/member content.

### Mock Mode

| Aspect | Gestell-AI/zowe-mcp | This repository |
|--------|--------------------|------------------|
| **Activation** | `ZOWE_MCP_MOCK=true` | `--mock <dir>` or `zoweMCP.mockDataDirectory` (extension) |
| **Data** | Mock mode for “demos and development” | **Structured mock**: `init-mock` with presets (minimal, default, large, inventory, pagination), DSFS-style layout, reproducible Faker data |

### Quality and Ecosystem

| Aspect | Gestell-AI/zowe-mcp | This repository |
|--------|--------------------|------------------|
| **Evals** | — | **Eval framework** (`zowe-mcp-evals`): question sets, `eval-compare`, scoreboard, LLM result cache |
| **Docs** | DEV, REFERENCE, DEMO (e.g. VSAM demo) | Generated **mcp-reference.md**, use-cases, AGENTS.md, presentations |
| **License** | MIT | EPL-2.0 |
| **CI / SDK** | — | CI with SDK fallback; `sdk:nightly`, `sdk:pr`, `sdk:local`, etc. |

---

## Part 2: What This Repo Can Learn from Gestell-AI/zowe-mcp

Ideas to adopt or adapt from Gestell (Zowe CLI–based MCP server).

### 1. Error explanation tools (high value)

Gestell provides **`zowe_explain_error`** and **`zowe_list_error_codes`** so the AI can look up ABEND/return codes and explain them in plain language. This repo supports job failure diagnostics (get status → spool → search → LLM explains) but has no dedicated “explain this code” tool.

**Suggestion:** Add a tool (e.g. `explainError`) that accepts an error code (e.g. S0C7, 0C4) and returns a short, structured explanation (cause, typical fix, reference). The LLM could call it after seeing an ABEND in job output. Data could be curated (e.g. JSON or MCP resource) or sourced from an external reference.

### 2. Reference resources (high value)

Gestell exposes **5 static resources**: dataset-types, jcl-basics, cobol-structure, abend-codes, zowe-cli. This repo has **2 resource templates** (data set/member content) and a glossary in `SERVER_INSTRUCTIONS`. Adding **read-only reference resources** (e.g. JCL basics, COBOL structure, ABEND code list) would:

- Give the LLM something to fetch when it needs to interpret JCL, COBOL, or errors.
- Reduce hallucination and improve quality of “explain this” answers.

**Suggestion:** Add MCP resources (or static files exposed as resources) for JCL, COBOL, and ABEND reference; optionally tie an `explainError` tool to the ABEND resource.

### 3. Workflow-oriented prompts (medium value)

Gestell has **5 prompts**: onboarding, diagnose-job-failure, explore-codebase, code-review, daily-ops-check. This repo has reviewJcl, explainDataset, compareMembers, reflectZoweMcp. Adding **task-focused prompts** could improve guided workflows, for example:

- **diagnose-job-failure** — “Analyze this job (by ID or output), identify failure, suggest fixes.”
- **explore-codebase** — “Map this COBOL application: programs, copybooks, data flow.”
- **code-review** — “Review this COBOL for issues and best practices.”

These can build on existing tools and, if added, the error explanation and reference resources above.

### 4. Explicit safety classification (clarity)

Gestell documents **SAFE / CAUTIOUS / BLOCKED** for commands. This repo uses pattern-based blocking and `readOnlyHint` / `destructiveHint`. Making the **classification explicit** (e.g. in `getContext`, tool descriptions, or docs) would help users and agents understand risk at a glance.

**Suggestion:** In `getContext` or in documentation, add a short “Command safety” section (e.g. read-only = safe, destructive = blocked without confirmation, others = elicit). Optionally tag tools with a `safety` field in schema or description.

### 5. Upload from local filesystem (partial parity)

This repo implements **single-file / single-member** transfers with **MCP roots** (or CLI/env fallback): **`downloadDatasetToFile`**, **`uploadFileToDataset`**, **`downloadUssFileToFile`**, **`uploadFileToUssFile`**, **`downloadJobFileToFile`** (`packages/zowe-mcp-server/src/tools/local-files/`). That covers the Gestell-style **upload file to data set** path for one member at a time.

Gestell’s **`zowe_upload_directory_to_pds`** (whole directory → PDS members) and Zowe CLI’s matching **`download all-members`** are **not** implemented as MCP tools here. Implemented single-path tools live under `packages/zowe-mcp-server/src/tools/local-files/`. See [pds-uss-directory-upload-download-zowe-and-cp.md](./pds-uss-directory-upload-download-zowe-and-cp.md) for Zowe CLI / IBM `cp` reference. Tracked as follow-up in [TODO.md](../TODO.md) (“Bulk directory ↔ PDS”).

### 6. Async / polling abstraction (optional)

Gestell has **async task tools** (wait, get, list) for long-running operations. This repo has **submitJob** with `wait: true`. A **generic “wait for task”** (or task ID + status) could be useful if more long-running operations are added later; lower priority until then.

---

## Summary

- **Gestell-AI/zowe-mcp**: Zowe **CLI**–based; good when you already use z/OSMF/APIML and Zowe CLI profiles. Offers 19 tools, error lookup, async tasks, 5 prompts, 5 reference resources, and clear guardrails. Single package, no VS Code extension.
- **This repo**: **Zowe Native Proto** over SSH; no z/OSMF. Larger surface: **55 tools** (datasets, jobs, USS, context, **local-file upload/download**), VS Code extension with Cursor support, HTTP transport, pagination, output schemas, mock with presets, and an eval suite. Fewer prompts/resources and no dedicated “explain error” or async-task tools. Bulk **directory ↔ PDS** (Gestell/Zowe CLI style) remains a gap; single-member and USS/job spool file transfers are covered.

The highest-impact ideas to adopt from Gestell are **error explanation tools** and **reference resources**, since they directly improve how the AI explains failures and mainframe concepts. See also [TODO.md](../TODO.md) for tracked follow-ups.
