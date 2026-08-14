/*
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 *
 */

/**
 * One-time-per-profile Playwright-Electron activation dance for GitHub
 * Copilot Chat's BYOK providers.
 *
 * Ported from the empirically-verified `/tmp/vscode-e2e-activation/run-from-scratch.sh`
 * recipe:
 *   1. GitHub.copilot-chat does NOT reliably activate on `onStartupFinished`
 *      in a cold profile. The reliable trigger is running the built-in
 *      "Chat: Manage Language Models" command via the Command Palette, which
 *      fires the implicit `onLanguageModelChatProvider:copilot` activation
 *      event and causes the extension to fetch `/api/tags` from the
 *      configured BYOK endpoint (seeded into settings.json by the caller
 *      before launch — see portable-profile.ts).
 *   2. The default chat model after that is just the first entry the
 *      endpoint returned. To pin a specific model (needed for OLLAMA mode,
 *      where multiple models are installed), drive the model picker
 *      (Alt+Meta+.) with the keyboard, reading the actually-focused row via
 *      a DOM query since the accessibility tree doesn't reliably expose
 *      focus state for this widget.
 *
 * Every step captures a screenshot into `profile.dir` so failures are
 * diagnosable after the fact.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import type { PortableProfile } from './portable-profile.js';

export interface LaunchOptions {
  /** Path to the VS Code Electron binary. Defaults to VSCODE_E2E_APP env or the macOS default install location. */
  executablePath?: string;
  /** Extra CLI args appended to the launch. */
  extraArgs?: string[];
  /** Extra env vars merged on top of profile.env for this launch only. */
  extraEnv?: Record<string, string>;
}

// VS Code renamed the macOS app binary from `Electron` to `Code` in 1.132 —
// probe both so the default works across versions.
const DEFAULT_MACOS_APP_CANDIDATES = [
  '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
];

function resolveExecutablePath(opts: LaunchOptions): string {
  return (
    opts.executablePath ??
    process.env.VSCODE_E2E_APP ??
    DEFAULT_MACOS_APP_CANDIDATES.find(p => fs.existsSync(p)) ??
    DEFAULT_MACOS_APP_CANDIDATES[0]
  );
}

let screenshotCounter = 0;

/** Take a numbered screenshot into the profile's scratch dir; never throws. */
export async function screenshot(
  profile: PortableProfile,
  page: Page,
  label: string
): Promise<void> {
  screenshotCounter += 1;
  const file = path.join(
    profile.dir,
    `shot-${String(screenshotCounter).padStart(2, '0')}-${label}.png`
  );
  try {
    await page.screenshot({ path: file });
  } catch {
    // Screenshotting must never fail the harness itself.
  }
}

/** Launches VS Code as an isolated Electron app under Playwright, against `profile`. */
export async function launchVsCode(
  profile: PortableProfile,
  opts: LaunchOptions = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  const executablePath = resolveExecutablePath(opts);
  const args = [
    '--new-window',
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    ...(opts.extraArgs ?? []),
  ];
  const app = await electron.launch({
    executablePath,
    args,
    env: { ...profile.env, ...(opts.extraEnv ?? {}) } as Record<string, string>,
    timeout: 60_000,
  });
  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForTimeout(1000);
  return { app, page };
}

/**
 * Fires the one-time GitHub.copilot-chat activation trigger via the Command
 * Palette: F1 → "Chat: Manage Language Models" → Enter → wait for the BYOK
 * endpoint fetch → Escape. Keyboard-only, per the harness's Playwright
 * automation guidance.
 */
export async function triggerCopilotChatActivation(
  profile: PortableProfile,
  page: Page
): Promise<void> {
  await screenshot(profile, page, 'before-activation');
  // On a cold CI runner the workbench can take much longer than locally to
  // accept keyboard input; a fire-and-forget palette invocation silently
  // no-ops (observed: chat panel still on its welcome state, extension never
  // activated). Wait for the workbench, then retry until the Language Models
  // editor is actually visible.
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });
  const opened = page.locator('.quick-input-widget, .monaco-editor').first(); // presence used only as a readiness hint before first attempt
  await opened.waitFor({ state: 'attached', timeout: 30_000 }).catch(() => undefined);

  const editorMarker = page.getByText('Install Model Providers', { exact: false }).first();
  let activated = false;
  for (let attempt = 1; attempt <= 5 && !activated; attempt++) {
    await page.keyboard.press('F1');
    await page.waitForTimeout(750);
    await page.keyboard.type('Manage Language Models', { delay: 30 });
    await page.waitForTimeout(750);
    await page.keyboard.press('Enter');
    // Poll for the Language Models editor; its appearance implies the
    // onLanguageModelChatProvider activation fired and the BYOK provider is
    // fetching /api/tags from the configured endpoint.
    try {
      await editorMarker.waitFor({ state: 'visible', timeout: 15_000 });
      activated = true;
    } catch {
      await screenshot(profile, page, `manage-models-retry-${String(attempt)}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }
  }
  // Give the BYOK provider time to finish fetching and registering models.
  await page.waitForTimeout(6000);
  await screenshot(profile, page, 'after-manage-models');
  if (!activated) {
    throw new Error(
      'Language Models editor did not open after 5 command-palette attempts — copilot-chat activation trigger failed'
    );
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

/**
 * Drives the chat input's model picker (Alt+Meta+.) with the keyboard to
 * pin a specific model as the sticky default for this profile — needed for
 * OLLAMA mode where several models are registered and the arbitrary first
 * one is not the one we want to test against. Not required for FAKE mode
 * (the fake server registers exactly one model, which is already default).
 *
 * `rowMatch` is matched (case-insensitively) against the focused row's text
 * content in the "Other Models" flyout.
 */
export async function pinChatModel(
  profile: PortableProfile,
  page: Page,
  rowMatch: string | RegExp,
  opts: { maxSteps?: number } = {}
): Promise<boolean> {
  const pattern = typeof rowMatch === 'string' ? new RegExp(rowMatch, 'i') : rowMatch;
  const maxSteps = opts.maxSteps ?? 25;

  // Click the real chat input Monaco editor: a role=textbox element that is
  // NOT the hidden accessibility-helper textbox (whose aria-label mentions
  // "not accessible").
  const input = page.locator('[role="textbox"]:not([aria-label*="not accessible"])').first();
  try {
    await input.click({ timeout: 5000 });
  } catch {
    // If the chat input isn't visible/focusable, the picker shortcut below
    // will simply no-op; caller should treat a `false` return as "could not pin".
  }
  await page.waitForTimeout(500);
  await screenshot(profile, page, 'before-model-picker');

  await page.keyboard.press('Alt+Meta+.');
  await page.waitForTimeout(800);
  await page.keyboard.press('ArrowDown'); // highlight "Other Models"
  await page.keyboard.press('Enter'); // expand it
  await page.waitForTimeout(800);
  await screenshot(profile, page, 'model-picker-expanded');

  let picked = false;
  for (let i = 0; i < maxSteps; i += 1) {
    const rowText = await page
      .evaluate(
        () => document.querySelector('.action-widget .monaco-list-row.focused')?.textContent ?? ''
      )
      .catch(() => '');
    if (pattern.test(rowText)) {
      picked = true;
      break;
    }
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(250);
  }

  if (picked) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    await screenshot(profile, page, 'model-picked');
  } else {
    await page.keyboard.press('Escape');
    await screenshot(profile, page, 'model-picker-not-found');
  }
  return picked;
}

/**
 * Answers a VS Code password input box (SecretStorage-backed credential
 * prompt) if one is currently visible — used for the mock z/OS SSH scenario
 * when SSH key auth isn't wired up and the extension falls back to asking
 * for a password. One-time per profile (SecretStorage persists it). Returns
 * true if a prompt was found and answered.
 */
export async function answerPasswordPromptIfPresent(
  profile: PortableProfile,
  page: Page,
  password: string,
  opts: { timeoutMs?: number } = {}
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const input = page.locator('.quick-input-widget input[type="password"]').first();
  try {
    await input.waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    return false;
  }
  await screenshot(profile, page, 'password-prompt');
  await input.fill(password);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await screenshot(profile, page, 'password-prompt-answered');
  return true;
}

/** Closes the Electron app; tolerates it already being gone. */
export async function closeVsCode(app: ElectronApplication): Promise<void> {
  try {
    await app.close();
  } catch {
    // already closed / crashed — fine, killProfileProcesses cleans up leftovers.
  }
}
