# E2E Copilot Demo Test Plan

## Goal

Create an end-to-end test that drives a real VS Code instance with GitHub
Copilot, sends a prompt ("List my datasets"), and validates that Copilot
invokes Zowe MCP tools against a real z/OS system. Screenshots are captured
at each milestone for validation and demo slides.

## Current State and Lessons Learned

### What exists (packages/zowe-mcp-e2e)

A first attempt using `vscode-extension-tester` (Selenium WebDriver) is in
place. It has:

- `prepare.ts` — downloads VS Code + ChromeDriver, installs Copilot Chat,
  launches VS Code for manual Copilot sign-in.
- `setup.ts` — installs the Zowe MCP VSIX, runs Mocha tests via ExTester.
- `copilot-demo.test.ts` — 5-step test (activate, settings, send prompt,
  wait for response, validate).
- Supporting files: `config.ts`, `settings.ts`, `screenshot.ts`, `paths.ts`.

### Why it does not work

`vscode-extension-tester` is fundamentally incompatible with persisting
Copilot authentication across runs:

1. **Settings wipe**: `browser.js` `start()` calls `fs.removeSync()` on the
   entire `settings/` directory every launch, destroying stored secrets.
2. **In-memory secret storage**: Even with `--password-store=basic` and
   `--use-mock-keychain`, the framework's cleanup removes the file-based
   secret store before each run.
3. **No persistent context**: There is no API to tell ExTester "use this
   existing user-data-dir as-is without cleaning it".

Patching `node_modules` is fragile and not a viable long-term solution.

## Industry Approaches (Research Summary)

### VS Code's own smoke tests (microsoft/vscode)

- Use **Playwright** (`@playwright/test`) with `_electron.launch()`.
- Each test suite gets a fresh `--user-data-dir` in a temp directory.
- Pass `--use-inmemory-secretstorage` — they **do not** test with real
  Copilot auth. Their chat test (`chatDisabled.test.ts`) only verifies that
  AI features can be disabled.
- Full control over launch args via `resolveElectronConfiguration()`.
- No `vscode-extension-tester` — they built their own automation layer.

### Playwright VS Code extension (microsoft/playwright-vscode)

- **Integration tests** (`tests-integration/`) use Playwright + Electron
  directly.
- Download VS Code via `@vscode/test-electron`'s `downloadAndUnzipVSCode()`.
- Launch with `_electron.launch({ executablePath, args })`.
- Each test gets a fresh temp `--user-data-dir` and `--extensions-dir`.
- Extension loaded via `--extensionDevelopmentPath`.
- **No real auth** — they test their own extension's UI, not Copilot.

### Playwright VS Code extension (unit tests)

- `tests/utils.ts` uses a **mock VS Code** (`TestController`, `VSCode`,
  `WorkspaceFolder` classes) — no real VS Code instance at all.
- Extension is instantiated directly: `new Extension(vscode, vscode.context)`.
- This is the fastest approach but tests nothing about the real UI.

### vitest-dev/vscode

- Originally attempted `vscode-extension-tester` (PR #270, closed).
- Switched to **Playwright + Electron** (`test-e2e/`).
- Same pattern: `downloadAndUnzipVSCode()` + `_electron.launch()`.

### Key takeaway

**Nobody tests with real Copilot authentication in automated E2E.**
Every project either:

- Uses in-memory secret storage (VS Code smoke tests)
- Uses fresh profiles with no auth (Playwright VS Code, vitest)
- Mocks the VS Code API entirely (Playwright VS Code unit tests)

## Recommended Approach

Replace `vscode-extension-tester` with **Playwright Electron** for full
control over the VS Code launch lifecycle. Use a two-phase approach:

### Phase 1: Prepare (manual, one-time)

Same concept as current `prepare.ts` but simplified:

1. Download VS Code via `@vscode/test-electron` `downloadAndUnzipVSCode()`.
2. Launch VS Code with `--user-data-dir=<persistent-dir>`,
   `--extensions-dir=<persistent-dir>`, `--password-store=basic`,
   `--use-mock-keychain`.
3. User manually signs into Copilot and selects model.
4. User closes VS Code. Profile persists.

### Phase 2: Test (automated, repeatable)

1. Install the Zowe MCP VSIX into the persistent `--extensions-dir` using
   the VS Code CLI (`code --install-extension <vsix>`).
2. Write `settings.json` with the z/OS connection into the persistent
   `--user-data-dir`.
3. Launch VS Code with Playwright's `_electron.launch()`, passing the same
   `--user-data-dir` and `--extensions-dir` plus
   `--password-store=basic --use-mock-keychain`.
4. **Playwright does NOT wipe the user-data-dir** — unlike
   `vscode-extension-tester`, we have full control.
5. Use Playwright's `Page` API to interact with the chat UI.
6. Take screenshots with `page.screenshot()`.
7. Close the Electron app when done.

### Architecture

```
packages/zowe-mcp-e2e/
  package.json              # devDeps: @playwright/test, @vscode/test-electron
  playwright.config.ts      # Playwright config (timeout, retries, output)
  src/
    prepare.ts              # One-time: download VS Code, launch for manual auth
    fixtures.ts             # Playwright test fixture: launch VS Code Electron
    copilot-demo.spec.ts    # The actual test (Playwright test syntax)
    config.ts               # Load native-config.json (reuse existing)
    settings.ts             # Generate settings.json (reuse existing)
```

### Key differences from current approach

| Aspect | vscode-extension-tester | Playwright Electron |
|---|---|---|
| User-data-dir | Wiped every launch | Preserved (we control launch) |
| Secret storage | Lost | Persists with `--password-store=basic` |
| DOM interaction | Selenium WebDriver | Playwright Page API |
| Screenshots | Custom via WebDriver | `page.screenshot()` (built-in) |
| Test runner | Mocha (required) | Playwright Test (built-in) |
| Page objects | Built-in (fragile) | Write our own selectors |
| Tracing | None | Built-in trace viewer |

### Test flow (copilot-demo.spec.ts)

```
test('Copilot lists datasets via Zowe MCP', async ({ page }) => {
  // 1. Wait for VS Code to load
  await page.waitForSelector('.monaco-workbench');

  // 2. Verify Zowe MCP extension activated (output channel)
  // 3. Open Copilot Chat via command palette
  // 4. Type "List my datasets" and press Enter
  // 5. Wait for response (poll for chat response elements)
  // 6. Validate response contains dataset information
  // 7. Screenshots captured at each step
});
```

### Prerequisites (same as current)

- `native-config.json` in cwd or repo root
- `ZOWE_MCP_PASSWORD_<USER>_<HOST>` or `ZOS_PASSWORD` env var
- GitHub Copilot subscription (authenticated during prepare step)
- Display available (or Xvfb for CI)

### npm scripts

```json
{
  "e2e:prepare": "npm run build -w packages/zowe-mcp-e2e && node packages/zowe-mcp-e2e/out/src/prepare.js",
  "e2e": "npm run build && npm run package -w packages/zowe-mcp-vscode && npx playwright test -w packages/zowe-mcp-e2e"
}
```

## Implementation Steps

1. **Remove** `vscode-extension-tester`, `mocha`, `chai` dependencies.
2. **Add** `@playwright/test` and `@vscode/test-electron` as devDependencies.
3. **Rewrite `prepare.ts`**: Use `downloadAndUnzipVSCode()` to get VS Code,
   then `execSync` to launch it with persistent profile flags. Remove all
   ExTester usage.
4. **Create `fixtures.ts`**: Playwright test fixture that calls
   `_electron.launch()` with the persistent user-data-dir and extensions-dir.
   Install the VSIX via CLI before launch. Expose `page` (the VS Code
   window) to tests.
5. **Rewrite `copilot-demo.test.ts` as `copilot-demo.spec.ts`**: Use
   Playwright test syntax (`test`, `expect`). Replace Selenium selectors
   with Playwright locators. Use `page.screenshot()` for captures.
6. **Keep `config.ts` and `settings.ts`** mostly unchanged (they have no
   framework dependency).
7. **Remove `.mocharc.js`** (Playwright has its own config).
8. **Add `playwright.config.ts`** with appropriate timeouts (3+ minutes for
   LLM response).
9. **Update root `package.json`** scripts.
10. **Update `.gitignore`** for Playwright artifacts (`test-results/`,
    `playwright-report/`).

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Copilot auth still lost | `--password-store=basic` + `--use-mock-keychain` + no user-data-dir wipe. Verified: VS Code stores secrets in `Local State` file inside user-data-dir with these flags. |
| Chat UI selectors break across VS Code versions | Pin VS Code version in prepare step. Use resilient selectors (multiple fallbacks). |
| Corporate proxy blocks downloads | `NODE_TLS_REJECT_UNAUTHORIZED=0` + cache VS Code/extensions across runs. |
| LLM response too slow or non-deterministic | 3-minute timeout. Loose validation (check for "dataset" or "data set" in response, not exact text). |
| CI without display | Use `xvfb-run` on Linux. Playwright supports `--headed` flag. |

## References

- [VS Code smoke tests](https://github.com/microsoft/vscode/tree/main/test/smoke) — Playwright + Electron, fresh user-data-dir, `--use-inmemory-secretstorage`
- [VS Code test automation](https://github.com/microsoft/vscode/tree/main/test/automation) — `resolveElectronConfiguration()`, `playwrightElectron.ts`
- [Playwright VS Code extension integration tests](https://github.com/microsoft/playwright-vscode/tree/main/tests-integration) — `downloadAndUnzipVSCode()` + `_electron.launch()`
- [Playwright Electron docs](https://playwright.dev/docs/api/class-electron)
- [Feature request: VS Code as Playwright target](https://github.com/microsoft/playwright/issues/22351)
- [vscode-extension-tester](https://github.com/redhat-developer/vscode-extension-tester) — what we are replacing and why
