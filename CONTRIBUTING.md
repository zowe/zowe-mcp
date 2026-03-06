# Contribution Guidelines

This document is a living summary of conventions and best practices for
development within Zowe MCP.

- [AI-Assisted Development](#ai-assisted-development)
- [Sign All of Your Git Commits](#sign-all-of-your-git-commits)
- [Pull Request Guidelines](#pull-request-guidelines)
- [AI Evaluation Requirements](#ai-evaluation-requirements)
- [Code Style](#code-style)
- [Testing Guidelines](#testing-guidelines)
- [Dependencies](#dependencies)
- [Reporting Security Issues](#reporting-security-issues)
- [More Information](#more-information)

## AI-Assisted Development

This project embraces AI-assisted development. The vast majority of the code
has been written by AI coding assistants (primarily Cursor with Claude models)
under experienced human guidance, testing, evaluation, and automated feedback
loops.

We encourage contributors to use AI coding assistants when contributing. Your
domain expertise — mainframe experience, use cases, architectural insights, and
bug reports — is invaluable and complements AI-generated code.

### AI Usage Disclosure in Pull Requests

Every pull request must include an **AI Usage** section in the PR description
that documents how AI was used:

- **Tool**: Which AI assistant was used (e.g. Cursor, GitHub Copilot, Claude
  Code, Cline)
- **Model**: Which model(s) were used (e.g. Claude Sonnet 4, GPT-4.1)
- **Scope**: What parts of the PR were AI-assisted vs. manually written
- **Review**: How the AI-generated code was reviewed and validated

Example:

```markdown
## AI Usage
- **Tool**: Cursor (Agent mode)
- **Model**: Claude Sonnet 4
- **Scope**: All code changes were AI-generated; test cases were reviewed
  and adjusted manually
- **Review**: Ran full test suite, verified with evals, manual code review
```

## Sign All of Your Git Commits

Whenever you make a commit, it is required to be signed. If you do not, you
will have to re-write the git history to get all commits signed before they can
be merged, which can be quite a pain.

Use the `-s` or `--signoff` flags to sign a commit.

Example calls:

```bash
git commit -s -m "Add a new MCP tool for USS file operations"
git commit --signoff -m "Fix pagination in listDatasets"
```

Why? Sign-off is a line at the end of the commit message which certifies who is
the author of the commit. Its main purpose is to improve tracking of who did
what, especially with patches.

Example commit in git history:

```text
Add tests for the searchInDataset tool.

Signed-off-by: Jane Doe <jane.doe@example.com>
```

What to do if you forget to sign off on a commit?

```bash
git rebase --exec 'git commit --amend --no-edit --signoff' -i <commit-hash>
```

where `<commit-hash>` is the commit before your first unsigned commit in
history.

## Pull Request Guidelines

Consider the following when you interact with pull requests:

- Pull requests require approval from at least one maintainer before merging.
- The code in the pull request must adhere to the [Code Style](#code-style)
  guidelines.
- The code must compile/transpile and pass all tests without breaking current
  Zowe MCP functionality.
- The pull request must describe the purpose and implementation clearly enough
  for maintainers to understand what is being accomplished.
- The pull request must explain how to test the change so maintainers or QA
  teams can verify correctness.
- If a pull request depends upon a pull request from the same or another
  repository that is pending, this must be stated.
- Pull requests must include the [AI Evaluation
  Requirements](#ai-evaluation-requirements) checklist (see below).
- Pull requests must include an [AI Usage](#ai-usage-disclosure-in-pull-requests)
  section describing how AI was used.

## AI Evaluation Requirements

Zowe MCP is an AI/MCP project. Every change that affects how an LLM interacts
with MCP tools must be validated with evaluations. The project maintains 19+
eval question sets in `packages/zowe-mcp-evals/questions/` and an
[eval scoreboard](docs/eval-scoreboard.md) that tracks pass rates across
models.

### New Functionality

Every new tool, prompt, or significant feature must be accompanied by new or
updated evaluation question sets (YAML files in
`packages/zowe-mcp-evals/questions/`). New eval sets must have a **baseline**
entry in the scoreboard before the PR is merged:

```bash
npm run eval-compare -- --set <new-set> --label "baseline"
```

### Behavior Improvements

Changes that aim to improve LLM behavior (e.g. better tool descriptions,
parameter naming, prompt tuning) must run `eval-compare` before and after the
change and update `docs/eval-scoreboard.md` to demonstrate improvement for at
least one model:

```bash
# Before making the change
npm run eval-compare -- --set <relevant-sets> --label "before-<change>"

# Make the change

# After making the change
npm run eval-compare -- --set <relevant-sets> --label "after-<change>"
```

The scoreboard must show the "after" label with equal or better pass rates
compared to the "before" label.

### No Regressions Without Justification

If a change causes a pass rate drop on any existing eval set, the PR must
document why the regression is acceptable (e.g. a trade-off that improves a
more important set).

### Eval Set Conventions

Eval question sets are YAML files in `packages/zowe-mcp-evals/questions/`.
Each file defines questions with assertions. The three assertion types are:

- **toolCall** — asserts which tool(s) the LLM calls (with optional argument
  checks)
- **toolCallOrder** — asserts an ordered sequence of tool calls
- **answerContains** — asserts the LLM's text response contains a substring or
  pattern

Composites `allOf`/`anyOf` provide logical grouping. Each assertion can have an
optional `name` for failure messages. See `AGENTS.md` for the full
specification.

### Key Commands

| Command | Description |
| ------- | ----------- |
| `npm run evals -- --set <name>` | Run a single eval set |
| `npm run eval-compare -- --set <sets> --label "<label>"` | Run and record results to the scoreboard |
| `npm run eval-compare -- --set <sets> --model all --label "<label>"` | Run across all configured models |

## Code Style

The project enforces code style automatically through tooling:

- **Prettier** formats all TypeScript, JavaScript, and JSON files
  (`.prettierrc.json` + `prettier-plugin-organize-imports`)
- **ESLint** enforces type-checked rules (`typescript-eslint`
  `recommendedTypeChecked` + `stylisticTypeChecked`) and license headers
  (`eslint-plugin-headers`)
- **markdownlint-cli2** formats Markdown files
- A Cursor hook (`.cursor/hooks/format.sh`) auto-formats files after Agent and
  Tab edits

Key conventions:

- 2 spaces per indent (no tabs)
- Tool names use **camelCase** (e.g. `listDatasets`, `setSystem`)
- Avoid `any` — use `as` type assertions on `JSON.parse()` results
- Prefer `T[]` over `Array<T>`, `interface` over `type` alias, `??` over `||`
  for nullish values

### License Headers

Every `.ts` file must start with the EPL-2.0 license header. This is enforced
by `eslint-plugin-headers` via `eslint.config.mjs` and auto-fixed by
`eslint --fix`. You do not need to manually add the header — the format hook
does it for you.

### Manual Commands

```bash
npm run format        # Format all TS/JS/JSON files
npm run check-format  # Verify formatting without modifying
npm run lint          # Check all ESLint rules
npm run lint:fix      # Auto-fix ESLint issues
```

## Testing Guidelines

The project uses Vitest for MCP server tests and `@vscode/test-cli` +
`@vscode/test-electron` for VS Code extension tests.

```bash
npm test          # Run server tests (Vitest)
npm run test:all  # Run all tests (server + VS Code extension)
npm run test:vscode  # Run VS Code extension tests
```

Server tests are organized into common (parameterized across transports) and
transport-specific files. See `packages/zowe-mcp-server/__tests__/` for
examples.

For quick tool testing during development:

```bash
npx zowe-mcp-server call-tool [--mock=<dir>] [<tool-name> [key=value ...]]
```

## Dependencies

For Zowe organization repositories, all dependencies must be compatible with
the EPL-2.0 license.

When adding new dependencies, use the package manager (`npm`) to add the latest
version. Do not make up dependency versions. Pin dependencies appropriately:

- Use `^` for dependencies with the same major version
- Use `~` for dependencies with the same minor version

## Reporting Security Issues

Please direct all security issues to
<zowe-security@lists.openmainframeproject.org>. A member of the security group
will reply to acknowledge receipt of the vulnerability and coordinate
remediation.

## More Information

| For more information about ... | See: |
| ------------------------------ | ---- |
| General Zowe contribution guidelines | [Zowe Community](https://github.com/zowe/community/blob/master/README.md) |
| Zowe code style guidelines | [General Code Style](https://docs.zowe.org/stable/contribute/guidelines-code/general/) |
| Zowe license and copyright requirements | [License & Copyright](https://github.com/zowe/community/blob/master/Technical-Steering-Committee/best-practices/license-copyright.md) |
| Project architecture and patterns | [AGENTS.md](AGENTS.md) |
| MCP tools reference | [docs/mcp-reference.md](docs/mcp-reference.md) |
| Eval scoreboard | [docs/eval-scoreboard.md](docs/eval-scoreboard.md) |
