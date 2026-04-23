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
 * Unit tests for per-tenant response cache and CLI plugin state maps.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetTenantResourcesForTests,
  DEFAULT_TENANT_KEY,
  getOrCreateTenantCliPluginStates,
  getOrCreateTenantResponseCache,
  tenantKeyFromSub,
} from '../src/auth/tenant-resources.js';

afterEach(() => {
  __resetTenantResourcesForTests();
});

describe('tenantKeyFromSub', () => {
  it('returns DEFAULT_TENANT_KEY for undefined or empty', () => {
    expect(tenantKeyFromSub(undefined)).toBe(DEFAULT_TENANT_KEY);
    expect(tenantKeyFromSub('')).toBe(DEFAULT_TENANT_KEY);
    expect(tenantKeyFromSub('   ')).toBe(DEFAULT_TENANT_KEY);
  });

  it('trims and returns subject', () => {
    expect(tenantKeyFromSub('  oidc|123  ')).toBe('oidc|123');
  });
});

describe('getOrCreateTenantResponseCache', () => {
  it('returns the same instance for the same tenant key', () => {
    const a = getOrCreateTenantResponseCache('user-a');
    const b = getOrCreateTenantResponseCache('user-a');
    expect(a).toBe(b);
  });

  it('returns different instances for different tenant keys', () => {
    const a = getOrCreateTenantResponseCache('user-a');
    const c = getOrCreateTenantResponseCache('user-b');
    expect(a).not.toBe(c);
  });
});

describe('getOrCreateTenantCliPluginStates', () => {
  it('returns the same Map for the same tenant key', () => {
    const a = getOrCreateTenantCliPluginStates('t1');
    const b = getOrCreateTenantCliPluginStates('t1');
    expect(a).toBe(b);
  });

  it('returns different maps for different tenant keys', () => {
    const a = getOrCreateTenantCliPluginStates('t1');
    const b = getOrCreateTenantCliPluginStates('t2');
    expect(a).not.toBe(b);
  });
});

describe('__resetTenantResourcesForTests', () => {
  it('clears caches so a new instance is created', () => {
    const first = getOrCreateTenantResponseCache('x');
    __resetTenantResourcesForTests();
    const second = getOrCreateTenantResponseCache('x');
    expect(second).not.toBe(first);
  });
});
