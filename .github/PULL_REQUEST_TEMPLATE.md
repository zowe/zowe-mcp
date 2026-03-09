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

### AI Evaluations (for MCP tool/prompt changes)

- [ ] New/updated eval questions added for new functionality
      (`packages/zowe-mcp-evals/questions/`)
- [ ] Baseline added to scoreboard for new eval sets
      (`npm run eval-compare -- --set <set> --label "baseline"`)
- [ ] `eval-compare` run for behavior changes (before/after labels in
      `docs/eval-scoreboard.md`)
- [ ] No eval regressions (or justification provided below)

### Regression Justification (if applicable)

<!-- If any eval set shows a pass rate drop, explain why it is acceptable. -->
