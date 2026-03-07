---
theme: default
title: 'Zowe MCP: AI-Powered z/OS Access'
info: |
  Zowe MCP — Model Context Protocol server and VS Code extension
  that gives AI assistants direct access to z/OS systems.
class: text-center
colorSchema: light
drawings:
  persist: false
transition: slide-left
mdc: true
---

<!-- Slide 1: Title -->

<div class="flex flex-col items-center justify-center h-full">
  <img src="/zowe-logo.svg" class="w-48 mb-6 drop-shadow-lg" alt="Zowe" />
  <h1 class="!text-5xl !font-extrabold !text-white !border-none !mb-4">Zowe MCP</h1>
  <p class="text-2xl !text-white/90 font-light">AI-Powered z/OS Access via Model Context Protocol</p>
</div>

<style>
.slidev-layout {
  background: linear-gradient(135deg, #1b375f 0%, #3162ac 60%, #3975d0 100%);
}
</style>

---

<!-- markdownlint-disable MD001 MD024 MD025 -->

<!-- Slide 2: What is MCP? -->

# What is MCP?

**Model Context Protocol** is an open standard (by Anthropic) that connects AI assistants to external tools and data sources.

<div class="grid grid-cols-2 gap-8 mt-6">
<div>

### <carbon-warning-alt class="inline text-[#e0182d]" /> The Problem

- LLMs are powerful but **isolated** from real systems
- Copy-pasting data into chat is slow and error-prone
- No structured way for AI to **act** on your behalf

</div>
<div>

### <carbon-checkmark-filled class="inline text-[#16825d]" /> The Solution

- **Standardized protocol** for tool discovery and invocation
- AI reads tool schemas, decides which to call, interprets results
- Adopted by **VS Code Copilot**, **Cursor**, **Claude Desktop**, **JetBrains**, and more

</div>
</div>

<div class="mt-6 p-4 bg-[#f3f4f4] rounded-lg border border-[#dddee0]">
  <strong class="text-[#1b375f]">Key insight:</strong> Zowe MCP lets AI assistants use z/OS tools the same way they use any other tool — and enable the use of z/OS like they can do with other systems.
</div>

---

<!-- Slide 3: What is Zowe MCP? -->

# What is Zowe MCP?

An **MCP server** and **VS Code extension** that gives AI assistants direct, structured access to z/OS systems and mainframe resources, such as data sets, jobs, and USS files, and do actions with them.

// TODO: Mention that Zowe MCP has been developed in Cursor with Anthropic models without a single line written manually guided and reviewed by architect with experience of developing of MCP servers and AI applications at Broadcom

<div class="grid grid-cols-4 gap-4 mt-8">
  <div class="text-center p-4 bg-[#f3f4f4] rounded-lg border-t-4 border-[#3162ac]">
    <carbon-assembly-cluster class="text-2xl text-[#3162ac] mb-1" />
    <div class="text-4xl font-extrabold text-[#3162ac]">6</div>
    <div class="text-sm text-[#6d7176] mt-1">Components</div>
  </div>
  <div class="text-center p-4 bg-[#f3f4f4] rounded-lg border-t-4 border-[#3162ac]">
    <carbon-tool-box class="text-2xl text-[#3162ac] mb-1" />
    <div class="text-4xl font-extrabold text-[#3162ac]">50</div>
    <div class="text-sm text-[#6d7176] mt-1">Tools</div>
  </div>
  <div class="text-center p-4 bg-[#f3f4f4] rounded-lg border-t-4 border-[#3162ac]">
    <carbon-chat class="text-2xl text-[#3162ac] mb-1" />
    <div class="text-4xl font-extrabold text-[#3162ac]">4</div>
    <div class="text-sm text-[#6d7176] mt-1">Prompts</div>
  </div>
  <div class="text-center p-4 bg-[#f3f4f4] rounded-lg border-t-4 border-[#3162ac]">
    <carbon-document class="text-2xl text-[#3162ac] mb-1" />
    <div class="text-4xl font-extrabold text-[#3162ac]">2</div>
    <div class="text-sm text-[#6d7176] mt-1">Resource Templates</div>
  </div>
</div>

<div class="mt-8 grid grid-cols-3 gap-4 text-sm">
  <div class="p-3 bg-[#f3f4f4] rounded-lg border-l-4 border-[#16825d]">
    <div class="font-bold text-[#1b375f] mb-1"><carbon-terminal class="inline text-[#16825d]" /> Standalone Server</div>
    <div class="text-[#6d7176]"><code>npx zowe-mcp-server --stdio</code> — works with any MCP client</div>
  </div>
  <div class="p-3 bg-[#f3f4f4] rounded-lg border-l-4 border-[#16825d]">
    <div class="font-bold text-[#1b375f] mb-1"><mdi-microsoft-visual-studio-code class="inline text-[#16825d]" /> VS Code Extension</div>
    <div class="text-[#6d7176]">Extension registers an Zowe MCP server as a <strong>local stdio server</strong> — used by Copilot Chat and Cursor automatically</div>
  </div>
  <div class="p-3 bg-[#f3f4f4] rounded-lg border-l-4 border-[#6d7176]">
    <div class="font-bold text-[#1b375f] mb-1"><carbon-cloud class="inline text-[#6d7176]" /> Remote HTTP Streamable</div>
    <div class="text-[#6d7176]">Centralized server for multi-user access — <em>coming soon</em></div>
  </div>
</div>

---

<!-- Slide 4: Use Cases -->

# Use Cases <span class="text-sm font-normal text-[#6d7176]">— <a href="https://github.com/plavjanik/zowe-mcp/blob/main/docs/use-cases.md" target="_blank">detailed workflows</a></span>

<div class="grid grid-cols-2 gap-5 mt-4">
  <div class="p-4 bg-[#f3f4f4] rounded-lg border-l-4 border-[#3162ac]">
    <div class="font-bold text-[#1b375f] mb-1"><carbon-education class="inline text-[#3162ac]" /> Mainframe Onboarding</div>
    <div class="text-sm text-[#6d7176]">New developers explore z/OS data sets, JCL, and COBOL through natural language — no ISPF knowledge needed.</div>
  </div>
  <div class="p-4 bg-[#f3f4f4] rounded-lg border-l-4 border-[#3162ac]">
    <div class="font-bold text-[#1b375f] mb-1"><carbon-code class="inline text-[#3162ac]" /> AI-Assisted COBOL Development</div>
    <div class="text-sm text-[#6d7176]">Search source, read copybooks, compile, submit jobs, and review output — all from Copilot Chat.</div>
  </div>
  <div class="p-4 bg-[#f3f4f4] rounded-lg border-l-4 border-[#3162ac]">
    <div class="font-bold text-[#1b375f] mb-1"><carbon-batch-job class="inline text-[#3162ac]" /> Batch Job Automation</div>
    <div class="text-sm text-[#6d7176]">Submit JCL, wait for completion, check return codes, search spool output — driven by AI agents.</div>
  </div>
  <div class="p-4 bg-[#f3f4f4] rounded-lg border-l-4 border-[#3162ac]">
    <div class="font-bold text-[#1b375f] mb-1"><carbon-connect class="inline text-[#3162ac]" /> Cross-Platform Workflows</div>
    <div class="text-sm text-[#6d7176]">AI reads z/OS data, transforms it, writes results — bridging mainframe and distributed systems.</div>
  </div>
  <div class="p-4 bg-[#f3f4f4] rounded-lg border-l-4 border-[#3162ac]">
    <div class="font-bold text-[#1b375f] mb-1"><carbon-search class="inline text-[#3162ac]" /> Code Review & Analysis</div>
    <div class="text-sm text-[#6d7176]">MCP prompts let AI review JCL, explain data sets, and compare PDS members with structured context.</div>
  </div>
  <div class="p-4 bg-[#f3f4f4] rounded-lg border-l-4 border-[#3162ac]">
    <div class="font-bold text-[#1b375f] mb-1"><carbon-terminal class="inline text-[#3162ac]" /> System Administration</div>
    <div class="text-sm text-[#6d7176]">Run TSO and USS commands with safety guardrails, manage multiple z/OS systems from one chat.</div>
  </div>
</div>

---

<!-- Slide 5: Demo -->

# Demo

<div class="flex flex-col items-center justify-center h-[70%]">
  <carbon-screen class="text-6xl text-[#3162ac] mb-6" />
  <h2 class="!text-3xl !text-[#3162ac] !border-none">Live Demo</h2>
  <p class="text-lg text-[#6d7176] mt-4 text-center max-w-lg">
    Using GitHub Copilot Chat with Zowe MCP to explore data sets,
    submit jobs, and search COBOL source on z/OS
  </p>
  <div class="mt-8 grid grid-cols-3 gap-6 text-center text-sm">
    <div class="p-3 bg-[#f3f4f4] rounded-lg">
      <carbon-data-base class="inline text-[#3162ac]" /> <strong class="text-[#1b375f]">1.</strong> List data sets
    </div>
    <div class="p-3 bg-[#f3f4f4] rounded-lg">
      <carbon-search class="inline text-[#3162ac]" /> <strong class="text-[#1b375f]">2.</strong> Search COBOL source
    </div>
    <div class="p-3 bg-[#f3f4f4] rounded-lg">
      <carbon-task class="inline text-[#3162ac]" /> <strong class="text-[#1b375f]">3.</strong> Submit &amp; monitor job
    </div>
  </div>
</div>

// TODO: Is there a way to do screenshots from a demo controlled by a script?

---

<!-- Slide 6: Section — Architecture -->

<div class="flex flex-col items-center justify-center h-full">
  <carbon-network-3 class="text-5xl text-[#3975d0] mb-4" />
  <div class="text-6xl font-extrabold text-[#3162ac] mb-4">Architecture</div>
  <div class="text-xl text-[#6d7176]">How Zowe MCP connects AI to z/OS</div>
  <div class="mt-8 w-24 h-1 bg-gradient-to-r from-[#1b375f] via-[#3162ac] to-[#3975d0] rounded-full"></div>
</div>

<style>
.slidev-layout {
  background: #f3f4f4;
}
</style>

---

<!-- Slide 6: Architecture Overview -->

# Architecture Overview

```mermaid {scale: 0.8}
---
config:
  flowchart:
    nodeSpacing: 20
    rankSpacing: 40
  themeVariables:
    fontSize: 13px
---
flowchart TD
  Copilot["VS Code Copilot"] & CursorAI["Cursor"] & Claude["Claude Desktop"]
  Copilot & CursorAI & Claude -->|"JSON-RPC"| Server

  subgraph Server ["Zowe MCP Server"]
    direction LR
    Tools["50 Tools divided into 6&nbsp;Components"]
    Cache["Response Cache"]
    Tools --> ZosBackendInterface
    ZosBackendInterface["ZosBackend Interface"]
    ZosBackendInterface --> Mock["Mock Backend<br/>(filesystem)"]
    ZosBackendInterface --> Native["Native Backend<br/>(SSH + ZNP)"]
  end

  classDef dottedStyle stroke-dasharray: 5 5
  class ZosBackendInterface dottedStyle

  Native --> zOS1["z/OS LPAR 1"]
  Native --> zOS2["z/OS LPAR 2"]
  Native --> zOS3["z/OS LPAR n..."]
```

---

<!-- Slide 7: Component Map -->

# Tool Components

<div class="grid grid-cols-4 gap-3 mt-4">
  <div class="col-span-4 text-center p-3 bg-[#1b375f] text-white rounded-lg font-bold text-lg">
    Zowe MCP Server — 50 tools
  </div>
  <div class="p-3 bg-[#f3f4f4] rounded-lg border-t-3 border-[#3162ac] text-center">
    <carbon-data-base class="text-xl text-[#3162ac]" />
    <div class="font-bold text-[#1b375f]">datasets</div>
    <div class="text-2xl font-extrabold text-[#3162ac]">15</div>
    <div class="text-xs text-[#6d7176] mt-1">list · read · write · search<br/>create · delete · copy · rename</div>
  </div>
  <div class="p-3 bg-[#f3f4f4] rounded-lg border-t-3 border-[#3162ac] text-center">
    <carbon-folder class="text-xl text-[#3162ac]" />
    <div class="font-bold text-[#1b375f]">uss</div>
    <div class="text-2xl font-extrabold text-[#3162ac]">17</div>
    <div class="text-xs text-[#6d7176] mt-1">list · read · write · command<br/>chmod · chown · chtag · copy</div>
  </div>
  <div class="p-3 bg-[#f3f4f4] rounded-lg border-t-3 border-[#3162ac] text-center">
    <carbon-task class="text-xl text-[#3162ac]" />
    <div class="font-bold text-[#1b375f]">jobs</div>
    <div class="text-2xl font-extrabold text-[#3162ac]">15</div>
    <div class="text-xs text-[#6d7176] mt-1">submit · status · output<br/>cancel · hold · release · delete</div>
  </div>
  <div class="p-3 bg-[#f3f4f4] rounded-lg border-t-3 border-[#3162ac] text-center">
    <carbon-settings class="text-xl text-[#3162ac]" />
    <div class="font-bold text-[#1b375f]">context</div>
    <div class="text-2xl font-extrabold text-[#3162ac]">3</div>
    <div class="text-xs text-[#6d7176] mt-1">listSystems · setSystem<br/>getContext</div>
  </div>
</div>

<div class="grid grid-cols-3 gap-3 mt-3">
  <div class="p-3 bg-[#f3f4f4] rounded-lg border-t-3 border-[#3975d0] text-center">
    <carbon-application class="text-xl text-[#3975d0]" />
    <div class="font-bold text-[#1b375f]">zowe-explorer</div>
    <div class="text-xl font-extrabold text-[#3975d0]">3</div>
    <div class="text-xs text-[#6d7176]">open dataset · USS file · job in editor</div>
  </div>
  <div class="p-3 bg-[#f3f4f4] rounded-lg border-t-3 border-[#3975d0] text-center">
    <carbon-terminal class="text-xl text-[#3975d0]" />
    <div class="font-bold text-[#1b375f]">tso</div>
    <div class="text-xl font-extrabold text-[#3975d0]">1</div>
    <div class="text-xs text-[#6d7176]">runSafeTsoCommand</div>
  </div>
</div>

---

<!-- Slide 8: Zowe Native Proto -->

# Zowe Native Proto (ZNP)

The native backend connects to z/OS through **Zowe Native Proto** — a lightweight z/OS server deployed over SSH.

<div class="grid grid-cols-2 gap-6 mt-4">
<div>

### <carbon-rocket class="inline text-[#3162ac]" /> Why ZNP?

- <carbon-locked class="inline text-[#6d7176]" /> **Only SSH required** — no z/OSMF, no APIML, no special middleware
- <carbon-deploy class="inline text-[#6d7176]" /> **Auto-deploy** — the MCP server installs and updates the ZNP binary on z/OS automatically
- <carbon-renew class="inline text-[#6d7176]" /> **Auto-redeploy** — detects version mismatch and redeploys on the fly
- <carbon-plug class="inline text-[#6d7176]" /> **Extensible by anyone** — open source, new operations can be added to the SDK
- <carbon-flash class="inline text-[#6d7176]" /> **Lightweight** — small native binary, minimal z/OS footprint

</div>
<div>

### <carbon-flow class="inline text-[#3162ac]" /> How It Works

1. MCP server opens an **SSH connection** to z/OS
2. ZNP binary is **deployed to user's USS home** (if needed)
3. Commands are sent as **structured RPC** over the SSH channel
4. Results come back as **JSON** — parsed and cached by the MCP server

### Key Operations via ZNP

- Data set list, read, write, search (SuperC)
- USS file operations and commands
- TSO command execution
- Job submission and management

</div>
</div>

---

<!-- Slide 9: VS Code Extension Integration -->

# <mdi-microsoft-visual-studio-code class="inline text-[#3162ac]" /> VS Code Extension Integration

<div class="grid grid-cols-2 gap-6">
<div>

### <carbon-two-person-lift class="inline text-[#3162ac]" /> Dual Registration

- **VS Code** — `mcpServerDefinitionProviders` API
- **Cursor** — `vscode.cursor.mcp.registerServer()`
- Works in both IDEs from a single extension

### <carbon-connection-signal class="inline text-[#3162ac]" /> Named Pipe Communication

// Todo: Mention that this is additional channel besides stdio to allow deeper integration of the MCP server and VS Code

- Bidirectional NDJSON over Unix socket
- Real-time log level changes
- Password collection via extension UI
- Zowe Explorer open-in-editor events

</div>
<div>

### <carbon-star class="inline text-[#3162ac]" /> Extension Features

- **Mock data generation** — palette command to init mock data
- **Settings-driven** — connections, encoding, log level, job cards
  - Automatically updates the server configuration

</div>
</div>

---

<!-- Slide 10: Section — Capabilities -->

<div class="flex flex-col items-center justify-center h-full">
  <carbon-tool-box class="text-5xl text-[#3975d0] mb-4" />
  <div class="text-6xl font-extrabold text-[#3162ac] mb-4">Capabilities</div>
  <div class="text-xl text-[#6d7176]">What can AI do with z/OS through Zowe MCP?</div>
  <div class="mt-8 w-24 h-1 bg-gradient-to-r from-[#1b375f] via-[#3162ac] to-[#3975d0] rounded-full"></div>
</div>

<style>
.slidev-layout {
  background: #f3f4f4;
}
</style>

---

<!-- Slide 11: Data Set Operations -->

# <carbon-data-base class="inline text-[#3162ac]" /> Data Set Operations — 15 Tools

<div class="grid grid-cols-2 gap-6">
<div>

### <carbon-list class="inline text-[#3162ac]" /> CRUD

- **listDatasets** — ISPF 3.4 style pattern matching
- **listMembers** — PDS or PDS/E member listing
- **readDataset** — line-windowed reads
- **writeDataset** — full or block-of-records
- **createDataset** / **createTempDataset**
- **deleteDataset** / **deleteDatasetsUnderPrefix**
- **copyDataset** / **renameDataset**
- **restoreDataset** — HSM recall

</div>
<div>

### <carbon-search class="inline text-[#3162ac]" /> Search & Attributes

- **searchInDataset** — SuperC search, context lines, COBOL-aware
- **getDatasetAttributes** — dsorg, recfm, lrecl, SMS classes, dates

### <carbon-flash class="inline text-[#3162ac]" /> Smart Features

- **Pagination** — offset/limit with `hasMore`
- **Response cache** — LRU, 10 min TTL
- **EBCDIC encoding** — IBM-037 default, per-system overrides
- **Temp data sets** — prefix generation + cleanup

</div>
</div>

---

<!-- Slide 12: USS Operations -->

# <carbon-folder class="inline text-[#3162ac]" /> USS Operations — 17 Tools

<div class="grid grid-cols-2 gap-6">
<div>

### <carbon-folder-open class="inline text-[#3162ac]" /> File System

- **listUssFiles** — directory listing with metadata
- **readUssFile** / **writeUssFile** — line-windowed reads
- **createUssFile** — files and directories
- **deleteUssFile** — with recursive support
- **copyUssFile** — recursive, symlink-aware
- **chmod** / **chown** / **chtag** — permissions, ownership, encoding tags

</div>
<div>

### <carbon-terminal class="inline text-[#3162ac]" /> Commands & Temp Files

- **runSafeUssCommand** — execute Unix commands with safety patterns
- **getUssHome** — resolve user home directory
- **changeUssDirectory** — per-system working directory
- **Temp operations** — getUssTempDir, getUssTempPath, createTempUssDir, createTempUssFile, deleteUssTempUnderDir

### <carbon-direction-fork class="inline text-[#3162ac]" /> Path Resolution

- Absolute (`/u/user/...`) or relative to current working directory
- Display paths shown relative when under cwd

</div>
</div>

---

<!-- Slide 13: Jobs -->

# <carbon-task class="inline text-[#3162ac]" /> Job Operations — 15 Tools

<div class="grid grid-cols-2 gap-6">
<div>

### <carbon-play class="inline text-[#3162ac]" /> Submit & Monitor

- **submitJob** — inline JCL with optional `wait: true` (adaptive polling)
- **submitJobFromDataset** — submit from PDS member
- **submitJobFromUss** — submit from USS file
- **getJobStatus** — INPUT / ACTIVE / OUTPUT + return code
- **listJobs** — filter by owner, prefix, status

</div>
<div>

### <carbon-document class="inline text-[#3162ac]" /> Output & Lifecycle

- **listJobFiles** — spool file listing
- **readJobFile** — line-windowed spool reads
- **getJobOutput** — aggregated output across files
- **searchJobOutput** — substring search in spool
- **getJcl** — retrieve submitted JCL
- **cancelJob** / **holdJob** / **releaseJob** / **deleteJob**

### <carbon-receipt class="inline text-[#3162ac]" /> Job Cards

- Auto-prepended when JCL lacks a JOB statement
- Configurable per connection (VS Code setting or config file)

</div>
</div>

---

<!-- Slide 14: TSO Commands -->

# <carbon-security class="inline text-[#3162ac]" /> TSO & Command Safety

<div class="grid grid-cols-2 gap-6">
<div>

### runSafeTsoCommand

Issue TSO commands with **pattern-based safety**:

| Category | Action | Examples |
|----------|--------|----------|
| **Dangerous** | Block | DELETE SYS1.*, PASSWORD, OSHELL |
| **Sensitive** | Elicit user | DELETE own DS, SUBMIT |
| **Safe** | Allow | LISTDS, STATUS, TIME, WHO |
| **Unknown** | Elicit user | Anything not matched |

</div>
<div>

### runSafeUssCommand

Same safety model for Unix commands:

| Category | Examples |
|----------|----------|
| **Dangerous** | `rm -rf /`, `mkfs`, `shutdown` |
| **Sensitive** | `rm`, `mv`, `chmod 777` |
| **Safe** | `ls`, `cat`, `grep`, `find` |

### How Elicitation Works

When a command needs approval, the server asks the MCP client to prompt the user — the AI cannot bypass this.

</div>
</div>

---

<!-- Slide 15: Multi-System Support -->

# <carbon-network-3 class="inline text-[#3162ac]" /> Multi-System Support

<div class="grid grid-cols-2 gap-6">
<div>

### <carbon-server-proxy class="inline text-[#3162ac]" /> System Management

- **listSystems** — show all configured z/OS systems
- **setSystem** — switch active system (by host or user@host)
- **getContext** — current system, user, working directory

### <carbon-connect class="inline text-[#3162ac]" /> Connection Model

- One **system** = one z/OS host
- Multiple **connections** per host (different users)
- `system` parameter on every tool — explicit or use active

</div>
<div>

### <carbon-magic-wand class="inline text-[#3162ac]" /> Smart Defaults

- **Single system** — auto-activated, no `setSystem` needed
- **Lazy initialization** — context created on first tool call
- **Per-system state** — each system remembers its user, USS cwd, encoding overrides

### <carbon-settings class="inline text-[#3162ac]" /> Configuration

- **VS Code** — `zoweMCP.nativeConnections` setting
- **Standalone** — `--config systems.json` or `--system user@host`
- **Mock** — `systems.json` in mock data directory

</div>
</div>

---

<!-- Slide 16: AI-Native Features -->

# <carbon-machine-learning class="inline text-[#3162ac]" /> AI-Native Design

Features that make Zowe MCP work **better with LLMs** than traditional APIs:

<div class="grid grid-cols-2 gap-6 mt-4">
<div>

### <carbon-data-structured class="inline text-[#3162ac]" /> Structured Output

- **Output schemas** (Zod) on every tool — clients validate `structuredContent`
- **Response envelope** — `_context` (resolution metadata), `_result` (pagination), `data` (payload)
- **Tool annotations** — `readOnlyHint` skips VS Code confirmation, `destructiveHint` warns

### <carbon-page-first class="inline text-[#3162ac]" /> Pagination Protocol

- **List pagination** — offset/limit with `hasMore` and directive messages
- **Line windowing** — startLine/lineCount for large reads
- **Server instructions** — full protocol sent at init

</div>
<div>

### <carbon-chat class="inline text-[#3162ac]" /> MCP Prompts

- **reviewJcl** — AI reviews JCL for errors and best practices
- **explainDataset** — AI explains dataset purpose and structure
- **compareMembers** — AI diffs two PDS members
- **reflectZoweMcp** — AI reflects on usage, creates AGENTS.md

### <carbon-progress-bar class="inline text-[#3162ac]" /> Progress Reporting

- Real-time progress via `_meta.progressToken`
- Human-readable titles: "List members of SYS1.MACLIB"
- Backend subactions: "Connecting via SSH", "Deploying ZNP"

</div>
</div>

---

<!-- Slide 17: Section — Safety & Security -->

<div class="flex flex-col items-center justify-center h-full">
  <carbon-security class="text-5xl text-[#3975d0] mb-4" />
  <div class="text-6xl font-extrabold text-[#3162ac] mb-4">Safety & Security</div>
  <div class="text-xl text-[#6d7176]">Protecting z/OS from unintended AI actions</div>
  <div class="mt-8 w-24 h-1 bg-gradient-to-r from-[#1b375f] via-[#3162ac] to-[#3975d0] rounded-full"></div>
</div>

<style>
.slidev-layout {
  background: #f3f4f4;
}
</style>

---

<!-- Slide 18: Command Safety Model -->

# <carbon-warning-alt class="inline text-[#e0182d]" /> Command Safety Model

```mermaid {scale: 0.72}
flowchart TD
  Input["Command Input (TSO / USS / Console)"]
  Input --> Patterns["Pattern Matching (JSON rule files)"]

  Patterns -->|"Dangerous"| Block["BLOCK — Command rejected"]
  Patterns -->|"Sensitive"| Elicit["ELICIT — Ask user"]
  Patterns -->|"Safe"| Allow["ALLOW — Execute"]
  Patterns -->|"No match"| Unknown["UNKNOWN — Ask user"]

  Elicit -->|"Approved"| Allow
  Elicit -->|"Declined"| Decline["DECLINE — Not executed"]
  Unknown -->|"Approved"| Allow
  Unknown -->|"Declined"| Decline

  style Block fill:#e0182d,color:#fff
  style Allow fill:#16825d,color:#fff
  style Elicit fill:#3162ac,color:#fff
  style Unknown fill:#264c86,color:#fff
  style Decline fill:#6d7176,color:#fff
```

<div class="text-center text-sm text-[#6d7176] mt-2">
  The AI <strong>cannot bypass</strong> elicitation — the MCP client (VS Code / Cursor) handles the user prompt.
</div>

---

<!-- Slide 19: Credential Management -->

# <carbon-locked class="inline text-[#3162ac]" /> Credential Management

<div class="grid grid-cols-2 gap-6">
<div>

### <carbon-flow class="inline text-[#3162ac]" /> Password Collection Flow

1. Tool needs credentials for a system
2. Check if password is already known
3. If not — **request via pipe** (VS Code extension prompts user with masked input)
4. If pipe not connected — **MCP elicitation** (client prompts user)
5. On success — **store** in VS Code SecretStorage
6. On failure — **blacklist** invalid password

### <carbon-group class="inline text-[#3162ac]" /> Concurrent Protection

When multiple tools request the same credential simultaneously, only one prompt runs — others wait.

</div>
<div>

### <carbon-security class="inline text-[#3162ac]" /> Security Features

- Passwords **never stored in plain text** — VS Code SecretStorage (OS keychain)
- **Invalid password blacklisting** — prevents repeated failed auth
- **"Clear Stored Password"** command in VS Code palette
- Shared secret key convention: `zowe.ssh.password.${user}.${host}`

### Connection Types

| Mode | Credential Source |
|------|------------------|
| VS Code | SecretStorage + pipe prompt |
| Standalone | Environment variables |
| Mock | `systems.json` credentials |

</div>
</div>

---

<!-- Slide 20: Section — Developer Experience -->

<div class="flex flex-col items-center justify-center h-full">
  <carbon-development class="text-5xl text-[#3975d0] mb-4" />
  <div class="text-6xl font-extrabold text-[#3162ac] mb-4">Developer Experience</div>
  <div class="text-xl text-[#6d7176]">Getting started, testing, and extending Zowe MCP</div>
  <div class="mt-8 w-24 h-1 bg-gradient-to-r from-[#1b375f] via-[#3162ac] to-[#3975d0] rounded-full"></div>
</div>

<style>
.slidev-layout {
  background: #f3f4f4;
}
</style>

---

<!-- Slide 21: Getting Started -->

# <carbon-rocket class="inline text-[#3162ac]" /> Getting Started

<div class="grid grid-cols-3 gap-6">
<div>

### <mdi-microsoft-visual-studio-code class="inline text-[#3162ac]" /> VS Code Extension

1. Install **Zowe MCP** extension
2. Set `zoweMCP.nativeConnections`
3. Open Copilot Chat — done!

### <carbon-data-vis-1 class="inline text-[#3162ac]" /> Mock Mode

1. Set `zoweMCP.mockDataDirectory`
2. Run **"Generate Mock Data"** command
3. Full z/OS simulation, no mainframe

</div>
<div>

### <carbon-terminal class="inline text-[#3162ac]" /> Standalone Server

```bash
npx zowe-mcp-server init-mock \
  --output ./mock-data

npx zowe-mcp-server --stdio \
  --mock ./mock-data
```

```bash
npx zowe-mcp-server --stdio \
  --native --system user@host
```

</div>
<div>

### <carbon-play class="inline text-[#3162ac]" /> Quick Tool Testing

```bash
npx zowe-mcp-server call-tool \
  --mock=./mock-data \
  listDatasets \
  dsnPattern="USER.*"
```

### <carbon-search class="inline text-[#3162ac]" /> MCP Inspector

```bash
npm run inspector
# Opens web UI at :6274
```

</div>
</div>

---

<!-- Slide 22: Eval-Driven Development -->

# <carbon-chart-evaluation class="inline text-[#3162ac]" /> Eval-Driven Development

Every tool change is validated with **before/after AI evaluation runs**.

<div class="grid grid-cols-2 gap-6 mt-4">
<div>

### <carbon-flow class="inline text-[#3162ac]" /> How It Works

1. Define **question sets** in YAML — natural language questions with assertions
2. Run evals across **multiple LLM models**
3. Compare pass rates — keep improvements, revert regressions
4. Track results in **scoreboard** (`docs/eval-scoreboard.md`)

### <carbon-category class="inline text-[#3162ac]" /> Question Set Types

- **naming-stress** — CLI phrasing, z/OS jargon, ISPF vocabulary
- **description-quality** — pagination, search options, attributes
- **sms-allocation** — SMS parameters, JCL-style allocation
- **mutations** — write/delete flows
- **pagination** / **search** — correctness of multi-page results

</div>
<div>

### Example Question (YAML)

```yaml
- question: How many members does USER.INVNTORY have?
  assertions:
    - toolCall:
        tool: listMembers
        args:
          dsn: USER.INVNTORY
    - answerContains: { pattern: "2,?000" }
```

### <carbon-idea class="inline text-[#3162ac]" /> Key Findings

- **Parameter descriptions** matter more than parameter names for LLMs
- **Expanding z/OS jargon** in descriptions improved pass rates by +9.1%
- Pagination awareness remains a challenge

</div>
</div>

---

<!-- Slide 23: Extensibility — Future Directions -->

# <carbon-plug class="inline text-[#3162ac]" /> Extensibility — Future Directions

The MCP ecosystem is already extensible — anyone can build and register an MCP server with AI assistants, and some vendors already offer z/OS-related MCP servers independent of Zowe. Zowe MCP is focused on **core z/OS functionality** now. Here are options we're considering:

<div class="grid grid-cols-3 gap-5 mt-4">
  <div class="p-4 bg-[#f3f4f4] rounded-lg border-t-4 border-[#3162ac]">
    <div class="text-xs font-bold text-[#3162ac] mb-2">OPTION 1</div>
    <div class="font-bold text-[#1b375f] mb-2"><carbon-package class="inline text-[#3162ac]" /> Shared Library / SDK</div>
    <div class="text-sm text-[#6d7176]">
      Extract common building blocks from Zowe MCP into a <strong>shared SDK</strong> that other z/OS MCP servers can build on — reducing divergent approaches across the ecosystem.
      <div class="mt-2 text-xs">Response envelopes, pagination, safety patterns, encoding, <code>ZosBackend</code> interface</div>
    </div>
  </div>
  <div class="p-4 bg-[#f3f4f4] rounded-lg border-t-4 border-[#3162ac]">
    <div class="text-xs font-bold text-[#3162ac] mb-2">OPTION 2</div>
    <div class="font-bold text-[#1b375f] mb-2"><carbon-assembly-cluster class="inline text-[#3162ac]" /> Zowe MCP Plug-ins</div>
    <div class="text-sm text-[#6d7176]">
      A <strong>plug-in model</strong> for the Zowe MCP server itself — similar to the CLI. Third parties register additional tools, prompts, and resources directly into the server.
    </div>
  </div>
  <div class="p-4 bg-[#f3f4f4] rounded-lg border-t-4 border-[#3162ac]">
    <div class="text-xs font-bold text-[#3162ac] mb-2">OPTION 3</div>
    <div class="font-bold text-[#1b375f] mb-2"><carbon-connect class="inline text-[#3162ac]" /> CLI Plug-ins → MCP Tools</div>
    <div class="text-sm text-[#6d7176]">
      Enable existing <strong>Zowe CLI plug-ins</strong> to provide MCP tools. Not a blind 1:1 mapping of CLI commands — MCP tools are <strong>designed purposefully</strong> for AI, using existing plug-in code as the implementation.
    </div>
  </div>
</div>

<div class="mt-4 p-3 bg-[#f3f4f4] rounded-lg border border-[#dddee0] text-sm text-center">
  <carbon-idea class="inline text-[#1b375f]" /> These options are <strong>not mutually exclusive</strong> — they can be pursued independently or combined.
</div>

---

<!-- Slide 23b: Extensibility — Internal -->

# <carbon-add class="inline text-[#3162ac]" /> Extending Zowe MCP — Internals

<div class="grid grid-cols-3 gap-6">
<div>

### <carbon-tool-box class="inline text-[#3162ac]" /> Adding a Tool

1. Create file under `src/tools/<component>/`
2. Export `register<Component>Tools(server, deps, logger)`
3. Register in `server.ts`
4. Add output schema (Zod)
5. Add tests in `__tests__/`

Tools use `registerTool()` with:

- camelCase names
- `readOnlyHint` / `destructiveHint`
- Progress reporting
- Pagination helpers

</div>
<div>

### <carbon-server-proxy class="inline text-[#3162ac]" /> Adding a Backend

Implement the `ZosBackend` interface:

```typescript
interface ZosBackend {
  listDatasets(...)
  listMembers(...)
  readDataset(...)
  writeDataset(...)
  searchInDataset(...)
  // ... 20+ methods
}
```

Current backends:

- **FilesystemMockBackend**
- **NativeBackend** (SSH + ZNP)

</div>
<div>

### <carbon-send class="inline text-[#3162ac]" /> Adding Events

1. Define event type in `events.ts`
2. Add to union type
3. Handle in `event-handler.ts`

Event types:

- `log`, `notification`
- `request-password`
- `store-password`
- `systems-update`
- `open-*-in-editor`
- `ceedump-collected`

</div>
</div>

---

<!-- Slide 24: Roadmap & Community -->

# <carbon-roadmap class="inline text-[#3162ac]" /> Roadmap & Community

<div class="grid grid-cols-2 gap-8">
<div>

### <carbon-calendar class="inline text-[#3162ac]" /> What's Next

- **z/OSMF backend** — REST API alternative to SSH
- **OAuth / MFA support** — enterprise authentication
- **Console commands** — z/OS operator console (code ready, waiting for ZNP support)
- **More prompts** — JCL generation, COBOL analysis, batch job templates
- **Resource subscriptions** — real-time data set change notifications

</div>
<div>

### <carbon-collaborate class="inline text-[#3162ac]" /> Get Involved

- **GitHub** — [github.com/zowe/zowe-mcp](https://github.com/zowe/zowe-mcp) - _coming soon_
- **npm** and  **VS Code Marketplace** — not available yet
- **Zowe Slack** — `#zowe-mcp` channel - _coming soon_

### License

Eclipse Public License 2.0 (EPL-2.0)

Part of the **Zowe** project under the **Open Mainframe Project** (Linux Foundation)

</div>
</div>

---

<!-- Slide 26: Thank You -->

<div class="flex flex-col items-center justify-center h-full">
  <img src="/zowe-logo.svg" class="w-40 mb-8 drop-shadow-lg" alt="Zowe" />
  <h1 class="!text-5xl !font-extrabold !text-white !border-none !mb-4">Thank You!</h1>
  <p class="text-xl !text-white/80 mb-8">Questions &amp; Discussion</p>
  <div class="grid grid-cols-2 gap-8 text-sm !text-white/70">
    <div class="text-right">
      <strong class="!text-white/90">GitHub</strong><br/>
      github.com/zowe/zowe-mcp
    </div>
    <div class="text-left">
      <strong class="!text-white/90">zowe.org</strong><br/>
      zowe.org
    </div>
  </div>
</div>

<style>
.slidev-layout {
  background: linear-gradient(135deg, #1b375f 0%, #3162ac 60%, #3975d0 100%);
  color: #ffffff;
}
</style>
