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
 * Validates every CLI-bridge plugin `*-tools.yaml` against the formal JSON
 * Schema (`schemas/plugin-tools.schema.json`). The runtime loader only does
 * typed parsing, so this is the gate that catches schema drift: unknown keys
 * (the schema is `additionalProperties: false` throughout), wrong types, and
 * missing required fields — before a bad plugin file ships.
 *
 * Runs in the normal test job on every OS, so no separate CI step is needed.
 */

// Use the named `Ajv` export: under NodeNext, ajv v8's CJS default import
// resolves to the (non-constructable) namespace, but the named class works.
import { Ajv, type ErrorObject } from 'ajv';
import { load as yamlLoad } from 'js-yaml';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const schemaPath = join(__dirname, '..', 'schemas', 'plugin-tools.schema.json');

const TOOLS_YAML = /-tools\.ya?ml$/;

/**
 * Discover every tracked CLI-bridge plugin `*-tools.yaml`:
 *   - vendored plugins under `vendor/<vendor>/cli-bridge-plugins/`, and
 *   - built-in plugins under the server package's `src/.../cli-bridge/plugins/`.
 */
function findPluginToolFiles(): string[] {
  const files: string[] = [];

  const vendorRoot = join(repoRoot, 'vendor');
  if (existsSync(vendorRoot)) {
    for (const vendor of readdirSync(vendorRoot, { withFileTypes: true })) {
      if (!vendor.isDirectory()) continue;
      const dir = join(vendorRoot, vendor.name, 'cli-bridge-plugins');
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (TOOLS_YAML.test(f)) files.push(join(dir, f));
      }
    }
  }

  const builtinDir = join(__dirname, '..', 'src', 'tools', 'cli-bridge', 'plugins');
  if (existsSync(builtinDir)) {
    for (const f of readdirSync(builtinDir)) {
      if (TOOLS_YAML.test(f)) files.push(join(builtinDir, f));
    }
  }

  return files;
}

/** Format ajv errors into a readable, multi-line message. */
function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return '(no details)';
  return errors
    .map(e => {
      const where = e.instancePath.length > 0 ? e.instancePath : '(root)';
      return `  • ${where} ${e.message ?? ''}`.trimEnd();
    })
    .join('\n');
}

const schema = JSON.parse(readFileSync(schemaPath, 'utf-8')) as object;
const pluginFiles = findPluginToolFiles();

describe('CLI-bridge plugin YAMLs', () => {
  // strict: false so the schema's `examples` annotation keyword doesn't trip
  // ajv v8's strict-mode schema checks.
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  it('the plugin-tools schema compiles', () => {
    expect(typeof validate).toBe('function');
  });

  // Guards against a discovery-path regression: the repo ships at least one
  // plugin, so an empty result almost certainly means this test stopped finding
  // them rather than that all plugins were intentionally removed.
  it('discovers at least one plugin *-tools.yaml', () => {
    expect(pluginFiles.length).toBeGreaterThan(0);
  });

  it.each(pluginFiles.map(f => [relative(repoRoot, f), f] as const))(
    'validates %s against plugin-tools.schema.json',
    (_label, file) => {
      const data = yamlLoad(readFileSync(file, 'utf-8'));
      const ok = validate(data);
      if (!ok) {
        throw new Error(
          `Schema validation failed for ${relative(repoRoot, file)}:\n${formatErrors(validate.errors)}`
        );
      }
      expect(ok).toBe(true);
    }
  );
});
