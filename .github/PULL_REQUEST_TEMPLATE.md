## Description

<!-- Describe the purpose of this pull request and what it accomplishes. -->

## Changes

<!-- List the key changes made in this PR. -->

-
-
-

## Testing

<!-- Explain how to test these changes. -->

## Checklist

### General

- [ ] All commits are signed off (`git commit -s`)
- [ ] Code compiles without errors (`npm run build`)
- [ ] Tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] PR description clearly explains the purpose and implementation


### Evaluations (for MCP tool/prompt changes)

- [ ] New/updated eval questions added for new functionality
      (`packages/zowe-mcp-evals/questions/`)
- [ ] Baseline added to scoreboard for new eval sets
      (`npm run eval-compare -- --set <set> --label "baseline"`)
- [ ] `eval-compare` run for behavior changes (before/after labels in
      `docs/eval-scoreboard.md`)
- [ ] No eval regressions (or justification provided below)

### Regression Justification (if applicable)

<!-- If any eval set shows a pass rate drop, explain why it is acceptable. -->

### AI Usage Disclosure

Document how AI was used in this pull request:

- **Tool**: Which AI assistant was used (e.g. Cursor, GitHub Copilot, Claude
  Code, Cline)
- **Model**: Which model(s) were used (e.g. Claude Sonnet 4, GPT-4.1)
- **Scope**: What parts of the PR were AI-assisted vs. manually written
- **Review**: How the AI-generated code was reviewed and validated
