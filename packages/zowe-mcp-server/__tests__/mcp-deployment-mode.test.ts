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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMcpDeploymentMode } from '../src/mcp-deployment-mode.js';

describe('getMcpDeploymentMode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns http when ZOWE_MCP_TRANSPORT is http', () => {
    vi.stubEnv('ZOWE_MCP_TRANSPORT', 'http');
    vi.stubEnv('MCP_DISCOVERY_DIR', '/tmp');
    vi.stubEnv('WORKSPACE_ID', 'ws');
    expect(getMcpDeploymentMode()).toBe('http');
  });

  it('returns stdio-vscode when discovery env vars are set and transport is not http', () => {
    vi.stubEnv('ZOWE_MCP_TRANSPORT', '');
    vi.stubEnv('MCP_DISCOVERY_DIR', '/tmp/zowe');
    vi.stubEnv('WORKSPACE_ID', 'abc');
    expect(getMcpDeploymentMode()).toBe('stdio-vscode');
  });

  it('returns stdio-standalone when no matching env', () => {
    vi.stubEnv('ZOWE_MCP_TRANSPORT', '');
    expect(getMcpDeploymentMode()).toBe('stdio-standalone');
  });
});
