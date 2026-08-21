# Contribution Guidelines

This document defines the policies that apply to contributions to Zowe MCP.

## AI Usage Disclosure

Every pull request must include an **AI Usage** section that states:

- The AI assistant and model used
- Which parts of the change were AI-assisted
- How the generated work was reviewed and validated

If no AI was used, state that explicitly.

Example:

```markdown
## AI Usage

- **Tool and model:** Cursor with Claude Sonnet 4.5
- **Scope:** Implementation and initial tests
- **Review:** Manually reviewed the diff and ran the relevant checks
```

## DCO Sign-off

Every commit must include a Developer Certificate of Origin sign-off. Use
`-s` or `--signoff` when committing:

```bash
git commit -s -m "Add USS file search"
```

The sign-off email must match the commit author email.

### What to do if you forgot to sign off on a commit

Rewrite the affected commits with:

```bash
git rebase --exec 'git commit --amend --no-edit --signoff' -i <base-commit>
```

Use the commit immediately before the first unsigned commit as `<base-commit>`.

## Pull Requests

A pull request must:

- Explain its purpose and implementation clearly
- Explain how the change was tested
- Pass the repository's required checks
- Follow the AI usage disclosure policy above
- Follow the evaluation policy below when it changes LLM-facing behavior
- Identify dependencies on unmerged changes in this or another repository
- Receive the approvals required by repository branch protection

Record user-facing changes under **Unreleased** in the root `CHANGELOG.md`.
Use the `no-changelog` label for changes that do not need an entry, such as
internal refactoring, documentation, or CI maintenance.

## AI Evaluation Policy

Changes that can affect how an LLM selects or calls MCP tools must be validated
with the evaluation harness.

- New tools, prompts, and significant LLM-facing features require new or
  updated evaluation questions and a baseline result in
  `docs/eval-scoreboard.md`.
- Changes intended to improve tool descriptions, parameter naming, prompts, or
  other model behavior require before-and-after evaluation results.
- The after result must maintain or improve the relevant pass rates. Document
  the reason for any accepted regression in the pull request.

See [packages/zowe-mcp-evals/README.md](packages/zowe-mcp-evals/README.md) for
the evaluation format and commands.

## Dependencies and Licensing

Dependencies must be compatible with the Eclipse Public License 2.0. Add or
update dependencies through npm rather than editing resolved versions by hand.
Use the latest appropriate version and follow the repository's existing
version-range conventions:

- Use `^` when updates within the same major version are acceptable.
- Use `~` when updates should remain within the same minor version.

See the Zowe project guidance for
[license and copyright requirements](https://github.com/zowe/community/blob/master/Technical-Steering-Committee/best-practices/license-copyright.md).

## Reporting Security Issues

Do not report security vulnerabilities in public issues. Email
<zowe-security@lists.openmainframeproject.org>. The security group will
acknowledge the report and coordinate remediation.
