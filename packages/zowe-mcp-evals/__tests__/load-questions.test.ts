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

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listSetNames, loadAndValidateAllSets, loadSetYaml } from '../src/load-questions.js';

describe('loadSetYaml schema validation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'evals-schema-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects YAML with unknown top-level property', () => {
    const yamlContent = `
questions:
  - id: test
    prompt: Hello
    assertions:
      - toolCall:
          tool: info
bogus: true
`;
    const path = join(tmpDir, 'bad.yaml');
    writeFileSync(path, yamlContent, 'utf-8');
    expect(() => loadSetYaml(path)).toThrow('JSON Schema validation failed');
  });

  it('rejects YAML with old-style type-based assertion', () => {
    const yamlContent = `
questions:
  - id: test
    prompt: Hello
    assertions:
      - type: toolCall
        tool: info
`;
    const path = join(tmpDir, 'old-style.yaml');
    writeFileSync(path, yamlContent, 'utf-8');
    expect(() => loadSetYaml(path)).toThrow('JSON Schema validation failed');
  });

  it('rejects YAML with missing assertions', () => {
    const yamlContent = `
questions:
  - id: test
    prompt: Hello
`;
    const path = join(tmpDir, 'no-assertions.yaml');
    writeFileSync(path, yamlContent, 'utf-8');
    expect(() => loadSetYaml(path)).toThrow('JSON Schema validation failed');
  });

  it('accepts valid YAML with toolCall assertion', () => {
    const yamlContent = `
questions:
  - id: test
    prompt: Hello
    assertions:
      - toolCall:
          tool: info
`;
    const path = join(tmpDir, 'good.yaml');
    writeFileSync(path, yamlContent, 'utf-8');
    const result = loadSetYaml(path);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].id).toBe('test');
  });

  it('accepts valid YAML with toolCallOrder assertion', () => {
    const yamlContent = `
questions:
  - id: test
    prompt: Hello
    assertions:
      - toolCallOrder:
          - tool: listSystems
          - tool: setSystem
`;
    const path = join(tmpDir, 'good-order.yaml');
    writeFileSync(path, yamlContent, 'utf-8');
    const result = loadSetYaml(path);
    expect(result.questions).toHaveLength(1);
  });

  it('accepts valid YAML with name on assertion', () => {
    const yamlContent = `
questions:
  - id: test
    prompt: Hello
    assertions:
      - name: must list then set
        toolCallOrder:
          - tool: listSystems
          - tool: setSystem
`;
    const path = join(tmpDir, 'good-name.yaml');
    writeFileSync(path, yamlContent, 'utf-8');
    const result = loadSetYaml(path);
    expect(result.questions[0].assertionBlock.items).toHaveLength(1);
  });
});

describe('all question set YAML files pass schema validation', () => {
  const setNames = listSetNames();

  it('has at least one question set', () => {
    expect(setNames.length).toBeGreaterThan(0);
  });

  it('all sets load and validate without error', () => {
    expect(() => loadAndValidateAllSets(setNames)).not.toThrow();
  });
});

describe('loadAndValidateAllSets collects all errors', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'evals-validate-all-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports errors from multiple invalid sets at once', () => {
    expect(() => loadAndValidateAllSets(['nonexistent-set-1', 'nonexistent-set-2'])).toThrow(
      /2 question sets failed validation/
    );
  });
});
