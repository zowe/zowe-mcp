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
 * End-to-end scenarios S1-S3: a 100%-from-scratch, fully isolated VS Code
 * profile gets the Zowe MCP extension installed from its .vsix, BYOK model
 * configured against the hermetic fake model server (`zowe-mcp-e2e`'s own
 * `startFakeModelServer`), and a chat prompt causes the model to call a
 * Zowe MCP tool whose data comes from a mock z/OS backend. Assertions read
 * the persisted chat session jsonl.
 *
 * Run with: `npm run e2e` (see package.json). Requires:
 *   - the zowe-mcp-vscode .vsix built (packages/zowe-mcp-vscode/*.vsix)
 *   - the zowe-mcp-server dist build (`npm run build -w @zowe/mcp-server`)
 *   - VS Code installed locally (path via VSCODE_E2E_APP, default macOS location)
 *
 * Sequential by design (`describe` block, no `.concurrent`) — only one
 * VS Code instance should be driven at a time.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import {
  initFilesystemMock,
  startMockZosDaemon,
  type MockZosHandle,
} from '../../src/mock-backends.js';
import {
  cleanupPortableProfile,
  createPortableProfile,
  installExtension,
  type PortableProfile,
} from '../../src/portable-profile.js';
import {
  byokOllamaSettings,
  privateKeyEnvVarName,
  zoweFilesystemMockSettings,
  zoweNativeMockZosSettings,
} from '../../src/vscode-settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VSIX_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'zowe-mcp-vscode',
  'zowe-mcp-vscode-0.10.0-dev.vsix'
);

const SUITE_TIMEOUT_MS = 240_000;

/** Tracks resources created by the current test so `afterEach` can always tear them down, even on failure/timeout. */
interface TestResources {
  profile?: PortableProfile;
  fakeServer?: FakeModelServer;
  mockZos?: MockZosHandle;
  detachedChatPids: number[];
}

describe('Copilot Chat BYOK e2e (FAKE model)', () => {
  let resources: TestResources = { detachedChatPids: [] };

  afterEach(async () => {
    if (resources.fakeServer) {
      await resources.fakeServer.close().catch(() => undefined);
    }
    if (resources.mockZos) {
      await resources.mockZos.stop().catch(() => undefined);
      // startMockZosDaemon's mockDir is a bare os.tmpdir() mkdtemp, not a
      // PortableProfile — clean it up here too, otherwise it leaks a temp
      // dir (fixtures + throwaway SSH key) per run.
      if (!process.env.VSCODE_E2E_KEEP_SCRATCH) {
        fs.rmSync(resources.mockZos.mockDir, { recursive: true, force: true });
      }
    }
    killChatCliProcesses(resources.detachedChatPids);
    if (resources.profile) {
      cleanupPortableProfile(resources.profile, { removeDir: true });
    }
    resources = { detachedChatPids: [] };
  });

  it(
    'S1: ask-mode smoke test — fresh profile, fake BYOK model, no MCP tools involved',
    async () => {
      const fake = await startFakeModelServer({ modelId: 'fake-e2e-s1' });
      resources.fakeServer = fake;

      const profile = createPortableProfile({ settings: byokOllamaSettings(fake.url) });
      resources.profile = profile;

      installExtension(profile, VSIX_PATH);

      const { app, page } = await launchVsCode(profile);
      await triggerCopilotChatActivation(profile, page);

      // Reuse the still-open Playwright window (-r): the prompt lands there,
      // so the rendered response can be screenshotted after the assertion.
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
        timeoutMs: 150_000,
      });
      await screenshot(profile, page, 'final-response');
      await closeVsCode(app);

      const req = session.requests.find(r => r.responseText.includes('E2E-SENTINEL-PONG'));
      expect(req).toBeDefined();
      expect(req?.modelId).toContain('fake-e2e-s1');
    },
    SUITE_TIMEOUT_MS
  );

  it(
    'S2: agent-mode + filesystem mock backend — model calls listDatasets, real mock data flows back',
    async () => {
      const mockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zowe-mcp-e2e-fsmock-'));
      initFilesystemMock(mockDir, 'default');

      const fake = await startFakeModelServer({
        modelId: 'fake-e2e-s2',
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
      const result = await runChatPrompt(profile, {
        mode: 'agent',
        prompt: 'List my datasets',
        reuseWindow: true,
      });
      resources.detachedChatPids = result.detachedPids;

      const session = await waitForChatSession(profile, {
        newerThan: before,
        containsText: 'E2E-SENTINEL-OK',
        timeoutMs: 150_000,
      });
      await screenshot(profile, page, 'final-response');
      await closeVsCode(app);

      const req = session.requests.find(r => r.responseText.includes('E2E-SENTINEL-OK'));
      expect(req).toBeDefined();
      expect(req?.responseText).toContain('E2E-SENTINEL-OK');
      // Proves data actually flowed from the mock filesystem backend through
      // the real listDatasets tool call into the model's final reply.
      expect(req?.responseText).toMatch(/USER\.(DATA|SRC|JCL|LISTING|LOADLIB|TEST)/);
      expect(req?.toolInvocationParts.length).toBeGreaterThan(0);

      fs.rmSync(mockDir, { recursive: true, force: true });
    },
    SUITE_TIMEOUT_MS
  );

  it(
    'S3: agent-mode + mock z/OS SSH host (zowex/native backend) — production RPC-over-SSH path',
    async () => {
      // sshKeyForUser: the VS Code-embedded MCP server does NOT read
      // ZOWE_MCP_PASSWORD_* env vars (that's standalone-CLI-only; VS Code
      // mode expects an interactive SecretStorage-backed password prompt
      // instead, which can't be answered headlessly). SSH key resolution,
      // however, reads directly from process.env regardless of mode — see
      // vscode-settings.ts's privateKeyEnvVarName doc comment — so a
      // throwaway keypair authorized on the mock host is what lets this
      // scenario avoid the password prompt entirely.
      const mockZos = await startMockZosDaemon({ logLevel: 'info', sshKeyForUser: 'USER1' });
      resources.mockZos = mockZos;

      const fake = await startFakeModelServer({
        modelId: 'fake-e2e-s3',
        datasetPattern: 'USER1.**',
      });
      resources.fakeServer = fake;

      const connSpec = `USER1@${mockZos.host}:${mockZos.port}`;
      const profile = createPortableProfile({
        settings: {
          ...byokOllamaSettings(fake.url),
          ...zoweNativeMockZosSettings([connSpec]),
        },
        extraEnv: {
          [privateKeyEnvVarName('USER1', mockZos.host)]: mockZos.sshKey!.privateKeyPath,
        },
      });
      resources.profile = profile;

      installExtension(profile, VSIX_PATH);

      const { app, page } = await launchVsCode(profile);
      await triggerCopilotChatActivation(profile, page);

      const before = new Date();
      const result = await runChatPrompt(profile, {
        mode: 'agent',
        prompt: 'List my datasets',
        reuseWindow: true,
      });
      resources.detachedChatPids = result.detachedPids;

      const session = await waitForChatSession(profile, {
        newerThan: before,
        containsText: 'E2E-SENTINEL-OK',
        timeoutMs: 150_000,
      });
      await screenshot(profile, page, 'final-response');
      await closeVsCode(app);

      const req = session.requests.find(r => r.responseText.includes('E2E-SENTINEL-OK'));
      expect(req).toBeDefined();
      // USER1.NOTES.TXT / USER1.SAMPLE.COBOL are seeded by `mock-zos gen-fixtures`.
      expect(req?.responseText).toMatch(/USER1\.(NOTES|SAMPLE)/);
      expect(req?.toolInvocationParts.length).toBeGreaterThan(0);
    },
    SUITE_TIMEOUT_MS
  );
});
