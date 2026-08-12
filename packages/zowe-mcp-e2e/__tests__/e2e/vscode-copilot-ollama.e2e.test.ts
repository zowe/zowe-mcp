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
 * Scenario S4: same flow as S2 (agent-mode + filesystem mock backend) but
 * against a REAL local Ollama model instead of the hermetic fake server —
 * for realism, not CI. Gated behind ZOWE_E2E_OLLAMA=1 and requires a running
 * Ollama server with a tools-capable model installed (default
 * "phi4-mini:latest" — VS Code's Ollama BYOK provider only surfaces models
 * that advertise "toolCalling" in their capabilities; vision/embedding-only
 * models are silently dropped from the picker).
 *
 * Run with: `ZOWE_E2E_OLLAMA=1 npm run e2e:ollama` (see package.json).
 *
 * Because this drives a real, non-deterministic LLM instead of the scripted
 * fake, expect this to be flakier and slower than S1-S3, and to occasionally
 * need re-runs — real models don't always call the exact right tool with
 * valid arguments on the first turn the way the scripted fake model does.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeVsCode,
  launchVsCode,
  pinChatModel,
  triggerCopilotChatActivation,
} from '../../src/activation.js';
import {
  killChatCliProcesses,
  runChatPrompt,
  waitForChatSession,
} from '../../src/chat-session.js';
import { initFilesystemMock } from '../../src/mock-backends.js';
import {
  cleanupPortableProfile,
  createPortableProfile,
  installExtension,
  type PortableProfile,
  resolveVsixPath,
} from '../../src/portable-profile.js';
import { byokOllamaSettings, zoweFilesystemMockSettings } from '../../src/vscode-settings.js';

const VSIX_PATH = resolveVsixPath();

const OLLAMA_URL = process.env.ZOWE_E2E_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.ZOWE_E2E_OLLAMA_MODEL ?? 'phi4-mini:latest';
const RUN_OLLAMA = process.env.ZOWE_E2E_OLLAMA === '1';

/** Escapes all regex metacharacters (backslash first) so a value can be embedded literally in a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SUITE_TIMEOUT_MS = 300_000;

describe.skipIf(!RUN_OLLAMA)('Copilot Chat BYOK e2e (real Ollama model)', () => {
  let profile: PortableProfile | undefined;
  let detachedChatPids: number[] = [];

  afterEach(() => {
    killChatCliProcesses(detachedChatPids);
    if (profile) {
      cleanupPortableProfile(profile, { removeDir: true });
    }
    profile = undefined;
    detachedChatPids = [];
  });

  it(
    `S4: agent-mode + filesystem mock backend against real Ollama model (${OLLAMA_MODEL})`,
    async () => {
      const mockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zowe-mcp-e2e-ollama-fsmock-'));
      initFilesystemMock(mockDir, 'default');

      profile = createPortableProfile({
        settings: {
          ...byokOllamaSettings(OLLAMA_URL),
          ...zoweFilesystemMockSettings(mockDir),
        },
      });

      installExtension(profile, VSIX_PATH);

      const { app, page } = await launchVsCode(profile);
      await triggerCopilotChatActivation(profile, page);

      const picked = await pinChatModel(
        profile,
        page,
        new RegExp(`^${escapeRegExp(OLLAMA_MODEL)}`, 'i')
      );
      expect(picked, `could not find/pin model "${OLLAMA_MODEL}" in the picker`).toBe(true);

      await closeVsCode(app);

      const before = new Date();
      const result = await runChatPrompt(profile, {
        mode: 'agent',
        prompt:
          'List my datasets using the available tool. When you get the result, include the ' +
          'exact text E2E-SENTINEL-OK followed by one of the dataset names in your final reply.',
        spawnTimeoutMs: 30_000,
      });
      detachedChatPids = result.detachedPids;

      const session = await waitForChatSession(profile, {
        newerThan: before,
        containsText: 'USER.',
        timeoutMs: 240_000,
      });

      const req = session.requests[session.requests.length - 1];
      expect(req?.toolInvocationParts.length ?? 0).toBeGreaterThan(0);
      expect(req?.responseText ?? '').toMatch(/USER\.(DATA|SRC|JCL|LISTING|LOADLIB|TEST)/);
      expect(req?.modelId).toContain(OLLAMA_MODEL);

      fs.rmSync(mockDir, { recursive: true, force: true });
    },
    SUITE_TIMEOUT_MS
  );
});
