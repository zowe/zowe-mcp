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
 * Unit tests for MCP tool progress (createToolProgress).
 */

import { describe, expect, it, vi } from 'vitest';
import { createToolProgress, EN_DASH, type ToolProgressExtra } from '../src/tools/progress.js';

describe('createToolProgress', () => {
  it('returns no-op reporter when progressToken is absent', async () => {
    const extra: ToolProgressExtra = {
      _meta: {},
      sendNotification: vi.fn(),
    };
    const progress = createToolProgress(extra, 'Test title');
    await progress.start();
    await progress.step('sub');
    await progress.complete('done');
    expect(extra.sendNotification).not.toHaveBeenCalled();
  });

  it('sends progress 0 on start when token present', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const extra: ToolProgressExtra = {
      _meta: { progressToken: 'tok1' },
      sendNotification,
    };
    const progress = createToolProgress(extra, 'List members of USER.SRC');
    await progress.start();
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: {
        progressToken: 'tok1',
        progress: 0,
        message: `List members of USER.SRC ${EN_DASH} Starting`,
      },
    });
  });

  it('sends increasing progress on step and progress 1 on complete', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const extra: ToolProgressExtra = {
      _meta: { progressToken: 42 },
      sendNotification,
    };
    const progress = createToolProgress(extra, 'Read USER.DATA');
    await progress.start();
    await progress.step('Connecting to sys1 via SSH');
    await progress.step('Running Zowe Native operation');
    await progress.complete(`range 1${EN_DASH}100, 500 records`);
    expect(sendNotification).toHaveBeenCalledTimes(4);
    interface ProgressParams {
      progress?: number;
      total?: number;
      message?: string;
    }
    const calls = sendNotification.mock.calls.map(
      (c): ProgressParams => (c[0] as { params: ProgressParams }).params
    );
    expect(calls[0].progress).toBe(0);
    expect(calls[1].progress).toBeGreaterThan(0);
    expect(calls[1].message).toBe(`Read USER.DATA ${EN_DASH} Connecting to sys1 via SSH`);
    expect(calls[2].progress).toBeGreaterThan(calls[1].progress);
    expect(calls[3].progress).toBe(1);
    expect(calls[3].total).toBe(1);
    expect(calls[3].message).toBe(`Read USER.DATA ${EN_DASH} range 1${EN_DASH}100, 500 records`);
  });

  it('formats final message as title - status', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const extra: ToolProgressExtra = {
      _meta: { progressToken: 'x' },
      sendNotification,
    };
    const progress = createToolProgress(extra, 'Delete USER.OLD');
    await progress.start();
    await progress.complete('deleted');
    expect(sendNotification).toHaveBeenLastCalledWith({
      method: 'notifications/progress',
      params: {
        progressToken: 'x',
        progress: 1,
        total: 1,
        message: `Delete USER.OLD ${EN_DASH} deleted`,
      },
    });
  });
});
