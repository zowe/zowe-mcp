# Contributing to Zowe MCP

This document is for people who change Zowe MCP: its code, tests, or
documentation. To use Zowe MCP, start with the [README](README.md). To run it
as a shared server, see the [remote server guide](docs/remote-mcp-server.md).

## Development setup

You need [Node.js](https://nodejs.org) 24, the version in `.nvmrc` that CI
uses, and git.

```bash
git clone https://github.com/zowe/zowe-mcp.git
cd zowe-mcp

# 1. Stage the pinned Zowe Remote SSH SDK. It is not committed to the repository.
node scripts/sdk-switch.js pin --no-install

# 2. Install dependencies
npm install

# 3. Build all packages
npm run build
```

- Step 1 must come first. Without it, `npm install` fails because the SDK
  package file that the server depends on is missing.
- `npm install` also configures a git hook that adds the `Signed-off-by` line
  to your commits. See [DCO sign-off](#dco-sign-off). It downloads the VS Code
  API type definitions as well, so it needs internet access.
- The built server is `packages/zowe-mcp-server/dist/index.js`. Inside the
  clone, `npx @zowe/mcp-server` runs the same file.

### Run your build

```bash
# Create mock data and call a tool from the command line
npx @zowe/mcp-server init-mock --output ./zowe-mcp-mock-data --preset minimal
npx @zowe/mcp-server call-tool --mock=./zowe-mcp-mock-data listDatasets dsnPattern='USER.**'

# Explore the tools in the MCP Inspector
npm run inspector:mock
```

To use your build from an MCP client, set the client's `command` to `node` and
the first argument to the absolute path of
`packages/zowe-mcp-server/dist/index.js`. The other arguments are the same as
in the [standalone server guide](docs/standalone-mcp.md).

To install your build of the VS Code extension, run `npm run build-and-install`.
Set `VSCODE_CLONE=cursor` to install into Cursor instead.

### Test without a mainframe

| Tool | Use it to test |
| --- | --- |
| [Mock mode](docs/mock-mode.md) (`--mock`) | Tools and prompts against sample files. This is the fastest option. |
| [Mock z/OS host](docs/mock-zos-host.md) (`mock-zos`) | The SSH path: authentication, deployment of the z/OS component, and the Zowe Remote SSH protocol. |

### Build the release files

```bash
npm run pack:server          # zowe-mcp-server-<version>.tgz in the repository root
npm run build-and-install    # builds the VSIX and installs it in VS Code
```

### Use another Zowe Remote SSH SDK build

The server depends on `@zowe/zowex-for-zowe-sdk` from the
[zowex](https://github.com/zowe/zowex) project. `resources/zowex-pin.json`
names the tested build. To try another build, run one of these commands and
then rebuild:

| Command | SDK build |
| --- | --- |
| `node scripts/sdk-switch.js pin` | The pinned build |
| `npm run sdk:nightly` | The latest nightly build |
| `npm run sdk:pr -- <number>` | The build of a zowex pull request |
| `npm run sdk:branch -- <branch>` | The latest build of a zowex branch |
| `npm run sdk:local -- <path>` | A local package file or zowex clone |

## Validate your change

Run the checks that apply to your change before you open or update a pull
request:

```bash
npm run check-format    # Prettier and shfmt
npm run lint:md         # Markdown
npm run typecheck
npm run lint            # ESLint, including license headers
npm test                # server tests
npm run test:vscode     # VS Code extension tests; opens a VS Code window
```

- If `npm test` stalls on your machine, run
  `npm test -- --no-file-parallelism`. To run one file, use
  `npx vitest run <file>` in `packages/zowe-mcp-server`.
- After you change a tool, prompt, or resource definition, run
  `npm run generate-docs` and commit the updated
  [MCP reference](docs/mcp-reference.md). CI fails when the reference is out of
  date.
- `npm run format` and `npm run lint:fix` fix most formatting and lint
  findings.

The `package.json` files list all scripts.

## Pull requests

A pull request must:

- Explain its purpose and how it was tested
- Include the [AI usage disclosure](#ai-usage-disclosure)
- Follow the [evaluation policy](#evaluation-policy) when it changes what an
  AI assistant sees: tools, prompts, descriptions, or parameters
- Identify dependencies on unmerged changes in this or another repository
- Add an entry under **Unreleased** in the root `CHANGELOG.md` when users can
  notice the change. Otherwise, ask a maintainer to add the `no-changelog`
  label.

### Required checks

Pull requests to `main` need one approval from a code owner and these checks:

| Check | What it covers |
| --- | --- |
| `ci-ok` | Formatting, lint, type check, duplication, tests on Linux, Windows, and macOS, packaging, offline installation, and the generated MCP reference |
| `audit` | Known vulnerabilities in production dependencies |
| `gitleaks` | Secrets in the change |
| `headers` | EPL-2.0 license header on every `.ts` file |
| `Analyze (javascript-typescript)` | CodeQL static analysis |
| `DCO` | Sign-off on every commit |
| `changelog` | A `CHANGELOG.md` entry or the `no-changelog` label |

Run `npm run audit:prod` to reproduce the `audit` check. Its only exception is
**GHSA-vfj7-8cjw-p6xm** in `braces`, which is reached through
`@zowe/imperative` and has no patched version. The exception expires after
**2026-12-10**. Changes to the exceptions need a code-owner review.

## AI usage disclosure

We welcome contributions made with AI coding assistants. Every pull request
must state in its description how AI was used:

- **Tool**: the AI assistant, such as Cursor, GitHub Copilot, or Claude Code
- **Model**: the exact model ID, such as `claude-sonnet-4-5` or `gpt-4.1`, not
  only the vendor name
- **Scope**: which parts were AI-assisted and which were written by hand
- **Review**: how the generated work was reviewed
- **Verified**: what was tested or run, and what was not

If no AI was used, say so.

Example:

```markdown
### AI Usage Disclosure

- **Tool**: Cursor (Agent mode)
- **Model**: claude-sonnet-4-5
- **Scope**: All code changes were AI-generated; test cases were reviewed
  and adjusted manually
- **Review**: Manual review of the full diff
- **Verified**: `npm test` and `npm run lint` pass; not run against real z/OS
```

The rules for AI agents that work in this repository are in
[AGENTS.md](AGENTS.md).

## DCO sign-off

Every commit must include a
[Developer Certificate of Origin](https://developercertificate.org) sign-off.
The git hook from `npm install` adds it. Without the hook, use `-s`:

```bash
git commit -s -m "Add USS file search"
```

The sign-off email must match the commit author email.

To sign off commits that you already made, rewrite them:

```bash
git rebase --exec 'git commit --amend --no-edit --signoff' -i <base-commit>
```

Use the commit immediately before the first unsigned commit as `<base-commit>`.

## Evaluation policy

Changes that can affect how an AI assistant selects or calls MCP tools must be
validated with the evaluation harness.

- New tools, prompts, and significant AI-facing features need new or updated
  evaluation questions and a baseline result in `docs/eval-scoreboard.md`.
- Changes that are intended to improve tool descriptions, parameter names,
  prompts, or other model behavior need before-and-after results.
- The after result must maintain or improve the pass rates. Explain any
  accepted regression in the pull request.

See the [evaluation harness README](packages/zowe-mcp-evals/README.md) for the
question format and commands.

## Dependencies and licensing

Dependencies must be compatible with the Eclipse Public License 2.0. Add or
update dependencies with npm instead of editing resolved versions by hand, and
follow the existing version-range conventions:

- Use `^` when updates within the same major version are acceptable.
- Use `~` when updates should remain within the same minor version.

See the Zowe guidance for
[license and copyright requirements](https://github.com/zowe/community/blob/master/Technical-Steering-Committee/best-practices/license-copyright.md).

## More documentation for contributors

| Topic | Document |
| --- | --- |
| Rules for code changes, written for AI agents and useful for people | [AGENTS.md](AGENTS.md) |
| Add a Zowe CLI plug-in as MCP tools | [How to add a CLI plug-in](docs/how-to-add-cli-plugin.md) |
| Manual test checklist for the VS Code extension | [Manual QA](docs/manual-qa.md) |
| Automated VS Code and Copilot end-to-end tests | [End-to-end tests](packages/zowe-mcp-e2e/README.md) |
| Release procedure | [RELEASING.md](RELEASING.md) |

## Reporting security issues

Do not report security vulnerabilities in public issues. Email
<zowe-security@lists.openmainframeproject.org>. The security group will
acknowledge the report and coordinate remediation.
