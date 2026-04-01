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
 * E2E test for the IBM Db2 for z/OS CLI bridge integration.
 *
 * Prerequisites:
 *   - Db2 Connect license: copy db2jcc_license_cisuz.jar (or equivalent) to
 *     ~/.zowe/plugins/installed/lib/node_modules/@zowe/db2-for-zowe-cli/node_modules/ibm_db/installer/clidriver/license/
 *   - Apple Silicon: run under x86_64 via Rosetta (intel alias) — ibm_db is x86_64 only
 *   - Set env vars: DB2_HOST, DB2_PORT, DB2_USER, DB2_DATABASE
 *   - Set password env var: ZOWE_MCP_PASSWORD_<USER>_<HOST_DOTS_AS_UNDERSCORES>
 *   - Or source .env from repo root
 *
 * Run from repo root:
 *   intel && source .env && npx vitest run vendor/zowe/e2e-tests/db2-native-stdio.e2e.test.ts
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DB2_HOST = process.env['DB2_HOST'] ?? '';
const DB2_PORT = process.env['DB2_PORT'] ?? '';
const DB2_USER = process.env['DB2_USER'] ?? '';
const DB2_DATABASE = process.env['DB2_DATABASE'] ?? '';

// Derive password env var from user and host (dots → underscores, uppercase)
const pwdEnvKey = `ZOWE_MCP_PASSWORD_${DB2_USER}_${DB2_HOST.replace(/\./g, '_').replace(/-/g, '_').toUpperCase()}`;
const password = process.env[pwdEnvKey] ?? process.env['ZOS_PASSWORD'];

// License check: ibm_db requires the Db2 Connect license to connect to z/OS
const licensePath = join(
  process.env['HOME'] ?? '',
  '.zowe/plugins/installed/lib/node_modules/@zowe/db2-for-zowe-cli/node_modules/ibm_db/installer/clidriver/license'
);
const hasLicense =
  existsSync(licensePath) && existsSync(join(licensePath, 'db2jcc_license_cisuz.jar')) === false
    ? false // jar not found
    : existsSync(licensePath);

const serverBin = resolve(__dirname, '../../../packages/zowe-mcp-server/dist/index.js');
const vendorPluginsDir = resolve(__dirname, '../cli-bridge-plugins');

const connFile = join(tmpdir(), 'db2-e2e-conn.json');
const connConfig = JSON.stringify({
  connection: {
    profiles: [
      {
        id: 'default',
        host: DB2_HOST,
        port: Number(DB2_PORT),
        user: DB2_USER,
        database: DB2_DATABASE,
      },
    ],
    default: 'default',
  },
});

function callTool(toolName: string, args: Record<string, unknown>) {
  const input = JSON.stringify(args).replace(/"/g, '\\"').split(',').join(' ');
  const result = spawnSync(
    process.execPath,
    [
      serverBin,
      'call-tool',
      `--cli-plugin-configuration=db2=${connFile}`,
      toolName,
      ...Object.entries(args).map(([k, v]) => `${k}=${JSON.stringify(v)}`),
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, [pwdEnvKey]: password ?? '' },
      timeout: 30000,
    }
  );
  return result;
}

describe.skipIf(!password || !existsSync(serverBin))(
  'Db2 for z/OS CLI bridge (native D13A)',
  () => {
    // Write connection file before tests
    require('node:fs').writeFileSync(connFile, connConfig);

    it.skipIf(!hasLicense)('db2ExecuteSql — SELECT CURRENT DATE returns a result', () => {
      const result = callTool('db2ExecuteSql', {
        query: 'SELECT CURRENT DATE FROM SYSIBM.SYSDUMMY1',
      });
      expect(result.status).toBe(0);
      const output = result.stdout + result.stderr;
      // Should contain a date like 2026-04-01
      expect(output).toMatch(/202[0-9]-[0-1][0-9]-[0-3][0-9]/);
    });

    it.skipIf(!hasLicense)('db2ExecuteSql — SYSIBM.SYSTABLES is queryable', () => {
      const result = callTool('db2ExecuteSql', {
        query:
          "SELECT NAME, TYPE FROM SYSIBM.SYSTABLES WHERE CREATOR = 'SYSIBM' FETCH FIRST 5 ROWS ONLY",
      });
      expect(result.status).toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/SYSTABLES|SYSCOLUMNS|SYSROUTINES/i);
    });

    it('db2ListConnections — returns configured profile', () => {
      const result = callTool('db2ListConnections', {});
      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).toMatch(
        new RegExp(DB2_HOST || DB2_DATABASE || 'profile', 'i')
      );
    });
  }
);
