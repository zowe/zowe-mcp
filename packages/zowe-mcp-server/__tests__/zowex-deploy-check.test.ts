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
 * Tests probeDeploySpace/verifyZowexBinary against a real (in-process) mock SSH server,
 * rather than mocking node-ssh directly, so the actual SSH exec plumbing is exercised.
 * The mock server's exec handler stands in for z/OS: it lets us script "no space left on
 * device" (ENOSPC) and "SE06 truncated module" responses to reproduce
 * https://github.com/zowe/zowe-mcp/issues/47 without needing a real full z/OS filesystem.
 */

import { SshSession } from '@zowe/zos-uss-for-zowe-sdk';
import { generateKeyPairSync } from 'node:crypto';
import type { Connection, ExecInfo, ServerChannel, Session } from 'ssh2';
import { Server } from 'ssh2';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isZowexTruncatedModuleError,
  probeDeploySpace,
  verifyZowexBinary,
} from '../src/zos/native/zowex-deploy-check.js';

interface ExecResult {
  code: number;
  stdout?: string;
  stderr?: string;
}

/** Starts a minimal SSH server that accepts any auth and answers `exec` requests via `handleExec`. */
function startMockSshServer(handleExec: (command: string) => ExecResult): Promise<{
  server: Server;
  port: number;
}> {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  const server = new Server({ hostKeys: [privateKey] }, (client: Connection) => {
    client.on('authentication', ctx => ctx.accept());
    client.on('ready', () => {
      client.on('session', accept => {
        const session: Session = accept();
        session.on('exec', (acceptExec, _reject, info: ExecInfo) => {
          const channel: ServerChannel = acceptExec();
          const { code, stdout = '', stderr = '' } = handleExec(info.command);
          if (stdout) channel.write(stdout);
          if (stderr) channel.stderr.write(stderr);
          channel.exit(code);
          channel.end();
        });
      });
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        resolve({ server, port: address.port });
      } else {
        reject(new Error('Mock SSH server did not report a port'));
      }
    });
  });
}

function testSession(port: number): SshSession {
  return new SshSession({ hostname: '127.0.0.1', port, user: 'test', password: 'test' });
}

describe('probeDeploySpace / verifyZowexBinary (mock SSH server)', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>(resolve => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
    server = undefined;
  });

  it('probeDeploySpace throws a clear "not enough space" error when the write fails (ENOSPC)', async () => {
    const started = await startMockSshServer(command => {
      if (command.includes('dd if=/dev/urandom')) {
        return {
          code: 1,
          stderr:
            'dd: writing to /z/user/.zowe-server/.zowe-mcp-deploy-space-probe: No space left on device\n',
        };
      }
      return { code: 0 };
    });
    server = started.server;

    await expect(
      probeDeploySpace(testSession(started.port), '~/.zowe-server', 8 * 1024 * 1024)
    ).rejects.toThrow(/Not enough space to deploy.*~\/\.zowe-server/s);
  });

  it('probeDeploySpace resolves when the probe write succeeds', async () => {
    const started = await startMockSshServer(() => ({ code: 0 }));
    server = started.server;

    await expect(
      probeDeploySpace(testSession(started.port), '~/.zowe-server', 8 * 1024 * 1024)
    ).resolves.toBeUndefined();
  });

  it('verifyZowexBinary throws when the freshly deployed binary fails to start (SE06 truncated module)', async () => {
    const started = await startMockSshServer(() => ({
      code: 1,
      stderr:
        'IEW4006I FETCH FOR UNIX SYSTEM SERVICES MODULE FAILED BECAUSE MODULE HAS BEEN TRUNCATED.\n' +
        'CSV034I PGMF FETCH FAILED FOR THE REQUESTED MODULE. 181\n' +
        '        RETURN CODE 20, REASON CODE 26110035\n',
    }));
    server = started.server;

    await expect(verifyZowexBinary(testSession(started.port), '~/.zowe-server')).rejects.toThrow(
      /did not start after deploy/
    );
  });

  it('verifyZowexBinary resolves when the binary starts successfully', async () => {
    const started = await startMockSshServer(() => ({ code: 0, stdout: 'zowex 1.2.3\n' }));
    server = started.server;

    await expect(
      verifyZowexBinary(testSession(started.port), '~/.zowe-server')
    ).resolves.toBeUndefined();
  });
});

describe('isZowexTruncatedModuleError', () => {
  it('matches the SE06/truncated-module console signature from issue #47', () => {
    const consoleOutput = [
      'IEW4006I FETCH FOR UNIX SYSTEM SERVICES MODULE FAILED BECAUSE MODULE HAS',
      ' BEEN TRUNCATED.',
      'CSV034I PGMF FETCH FAILED FOR THE REQUESTED MODULE. 181',
      '        RETURN CODE 20, REASON CODE 26110035',
      'CSV028I ABENDE06-0040  JOBNAME=IBMUSER  STEPNAME=STEP1',
      ' SYSTEM COMPLETION CODE=E06  REASON CODE=00000040',
    ].join('\n');
    expect(isZowexTruncatedModuleError(consoleOutput)).toBe(true);
  });

  it('matches each signature in isolation', () => {
    expect(isZowexTruncatedModuleError('IEW4006I ...')).toBe(true);
    expect(isZowexTruncatedModuleError('CSV034I ...')).toBe(true);
    expect(isZowexTruncatedModuleError('ABENDE06-0040')).toBe(true);
    expect(isZowexTruncatedModuleError('SYSTEM COMPLETION CODE=E06')).toBe(true);
    expect(isZowexTruncatedModuleError('reason code 26110035')).toBe(true);
    expect(isZowexTruncatedModuleError('module has been truncated')).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isZowexTruncatedModuleError('Connection refused')).toBe(false);
    expect(isZowexTruncatedModuleError('Authentication failed')).toBe(false);
    expect(isZowexTruncatedModuleError('CEE3204S protection exception 0C4')).toBe(false);
  });
});
