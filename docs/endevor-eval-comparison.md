# Endevor MCP Eval Comparison: Zowe CLI Bridge vs code4z-gen-ai

## Overview

Comparative evaluation of two Endevor MCP server implementations against the same mock EWS server,
using Gemini 2.5 Flash (gemini-2.5-flash) as the LLM agent.

## Test Setup

- **Mock EWS Server**: `mock_ews_server` from code4z-gen-ai, port 8080
- **Mock Data**: `ENDEVOR` datasource, environments: DEV (stage 1), PRD (stage 1)
  - System: SYS1 → Subsystem: SUB1 → Types: COBPGM (5 elements: PROG01–PROG05), COPYBOOK (2 elements: CPYBK01–CPYBK02)
- **LLM**: Gemini 2.5 Flash
- **Repetitions**: 2 per question
- **Date**: 2026-03-25

## Results


| Question Set   | Server          | Description Variant | Score | Pass Rate |
| -------------- | --------------- | ------------------- | ----- | --------- |
| endevor        | Zowe CLI Bridge | `intent`            | 20/20 | **100%**  |
| endevor        | Zowe CLI Bridge | `cli`               | 20/20 | **100%**  |
| endevor-code4z | code4z-gen-ai   | n/a                 | 18/18 | **100%**  |


## Per-Question Breakdown

### Zowe CLI Bridge (`intent` and `cli` variants)


| Question ID                    | Prompt Summary                    | Result |
| ------------------------------ | --------------------------------- | ------ |
| list-environments              | List all Endevor environments     | ✓ 2/2  |
| list-environments-both-present | Show all environments (DEV + PRD) | ✓ 2/2  |
| list-systems-dev               | Systems in DEV stage 1            | ✓ 2/2  |
| list-subsystems                | Subsystems under DEV SYS1         | ✓ 2/2  |
| list-types                     | Element types in DEV SYS1         | ✓ 2/2  |
| list-elements-cobpgm           | List COBPGM elements              | ✓ 2/2  |
| list-elements-count            | Count COBPGM elements             | ✓ 2/2  |
| print-element                  | Show source of PROG01             | ✓ 2/2  |
| context-then-list              | SetContext then list elements     | ✓ 2/2  |
| list-copybooks                 | List COPYBOOK elements            | ✓ 2/2  |


### code4z-gen-ai TypeScript Server (tool aliases normalized)


| Question ID                    | Prompt Summary                    | Result |
| ------------------------------ | --------------------------------- | ------ |
| list-environments              | List all Endevor environments     | ✓ 2/2  |
| list-environments-both-present | Show all environments (DEV + PRD) | ✓ 2/2  |
| list-systems-dev               | Systems in DEV stage 1            | ✓ 2/2  |
| list-subsystems                | Subsystems under DEV SYS1         | ✓ 2/2  |
| list-types                     | Element types in DEV SYS1         | ✓ 2/2  |
| list-elements-cobpgm           | List COBPGM elements              | ✓ 2/2  |
| list-elements-count            | Count COBPGM elements             | ✓ 2/2  |
| print-element                  | Show source of PROG01             | ✓ 2/2  |
| list-copybooks                 | List COPYBOOK elements            | ✓ 2/2  |


## Key Findings

1. **Both servers perform equally (100%) on basic Endevor inventory and element retrieval tasks.**
2. **Description variants (`intent` vs `cli`) show no difference** on Gemini 2.5 Flash for these structured inventory questions. Both score 100%. This is because the questions are straightforward ("List COBPGM elements") and the parameter names match the prompt vocabulary well.
3. **Tool aliasing works correctly**: The code4z-gen-ai server uses `get_elements` while assertions use `endevorListElements`; the harness correctly normalizes via `toolAliases` so assertions pass.
4. **Zowe CLI Bridge advantages**:
  - Integrated into the Zowe MCP server — no separate deployment
  - Works with existing Zowe CLI profiles (no separate credentials config)
  - Supports `endevorSetContext` to reduce per-call verbosity
  - Description variants (`cli`, `intent`, `optimized`) allow A/B testing
  - Consistent response envelope with `_context`, `_result`, pagination
5. **code4z-gen-ai advantages**:
  - Richer element metadata (version, level, last update date)
  - More complete tool coverage (history, dependencies, usage, packages, ACM)
  - Direct REST API calls (no Zowe CLI subprocess overhead)
  - Better response token management (truncation at `maximumResponseTokens`)
6. **Notable behavioral differences**:
  - code4z-gen-ai uses 3 steps for the `list-copybooks` question (first call returned without filter results, retried) vs 2 steps for Zowe CLI bridge
  - Zowe CLI bridge response includes `_result` with pagination metadata; code4z-gen-ai response does not have this structure

## Technical Notes

- The Zowe CLI bridge server was started with `--endevor-`* CLI flags pointing to the mock server
- The code4z-gen-ai server was started with `--ews-url=http://localhost:8080 --ews-api=EndevorService/api/v2 --datasource=ENDEVOR --credentials=USER:PASSWORD`
- Both servers correctly handled the mock_ews_server's response format
- No failures or timeouts observed

