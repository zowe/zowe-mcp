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
 * Unit tests for init-mock inventory card generator.
 *
 * Verifies YAML card structure (seven keys, non-empty values) and deterministic output with seed.
 */

import type { Faker } from '@faker-js/faker';
import { fakerEN } from '@faker-js/faker';
import { describe, expect, it } from 'vitest';
import * as initMock from '../src/scripts/init-mock.js';

const generateInventoryMemberCard = initMock.generateInventoryMemberCard as (
  faker: Faker
) => string;
const yamlValue = initMock.yamlValue as (s: string) => string;

const REQUIRED_KEYS = ['name', 'description', 'category', 'price', 'material', 'product', 'upc'];

/** Parse simple key: value YAML lines (handles double-quoted values). */
function parseSimpleYaml(yaml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(': ');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 2).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    out[key] = value;
  }
  return out;
}

describe('yamlValue', () => {
  it('returns plain string when no special characters', () => {
    const result: string = yamlValue('Garden');
    expect(result).toBe('Garden');
  });

  it('wraps and escapes double-quoted string when needed', () => {
    const result: string = yamlValue('Say "hello"');
    expect(result).toBe('"Say \\"hello\\""');
  });
});

describe('generateInventoryMemberCard', () => {
  it('produces valid YAML with all seven keys and non-empty values', () => {
    fakerEN.seed(42);
    const card: string = generateInventoryMemberCard(fakerEN);
    const parsed: Record<string, string> = parseSimpleYaml(card);
    for (const key of REQUIRED_KEYS) {
      expect(parsed).toHaveProperty(key);
      expect(parsed[key]).toBeTruthy();
    }
    expect(Object.keys(parsed)).toHaveLength(REQUIRED_KEYS.length);
  });

  it('is deterministic with the same seed', () => {
    fakerEN.seed(100);
    const card1: string = generateInventoryMemberCard(fakerEN);
    fakerEN.seed(100);
    const card2: string = generateInventoryMemberCard(fakerEN);
    expect(card1).toBe(card2);
  });

  it('differs when different locales are used', async () => {
    const { fakerES } = (await import('@faker-js/faker')) as {
      fakerES: typeof fakerEN;
    };
    fakerEN.seed(1);
    fakerES.seed(1);
    const cardEn: string = generateInventoryMemberCard(fakerEN);
    const cardEs: string = generateInventoryMemberCard(fakerES);
    const parsedEn: Record<string, string> = parseSimpleYaml(cardEn);
    const parsedEs: Record<string, string> = parseSimpleYaml(cardEs);
    expect(parsedEn.name).not.toBe(parsedEs.name);
  });
});
