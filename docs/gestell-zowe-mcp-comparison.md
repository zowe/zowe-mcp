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
| **CLI integration** | Architecture **is** Zowe CLI; all 19 tools are thin wrappers around `zowe` subcommands | **Primary**: Zowe Native Proto over SSH. **Additionally**: generic YAML-driven CLI bridge (`src/tools/cli-bridge/`) turns any Zowe CLI plugin into MCP tools without TypeScript changes; vendor-supplied plugins extend the server via `vendor/<name>/cli-bridge-plugins/*.yaml` |
| **Setup** | `zowe config init` or `zowe config auto-init`, profiles, optional APIML login | Native: `user@host` (and optional port); config file or VS Code `zoweMCP.nativeConnections`; CLI bridge: profile/connection per plugin via `zoweMCP.cliPluginConfiguration` or `--cli-plugin-configuration` |
| **Runtime** | Node + **bun** (install/build) | Node.js 22+, **npm** workspaces |

**Summary:** Gestell wraps the existing Zowe CLI (zosmf/APIML); this repo uses Zowe Native Proto over SSH as the primary backend, and adds a generic CLI bridge that can expose any Zowe CLI plugin as MCP tools on top.

### Scope and Packaging

| Aspect | Gestell-AI/zowe-mcp | This repository |
|--------|--------------------|------------------|
| **Packaging** | Single package, npm `@gestell/zowe-mcp` | **Monorepo**: `@zowe/mcp-server`, `zowe-mcp-vscode`, `zowe-mcp-common`, `zowe-mcp-evals` |
| **VS Code** | MCP client config only (e.g. Claude Desktop, Codex) | **Full VS Code extension**: registers MCP (VS Code + Cursor), pipe for passwords/log level/mock, Zowe Explorer "open in editor"; **`zoweMCP.backend`** setting switches native/mock with auto-migration |
| **Transports** | Stdio (implied from MCP client config) | **Stdio**; HTTP Streamable has code foundations but is **not yet usable** (configuration and authorization incomplete) |
| **Vendor extensions** | — | **`vendor/<name>/` extension point**: vendor-specific CLI plugins, eval questions, and e2e tests; auto-discovered at startup without code changes; tracked on vendor branch, gitignored on `develop` |

### Tools

| Area | Gestell-AI/zowe-mcp | This repository |
|------|--------------------|------------------|
| **Count** | **19 tools** | **55 core tools** (native SSH + USS + jobs + datasets + local-files + context) **+ CLI plugin tools** from any loaded YAML plugin (no built-in CLI plugins in the open-source package; vendor-provided via `vendor/<name>/cli-bridge-plugins/`) |
| **Datasets** | List, list members, read, search, upload file, upload dir → PDS | List, list members, read, write, search, get attributes, create, create temp, delete, delete under prefix, copy, rename, restore, temp prefix/name; **local workspace**: `downloadDatasetToFile` / `uploadFileToDataset` (single PS or PDS/E member via path under MCP roots — not directory → PDS bulk) |
| **Jobs** | List, get status, get output (with error analysis), list spool files, get spool file (paged), submit from dataset | Submit (from JCL/dataset/USS), get status, list jobs, list job files, read job file, get output, search job output, get JCL, cancel, hold, release, delete; **local workspace**: `downloadJobFileToFile` (spool → file under roots) |
| **TSO / Console** | TSO command, console command (with guardrails) | `runSafeTsoCommand`; console tool present but **disabled** (ZNP doesn't support it yet) |
| **USS** | — | Full set: list, read, write, create, delete, chmod, chown, chtag, copy, run command, temp dir/file helpers, get home, change directory; **local workspace**: `downloadUssFileToFile` / `uploadFileToUssFile` |
| **Context** | — | `getContext`, `listSystems`, `setSystem` (multi-system, multi-connection) |
| **CLI plugin tools** | All 19 tools are hardcoded Zowe CLI wrappers (no plugin system) | Generic bridge auto-discovers `*.yaml` plugin definitions; each adds N command tools + 4 profile management tools (`List/Set Connection/Location`); per-tool or per-plugin pagination (list/content windowing); `cli`/`intent`/`optimized` description variants; non-retryable fatal error pattern |
| **Extras** | `zowe_explain_error`, `zowe_list_error_codes`; async task tools (wait, get, list) | No dedicated "explain error" tools; optional **Zowe Explorer** open dataset/USS/job in editor |

### Safety and Behavior

| Aspect | Gestell-AI/zowe-mcp | This repository |
|--------|--------------------|------------------|
| **Safety** | Explicit guardrails: SAFE / CAUTIOUS / BLOCKED (e.g. block DELETE, CANCEL, PURGE) | Pattern-based: TSO and USS commands evaluated (e.g. `tso-command-patterns.json`, hardstop-patterns); destructive tools annotated |
| **Errors** | **Automatic error analysis** (ABEND/return code explanation) | No dedicated "explain error" tool; errors returned as usual; CLI bridge has **context-aware diagnostics** with VS Code-specific vs standalone remediation hints |
| **Pagination** | Spool file paging | **Structured pagination**: list (offset/limit), line-windowed (startLine/lineCount), `_result.hasMore` and server instructions for agents; **also available in CLI bridge tools** |
| **Output** | — | **Zod output schemas** and optional `structuredContent`; response envelope (`_context`, `_result`, `data`, `messages`) |

### Prompts and Resources

| Aspect | Gestell-AI/zowe-mcp | This repository |
|--------|--------------------|------------------|
| **Prompts** | **5**: onboarding, diagnose-job-failure, explore-codebase, code-review, daily-ops-check | **4** (e.g. `reflectZoweMcp`, `reviewJcl`, `explainDataset`, `compareMembers`; see `docs/mcp-reference.md`) |
| **Resources** | **5** reference URIs: dataset-types, jcl-basics, cobol-structure, abend-codes, zowe-cli | **2** resource templates: data set content, member content (`zos-ds://{system}/{dsn}` and `(member)`); z/OS glossary embedded in `SERVER_INSTRUCTIONS` (delivered at init) |

Gestell emphasizes pre-built workflows and z/OS reference docs; this repo emphasizes tool coverage and MCP resource templates for data set/member content, with background context via server instructions.

### Mock Mode

| Aspect | Gestell-AI/zowe-mcp | This repository |
|--------|--------------------|------------------|
| **Activation** | `ZOWE_MCP_MOCK=true` | `--mock <dir>` or `zoweMCP.mockDataDirectory` (extension); **`zoweMCP.backend`** setting in VS Code switches between native/mock with auto-migration and reload prompt |
| **Data** | Mock mode for "demos and development" | **Structured mock**: `init-mock` with presets (minimal, default, large, inventory, pagination), DSFS-style layout, reproducible Faker data |

### Quality and Ecosystem

| Aspect | Gestell-AI/zowe-mcp | This repository |
|--------|--------------------|------------------|
| **Evals** | — | **Eval framework** (`zowe-mcp-evals`): question sets, `eval-compare`, scoreboard, LLM result cache; eval harness supports generic mock servers with dynamic port allocation |
| **CLI plugin bridge** | — | Generic YAML-driven bridge: named profiles, hot-reload via VS Code `zoweMCP.cliPluginConfiguration`, description variants (`cli`/`intent`/`optimized`) with `$.path` JSON references, list/content pagination, non-retryable fatal error pattern |
| **Vendor extension** | — | `vendor/<name>/` for CLI plugins, eval questions, e2e tests; auto-discovered; separates vendor content from `develop` |
| **Docs** | DEV, REFERENCE, DEMO (e.g. VSAM demo) | Generated **mcp-reference.md** (Core + per-plugin sections), use-cases, AGENTS.md, presentations |
| **License** | MIT | EPL-2.0 |
| **CI / SDK** | — | CI with SDK fallback; `sdk:nightly`, `sdk:pr`, `sdk:local`, etc. |

---

## Part 2: What This Repo Can Learn from Gestell-AI/zowe-mcp

Ideas to adopt or adapt from Gestell (Zowe CLI–based MCP server).

### 1. Error explanation tools (high value)

Gestell provides **`zowe_explain_error`** and **`zowe_list_error_codes`** so the AI can look up ABEND/return codes and explain them in plain language. This repo supports job failure diagnostics (get status → spool → search → LLM explains) but has no dedicated "explain this code" tool.

**Suggestion:** Add a tool (e.g. `explainError`) that accepts an error code (e.g. S0C7, 0C4) and returns a short, structured explanation (cause, typical fix, reference). The LLM could call it after seeing an ABEND in job output. Data could be curated (e.g. JSON or MCP resource) or sourced from an external reference.

### 2. Reference resources (high value)

Gestell exposes **5 static resources**: dataset-types, jcl-basics, cobol-structure, abend-codes, zowe-cli. This repo has **2 resource templates** (data set/member content) and a glossary in `SERVER_INSTRUCTIONS`. Adding **read-only reference resources** (e.g. JCL basics, COBOL structure, ABEND code list) would:

- Give the LLM something to fetch when it needs to interpret JCL, COBOL, or errors.
- Reduce hallucination and improve quality of "explain this" answers.

**Suggestion:** Add MCP resources (or static files exposed as resources) for JCL, COBOL, and ABEND reference; optionally tie an `explainError` tool to the ABEND resource. See Part 3 below for a full comparison of domain context delivery approaches, including MCP resources, server instructions, tool descriptions, and user-customizable skill files.

### 3. Workflow-oriented prompts (medium value)

Gestell has **5 prompts**: onboarding, diagnose-job-failure, explore-codebase, code-review, daily-ops-check. This repo has reviewJcl, explainDataset, compareMembers, reflectZoweMcp. Adding **task-focused prompts** could improve guided workflows, for example:

- **diagnose-job-failure** — "Analyze this job (by ID or output), identify failure, suggest fixes."
- **explore-codebase** — "Map this COBOL application: programs, copybooks, data flow."
- **code-review** — "Review this COBOL for issues and best practices."

These can build on existing tools and, if added, the error explanation and reference resources above.

### 4. Explicit safety classification (clarity)

Gestell documents **SAFE / CAUTIOUS / BLOCKED** for commands. This repo uses pattern-based blocking and `readOnlyHint` / `destructiveHint`. Making the **classification explicit** (e.g. in `getContext`, tool descriptions, or docs) would help users and agents understand risk at a glance.

**Suggestion:** In `getContext` or in documentation, add a short "Command safety" section (e.g. read-only = safe, destructive = blocked without confirmation, others = elicit). Optionally tag tools with a `safety` field in schema or description.

### 5. Upload from local filesystem (addressed for single-file; bulk gap remains)

This repo implements **single-file / single-member** transfers with **MCP roots** (or CLI/env fallback): **`downloadDatasetToFile`**, **`uploadFileToDataset`**, **`downloadUssFileToFile`**, **`uploadFileToUssFile`**, **`downloadJobFileToFile`** (`packages/zowe-mcp-server/src/tools/local-files/`). That covers the Gestell-style **upload file to data set** path for one member at a time.

Gestell's **`zowe_upload_directory_to_pds`** (whole directory → PDS members) and Zowe CLI's matching **`download all-members`** are **not** implemented as MCP tools here. See [pds-uss-directory-upload-download-zowe-and-cp.md](./pds-uss-directory-upload-download-zowe-and-cp.md) for Zowe CLI / IBM `cp` reference. Tracked as follow-up in [TODO.md](../TODO.md) ("Bulk directory ↔ PDS").

### 6. Async / polling abstraction (optional)

Gestell has **async task tools** (wait, get, list) for long-running operations. This repo has **submitJob** with `wait: true`. A **generic "wait for task"** (or task ID + status) could be useful if more long-running operations are added later; lower priority until then.

---

## Part 3: Domain Context Delivery — Patterns and Trade-offs

This section compares approaches for delivering z/OS domain knowledge to the LLM (background on JCL, ABEND codes, data set types, naming conventions, etc.) — prompted by Gestell's use of static MCP resources for this purpose.

### Is the MCP resources approach the right use case?

Yes. The MCP spec explicitly lists reference material as a valid resource type — "anything a server wants to make available: file contents, database records, API responses, live system data, screenshots, **reference material**". Gestell's static reference resources are a textbook correct use of the spec.

### Comparison of approaches

| Approach | Who delivers it | When seen by LLM | User can customize | Size limit | Already in use |
|----------|----------------|------------------|-------------------|------------|----------------|
| **MCP server instructions** | Server (at init) | Every session, automatically | No (server rebuild required) | Must be concise | Yes — z/OS glossary, pagination protocol |
| **MCP resources** (static reference) | Server (on request) | When client fetches the resource | No | Large content OK | Partial — data set/member content via resource templates; no reference resources yet |
| **Tool/parameter descriptions** | Server (in `tools/list`) | When LLM considers using the tool | No | Keep short | Yes — rich `.describe()` text throughout |
| **MCP prompts** | Server + client invocation | When user invokes the prompt | No | Full conversation | Yes — reviewJcl, explainDataset, etc. |
| **IDE rules / skill files** (user-managed) | User workspace | Injected by IDE into every session | **Yes — user edits freely** | Depends on IDE | No |
| **IDE project knowledge** (e.g. Claude Projects) | User | Per-project context | Yes | Varies | No |

### When to use each approach

**MCP server instructions**: Short, always-relevant context that every session needs (e.g. pagination protocol, z/OS acronym glossary). Keep to ~500 words max so it does not eat too much of the context window.

**MCP resources (static reference)**: Large reference material the LLM fetches on demand — ABEND codes, JCL keyword reference, COBOL division structure. Content can be 5–50 KB. Client caches it. Clients like Claude Desktop and VS Code Copilot show available resources in their UI, making discoverability good. Downside: passive — the LLM must decide to fetch it, which it may not always do.

**Tool/parameter descriptions**: Tight, tool-specific guidance (e.g. "DSN format: USER.SRC.COBOL", "RECFM values: FB, VB, U"). Best for constraints and field formats. Avoid long prose; it inflates every `tools/list` response.

**MCP prompts**: Guided multi-step workflows the user invokes intentionally (diagnose a job failure, review a COBOL program). Not background knowledge — active workflows.

**IDE rules / skill files (user-editable)**: The most flexible option for **shop-specific context** that the MCP server cannot know:

- HLQ naming conventions for the user's organization
- Job card templates for their system
- Internal product and subsystem names
- SDLC process (which environment to use for dev vs prod)
- Common failure patterns specific to their shop

For Zowe MCP this could be:

1. **A Cursor rule file** — the user places a `zowe-mcp.md` (or `.cursor/rules/zowe.mdc`) in their workspace and writes whatever z/OS context is relevant to their shop. Cursor injects it into every agent session. The file is version-controllable and editable without any server change.

2. **A publishable skill package** — `@zowe/mcp-skill` (or `npx @zowe/mcp-skill`) ships a starter `SKILL.md` (or `.cursor/rules/zowe.mdc`) that provides baseline z/OS context. The user installs it once, then edits it for their shop. This is how Cursor skills work for tools like Playwright or Slidev. Pros: distributable, versioned starter content, installable with one command. Cons: user must still install and maintain it; it is IDE-specific (Cursor rules don't help in Claude Desktop).

3. **MCP server config file** — the MCP server reads a `zowe-context.md` from the workspace (e.g. `ZOWE_MCP_CONTEXT_FILE` env var or VS Code setting) and appends it to server instructions. This makes the context available to any MCP client, not just Cursor. Pros: client-agnostic. Cons: server must support the feature; not auto-discovered.

### Recommendation for Zowe MCP

A **layered approach** makes the most sense:

| Layer | Content | Delivery |
|-------|---------|----------|
| Server instructions | Pagination protocol + z/OS glossary (existing) | Always-on, server init |
| MCP resources | ABEND reference, JCL keyword index, data set type guide | On-demand, standard MCP |
| Tool descriptions | Field formats, constraints, safe/unsafe flags | Inline, per-tool |
| Skill file / IDE rule | Shop-specific conventions, naming patterns, job cards | User-managed, IDE-injected |

The **skill file** approach is best for shop-specific knowledge because the MCP server cannot know it. Publishing a well-structured starter file (as a Cursor rule, Claude project note, or similar) lowers the barrier for users while keeping the server general-purpose.

---

## Summary

- **Gestell-AI/zowe-mcp**: Zowe **CLI**–based; good when you already use z/OSMF/APIML and Zowe CLI profiles. Offers 19 tools, error lookup, async tasks, 5 prompts, 5 reference resources, and clear guardrails. Single package, no VS Code extension.
- **This repo**: **Zowe Native Proto** over SSH; no z/OSMF required. Larger surface: **55 core tools** (datasets, jobs, USS, context, local-file upload/download), plus a **generic CLI plugin bridge** that exposes any Zowe CLI plugin as MCP tools via YAML. VS Code extension with Cursor support, backend selector (`zoweMCP.backend`), pagination, output schemas, mock with presets, and an eval suite. Fewer prompts/resources and no dedicated "explain error" or async-task tools. Bulk **directory ↔ PDS** (Gestell/Zowe CLI style) remains a gap; single-member and USS/job spool file transfers are covered.

The highest-impact ideas to adopt from Gestell are **error explanation tools** and **reference resources**, since they directly improve how the AI explains failures and mainframe concepts. The CLI plugin bridge partially closes the Gestell/native gap by making any Zowe CLI plugin accessible as MCP tools. See Part 3 for a structured comparison of how to deliver domain context to LLMs. See also [TODO.md](../TODO.md) for tracked follow-ups.
