# How to Add a Zowe CLI Plugin via the CLI Bridge

This guide walks you through integrating any Zowe CLI plugin into the Zowe MCP server as a set
of MCP tools, using the **CLI Bridge** mechanism.

> **Note:** All examples in this guide use the Endevor CLI plugin. When following this guide for
> a different plugin, substitute the plugin name, command groups, profile fields, and tool names
> accordingly.

This guide is designed to be followed by an **AI coding assistant** (e.g. Cursor) working
alongside the user. Steps are labeled:

- **AI** — the assistant can complete this step autonomously using the repo and CLI
- **USER** — the user must provide input or make a decision
- **AI + USER** — the assistant researches and proposes; the user reviews and confirms

---

## What the CLI Bridge Is

The CLI Bridge is a **metadata-driven** mechanism in the Zowe MCP server that turns Zowe CLI
plugin commands into MCP tools without writing TypeScript code for each plugin. You describe the
mapping in a YAML file; the bridge handles argument building, CLI invocation (`zowe ... --rfj`),
response wrapping, pagination, and error formatting.

The YAML is the only artifact you need to create for a new plugin. All TypeScript code is
**generic and non-vendor-specific** — shared by every plugin.

### When to Use the CLI Bridge vs a Native Backend

| Situation | Approach |
| --- | --- |
| The Zowe CLI plugin already wraps the API you need | CLI Bridge |
| You need high-throughput bulk operations (thousands of items/sec) | Native backend |
| The CLI plugin has no `--rfj` (JSON output) support | Native backend or patch the CLI |
| You want zero new infrastructure (no SSH, no SDK) | CLI Bridge |

---

## Overview of the Process

```text
Step 1 [AI]         Install plugin + generate CLI commands YAML
       ↓
Step 2 [USER]       Provide connection info and use-case context
       ↓
Step 3 [AI + USER]  Define use cases and draft eval questions
       ↓
Step 4 [AI]         Author the MCP tools YAML
       ↓
Step 5 [AI + USER]  Smoke-test the tools
       ↓
Step 6 [AI]         Optimize descriptions with AI (gemini-3.1-pro)
       ↓
Step 7 [AI + USER]  Build and run evaluations — iterate until targets are met
       ↓
Step 8 [AI]         Create E2E tests
       ↓
Step 9 [AI + USER]  Generate and review the vendor reference doc
       ↓
Step 10             Vendor directory layout + AGENTS.md
```

---

## Step 1 \[AI\]: Install the Plugin and Generate the CLI Commands YAML

> **The assistant starts here.** This step produces the raw material for every subsequent
> decision: a structured YAML of every command, option, positional, alias, and description in
> the plugin. The user does not need to be involved.

Install the Zowe CLI plugin and run the extraction script:

```bash
# Install the plugin from the public npm registry (example for Endevor)
zowe plugins install @broadcom/endevor-for-zowe-cli

# Generate the CLI commands YAML — captures every command, option, and description
npm run generate-cli-bridge-yaml -- \
  --plugin endevor \
  --output vendor/broadcom/cli-bridge-plugins/endevor-commands.yaml

# Or install directly from a local .tgz without touching the global Zowe CLI:
npm run generate-cli-bridge-yaml -- \
  --plugin endevor \
  --tgz /path/to/endevor-for-zowe-cli.tgz \
  --output vendor/broadcom/cli-bridge-plugins/endevor-commands.yaml \
  --keep-installed
```

The output is a structured YAML containing every group, command, positional, and option with
full metadata:

```yaml
# endevor-commands.yaml (auto-generated — do not hand-edit)
endevor:
  list:
    environments:
      description: "List the Endevor environments."
      positionals:
        environment:
          description: "The name of the Endevor environment to list..."
          type: string
      options:
        instance:
          description: "Web Services instance name (datasource)."
          aliases: [i]
          type: string
          required: false
    elements:
      description: "List Endevor elements."
      options:
        search-text:
          description: "Search for elements by source text content."
          type: string
        limit:
          description: "Maximum number of results to return."
          type: number
```

**After generating, review the YAML to:**

- Identify the connection-level options (host, port, user, protocol, basePath) — these become
  the connection profile
- Identify domain-context options (environment, stage, system, subsystem, type for Endevor)
  — these become the location profile
- Find any `--search-text`, `--limit`, or `--offset` options — signals for pagination support
- Note any options that use opaque codes (e.g. 2-letter EWS codes `ES`, `EH`) instead of
  human-readable values — signals for `valueMap`
- Find examples in the CLI docs that reveal typical usage patterns

> Regenerate this file whenever the plugin is updated. It is the single source of truth for
> CLI metadata and should not be hand-edited. Reference individual nodes in your tools YAML
> via `$.endevor.list.environments.description` — the loader resolves these at startup.

---

## Step 2 \[USER\]: Provide Connection Info and Use-Case Context

> **The user must answer these questions before the assistant can proceed.**
> The AI agent should ask the user for this information if it is not already provided.

### 2.1 Connection Information

The assistant needs connection details to smoke-test tools and to configure evals. Provide:

| Information needed | Example (Endevor) |
| --- | --- |
| Backend host | `endevor.example.com` |
| Port | `8080` |
| Username | `MYUSER` |
| Password | *(set as env var — do not store in files)* |
| Protocol | `https` |
| Base path | `EndevorService/api/v2` |
| Any plugin-specific connection param | `instance: ENDEVOR` |

The password is never stored in YAML files. Set it as an environment variable:

```bash
# Pattern: ZOWE_MCP_PASSWORD_<USER>_<HOST>  (uppercase, dots → underscores)
export ZOWE_MCP_PASSWORD_MYUSER_ENDEVOR_EXAMPLE_COM=mysecret
```

### 2.2 Use-Case Context

Tell the assistant what you want to accomplish with the plugin. Address each category:

- **Discovery**: What is the domain hierarchy you navigate? (For Endevor: environments →
  stages → systems → subsystems → element types → elements)
- **Read content**: What artifacts do you want to retrieve and display? (source code, reports,
  change history, package SCL)
- **Search**: Is there a content-search capability? What operators does it support?
- **Multi-step workflows**: What is the canonical sequence you run every session?
  (e.g. "set context, list elements, print source")
- **Change management**: Is there a lifecycle, package, or promotion concept?
- **Dependency analysis**: Can you query what X depends on or what uses X?

The assistant will cross-reference your answers with the generated CLI commands YAML to
identify which CLI commands map to each use case.

---

## Step 3 \[AI + USER\]: Define Use Cases and Draft Eval Questions

> **The assistant proposes; the user reviews and confirms.**
> The assistant reads the generated CLI commands YAML, extracts examples and option descriptions,
> and builds a use-case table plus eval question drafts. The user adds domain knowledge the CLI
> docs don't cover (e.g. naming conventions, typical filter values, real element names in the
> test environment).

### Use-Case Table

The assistant should produce a table like this, informed by the YAML and the user's answers:

> **Endevor example — substitute with your plugin's domain.**

| Use case | User goal | MCP tools needed |
| --- | --- | --- |
| Discovery | "What COBOL programs are in PRD?" | `endevorListEnvironments` → `endevorListSystems` → `endevorListElements` |
| Read content | "Show me the source code of PROG01" | `endevorPrintElement` |
| Search | "Which programs reference CPYBK01?" | `endevorSearchElements` |
| Multi-step | "Set DEV context, list programs, show PROG03" | `endevorSetLocation` → `endevorListElements` → `endevorPrintElement` |
| Change management | "What's in package PKG001?" | `endevorListPackages` → `endevorViewPackageScl` |
| Dependency | "What does PROG01 use?" | `endevorQueryComponents` |

### Command Classification

Classify each CLI command the assistant found:

| Category | Include? | Reason |
| --- | --- | --- |
| `list *` | Yes, all | Core discovery |
| `print element` | Yes | Read content |
| `queryacm components` | Yes | Dependency analysis |
| `view pkgscl` | Yes | Change management |
| `retrieve element` | Later | Needs local file path |
| `add element` | Later / never | Mutating — requires extra care |
| `generate element` | Later / never | Triggers z/OS build pipeline |

> **Start small.** The discovery tools + one read tool is a sufficient MVP. Content tools
> (print, view, query) and search can be added after the discovery tools are working well.

### Eval Question Drafts

Write 2-3 questions per use case category in the way a real user would type them. These
become eval YAML entries in Step 7. Use **real values from the test environment** the user
provided in Step 2 — not placeholders.

> **Endevor example — use your plugin's domain names and real test data.**

```text
Discovery:
  "List all Endevor environments."
  "What COBPGM elements exist in DEV stage 1 system SYS1 subsystem SUB1?"
  "What element types are available in DEV?"

Read content:
  "Show me the source code of PROG01 (type COBPGM) in DEV stage 1 SYS1 SUB1."
  "Show me the full change history for PROG01."

Search:
  "Find all COBPGM elements whose source contains PROGRAM-ID."
  "Which programs contain both GOBACK and WORKING-STORAGE?"

Multi-step:
  "Set context to DEV/1/SYS1/SUB1, then list all COBPGM elements, then show PROG03 source."

Dependency:
  "What components does PROG01 depend on?"
```

Keep these question drafts — you will paste them directly into eval YAML files in Step 7.

---

## Step 4 \[AI\]: Author the MCP Tools YAML

The tools YAML is the only file the assistant hand-authors (with user review on profile
field choices). It defines:

- `plugin` — the plugin identifier (used in tool names and error messages)
- `displayName` — shown in error messages
- `activeDescription` — which variant the server uses by default (`optimized` after Step 6)
- `pagination` — plugin-level pagination defaults
- `profiles` — named profile types (connection, location)
- `tools` — one entry per MCP tool

Place it in `vendor/<yourname>/cli-bridge-plugins/<plugin>-tools.yaml`.

### 4.1 Profile Types

Every plugin has at least one profile type. Typically:

- **connection** — how to reach the backend API (host, port, user, protocol, basePath).
  `required: true`, `perToolOverride: false`. A profile must be active before any tool call.
- **location** — a domain context (environment, stage, system, subsystem, type for Endevor).
  `required: false`, `perToolOverride: true`. Individual fields are injected into every
  tool's input schema.

> **Endevor example** — adapt profile field names and CLI option names for your plugin.

```yaml
profiles:
  connection:
    name: Endevor connection
    toolListName: endevorListConnections
    toolSetName: endevorSetConnection
    required: true
    perToolOverride: false
    fields:
      - name: host
        cliOption: host
        required: true
        description: "Base host name for Endevor Web Services."
      - name: port
        cliOption: port
        description: "Port number."
      - name: user
        cliOption: user
        required: true
        isUsername: true          # used for password lookup (user@host key)
        description: "Username."
      - name: protocol
        cliOption: protocol
        default: https            # injected when omitted
        description: "Protocol (http or https)."
      - name: basePath
        cliOption: base-path
        description: "$.endevor.list.environments.options.base-path"
      - name: instance
        cliOption: i
        description: "$.endevor.list.environments.options.instance"

  location:
    name: Endevor location
    toolListName: endevorListLocations
    toolSetName: endevorSetLocation
    required: false
    perToolOverride: true         # fields appear in each tool's schema
    fields:
      - name: environment
        cliOption: env
        description: "Endevor environment (e.g. DEV, PRD). Wildcards supported."
      - name: stageNumber
        cliOption: sn
        default: "*"              # wildcard default — means "all"
        description: "Stage number (1 or 2)."
      - name: system
        cliOption: sys
        description: "Endevor system (e.g. SYS1). Wildcards supported."
      - name: subsystem
        cliOption: sub
        default: "*"
        description: "Endevor subsystem. Wildcards supported."
      - name: type
        cliOption: typ
        default: "*"
        description: "Element type (e.g. COBPGM, COPYBOOK). Wildcards supported."
      - name: maxrc
        cliOption: maxrc
        default: "8"
        description: "Maximum return code for a successful action."
```

**Key rules for profiles:**

- `isUsername: true` tells the bridge which field to use for the `user@host` password key.
- `default` values are injected into CLI args even when the model omits the field. Use `"*"`
  for wildcard-style defaults that mean "all".
- `required: true` on a field means the profile record must have a value for it.
- For fields that conflict with a specific tool (e.g. `--instance` is not accepted by
  `list instances`), use `excludeConnectionFields` on that tool (see §4.3).

### 4.2 Tool Definitions

Each tool entry maps one CLI command to one MCP tool. Start with `cli:` descriptions
(from the `$.path` references into the commands YAML). The `optimized:` variant is
generated in Step 6.

> **Endevor example — tool names, CLI commands, and parameter names differ per plugin.**

```yaml
tools:
  - toolName: endevorListElements   # camelCase; becomes the MCP tool name
    zoweCommand: endevor list elements
    readOnlyHint: true              # skip VS Code confirmation dialog
    locationParams: true            # inject all location profile fields into schema
    descriptions:
      cli: "$.endevor.list.elements.description"
      # optimized: will be generated by rephrase-tool-descriptions.mjs in Step 6
    params:
      - name: element
        cliPositional: true
        description: "$.endevor.list.elements.positionals.element"
        default: "*"
      - name: data
        cliOption: dat
        default: "BAS"
        description: "$.endevor.list.elements.options.data"
```

**Tool definition reference:**

| Field | Purpose |
| --- | --- |
| `toolName` | MCP tool name — camelCase, prefix with plugin name |
| `zoweCommand` | The full `zowe ...` subcommand string (without --rfj) |
| `readOnlyHint` | `true` for read-only tools (no VS Code confirmation prompt) |
| `locationParams: true` | Inject all location profile fields (all fields with their defaults) |
| `locationParams: [field, ...]` | Inject only listed location fields |
| `outputPath: stdout` | Tool returns CLI's stdout as content (for print/view commands) |
| `pagination: list` | Add offset/limit params and paginate the JSON array result |
| `pagination: content` | Add startLine/lineCount params and window the stdout text |
| `pagination: false` | Opt out of auto-pagination for this tool |
| `excludeConnectionFields: [...]` | Do not pass these connection profile fields to this tool |
| `valueMap` on a param | Translate friendly names to CLI codes (see §4.4) |
| `required: true` on a param | The model must provide this parameter |
| `cliPositional: true` | Pass as a positional argument (not `--option value`) |
| `fatalOnCliError: false` | CLI failures are retryable execution errors (not stop-the-LLM config errors) |

**`fatalOnCliError: false`** — set this on tools where the LLM may send invalid input
(e.g. SQL syntax errors, wrong element names) that it can correct and retry. By default
(`fatalOnCliError: true`), any CLI failure triggers a "FATAL CONFIGURATION ERROR" with
`stop: true`, which halts the LLM. For database query tools (`db2ExecuteSql`,
`db2CallProcedure`) this is too aggressive — a bad SQL statement should be retryable.

### 4.3 Special Cases

**`outputPath: stdout`** — for commands that print free-form text (source code, SCL,
listings). The tool captures stdout instead of the `--rfj` data field.

> **Endevor example.**

```yaml
  - toolName: endevorPrintElement
    zoweCommand: endevor print element
    readOnlyHint: true
    locationParams: true
    outputPath: stdout
    descriptions:
      cli: "$.endevor.print.element.description"
    params:
      - name: element
        cliPositional: true
        required: true
        description: "$.endevor.print.element.positionals.element"
      - name: printType
        cliOption: print
        description: "$.endevor.print.element.options.print"
```

**`excludeConnectionFields`** — for commands that don't accept all connection options:

```yaml
  - toolName: endevorListInstances
    zoweCommand: endevor list instances
    readOnlyHint: true
    pagination: false
    excludeConnectionFields:
      - instance              # zowe endevor list instances has no --instance flag
    descriptions:
      cli: "$.endevor.list.instances.description"
```

**`pagination: false`** — for small-result commands where pagination would be noise:

```yaml
  - toolName: endevorListEnvironments
    zoweCommand: endevor list environments
    readOnlyHint: true
    pagination: false             # typically ≤ 20 environments
    descriptions:
      cli: "$.endevor.list.environments.description"
```

### 4.4 The `valueMap` Feature

When a CLI option uses codes that are opaque to an LLM, map friendly names to codes. The
model passes the friendly name; the bridge translates to the CLI code before invocation.

> **Endevor example** — Endevor Web Services uses 2-letter search-scope codes.

```yaml
      - name: searchIn
        cliOption: search-in
        valueMap:
          source: ES          # model passes "source"; CLI receives "--search-in ES"
          history: EH
          changes: EC
          summary: EU
          componentSource: CS
        description: >-
          Where to search: source (default) = element source content;
          history = all action history records; changes = delta changes only.
```

### 4.5 Plugin-Level Pagination Defaults

```yaml
pagination:
  list:
    defaultLimit: 200       # items per page when model doesn't specify
    maxLimit: 1000          # hard ceiling per page
    maxResults: 5000        # elicit if total would exceed this
    applyToPattern:
      - "*List*"            # auto-apply list pagination to matching tool names
      - "*QueryComponents*"
  content:
    defaultLineCount: 1000  # lines per window
    # applyToStdout: true   # auto-apply content windowing to tools with outputPath: stdout
```

A tool can override with `pagination: list`, `pagination: content`, `pagination: false`, or a
full object.

---

## Step 5 \[AI + USER\]: Smoke-Test the Tools

Build and start the server with your plugin, using the connection info provided in Step 2:

```bash
npm run build

# Point to your vendor plugins directory, using the connection info from Step 2
npx @zowe/mcp-server --stdio --mock ./zowe-mcp-mock-data \
  --cli-plugins-dir vendor/<yourname>/cli-bridge-plugins \
  --cli-plugin-enable <plugin> \
  --cli-plugin-configuration <plugin>=/tmp/<plugin>-conn.json

# Quick call-tool smoke test
npx @zowe/mcp-server call-tool \
  --cli-plugins-dir vendor/<yourname>/cli-bridge-plugins \
  <pluginListTool>
```

The connection file uses the details from Step 2:

> **Endevor example — substitute with your plugin's profile fields and real connection values.**

```json
{
  "connection": {
    "profiles": [{
      "id": "my-server",
      "host": "endevor.example.com",
      "port": 8080,
      "user": "MYUSER",
      "protocol": "https",
      "basePath": "EndevorService/api/v2",
      "instance": "ENDEVOR"
    }],
    "default": "my-server"
  }
}
```

The password is never in the file. Set it as an environment variable:

```bash
# Pattern: ZOWE_MCP_PASSWORD_<USER>_<HOST>  (uppercase, dots and colons → underscores)
export ZOWE_MCP_PASSWORD_MYUSER_ENDEVOR_EXAMPLE_COM=mysecret
```

Verify that:

- All expected tools are registered (`getContext` lists them)
- A simple list call returns JSON matching the CLI's `--rfj` output
- Pagination works on a result set large enough to trigger it

---

## Step 6 \[AI\]: Optimize Descriptions with AI

The `cli` variant (raw CLI help text) is functional but rarely optimal for LLMs. The
`optimized` variant, generated by **gemini-3.1-pro**, consistently scores **5–12 percentage
points higher** on stress questions (ambiguous prompts, multi-step workflows).

### Generate Optimized Descriptions

Use `gemini-3.1-pro` for the highest-quality rewrites. Keep `gemini-2.5-flash` for running
evals (faster and cheaper at scale).

```bash
# Requires evals.config.json at repo root — see Appendix for configuration
node scripts/rephrase-tool-descriptions.mjs \
  --yaml vendor/<yourname>/cli-bridge-plugins/<plugin>-tools.yaml \
  --model gemini-3.1-pro \
  --variant optimized \
  --source cli
```

The script:

1. Reads each tool's `cli` description (resolved from `$.path` references)
2. Sends it to gemini-3.1-pro with a prompt asking for a clear, agent-oriented rewrite
3. Validates the output ends with sentence punctuation (retries once if truncated)
4. Writes `descriptions.optimized` back into the YAML

To regenerate a single tool without touching the rest:

```bash
node scripts/rephrase-tool-descriptions.mjs \
  --yaml vendor/<yourname>/cli-bridge-plugins/<plugin>-tools.yaml \
  --tool <toolName> \
  --model gemini-3.1-pro
```

After generation, set `activeDescription: optimized` at the plugin root:

```yaml
plugin: endevor
displayName: Endevor
activeDescription: optimized   # activate the generated descriptions
```

### What Makes a Good Tool Description

Review the generated descriptions against these criteria before accepting them:

- **First sentence must stand alone** — it appears in the tools table and in Copilot's tool
  picker. Start with what the tool does, not with who should use it.
- **Explain domain vocabulary** — abbreviations and codes the model may not know (e.g.
  "COBPGM (COBOL program element type)", "CCID (Change Control ID — a ticket/work-order
  number)"). Always expand on first use.
- **List key filtering parameters inline** — "Use `whereCcidLastAct` to filter by ticket;
  `whereProcGroup` to filter by processor group." This prevents the model from guessing.
- **Say what NOT to expect** — "Results are element names — to read source content use
  `<printTool>`." Prevents the model from calling the wrong follow-up tool.
- **For location-context tools**: state that location defaults to the active context set by
  the Set tool. Without this, the model may call the Set tool unnecessarily before every call.

If the generated text misses a nuance, edit it directly in the YAML. The script writes to
`descriptions.optimized` only; the `cli` source is preserved.

---

## Step 7 \[AI + USER\]: Build and Run Evaluations

Evals are **mandatory**. They are the only objective measure of whether the tools work for
real users.

### Directory Structure

```text
vendor/<yourname>/
  cli-bridge-plugins/
    <plugin>-tools.yaml
    <plugin>-commands.yaml
  eval-questions/
    <plugin>.yaml              # standard questions (10 q, use-case coverage)
    <plugin>-stress.yaml       # harder questions (ambiguous, multi-step, exact counts)
    <plugin>-search.yaml       # search-specific (if applicable)
    <plugin>-pagination.yaml   # pagination tests (if applicable)
  e2e-tests/
    mock-<plugin>-stdio.e2e.test.ts
  docs/
    mcp-reference-vendor.md
```

### 7.1 Create the Standard Question Set

The standard set validates that a model reliably calls the correct tool with the correct
arguments for your use cases. Paste the question drafts from Step 3 here. Aim for
**10 questions**, **5 repetitions**, **minSuccessRate: 0.7**.

> **Endevor example — replace prompts, tool names, args, and mock data with your plugin.**

```yaml
# vendor/broadcom/eval-questions/endevor.yaml
config:
  name: endevor
  repetitions: 5
  minSuccessRate: 0.7
  mockServers:
    - name: endevor-ews
      cliScript: "${ZOWE_MCP_MOCK_EWS_DIR}/dist/cli/index.js"
      initArgs: "init ENDEVOR --output {dataDir}"
      serveArgs: "serve --port ${availablePort}"
      pluginName: endevor

questions:
  # Discovery
  - id: list-environments
    prompt: List all Endevor environments.
    assertions:
      - toolCall:
          tool: endevorListEnvironments
      - answerContains:
          pattern: "DEV|PRD"

  # Read content
  - id: print-element
    prompt: >
      Show me the source code of PROG01 (type COBPGM) in DEV environment,
      stage 1, system SYS1, subsystem SUB1.
    assertions:
      - toolCall:
          tool: endevorPrintElement
          args:
            element: PROG01
            type: COBPGM
      - answerContains:
          pattern: "PROG01|PROGRAM-ID|IDENTIFICATION DIVISION"

  # Multi-step workflow
  - id: context-then-list
    prompt: >
      Set up the Endevor context for DEV, stage 1, SYS1, SUB1,
      then list all COBPGM elements.
    assertions:
      - toolCallOrder:
          - tool: endevorSetLocation
          - tool: endevorListElements
      - answerContains:
          pattern: "PROG0[1-5]"
```

### 7.2 The Three Assertion Types

| Assertion | Syntax | Use for |
| --- | --- | --- |
| `toolCall` | `tool:`, optional `args:`, `count:`, `minCount:` | Verify a specific tool was called with specific args |
| `toolCallOrder` | Array of `{tool, args}` steps | Verify a multi-step workflow happened in order |
| `answerContains` | `substring:` or `pattern:` (regex) | Verify the final answer mentions expected data |

The `args` field in `toolCall` checks that the model passed correct argument values. Omit it
to check only that the tool was called at all.

### 7.3 Create the Stress Question Set

The stress set validates robustness under harder, more realistic prompts. Use ambiguous
phrasing, cross-environment comparisons, exact counts, multi-step flows, and domain
vocabulary that a real user would type.

> **Endevor example — adapt question wording and assertions to your plugin's domain.**

```yaml
  # Ambiguous type name (user says "COBOL programs" not "COBPGM")
  - id: ambiguous-type
    prompt: What COBOL programs are available in PRD stage 1 system SYS1 subsystem SUB1?
    assertions:
      - toolCall:
          tool: endevorListElements
          args:
            type: COBPGM

  # Exact count
  - id: count-copybooks
    prompt: Exactly how many COPYBOOK elements exist in DEV stage 1 SYS1 SUB1?
    assertions:
      - toolCall:
          tool: endevorListElements
      - answerContains:
          pattern: "\\b2\\b|two"

  # Multi-step with a specific element to print
  - id: multi-step-source
    prompt: >
      List all COBPGM elements in DEV/1/SYS1/SUB1, then show me the source of PROG03.
    assertions:
      - toolCallOrder:
          - tool: endevorListElements
          - tool: endevorPrintElement
            args:
              element: PROG03
```

### 7.4 Create the Mock Server Config

If a CLI mock server exists, configure it in the question-set YAML. The eval harness starts
and stops it automatically and allocates a free port at runtime.

```yaml
config:
  mockServers:
    - name: my-plugin-mock
      cliScript: "${MY_PLUGIN_MOCK_DIR}/dist/cli/index.js"
      initArgs: "init --output {dataDir}"
      serveArgs: "serve --port ${availablePort}"
      pluginName: myplugin    # must match the plugin YAML name
  # Reference the dynamic port in server args:
  mcpServerArgs: "--some-url http://localhost:${port:my-plugin-mock}"
```

Set the env var in `.env` at repo root:

```shell
MY_PLUGIN_MOCK_DIR=/path/to/mock-server
```

### 7.5 Evals Without a Mock Server

When no mock server exists, use a **real test system** or a **dedicated test environment**
with known, stable data. Use `${VAR}` env var syntax in the connection config — all values
must be supplied via `.env` at the repo root (no hardcoded defaults):

```yaml
config:
  name: myplugin-native
  # No mockServers block — connects to a real backend
  cliPluginConfiguration:
    myplugin:
      host: "${MY_PLUGIN_TEST_HOST}"
      port: "${MY_PLUGIN_TEST_PORT}"
      user: "${MY_PLUGIN_TEST_USER}"
      # Plugin-specific fields go here (e.g. database for Db2):
      database: "${MY_PLUGIN_DATABASE}"
```

The `cliPluginConfiguration` under each plugin name is a flat `CliPluginConnection` object with
standard fields (`host`, `port`, `user`, `password`, `protocol`, `basePath`) plus `database` (for
database-style backends) and `pluginParams` (a string map for any other plugin-specific fields).
The harness copies all these fields to the connection profile JSON.

Set all required vars in `.env` at the repo root before running evals.
Do **not** use `${VAR:-default}` syntax — hardcoded defaults risk accidentally committing
sensitive internal hostnames, ports, or credentials.

**Tradeoffs of no-mock approach:**

- Eval data can change if someone modifies the test system — keep assertions broad (regex,
  not exact strings)
- Tests are slower (real network round trips)
- Good for verifying the tools produce correct CLI invocations; harder for edge cases

**Assertion patterns — important constraints:**

- `answerContains.pattern` uses `new RegExp(pattern)` — **no inline `(?i)` flags**
  (not supported in Node.js 20). Use uppercase for known-uppercase outputs (e.g. z/OS tables),
  or write `[Ss]ome[Tt]hing` for mixed case. Do not use `(?i:...)` either.
- `toolCall.args` values: use a **plain string** (case-insensitive includes), `{ anyOf: [...] }`
  (any of the listed strings), or a number/boolean for exact match.
  `{ pattern: "..." }` is **not** supported for args — that format is silently ignored.
- Avoid overly specific assertions on exact query text when the model may phrase queries
  differently. Test for key substrings (table names, keywords) rather than whole queries.

### 7.6 Run and Interpret Results

```bash
# Single run against mock
npm run evals -- --set <yourname>/<plugin>

# Compare variants
npm run eval-compare -- \
  --set <yourname>/<plugin>,<yourname>/<plugin>-stress \
  --model gemini-2.5-flash \
  --label "after-description-improvement"

# Check scoreboard
cat docs/eval-scoreboard.md
```

**Quick failure taxonomy:**

1. Tool never called → description or tool name is misleading; rewrite or rename
2. Tool called with wrong args → parameter description is ambiguous; add examples
3. Tool called correctly, answer wrong → assertion is too strict; relax pattern/substring
4. Multi-step order wrong → description missing ordering guidance; add "Always call X before Y"

### 7.7 Reviewing Failures with the AI Coding Assistant

The report produced by `npm run evals` contains everything the AI assistant needs to diagnose
and fix failures. The workflow is: run → read report → open in Cursor → prompt → fix → re-run.

#### What the report contains

After every run, two files are written to `evals-report/`:

- **`report.md`** — summary table, per-question pass rates, metrics, tool call coverage,
  and a Q&A preview of the first run per question
- **`failures.md`** — for each failed run: the prompt, every tool call (name + arguments +
  result snippet), and the assertion that failed

The `failures.md` structure for one failed run looks like this:

```text
### context-then-list

- Prompt: Set up the Endevor context for DEV, stage 1, SYS1, SUB1, then list COBPGM elements.
- Failed runs: 3/5

#### context-then-list - Run 2/5

- Tool calls:
  1. endevorListElements
     Args: {"environment":"DEV","stageNumber":"1","system":"SYS1",...}
     Result: {"data":[...],"_result":{"count":5,"hasMore":false}}

- Error/assertion: toolCallOrder step 0: expected endevorSetLocation, got endevorListElements
```

This is the evidence you need to decide whether the description, the assertion, or the mock
data is wrong.

#### Prompting the AI assistant with failures

After `npm run evals`, open a Cursor chat and reference the failures file and the relevant
YAML files:

```text
@evals-report/failures.md @vendor/<yourname>/cli-bridge-plugins/<plugin>-tools.yaml
@vendor/<yourname>/eval-questions/<plugin>.yaml

Review the failures and tell me:
1. For each failed question: is the failure caused by a bad tool description,
   a bad assertion, or bad mock data?
2. For description problems: suggest specific changes to <plugin>-tools.yaml
3. For assertion problems: suggest specific changes to <plugin>.yaml
4. For mock data problems: describe what data is missing or wrong
```

#### Three categories of failure — and what to do

**Category 1: Description problem** — the model called the wrong tool or passed a wrong arg.

Signs in `failures.md`: wrong tool was called; correct tool called but key parameter missing
or has the wrong value.

Ask the AI assistant:

```text
The model called <toolA> instead of <toolB> for this prompt:
"<the failing prompt>"

Here is the current <toolB> description:
<paste description here>

And <toolA> description:
<paste description here>

What change to the <toolB> description would make the model choose
it over <toolA> for this kind of prompt?
```

**Category 2: Assertion problem** — the tool was called correctly but the assertion fails.

Signs in `failures.md`: tool called with the right name and arguments; the model's answer
looks correct to a human; the `assertionFailed` line says `answerContains` or `toolCall.args`.

Two sub-cases:

- *Pattern too strict*: the model answered correctly in different words; widen the regex or
  use `substring` instead of `pattern`.
- *Args type mismatch*: `stageNumber: "1"` fails when model passes `1` (integer). Use
  `{ anyOf: ["1", 1] }` or drop the assertion if it's not the focus.

Ask the AI assistant:

```text
@evals-report/failures.md @vendor/<yourname>/eval-questions/<plugin>.yaml

For the "<question-id>" question, the tool was called correctly
but the answerContains assertion failed. The model's answer was:

"<paste the model answer from the report>"

The assertion is: <paste the assertion>

Why did this fail and how should the assertion be fixed?
```

**Category 3: Mock data / test data problem** — assertion is correct but data doesn't exist.

Signs in `failures.md`: tool returns `"count": 0` or a CLI error about a missing resource;
100% failure rate across all repetitions (structural, not probabilistic).

Ask the AI assistant:

```text
@evals-report/failures.md @vendor/<yourname>/eval-questions/<plugin>-stress.yaml

The "<question-id>" question fails 5/5 every run.
The tool call result shows "count": 0 for <the queried location>.

Should I:
(a) Fix the question to ask about data that exists in the mock, or
(b) Add the missing data to the mock init parameters?

Which option causes fewer cascading changes?
```

#### Using `eval-compare` output for deeper analysis

When you have run `eval-compare` across variants (cli vs optimized), open the comparison
markdown in Cursor and ask for a root-cause table:

```text
@evals-report/<label>/comparison.md
@vendor/<yourname>/cli-bridge-plugins/<plugin>-tools.yaml
@vendor/<yourname>/eval-questions/<plugin>-stress.yaml

The comparison shows "<question-id>" fails on both variants.
The model skips <setTool> and passes the context args directly to <listTool>.

The current <listTool> description says:
"<paste relevant sentence>"

The current <setTool> description says:
"<paste relevant sentence>"

What wording change would make the model more likely to call <setTool> first?
Should I add a toolCallOrder hint, or is a description change sufficient?
```

#### The assertion vs description decision tree

```text
Is the failure rate < 30% (sporadic)?
  → Probably LLM noise. Increase repetitions to confirm.

Is the failure rate 100% across all runs?
  → Almost certainly a mock data or assertion bug. Fix the data or assertion first.

Is the same wrong tool called every time?
  → Description problem. The wrong tool is a better semantic match for the prompt.

Is the right tool called but with a consistently wrong arg?
  → Parameter description problem. Add examples or clarify the allowed values.

Is the right tool called with right args, but answer fails answerContains?
  → Assertion too strict. Widen the pattern or add alternatives.

Does the failure appear only on the stress set, not the standard set?
  → Description handles simple phrasing but breaks on domain jargon or multi-step prompts.
    Run rephrase-tool-descriptions.mjs with gemini-3.1-pro to generate a better optimized variant.
```

#### When to rewrite descriptions vs relax assertions

| Symptom | Action |
| --- | --- |
| Wrong tool selected | Rewrite the chosen tool's description to be more distinctive; add a contrast sentence to the competing tool |
| Correct tool, wrong arg value | Add concrete examples to the param's `description` field |
| Correct tool, arg missing | Add `default` to the field in the profiles YAML, or add "defaults to `*` (all)" to the description |
| Multi-step order wrong | Add to the Set tool: "Call this before any listing tool to set the default location context." |
| Answer doesn't match pattern | Widen the regex or add pipe alternatives; use `substring` instead of `pattern` for fixed strings |
| Empty results from mock | Fix the mock init parameters or change the question to use data that exists |

#### Workflow summary

```text
npm run evals -- --set <yourname>/<plugin>
      ↓
evals-report/failures.md has failures?
  No  → done for this round
  Yes → open in Cursor chat with tools YAML + question YAML
      ↓
For each failure: classify (description / assertion / mock data)
      ↓
Apply fixes (tools YAML or question YAML)
      ↓
npm run evals -- --set <yourname>/<plugin> --no-cache
      ↓
Score improved? → keep changes; run eval-compare for final comparison
Score same?     → undo description change; try assertion fix instead
Score worse?    → revert; the "fix" introduced a new problem
```

Use `--no-cache` after description changes — the cache key includes tool definitions, so
description changes automatically invalidate it. After assertion-only changes, cached LLM
results are replayed against the new assertions (faster and cheaper).

---

## Step 8 \[AI\]: Create E2E Tests

E2E tests validate the full server + CLI path in CI without an LLM. They are faster and
cheaper than evals, and should cover the happy path for each tool category.

```typescript
// vendor/<yourname>/e2e-tests/mock-<plugin>-stdio.e2e.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';

const MOCK_DIR = process.env.MY_PLUGIN_MOCK_DIR;

describe.skipIf(!MOCK_DIR || !existsSync(`${MOCK_DIR}/dist/cli/index.js`))(
  '<Plugin> CLI bridge (mock server)',
  () => {
    // start the mock server and MCP server using the test harness helpers
    // then call tools via an in-process MCP client

    it('<pluginListTool> returns expected data', async () => {
      const result = await client.callTool({ name: '<pluginListTool>', arguments: {} });
      expect(JSON.stringify(result)).toMatch(/<expected pattern>/);
    });
  }
);
```

Vitest discovers test files anywhere under `vendor/` automatically — no registration needed.

---

## Step 9 \[AI + USER\]: Generate and Review the Vendor Reference Doc

After the tools are working and evals pass, generate the vendor reference documentation.
This is the artifact that users and other developers read to understand what tools are
available and how to use them.

```bash
# Generate the vendor reference doc (builds server first, uses a temp mock backend)
npm run generate-docs
```

This writes `vendor/<yourname>/docs/mcp-reference-vendor.md`. The doc contains:

- A table of all registered tools with their first-sentence descriptions
- Per-tool parameter tables
- Profile management tools (list/set connection, list/set location)

**Review the generated doc with the user** and verify:

- **Tool descriptions are clear** to someone who has never used the plugin CLI. If a
  first sentence is opaque (e.g. "Perform element query ACM operation"), improve the
  `optimized` description in the tools YAML and re-run the script.
- **Parameter descriptions cover all required fields** with examples for non-obvious values.
- **The tool names make sense** in the context of the MCP server's naming conventions
  (camelCase, plugin prefix, verb-noun pattern).
- **Profile fields are complete** — host, port, user, protocol, basePath, and any
  plugin-specific fields (e.g. `instance` for Endevor) are documented.

If any descriptions need manual improvement after this review, update the `optimized:`
entry in the tools YAML directly, then re-run `npm run generate-docs`.

---

## Step 10: Vendor Directory Layout and AGENTS.md

The `vendor/<name>/` directory is the complete delivery unit for your plugin. It is tracked
on a vendor-specific branch and gitignored on `develop`.

```text
vendor/<yourname>/
  AGENTS.md                           # area-specific agent instructions (nested AGENTS.md)
  cli-bridge-plugins/
    <plugin>-tools.yaml               # hand-authored MCP tools YAML
    <plugin>-commands.yaml            # auto-generated CLI commands YAML
  eval-questions/
    <plugin>.yaml                     # standard question set
    <plugin>-stress.yaml              # stress question set
    <plugin>-search.yaml              # search-specific (if applicable)
    <plugin>-pagination.yaml          # pagination tests (if applicable)
  e2e-tests/
    mock-<plugin>-stdio.e2e.test.ts
  docs/
    mcp-reference-vendor.md           # auto-generated by npm run generate-docs
```

> **Naming**: Use the publisher/maintainer as the vendor directory name (e.g.
> `vendor/broadcom/` for Broadcom products like Endevor, `vendor/zowe/` for Zowe
> community plugins like `@zowe/db2-for-zowe-cli`).
>
> **Endevor example** for reference:
> `vendor/broadcom/` with `endevor-tools.yaml`, `endevor-commands.yaml`,
> `eval-questions/endevor.yaml`, `eval-questions/endevor-stress.yaml`, and
> `docs/mcp-reference-vendor.md`.
>
> **NEVER `git merge` between `develop` and a vendor branch in either direction.**
> Use `git cherry-pick` to move individual commits.

### Nested AGENTS.md

Create a `vendor/<name>/AGENTS.md` with vendor-specific context for the AI agent:

- Path of the mock server and its env var name
- Eval set names (e.g. `broadcom/endevor`, `broadcom/endevor-stress`, `zowe/db2`)
- Profile field notes (wildcard defaults, field that conflicts with a specific tool)
- Known issues and skipped tests with their reason

This supplements the root `AGENTS.md` and is loaded automatically by Cursor.

---

## Step 11: Core Framework Changes

When integrating a new plugin you may discover that the CLI bridge needs a new generic
capability. These changes belong in the **shared TypeScript code** — never in plugin-specific
code. Examples from the Endevor integration:

| Gap discovered during Endevor integration | Generic fix added to the framework |
| --- | --- |
| Some commands don't accept all connection options (e.g. `list instances` has no `--instance`) | `excludeConnectionFields` field on `PluginToolDef` |
| Endevor uses 2-letter API codes (ES, EH, EC) but users say "source", "history" | `valueMap` field on `PluginParamDef` |
| No pagination — list results can be thousands of items | `pagination: list` and `pagination: content` modes in the bridge |
| LLM error messages were generic and gave no remediation | `configSource` + `buildRemediationHint()` in `cli-tool-loader.ts` |
| Eval port was hardcoded to 8080, causing port conflicts | `serveArgs: "serve --port ${availablePort}"` in mock server config |
| CLI descriptions were verbose and LLM-hostile | `rephrase-tool-descriptions.mjs` script + `activeDescription` in YAML |
| CLI help text was scattered across web docs | `generate-cli-bridge-yaml.mjs` to extract and centralize |
| `*-commands.yaml` companion files were loaded as plugin YAMLs by auto-discovery, crashing the server | Auto-discovery in `index.ts` and `generate-docs.ts` now skips `*-commands.yaml` files |
| `call-tool` only supported Endevor via plugin-specific hardcoding | `call-tool` now supports any plugin via `--cli-plugin-configuration name=file` (YAML auto-discovered from vendor dirs) |

When you encounter a gap in a new plugin that clearly affects all plugins, open a PR against
`develop` with the generic fix. Do not embed plugin-specific code in the TypeScript source.

---

## Step 12: Plugins with Native Dependencies

Some Zowe CLI plugins require compiled native binaries (e.g. C++ addons via node-gyp).
The IBM Db2 Database Plug-in (`@zowe/db2-for-zowe-cli`) is the canonical example: it
requires `ibm_db`, which builds a native ODBC driver that only supports x86_64 on macOS.

### Metadata Extraction on ARM (Apple Silicon)

When a plugin has a native dependency that prevents loading on arm64, use this workaround
to extract the CLI commands YAML (Step 1):

```bash
# 1. Install plugin with --ignore-scripts to skip native build
npm install @zowe/db2-for-zowe-cli -g --ignore-scripts --legacy-peer-deps \
  --prefix ~/.zowe/plugins/installed \
  --registry https://zowe.jfrog.io/artifactory/api/npm/npm-release/

# Manually register in ~/.zowe/plugins/plugins.json if needed (see vendor/broadcom/AGENTS.md)

# 2. Temporarily stub the native module so definitions can load
DB2_PLUGIN=~/.zowe/plugins/installed/lib/node_modules/@zowe/db2-for-zowe-cli
cp "$DB2_PLUGIN/node_modules/ibm_db/lib/odbc.js" "$DB2_PLUGIN/node_modules/ibm_db/lib/odbc.js.bak"
cat > "$DB2_PLUGIN/node_modules/ibm_db/lib/odbc.js" << 'EOF'
module.exports = { Database: class {}, Pool: class {}, open: ()=>{}, openSync: ()=>{}, close: ()=>{} };
EOF

# 3. Extract metadata
npm run generate-cli-bridge-yaml -- --plugin db2 --output vendor/.../db2-commands.yaml

# 4. Restore original
cp "$DB2_PLUGIN/node_modules/ibm_db/lib/odbc.js.bak" "$DB2_PLUGIN/node_modules/ibm_db/lib/odbc.js"
```

### Installing the Native Build for Smoke Tests and Evals

For actually running the plugin (smoke test, evals, production), you need the native binary
built for the correct architecture. On macOS Apple Silicon, the Zowe Docs provide instructions:
<https://docs.zowe.org/v3.0.x/user-guide/cli-db2-install-m1/>

**Summary for macOS arm64:**

```bash
# One-time: add intel alias to ~/.zshrc (if not already present)
echo 'alias intel="env /usr/bin/arch -x86_64 /bin/zsh --login"' >> ~/.zshrc

# Every session that needs the plugin:
intel   # spawns x86_64 shell

# One-time under x86_64: install NVM node, fix node-gyp, install Zowe CLI + plugin
source ~/.nvm/nvm.sh
nvm install 20
npm install brace-expansion --prefix ~/    # fix broken node-gyp dependency
npm install -g @zowe/cli@zowe-v3-lts --registry https://zowe.jfrog.io/...
zowe plugins install @zowe/db2-for-zowe-cli@6.0.0 --registry https://...
```

### External License Requirements

Some plugins require runtime configuration in addition to the binary. The Db2 plugin
illustrates two distinct scenarios:

**Scenario A — `db2connectactivate` applied on the server (Broadcom internal)**:
No Db2 Connect license file is needed. However, the IBM ODBC CLI driver performs a
client-side license check during initialization that the server-side `db2connectactivate`
does NOT bypass (unlike the JDBC driver). Fix: run `db2cli writecfg add -parameter Authentication=SERVER`
once after installing the plugin. This writes `Authentication=SERVER` to
`clidriver/cfg/db2dsdriver.cfg` and is permanent. This same fix is documented in
`ibm_db/installer/ifx.sh` with the comment "to avoid SQL1042C error from security layer".

```bash
CLIDIR=~/.zowe/plugins/installed/lib/node_modules/@zowe/db2-for-zowe-cli/node_modules/ibm_db/installer/clidriver
env /usr/bin/arch -x86_64 /bin/zsh -c "$CLIDIR/bin/db2cli writecfg add -parameter Authentication=SERVER"
```

**Scenario B — no `db2connectactivate` on the server**:
You need the `db2consv.lic` or `db2connectLicense.lic` file (from IBM Db2 Connect product)
placed in the `clidriver/license/` directory. The JDBC license (`db2jcc_license_cisuz.jar`)
is incompatible with the ODBC CLI driver.

Document this clearly in the vendor `AGENTS.md` so future contributors know:

1. Which scenario applies (server-side `db2connectactivate` or client license)
2. What workaround is needed
3. How to verify: if `SQL1042C SQLSTATE=58004` persists after Authentication=SERVER, a client license is needed

### Password Env-Var Naming

The CLI bridge resolves passwords using `ZOWE_MCP_PASSWORD_<USER>_<HOST>` where `HOST`
is the `host` field in the connection profile (dots → underscores, uppercase). Make sure
the profile uses the same hostname form as your env vars. If your `.env` has:

```bash
ZOWE_MCP_PASSWORD_SAMPLE01_CA31_LVN_BROADCOM_NET=...
```

Then the connection profile must have `"host": "ca31.lvn.broadcom.net"` (not
`usilca31.lvn.broadcom.net` or `ca31`). Choose the short canonical hostname that matches
your env var naming convention and document it in the vendor `AGENTS.md`.

---

## Quick Checklist

- [ ] CLI plugin installed and `zowe <plugin> --help` tree explored
  - [ ] If plugin has native dependencies (C++ addon): use `--ignore-scripts` + stub for metadata-only install; see Step 12
  - [ ] If plugin requires a license file: document location and source in vendor `AGENTS.md`
- [ ] `npm run generate-cli-bridge-yaml` run → `<plugin>-commands.yaml` created
- [ ] User asked for connection info (host, port, user, protocol, basePath, plugin-specific fields)
- [ ] User asked for use-case context (discovery, read, search, multi-step, change management, dependency)
- [ ] Use-case table built using CLI YAML + user input
- [ ] Eval question drafts written (one per use case) using real test environment values
- [ ] `<plugin>-tools.yaml` authored with `connection` profile, location profile (if applicable), and all target tools
- [ ] `$.path` references used for `cli:` descriptions — pointing to `<plugin>-commands.yaml`
- [ ] `default` values set on location fields that should default to wildcard `"*"`
- [ ] `readOnlyHint: true` on all read-only tools
  - [ ] `outputPath: stdout` on print/view commands
  - [ ] `valueMap` used for any opaque CLI codes
  - [ ] `pagination: false` on small-result commands; `pagination: list` or auto-pattern on large-result commands
  - [ ] `fatalOnCliError: false` on tools where bad user input (SQL, parameters) should be retryable
- [ ] Password env var documented: `ZOWE_MCP_PASSWORD_<USER>_<HOST>`
- [ ] Smoke-test passes: all tools registered, list call returns expected JSON
- [ ] `rephrase-tool-descriptions.mjs` run with `--model gemini-3.1-pro`
- [ ] `activeDescription: optimized` set in plugin YAML
- [ ] Generated descriptions reviewed for clarity and domain vocabulary coverage
- [ ] Standard eval question set created (10 questions, 5 reps, minSuccessRate: 0.7)
- [ ] Stress eval question set created (ambiguous prompts, multi-step, exact counts)
- [ ] Pagination eval set created if tool results can exceed `maxLimit`
- [ ] `npm run evals -- --set <yourname>/<plugin>` passes with score ≥ 70%
- [ ] `npm run eval-compare` run for cli vs optimized variants
- [ ] Failures reviewed with AI assistant; descriptions or assertions improved
- [ ] E2E test created under `vendor/<name>/e2e-tests/`
- [ ] `npm run generate-docs` run → `vendor/<name>/docs/mcp-reference-vendor.md` generated
- [ ] Vendor reference doc reviewed with user; descriptions updated where needed
- [ ] `vendor/<name>/AGENTS.md` written with mock server path, eval set names, known issues

---

## Appendix: Description Variant Comparison Results

From Endevor evals, model: `gemini-2.5-flash`, 5 repetitions × 20 questions:

| Variant | Standard (10 q) | Stress (10 q) |
| --- | --- | --- |
| `optimized` (gemini-3.1-pro rephrase) | 100% | 70% |
| `cli` (raw help text) | 100% | 66% |

**Conclusion**: Both variants are essentially equivalent on straightforward questions.
`optimized` has a clear lead on harder questions with ambiguous phrasing or multi-step
workflows. Always run the rephrase script before shipping.

---

## Appendix: `evals.config.json` for Gemini

Configure both models — `gemini-3.1-pro` for description optimization and
`gemini-2.5-flash` for eval runs:

```json
{
  "models": [
    {
      "id": "gemini-3.1-pro",
      "provider": "google",
      "serverModel": "gemini-3.1-pro-preview",
      "apiKey": "${GOOGLE_API_KEY}"
    },
    {
      "id": "gemini-2.5-flash",
      "provider": "google",
      "serverModel": "gemini-2.5-flash-preview-04-17",
      "apiKey": "${GOOGLE_API_KEY}"
    }
  ]
}
```

Set `GOOGLE_API_KEY` in your shell or `.env` at the repo root. Use `gemini-3.1-pro` for
`rephrase-tool-descriptions.mjs` and `gemini-2.5-flash` for `npm run evals` and
`npm run eval-compare`.
