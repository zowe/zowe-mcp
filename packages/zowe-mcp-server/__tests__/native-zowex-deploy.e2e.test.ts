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
 * E2E test for zowex z/OS server auto-deploy on first connect (ZSshUtils.installServer).
 *
 * Runs only when the target system is provided via ZOWE_MCP_E2E_NATIVE_SYSTEM (e.g.
 * "user@host" or "user@host:port"). Starts the stdio server with the native backend
 * and verifies that the first tool call that needs the native backend does not end
 * with "Server not found" (i.e. either the z/OS server was already present or deploy
 * it via ZSshUtils.installServer and retried).
 *
 * Skip when ZOWE_MCP_E2E_NATIVE_SYSTEM is unset or password for that system is missing.
 *
 * Before the test, removes ~/.zowe-server on the target via ssh (using sshpass) so the
 * deploy path is exercised every run. If sshpass is missing or cleanup fails, the test
 * still runs.
 *
 * Run only this E2E from server package (build first):
 *   ZOWE_MCP_E2E_NATIVE_SYSTEM=user@host npm run build && npx vitest run native-zowex-deploy.e2e
 * Set ZOWE_MCP_PASSWORD_<USER>_<HOST> or ZOS_PASSWORD (e.g. from .env).
 * Optional: install sshpass (e.g. brew install sshpass) so the test can remove ~/.zowe-server before running.
 *
 * .env is loaded from the current working directory or from the repo root so variables are visible to the test.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parseConnectionSpec,
  type ParsedConnectionSpec,
  toPasswordEnvVarName,
} from '../src/zos/native/connection-spec.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, '..', 'dist', 'index.js');

/** Load .env from the given path; set process.env for each KEY=value line (existing env not overwritten). */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    const value = trimmed.slice(eq + 1).trim();
    const unquoted = /^['"](.*)['"]$/.exec(value);
    process.env[key] = unquoted ? unquoted[1] : value;
  }
}

// Load .env from cwd (e.g. repo root when run via "npm run test" from root) or from repo root relative to this file
loadEnvFile(resolve(process.cwd(), '.env'));
loadEnvFile(resolve(__dirname, '..', '..', '..', '.env'));

const E2E_NATIVE_SYSTEM_ENV = 'ZOWE_MCP_E2E_NATIVE_SYSTEM';

interface ToolContent {
  type: string;
  text: string;
}

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

function getResultText(result: ToolResult): string {
  const content = result.content as ToolContent[];
  return content[0].text;
}

/** True if the result text indicates SSH/auth failure (invalid password, auth methods failed). */
function isAuthError(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('all configured authentication methods failed') ||
    lower.includes('authentication failed') ||
    lower.includes('invalid password') ||
    lower.includes('permission denied')
  );
}

/** Parsed listDatasets success envelope (has _context and data). */
interface ListDatasetsEnvelope {
  _context?: { system: string };
  _result?: { count: number; totalAvailable: number };
  data?: unknown[];
}

/** True if the result looks like a successful listDatasets response (zowex-sdk responded). */
function isListDatasetsSuccess(result: ToolResult): boolean {
  if (result.isError) return false;
  const text = getResultText(result);
  try {
    const envelope = JSON.parse(text) as ListDatasetsEnvelope;
    return (
      envelope != null &&
      typeof envelope === 'object' &&
      Array.isArray(envelope.data) &&
      envelope._context != null
    );
  } catch {
    return false;
  }
}

function getTargetSpec(): ParsedConnectionSpec | null {
  const raw = process.env[E2E_NATIVE_SYSTEM_ENV];
  if (!raw || raw.trim() === '') return null;
  try {
    return parseConnectionSpec(raw);
  } catch {
    return null;
  }
}

const targetSpec = getTargetSpec();
const passwordEnvVar = targetSpec ? toPasswordEnvVarName(targetSpec.user, targetSpec.host) : '';
const passwordFromVar = passwordEnvVar && process.env[passwordEnvVar];
const passwordFromZos = process.env.ZOS_PASSWORD;
const password =
  (passwordFromVar && passwordFromVar.trim() !== '' ? passwordFromVar : undefined) ??
  (passwordFromZos && passwordFromZos.trim() !== '' ? passwordFromZos : undefined);

const systemSpec = targetSpec ? `${targetSpec.user}@${targetSpec.host}` : '';
const canRunZnpDeployE2E = Boolean(targetSpec && password);

const skipReason = !canRunZnpDeployE2E
  ? !targetSpec
    ? `Missing or invalid ${E2E_NATIVE_SYSTEM_ENV} (e.g. user@host)`
    : !password
      ? `Missing password (set ${passwordEnvVar} or ZOS_PASSWORD)`
      : ''
  : '';

function getChildEnv(): Record<string, string> {
  const env = { ...process.env };
  if (password && passwordEnvVar && !process.env[passwordEnvVar]) {
    env[passwordEnvVar] = password;
  }
  return env as Record<string, string>;
}

/**
 * Remove ~/.zowe-server on the target via ssh so the test always exercises the ZNP deploy path.
 * Uses sshpass -e (password from SSHPASS env). Requires sshpass (e.g. brew install sshpass on macOS).
 * If cleanup fails, the test still runs.
 */
function removeZnpServerOnTarget(spec: ParsedConnectionSpec, pwd: string): void {
  const userHost = `${spec.user}@${spec.host}`;
  const remoteCmd = 'rm -rf ~/.zowe-server';
  const sshOpts =
    '-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10';
  try {
    execSync(`sshpass -e ssh ${sshOpts} ${userHost} '${remoteCmd}'`, {
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 15_000,
      env: { ...process.env, SSHPASS: pwd },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('sshpass') || msg.includes('command not found')) {
      console.warn(
        'native-zowex-deploy: sshpass not found; skipping cleanup of ~/.zowe-server on target. ' +
          'Install sshpass (e.g. brew install sshpass) to ensure the deploy path is exercised every run.'
      );
    } else {
      console.warn('native-zowex-deploy: failed to remove ~/.zowe-server on target:', msg);
    }
  }
}

describe.skipIf(!canRunZnpDeployE2E)(
  `Zowex z/OS server deploy on first connect${skipReason ? ` [skipped: ${skipReason}]` : ''}`,
  () => {
    let client: Client;

    beforeAll(async () => {
      if (targetSpec && password) {
        removeZnpServerOnTarget(targetSpec, password);
      }
      const transport = new StdioClientTransport({
        command: 'node',
        args: [serverPath, '--stdio', '--native', '--system', systemSpec],
        env: getChildEnv(),
      });
      client = new Client({ name: 'e2e-zowex-deploy', version: '1.0.0' });
      await client.connect(transport);
    });

    afterAll(async () => {
      if (client) {
        await client.close();
      }
    });

    it(
      'authentication succeeds (listDatasets does not return an auth error)',
      { timeout: 120_000 },
      async () => {
        await client.callTool({ name: 'setSystem', arguments: { system: targetSpec!.host } });
        const result = await client.callTool({
          name: 'listDatasets',
          arguments: { dsnPattern: "'SYS1.*LIB'", attributes: true },
        });
        const text = getResultText(result);
        expect(isAuthError(text)).toBe(false);
      }
    );

    it(
      'listDatasets returns a successful result (z/OS server deployed or already present)',
      {
        timeout: 120_000,
      },
      async () => {
        await client.callTool({ name: 'setSystem', arguments: { system: targetSpec!.host } });
        const result = await client.callTool({
          name: 'listDatasets',
          arguments: { dsnPattern: "'SYS1.*LIB'", attributes: true },
        });
        expect(isListDatasetsSuccess(result)).toBe(true);
      }
    );
  }
);
