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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeEnvContract, envRefKeys } from './deploy-zos.mjs';

test('envRefKeys lists the keys whose raw value references ${ENV:...}', () => {
  const keys = envRefKeys({
    PLAIN: 'value',
    WHOLE: '${ENV:SOME_SECRET}',
    EMBEDDED: 'prefix-${ENV:OTHER}-suffix',
    NOT_A_REF: '$ENV:NOPE',
  });
  assert.deepEqual([...keys].sort(), ['EMBEDDED', 'WHOLE']);
});

test('envRefKeys tolerates a missing runtimeEnv', () => {
  assert.equal(envRefKeys(undefined).size, 0);
});

test('describeEnvContract masks values interpolated from deploy/.env', () => {
  const lines = describeEnvContract(
    { ZOWE_MCP_TENANT_STORE_DIR: '/srv/store', OPAQUE: 'abc123' },
    new Set(['OPAQUE'])
  );
  assert.deepEqual(lines, ['  ZOWE_MCP_TENANT_STORE_DIR=/srv/store', '  OPAQUE=***']);
});

test('describeEnvContract masks secret-looking names even when written inline', () => {
  const lines = describeEnvContract(
    {
      ZOWE_MCP_TENANT_STORE_KEY: 'fcf2deadbeef',
      ZOWE_MCP_PASSWORD_USER_HOST: 'hunter2',
      ZOWE_MCP_VAULT_TOKEN: 's.xyz',
      MY_CLIENT_SECRET: 'shh',
      ZOWE_MCP_CREDENTIALS: '{"u@h":"p"}',
      ZOWE_MCP_JWT_ISSUER: 'https://idp.example.com',
    },
    new Set()
  );
  assert.deepEqual(lines, [
    '  ZOWE_MCP_TENANT_STORE_KEY=***',
    '  ZOWE_MCP_PASSWORD_USER_HOST=***',
    '  ZOWE_MCP_VAULT_TOKEN=***',
    '  MY_CLIENT_SECRET=***',
    '  ZOWE_MCP_CREDENTIALS=***',
    '  ZOWE_MCP_JWT_ISSUER=https://idp.example.com',
  ]);
});

test('describeEnvContract never prints a masked value anywhere in its output', () => {
  const secret = 'fcf299fbe08cf801f4a60f855cfcf021';
  const output = describeEnvContract({ ZOWE_MCP_TENANT_STORE_KEY: secret }, new Set()).join('\n');
  assert.ok(!output.includes(secret));
});
