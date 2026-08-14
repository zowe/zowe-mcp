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
 * INVESTIGATION PROTOTYPE — VS Code 1.132 Agent Host breakage (not part of
 * the regular e2e suite; run explicitly with `-t` filters against a 1.132
 * build via VSCODE_E2E_APP/VSCODE_E2E_CLI).
 *
 * E1: does seeding `"chat.agentHost.enabled": false` restore the classic
 *     (pre-1.132) `code chat` → chat panel → BYOK route?
 * E2: does submitting the prompt by typing into the chat panel with
 *     Playwright (keyboard-only) work on 1.132, `code chat` not involved?
 * E3: E2 but agent mode + filesystem mock backend — do MCP tools still get
 *     called from a panel-typed prompt?
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeVsCode,
  launchVsCode,
  screenshot,
  triggerCopilotChatActivation,
} from '../../src/activation.js';
import {
  killChatCliProcesses,
  runChatPrompt,
  waitForChatSession,
} from '../../src/chat-session.js';
import { startFakeModelServer, type FakeModelServer } from '../../src/fake-model-server.js';
import { initFilesystemMock } from '../../src/mock-backends.js';
import {
  cleanupPortableProfile,
  createPortableProfile,
  installExtension,
  resolveVsixPath,
  type PortableProfile,
} from '../../src/portable-profile.js';
import { byokOllamaSettings, zoweFilesystemMockSettings } from '../../src/vscode-settings.js';

const VSIX_PATH = resolveVsixPath();

const SUITE_TIMEOUT_MS = 240_000;

interface TestResources {
  profile?: PortableProfile;
  fakeServer?: FakeModelServer;
  mockDir?: string;
  detachedChatPids: number[];
}

/**
 * Opens the chat panel (in a specific mode, if given) and submits `prompt`
 * by typing it, keyboard-only.
 *
 * Empirically (see /tmp/zme2e-WLzF9s/shot-03-palette-open-chat.png from a
 * prior run), the 1.132 Command Palette does NOT have a "Chat: Set Chat
 * Mode" command — typing that resolves (as its top, auto-selected match) to
 * the unrelated built-in "Change Language Mode" command, which then opens a
 * dead-end "No text editor active at this time" quick pick that swallows
 * the subsequently-typed mode name. That was the actual cause of E2's
 * original locator-timeout failure: focus was left stuck in that leftover
 * quick-open widget, so the later chat-input click never found a real
 * textbox in the expected state.
 *
 * The palette DOES have mode-specific open commands though — "Chat: Open
 * Chat (Ask)" / "Chat: Open Chat (Agent)" / "Chat: Open Chat (Edit)" — so
 * mode selection is folded into the same "open chat" palette invocation
 * instead of a separate step.
 */
async function typePromptIntoChatPanel(
  profile: PortableProfile,
  page: Page,
  prompt: string,
  opts: { mode?: 'ask' | 'agent' } = {}
): Promise<void> {
  const openCommand = opts.mode
    ? `Chat: Open Chat (${opts.mode === 'ask' ? 'Ask' : 'Agent'})`
    : 'Chat: Open Chat';

  // Open (or focus) the chat view, already in the desired mode.
  await page.keyboard.press('F1');
  await page.waitForTimeout(750);
  await page.keyboard.type(openCommand, { delay: 30 });
  await page.waitForTimeout(750);
  await screenshot(profile, page, 'palette-open-chat');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  await screenshot(profile, page, 'chat-panel-opened');

  // Focus the chat input. On 1.132 (Monaco's EditContext-based input model)
  // the chat input's *only* `[role="textbox"]` element is a
  // `.native-edit-context` div whose default aria-label happens to read
  // "The editor is not accessible at this time..." — that string is generic
  // Monaco boilerplate about screen-reader mode, not a signal that this is
  // some other (non-real) helper element. Excluding it (as older harness
  // code did, modeled on a pre-EditContext VS Code build that had a
  // separate always-hidden accessibility textbox alongside a real one)
  // leaves zero matches and the click hangs until timeout. Empirically
  // verified via a debug DOM dump: exactly one `[role="textbox"]` exists at
  // this point, positioned right where the chat input renders on screen.
  const input = page.locator('[role="textbox"]').first();
  // A plain Playwright pointer click on this element is unreliable: Monaco
  // renders transient decoration `<span>` overlays
  // (`.ced-chat-session-detail-*`) directly on top of the input area that
  // intercept the synthetic pointer event even though the underlying
  // textbox is itself visible/enabled/stable — Playwright's actionability
  // retry loop for `.click()` just spins until timeout. Opening the chat
  // view via the palette's mode-specific command (e.g. "Chat: Open Chat
  // (Ask)") already focuses this same input (visible as a blinking caret in
  // screenshots even before any click), so prefer a direct DOM `.focus()`
  // and only fall back to a forced click if that didn't actually take.
  await input.evaluate(el => (el as HTMLElement).focus());
  const isFocused = await input.evaluate(el => document.activeElement === el);
  if (!isFocused) {
    await input.click({ timeout: 10_000, force: true });
  }
  await page.waitForTimeout(500);
  await page.keyboard.type(prompt, { delay: 15 });
  await screenshot(profile, page, 'prompt-typed');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  await screenshot(profile, page, 'prompt-submitted');
}

describe('VS Code 1.132 experiments', () => {
  let resources: TestResources = { detachedChatPids: [] };

  afterEach(async () => {
    if (resources.fakeServer) {
      await resources.fakeServer.close().catch(() => undefined);
    }
    killChatCliProcesses(resources.detachedChatPids);
    if (resources.profile) {
      cleanupPortableProfile(resources.profile, { removeDir: true });
    }
    if (resources.mockDir && !process.env.VSCODE_E2E_KEEP_SCRATCH) {
      fs.rmSync(resources.mockDir, { recursive: true, force: true });
    }
    resources = { detachedChatPids: [] };
  });

  it(
    'E0: code chat + byokUtilityModelDefault=mainAgent — is the utility-model error the only 1.132 blocker?',
    async () => {
      const fake = await startFakeModelServer({
        modelId: 'fake-e2e-e0',
        logFile: '/tmp/fake-model-e0.log',
      });
      resources.fakeServer = fake;

      const profile = createPortableProfile({
        settings: {
          ...byokOllamaSettings(fake.url),
          // 1.132 (copilot-chat 0.60.0): a BYOK main model now requires a
          // "utility model"; without sign-in the turn aborts with
          // "No utility model is configured for 'copilot-utility-small'...".
          // This setting redirects utility calls to the BYOK main model.
          // NB: read via getNonExtensionConfig — the BARE key, not
          // github.copilot.-prefixed.
          'chat.byokUtilityModelDefault': 'mainAgent',
        },
      });
      resources.profile = profile;

      installExtension(profile, VSIX_PATH);

      const { app, page } = await launchVsCode(profile, {
        extraArgs: ['--log', 'trace'],
      });
      await triggerCopilotChatActivation(profile, page);

      const before = new Date();
      const result = await runChatPrompt(profile, {
        mode: 'ask',
        prompt: 'Reply with exactly the word PONG',
        reuseWindow: true,
      });
      resources.detachedChatPids = result.detachedPids;

      const session = await waitForChatSession(profile, {
        newerThan: before,
        containsText: 'E2E-SENTINEL-PONG',
        timeoutMs: 120_000,
      });
      await screenshot(profile, page, 'final-response');
      await closeVsCode(app);

      const req = session.requests.find(r => r.responseText.includes('E2E-SENTINEL-PONG'));
      expect(req).toBeDefined();
      expect(req?.modelId).toContain('fake-e2e-e0');
    },
    SUITE_TIMEOUT_MS
  );

  it(
    'E1: code chat with chat.agentHost.enabled=false — classic route restored?',
    async () => {
      const fake = await startFakeModelServer({ modelId: 'fake-e2e-e1' });
      resources.fakeServer = fake;

      const profile = createPortableProfile({
        settings: {
          ...byokOllamaSettings(fake.url),
          'chat.agentHost.enabled': false,
        },
      });
      resources.profile = profile;

      installExtension(profile, VSIX_PATH);

      const { app, page } = await launchVsCode(profile);
      await triggerCopilotChatActivation(profile, page);

      const before = new Date();
      const result = await runChatPrompt(profile, {
        mode: 'ask',
        prompt: 'Reply with exactly the word PONG',
        reuseWindow: true,
      });
      resources.detachedChatPids = result.detachedPids;

      const session = await waitForChatSession(profile, {
        newerThan: before,
        containsText: 'E2E-SENTINEL-PONG',
        timeoutMs: 120_000,
      });
      await screenshot(profile, page, 'final-response');
      await closeVsCode(app);

      const req = session.requests.find(r => r.responseText.includes('E2E-SENTINEL-PONG'));
      expect(req).toBeDefined();
      expect(req?.modelId).toContain('fake-e2e-e1');
    },
    SUITE_TIMEOUT_MS
  );

  it(
    'E2: panel-typed ask prompt on 1.132 — BYOK panel route works without code chat?',
    async () => {
      const fake = await startFakeModelServer({ modelId: 'fake-e2e-e2' });
      resources.fakeServer = fake;

      const profile = createPortableProfile({ settings: byokOllamaSettings(fake.url) });
      resources.profile = profile;

      installExtension(profile, VSIX_PATH);

      const { app, page } = await launchVsCode(profile);
      await triggerCopilotChatActivation(profile, page);

      const before = new Date();
      await typePromptIntoChatPanel(profile, page, 'Reply with exactly the word PONG', {
        mode: 'ask',
      });

      const session = await waitForChatSession(profile, {
        newerThan: before,
        containsText: 'E2E-SENTINEL-PONG',
        timeoutMs: 120_000,
      });
      await screenshot(profile, page, 'final-response');
      await closeVsCode(app);

      const req = session.requests.find(r => r.responseText.includes('E2E-SENTINEL-PONG'));
      expect(req).toBeDefined();
      expect(req?.modelId).toContain('fake-e2e-e2');
    },
    SUITE_TIMEOUT_MS
  );

  it(
    'E3: panel-typed agent prompt + filesystem mock — MCP tool call still works?',
    async () => {
      const mockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zowe-mcp-e2e-fsmock-'));
      resources.mockDir = mockDir;
      initFilesystemMock(mockDir, 'default');

      const fake = await startFakeModelServer({
        modelId: 'fake-e2e-e3',
        datasetPattern: 'USER.**',
      });
      resources.fakeServer = fake;

      const profile = createPortableProfile({
        settings: {
          ...byokOllamaSettings(fake.url),
          ...zoweFilesystemMockSettings(mockDir),
        },
      });
      resources.profile = profile;

      installExtension(profile, VSIX_PATH);

      const { app, page } = await launchVsCode(profile);
      await triggerCopilotChatActivation(profile, page);

      const before = new Date();
      await typePromptIntoChatPanel(profile, page, 'List my datasets', { mode: 'agent' });

      const session = await waitForChatSession(profile, {
        newerThan: before,
        containsText: 'E2E-SENTINEL-OK',
        timeoutMs: 150_000,
      });
      await screenshot(profile, page, 'final-response');
      await closeVsCode(app);

      const req = session.requests.find(r => r.responseText.includes('E2E-SENTINEL-OK'));
      expect(req).toBeDefined();
      expect(req?.responseText).toMatch(/USER\.(DATA|SRC|JCL|LISTING|LOADLIB|TEST)/);
      expect(req?.toolInvocationParts.length).toBeGreaterThan(0);
    },
    SUITE_TIMEOUT_MS
  );
});
