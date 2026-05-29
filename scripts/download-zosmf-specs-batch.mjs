#!/usr/bin/env node
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
 * download-zosmf-specs-batch.mjs
 *
 * Runs download-zosmf-specs.mjs for every enabled z/OSMF instance listed in a
 * JSON config file (default: zosmf-instances.json at the repo root, gitignored).
 *
 * Usage:
 *   node scripts/download-zosmf-specs-batch.mjs [options]
 *
 *   --config <path>    Path to instances JSON (default: zosmf-instances.json)
 *   --list             List configured instances and exit (no downloads)
 *   --dry-run          Print what would be run, without executing
 *   --parallel         Run all instances concurrently (default: sequential)
 *   --output <dir>     Override output directory for all instances
 *   --insecure         Override: skip TLS verification for all instances
 *   -h, --help         Show help
 *
 * Instance config file format (zosmf-instances.json):
 * {
 *   "defaults": {           // applied to every instance (overridden per-instance)
 *     "port": 10443,
 *     "insecure": true
 *   },
 *   "instances": [
 *     {
 *       "host": "ca32.lvn.broadcom.net",
 *       "user": "MYUSER",
 *       "port": 10443,                // optional, overrides defaults.port
 *       "insecure": true,             // optional, overrides defaults.insecure
 *       "description": "R&D LPAR",    // optional, shown in progress output
 *       "disabled": false             // optional, set true to skip this instance
 *     }
 *   ]
 * }
 *
 * Password resolution per instance (highest priority first):
 *   1. ZOWE_MCP_PASSWORD_<USER>_<HOST> env var
 *   2. ZOWE_MCP_CREDENTIALS JSON map
 *   3. ZOWE_MCP_ZOSMF_PASSWORD env var (used when only one instance)
 *
 * Output:
 *   resources/zosmf/<zos-version>/   (gitignored, tagged by z/OS version from /zosmf/info)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');
const DOWNLOAD_SCRIPT = join(__dirname, 'download-zosmf-specs.mjs');

// ─── CLI argument parsing ─────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    config: { type: 'string', default: join(REPO_ROOT, 'zosmf-instances.json') },
    list: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    parallel: { type: 'boolean', default: false },
    output: { type: 'string' },
    insecure: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: false,
});

if (args.help) {
  console.log(`
Usage: node scripts/download-zosmf-specs-batch.mjs [options]

Downloads z/OSMF OpenAPI specs for every instance listed in a JSON config file.

Options:
  --config <path>    Path to instances JSON (default: zosmf-instances.json)
  --list             List configured instances and exit (no downloads)
  --dry-run          Print what would be run, without executing
  --parallel         Run all instances concurrently (default: sequential)
  --output <dir>     Override output directory for all instances
  --insecure         Override: skip TLS verification for all instances
  -h, --help         Show this help

Instance file (zosmf-instances.json) format:
  {
    "defaults": { "port": 10443, "insecure": true },
    "instances": [
      { "host": "myhost.example.com", "user": "MYUSER", "description": "..." }
    ]
  }

Password resolution per instance (highest priority first):
  1. ZOWE_MCP_PASSWORD_<USER>_<HOST>  e.g. ZOWE_MCP_PASSWORD_MYUSER_MYHOST_EXAMPLE_COM
  2. ZOWE_MCP_CREDENTIALS             JSON map { "myuser@myhost.example.com": "pass" }
  3. ZOWE_MCP_ZOSMF_PASSWORD          (fallback, single-instance use)

See zosmf-instances.example.json for a full example.
`);
  process.exit(0);
}

// ─── Load instance config ─────────────────────────────────────────────────────

const configPath = resolvePath(args.config);
if (!existsSync(configPath)) {
  console.error(
    `Error: Instance config file not found: ${configPath}\n` +
      `Copy zosmf-instances.example.json to zosmf-instances.json and fill in your instances.`
  );
  process.exit(1);
}

let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (err) {
  console.error(`Error: Failed to parse ${configPath}: ${err.message}`);
  process.exit(1);
}

const defaults = config.defaults ?? {};
const rawInstances = config.instances ?? [];

if (!rawInstances.length) {
  console.error(`Error: No instances defined in ${configPath}`);
  process.exit(1);
}

// Merge defaults into each instance
const instances = rawInstances.map(inst => ({ ...defaults, ...inst }));
const enabled = instances.filter(i => !i.disabled);
const disabled = instances.filter(i => i.disabled);

// ─── List mode ────────────────────────────────────────────────────────────────

if (args.list) {
  console.log(`\nz/OSMF instances from: ${configPath}\n`);
  for (const inst of instances) {
    const tag = inst.disabled ? ' [DISABLED]' : '';
    const desc = inst.description ? ` — ${inst.description}` : '';
    const port = inst.port ?? 10443;
    const insec = inst.insecure ? ' (insecure)' : '';
    console.log(`  ${inst.user}@${inst.host}:${port}${insec}${desc}${tag}`);
  }
  console.log(`\n${enabled.length} enabled, ${disabled.length} disabled.`);
  process.exit(0);
}

// ─── Build per-instance download command ─────────────────────────────────────

/**
 * Builds the argv for download-zosmf-specs.mjs for a given instance.
 */
function buildArgs(inst) {
  const argv = ['--host', inst.host, '--user', inst.user];
  const port = inst.port ?? 10443;
  argv.push('--port', String(port));
  if (inst.insecure || args.insecure) argv.push('--insecure');
  if (args.output) argv.push('--output', args.output);
  return argv;
}

/**
 * Checks whether a password is available for this instance (without running
 * the download script). Returns the env var name that holds the password, or
 * null if not found (download will fail with a clear error).
 */
function hasPassword(inst) {
  const userPart = inst.user.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const hostPart = inst.host.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const envKey = `ZOWE_MCP_PASSWORD_${userPart}_${hostPart}`;
  if (process.env[envKey]) return envKey;
  if (process.env.ZOWE_MCP_CREDENTIALS) {
    try {
      const map = JSON.parse(process.env.ZOWE_MCP_CREDENTIALS);
      const key = `${inst.user.toLowerCase()}@${inst.host.toLowerCase()}`;
      if (Object.keys(map).some(k => k.toLowerCase() === key)) return 'ZOWE_MCP_CREDENTIALS';
    } catch {
      /* ignore */
    }
  }
  if (process.env.ZOWE_MCP_ZOSMF_PASSWORD) return 'ZOWE_MCP_ZOSMF_PASSWORD';
  return null;
}

// ─── Run one instance ─────────────────────────────────────────────────────────

/**
 * Runs download-zosmf-specs.mjs for a single instance.
 * Returns { host, user, success, skipped, reason, stdout, stderr }.
 */
function runOne(inst, index, total) {
  const label = inst.description
    ? `${inst.description} (${inst.user}@${inst.host})`
    : `${inst.user}@${inst.host}:${inst.port ?? 10443}`;

  console.log(`\n[${index + 1}/${total}] ${label}`);

  const pwSource = hasPassword(inst);
  if (!pwSource) {
    const userPart = inst.user.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const hostPart = inst.host.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const hint = `ZOWE_MCP_PASSWORD_${userPart}_${hostPart}`;
    console.log(`  SKIPPED — no password found. Set ${hint} or add to ZOWE_MCP_CREDENTIALS.`);
    return {
      host: inst.host,
      user: inst.user,
      label,
      success: false,
      skipped: true,
      reason: `no password (set ${hint})`,
    };
  }

  const argv = buildArgs(inst);
  if (args['dry-run']) {
    console.log(
      `  DRY RUN: node ${DOWNLOAD_SCRIPT.replace(REPO_ROOT + '/', '')} ${argv.join(' ')}`
    );
    console.log(`  Password source: ${pwSource}`);
    return {
      host: inst.host,
      user: inst.user,
      label,
      success: true,
      skipped: false,
      dryRun: true,
    };
  }

  const result = spawnSync(process.execPath, [DOWNLOAD_SCRIPT, ...argv], {
    stdio: 'inherit',
    env: process.env,
  });

  const success = result.status === 0;
  if (!success) {
    console.log(`  FAILED (exit ${result.status ?? 'signal:' + result.signal})`);
  }
  return { host: inst.host, user: inst.user, label, success, skipped: false };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nz/OSMF Batch Spec Downloader`);
  console.log(`  Config  : ${configPath}`);
  console.log(`  Enabled : ${enabled.length} instance(s), ${disabled.length} disabled`);
  if (args['dry-run']) console.log('  Mode    : DRY RUN (no downloads)');
  if (args.parallel) console.log('  Mode    : parallel');

  if (!enabled.length) {
    console.error('\nNo enabled instances to process. Check the "disabled" flag in your config.');
    process.exit(1);
  }

  const results = [];

  if (args.parallel) {
    // Run all in parallel using Promise.all over child process wrappers.
    // Note: spawnSync is synchronous — use spawn with promise wrapper for true parallel.
    const { spawn } = await import('node:child_process');

    const runParallel = inst =>
      new Promise(resolve => {
        const label = inst.description
          ? `${inst.description} (${inst.user}@${inst.host})`
          : `${inst.user}@${inst.host}:${inst.port ?? 10443}`;

        const pwSource = hasPassword(inst);
        if (!pwSource) {
          const userPart = inst.user.toUpperCase().replace(/[^A-Z0-9]/g, '_');
          const hostPart = inst.host.toUpperCase().replace(/[^A-Z0-9]/g, '_');
          const hint = `ZOWE_MCP_PASSWORD_${userPart}_${hostPart}`;
          console.log(`\n[skip] ${label} — no password (set ${hint})`);
          resolve({
            host: inst.host,
            user: inst.user,
            label,
            success: false,
            skipped: true,
            reason: `no password (set ${hint})`,
          });
          return;
        }

        const argv = buildArgs(inst);
        if (args['dry-run']) {
          console.log(`\n[dry-run] ${label}: node ... ${argv.join(' ')}`);
          resolve({
            host: inst.host,
            user: inst.user,
            label,
            success: true,
            skipped: false,
            dryRun: true,
          });
          return;
        }

        console.log(`\n[start] ${label}`);
        const proc = spawn(process.execPath, [DOWNLOAD_SCRIPT, ...argv], {
          stdio: 'inherit',
          env: process.env,
        });
        proc.on('close', code => {
          const success = code === 0;
          if (!success) console.log(`[fail] ${label} (exit ${code})`);
          else console.log(`[done] ${label}`);
          resolve({ host: inst.host, user: inst.user, label, success, skipped: false });
        });
      });

    const all = await Promise.all(enabled.map(runParallel));
    results.push(...all);
  } else {
    // Sequential
    for (let i = 0; i < enabled.length; i++) {
      results.push(runOne(enabled[i], i, enabled.length));
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────────────────

  const succeeded = results.filter(r => r.success && !r.dryRun);
  const skipped = results.filter(r => r.skipped);
  const failed = results.filter(r => !r.success && !r.skipped);

  console.log('\n' + '─'.repeat(60));
  console.log('Summary:');
  if (args['dry-run']) {
    console.log(`  Would run ${enabled.length} instance(s). Use without --dry-run to execute.`);
  } else {
    console.log(`  Succeeded : ${succeeded.length}`);
    console.log(`  Skipped   : ${skipped.length} (missing password)`);
    console.log(`  Failed    : ${failed.length}`);
  }
  if (skipped.length) {
    console.log('\nSkipped instances (set password env var to enable):');
    for (const r of skipped) console.log(`  ${r.label} — ${r.reason}`);
  }
  if (failed.length) {
    console.log('\nFailed instances:');
    for (const r of failed) console.log(`  ${r.label}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
