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

import { describe, expect, it } from 'vitest';
import { redactSecretsForLogging } from '../src/tool-call-logging.js';

describe('redactSecretsForLogging', () => {
  it('redacts secret-named keys and preserves everything else', () => {
    const input = {
      owner: 'CERTADM',
      label: 'WebServerCert',
      password: 'hunter2',
      filePassphrase: 'also-secret',
      apiToken: 'tok-123',
    };
    const out = redactSecretsForLogging(input) as Record<string, unknown>;
    expect(out.owner).toBe('CERTADM');
    expect(out.label).toBe('WebServerCert');
    expect(out.password).toBe('«redacted»');
    expect(out.filePassphrase).toBe('«redacted»');
    expect(out.apiToken).toBe('«redacted»');
  });

  it('recurses into nested objects and arrays', () => {
    const input = {
      profiles: [{ host: 'h1', password: 'p1' }, { host: 'h2' }],
      options: { credentials: 'user:pass', keep: 1 },
    };
    const out = redactSecretsForLogging(input) as {
      profiles: Record<string, unknown>[];
      options: Record<string, unknown>;
    };
    expect(out.profiles[0].password).toBe('«redacted»');
    expect(out.profiles[0].host).toBe('h1');
    expect(out.options.credentials).toBe('«redacted»');
    expect(out.options.keep).toBe(1);
  });

  it('does not mutate the original input', () => {
    const input = { password: 'p' };
    redactSecretsForLogging(input);
    expect(input.password).toBe('p');
  });

  it('passes primitives and null through unchanged', () => {
    expect(redactSecretsForLogging('x')).toBe('x');
    expect(redactSecretsForLogging(null)).toBeNull();
    expect(redactSecretsForLogging(undefined)).toBeUndefined();
  });
});
