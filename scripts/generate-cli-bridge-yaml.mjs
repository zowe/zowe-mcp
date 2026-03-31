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
 * generate-cli-bridge-yaml.mjs
 *
 * Extracts metadata from an installed Zowe CLI plugin and generates a rich
 * "CLI commands YAML" for use with the MCP CLI bridge.
 *
 * The generated file contains every group, command, positional, and option
 * with full metadata (type, aliases, required, default value, allowed values,
 * group membership). It is referenced by "MCP tools YAMLs" via $.path syntax.
 *
 * No dependency on ansible-collection-generator or any other helper plugin.
 * Uses the Zowe Imperative framework's own plugin definition files directly,
 * applying the passOn cascade mechanism to resolve inherited options.
 *
 * Usage:
 *   node scripts/generate-cli-bridge-yaml.mjs --plugin <name> [options]
 *
 * Options:
 *   --plugin <name>        CLI group name to extract (e.g. endevor)
 *   --npm <package>        Download latest package from npm, then extract
 *   --tgz <path>           Install plugin from a local .tgz, then extract
 *   --output <path>        Write YAML to file (default: stdout)
 *   --keep-installed       Do not uninstall plugin after --npm/--tgz extraction
 */

import { spawnSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { createRequire } from 'module';
import { homedir, tmpdir } from 'os';
import { dirname, join, resolve as resolvePath } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// CJS require for loading plugin definition files and js-yaml.
const require = createRequire(import.meta.url);

// ============================================================================
// CLI argument parsing
// ============================================================================

function parseArgs(argv) {
  const args = { plugin: null, npm: null, tgz: null, output: null, keepInstalled: false };
  let i = 2;
  while (i < argv.length) {
    switch (argv[i]) {
      case '--plugin':
        args.plugin = argv[++i];
        break;
      case '--npm':
        args.npm = argv[++i];
        break;
      case '--tgz':
        args.tgz = resolvePath(argv[++i]);
        break;
      case '--output':
        args.output = resolvePath(argv[++i]);
        break;
      case '--keep-installed':
        args.keepInstalled = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        console.error(`[generate-cli-bridge-yaml] Unknown argument: ${argv[i]}`);
        printUsage();
        process.exit(1);
    }
    i++;
  }
  if (!args.plugin) {
    console.error('[generate-cli-bridge-yaml] Error: --plugin <name> is required');
    printUsage();
    process.exit(1);
  }
  return args;
}

function printUsage() {
  process.stderr.write(
    [
      '',
      'Usage: node scripts/generate-cli-bridge-yaml.mjs --plugin <name> [options]',
      '',
      'Options:',
      '  --plugin <name>        CLI group name to extract (e.g. endevor)',
      '  --npm <package>        Download latest version from npm, then extract',
      '  --tgz <path>           Install plugin from a local .tgz, then extract',
      '  --output <path>        Output file path (default: stdout)',
      '  --keep-installed       Do not uninstall plugin after --npm/--tgz extraction',
      '',
      'Examples:',
      '  # Extract from the already-installed plugin:',
      '  node scripts/generate-cli-bridge-yaml.mjs --plugin endevor',
      '',
      '  # Download the latest version from npm and extract:',
      '  node scripts/generate-cli-bridge-yaml.mjs \\',
      '    --plugin endevor \\',
      '    --npm @broadcom/endevor-for-zowe-cli \\',
      '    --output vendor/endevor/cli-bridge-plugins/endevor-commands.yaml',
      '',
      '  # Install from a local .tgz and extract:',
      '  node scripts/generate-cli-bridge-yaml.mjs \\',
      '    --plugin myplugin \\',
      '    --tgz ./myplugin-1.0.0.tgz \\',
      '    --output vendor/myplugin/cli-bridge-plugins/myplugin-commands.yaml',
      '',
    ].join('\n')
  );
}

// ============================================================================
// Logging
// ============================================================================

function info(msg) {
  process.stderr.write(`[generate-cli-bridge-yaml] ${msg}\n`);
}

// ============================================================================
// NODE_PATH worker pattern
//
// Plugin definition files require('@zowe/imperative'), which lives inside the
// globally-installed @zowe/cli package's own node_modules — not in the MCP
// repo's node_modules. NODE_PATH must be set before Node.js starts, so the
// script re-spawns itself as a worker with the correct NODE_PATH.
// ============================================================================

function findZoweCliNodeModules() {
  const result = spawnSync('which', ['zowe'], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error('zowe CLI not found in PATH. Install with: npm install -g @zowe/cli');
  }
  const zoweBin = result.stdout.trim().split('\n')[0].trim();

  let zoweReal = zoweBin;
  try {
    zoweReal = realpathSync(zoweBin);
  } catch {
    /* use as-is */
  }

  // zoweReal = .../node_modules/@zowe/cli/lib/main.js
  // zoweCliDir = .../node_modules/@zowe/cli
  const zoweCliDir = dirname(dirname(zoweReal));

  // Preferred: @zowe/imperative nested inside @zowe/cli's own node_modules
  const nested = join(zoweCliDir, 'node_modules');
  if (existsSync(join(nested, '@zowe', 'imperative'))) return nested;

  // Fallback: global node_modules
  const globalNm = dirname(zoweCliDir);
  if (existsSync(join(globalNm, '@zowe', 'imperative'))) return globalNm;

  throw new Error(`Could not locate @zowe/imperative.\nChecked:\n  ${nested}\n  ${globalNm}`);
}

// ============================================================================
// Plugin management
// ============================================================================

function installPlugin(tgzPath) {
  info(`Installing plugin from ${tgzPath}...`);
  const result = spawnSync('zowe', ['plugins', 'install', tgzPath], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Plugin install failed (exit ${result.status ?? 'signal'})`);
  }
  info('Plugin installed.');
}

function uninstallPlugin(pluginName) {
  info(`Uninstalling plugin "${pluginName}"...`);
  spawnSync('zowe', ['plugins', 'uninstall', pluginName], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  });
}

/**
 * Downloads an npm package as a .tgz using `npm pack`.
 * Runs from the repo root so the workspace `.npmrc` (registry + auth) is
 * picked up automatically.  Returns the path of the downloaded .tgz and the
 * temp directory (caller is responsible for cleanup).
 */
function downloadFromNpm(packageName) {
  const tempDir = mkdtempSync(join(tmpdir(), 'zowe-mcp-cli-yaml-'));
  info(`Downloading ${packageName} from npm...`);

  // Run from repo root (where .npmrc lives) and direct output to tempDir so
  // the workspace registry + credentials are used automatically.
  const result = spawnSync('npm', ['pack', packageName, '--pack-destination', tempDir], {
    cwd: process.cwd(), // repo root → picks up .npmrc with Zowe Artifactory config
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    rmSync(tempDir, { recursive: true, force: true });
    throw new Error(
      `npm pack failed for "${packageName}" (exit ${result.status ?? 'signal'}). ` +
        `Is the package name correct? Check that the registry in .npmrc is reachable.`
    );
  }

  // Find the .tgz file that npm pack wrote into tempDir
  const tgzFiles = readdirSync(tempDir).filter(f => f.endsWith('.tgz'));
  if (tgzFiles.length === 0) {
    rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`npm pack succeeded but no .tgz found in ${tempDir}`);
  }

  const tgzPath = join(tempDir, tgzFiles[0]);
  info(`Downloaded: ${tgzFiles[0]}`);
  return { tgzPath, tempDir };
}

// ============================================================================
// Plugin discovery (runs in worker process with correct NODE_PATH)
// ============================================================================

/** Collect all package directories (including scoped) under a node_modules dir. */
function collectPackageDirs(nmDir) {
  if (!existsSync(nmDir)) return [];
  const dirs = [];
  for (const entry of readdirSync(nmDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = join(nmDir, entry.name);
    if (entry.name.startsWith('@')) {
      // Scoped package — one more level
      for (const sub of readdirSync(full, { withFileTypes: true })) {
        if (sub.isDirectory()) dirs.push(join(full, sub.name));
      }
    } else {
      dirs.push(full);
    }
  }
  return dirs;
}

/**
 * Find the installed plugin directory and its Imperative config by CLI group name.
 * Requires the worker process (NODE_PATH set) to load configurationModule.
 */
function findPlugin(cliGroupName) {
  const zoweHome = process.env.ZOWE_CLI_HOME ?? join(homedir(), '.zowe');
  const pluginsNm = join(zoweHome, 'plugins', 'installed', 'lib', 'node_modules');

  if (!existsSync(pluginsNm)) {
    throw new Error(
      `Plugins node_modules not found: ${pluginsNm}\n` +
        `Install a plugin first: zowe plugins install <package>`
    );
  }

  for (const pkgDir of collectPackageDirs(pluginsNm)) {
    const pkgJsonPath = join(pkgDir, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;

    let pkgJson;
    try {
      pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    } catch {
      continue;
    }

    const configModuleRel = pkgJson.imperative?.configurationModule;
    if (!configModuleRel) continue;

    let config;
    try {
      const raw = require(join(pkgDir, configModuleRel));
      config = raw?.default ?? raw;
    } catch {
      continue;
    }

    if (config?.name === cliGroupName) {
      return { pkgDir, pkgJson, config };
    }
  }

  throw new Error(
    `No installed plugin with CLI group name "${cliGroupName}".\n` +
      `Run: zowe plugins list   to see installed plugins.`
  );
}

// ============================================================================
// Definition file loading
// ============================================================================

/** Recursively find all *.definition.js files under a directory. */
function findDefinitionFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findDefinitionFiles(full));
    } else if (entry.name.endsWith('.definition.js') && !entry.name.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

/** Load a single definition file, returning the ICommandDefinition export or null. */
function loadDefinitionFile(filePath) {
  try {
    const mod = require(filePath);
    if (!mod || typeof mod !== 'object') return null;
    // Handle ESM __esModule wrapper
    const def = mod.__esModule ? mod.default : mod;
    if (def?.name && def?.type) return def;
    // Some files use named exports
    const named = Object.values(mod).find(v => v?.name && v?.type);
    return named ?? null;
  } catch {
    return null;
  }
}

// ============================================================================
// passOn resolution
//
// Imperative's passOn mechanism propagates shared options (e.g. session/location
// options) from parent groups down to leaf commands. Each passOn entry has:
//   property:    the command property to merge into (e.g. "options")
//   value:       the value(s) to add — array or single object
//   merge:       when true (default), extend; when false, replace
//   ignoreNodes: list of {type?, name?} specs — nodes matching ALL specified
//                fields are skipped (but their descendants are still traversed)
// ============================================================================

function applyPassOnEntry(node, entry) {
  // A node is ignored when ALL specified conditions in an ignoreNodes entry match.
  const shouldIgnore = (entry.ignoreNodes ?? []).some(ig => {
    if (ig.type !== undefined && node.type !== ig.type) return false;
    if (ig.name !== undefined && node.name !== ig.name) return false;
    return true;
  });

  if (!shouldIgnore) {
    const value = Array.isArray(entry.value) ? entry.value : [entry.value];
    const existing = Array.isArray(node[entry.property]) ? node[entry.property] : [];
    node[entry.property] = entry.merge !== false ? [...existing, ...value] : [...value];
  }

  // Always recurse so passOn propagates through groups to reach leaf commands.
  for (const child of node.children ?? []) {
    applyPassOnEntry(child, entry);
  }
}

/** Apply passOn from each node to its children, then recurse. */
function processPassOn(node) {
  for (const entry of node.passOn ?? []) {
    for (const child of node.children ?? []) {
      applyPassOnEntry(child, entry);
    }
  }
  for (const child of node.children ?? []) {
    processPassOn(child);
  }
}

// ============================================================================
// Command tree assembly
// ============================================================================

/**
 * Build the root command group from loaded definition files.
 *
 * Each *.definition.js file exports one ICommandDefinition (a group or command)
 * that is a direct child of the plugin's root. Inline children within those
 * groups are NOT separate definition files. We detect root-level definitions
 * by checking which definition names do not appear as inline children of others.
 */
function buildCommandTree(config, defFiles) {
  // Load all definition files
  const allDefs = [];
  for (const f of defFiles) {
    const def = loadDefinitionFile(f);
    if (def) allDefs.push(def);
  }

  // Collect all names that appear as inline children of loaded definitions.
  // Root-level definitions are those NOT appearing as inline children.
  const inlineChildNames = new Set();
  for (const def of allDefs) {
    for (const child of def.children ?? []) {
      inlineChildNames.add(child.name);
    }
  }

  const rootDefs = allDefs.filter(d => !inlineChildNames.has(d.name));

  // Deduplicate by name — keep the definition with the most children (most complete).
  const byName = new Map();
  for (const def of rootDefs) {
    const existing = byName.get(def.name);
    const len = (def.children ?? []).length;
    if (!existing || len > (existing.children ?? []).length) {
      byName.set(def.name, def);
    }
  }

  const root = {
    name: config.name,
    type: 'group',
    description: config.rootCommandDescription ?? '',
    children: [...byName.values()],
  };

  processPassOn(root);

  return root;
}

// ============================================================================
// Profile group classification
// ============================================================================

function classifyOptionGroup(group) {
  if (!group) return 'tool';
  if (/session.+definition.+options/i.test(group)) return 'connection';
  if (/connection.+options/i.test(group)) return 'connection';
  if (/authentication.+options/i.test(group)) return 'connection';
  if (/location.+definition.+options/i.test(group)) return 'location';
  if (/scope.+options/i.test(group)) return 'location';
  return 'tool';
}

/** Collect all distinct option group names and classify them. */
function collectProfileGroups(root) {
  const connection = new Set();
  const location = new Set();

  function walk(node) {
    for (const opt of node.options ?? []) {
      const cls = classifyOptionGroup(opt.group);
      if (cls === 'connection' && opt.group) connection.add(opt.group);
      if (cls === 'location' && opt.group) location.add(opt.group);
    }
    for (const child of node.children ?? []) walk(child);
  }
  walk(root);

  return {
    connection: [...connection].sort(),
    location: [...location].sort(),
  };
}

// ============================================================================
// YAML document building
// ============================================================================

function buildOptionEntry(opt) {
  const entry = {
    description: opt.description ?? '',
    type: opt.type ?? 'string',
    aliases: opt.aliases ?? [],
    required: opt.required ?? false,
  };
  if (opt.group !== undefined) entry.group = opt.group;
  if (opt.defaultValue !== undefined) entry.defaultValue = opt.defaultValue;
  if (opt.allowableValues !== undefined) entry.allowableValues = opt.allowableValues;
  if (opt.stringLengthRange !== undefined) entry.stringLengthRange = opt.stringLengthRange;
  if (opt.conflictsWith?.length) entry.conflictsWith = opt.conflictsWith;
  if (opt.implies?.length) entry.implies = opt.implies;
  return entry;
}

function buildPositionalEntry(pos) {
  const entry = {
    description: pos.description ?? '',
    type: pos.type ?? 'string',
    required: pos.required ?? false,
    aliases: pos.aliases ?? [],
  };
  if (pos.stringLengthRange !== undefined) entry.stringLengthRange = pos.stringLengthRange;
  return entry;
}

function buildCommandEntry(cmd) {
  const entry = {};

  if (cmd.description) entry.description = cmd.description;
  if (cmd.summary && cmd.summary !== cmd.description) entry.summary = cmd.summary;
  if (cmd.aliases?.length) entry.aliases = cmd.aliases;

  if (cmd.examples?.length) {
    entry.examples = cmd.examples.map(ex => ({
      description: ex.description ?? '',
      options: ex.options ?? '',
    }));
  }

  if (cmd.positionals?.length) {
    entry.positionals = {};
    for (const pos of cmd.positionals) {
      entry.positionals[pos.name] = buildPositionalEntry(pos);
    }
  }

  const opts = (cmd.options ?? []).filter(o => o?.name);
  if (opts.length) {
    entry.options = {};
    for (const opt of opts) {
      entry.options[opt.name] = buildOptionEntry(opt);
    }
  }

  return entry;
}

function buildGroupEntry(group) {
  const entry = {};

  if (group.description) entry.description = group.description;
  if (group.summary && group.summary !== group.description) entry.summary = group.summary;
  if (group.aliases?.length) entry.aliases = group.aliases;

  for (const child of group.children ?? []) {
    if (child.type === 'command') {
      entry[child.name] = buildCommandEntry(child);
    } else if (child.type === 'group') {
      entry[child.name] = buildGroupEntry(child);
    }
  }

  return entry;
}

function buildYamlDoc(root, pkgJson, profileGroups) {
  return {
    _meta: {
      plugin: root.name,
      npmPackage: pkgJson.name ?? root.name,
      version: pkgJson.version ?? 'unknown',
      extractedAt: new Date().toISOString(),
      profileGroups,
    },
    [root.name]: buildGroupEntry(root),
  };
}

// ============================================================================
// Statistics
// ============================================================================

function countNodes(node) {
  let groups = node.type === 'group' ? 1 : 0;
  let commands = node.type === 'command' ? 1 : 0;
  for (const child of node.children ?? []) {
    const sub = countNodes(child);
    groups += sub.groups;
    commands += sub.commands;
  }
  return { groups, commands };
}

// ============================================================================
// Main extraction (runs in worker process with NODE_PATH set)
// ============================================================================

function runExtraction(args) {
  info(`Finding plugin "${args.plugin}"...`);

  const { pkgDir, pkgJson, config } = findPlugin(args.plugin);
  info(`Found: ${pkgJson.name ?? args.plugin}@${pkgJson.version ?? 'unknown'}`);
  info(`  Location: ${pkgDir}`);

  // The configuration module's directory is typically lib/ — search for defs there.
  const configModuleRel = pkgJson.imperative.configurationModule;
  const libDir = join(pkgDir, dirname(configModuleRel));
  info(`Scanning for definition files in ${libDir}...`);

  const defFiles = findDefinitionFiles(libDir);
  info(`Found ${defFiles.length} definition file(s)`);

  // Build command tree with passOn fully resolved.
  const root = buildCommandTree(config, defFiles);
  const { groups, commands } = countNodes(root);
  info(`Command tree: ${groups} group(s), ${commands} command(s)`);

  // Classify option groups for profile guidance.
  const profileGroups = collectProfileGroups(root);
  info(`Profile groups:`);
  info(`  connection: [${profileGroups.connection.join(', ') || 'none detected'}]`);
  info(`  location:   [${profileGroups.location.join(', ') || 'none detected'}]`);

  // Build the YAML document object.
  const doc = buildYamlDoc(root, pkgJson, profileGroups);

  // Serialize with js-yaml (available via workspace node_modules).
  let jsYaml;
  try {
    jsYaml = require('js-yaml');
  } catch {
    throw new Error(
      'js-yaml not found. Run: npm install   from the repo root to install dependencies.'
    );
  }

  const yamlBody = jsYaml.dump(doc, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });

  const pluginName = args.plugin;
  const npmFlag = args.npm ? ` --npm ${args.npm}` : '';
  const outputFlag = args.output ? ` --output ${args.output}` : '';
  const header = [
    `# CLI commands YAML — auto-generated by scripts/generate-cli-bridge-yaml.mjs`,
    `# plugin: ${pkgJson.name ?? root.name}, version: ${pkgJson.version ?? 'unknown'}`,
    `# Regenerate: node scripts/generate-cli-bridge-yaml.mjs --plugin ${pluginName}${npmFlag}${outputFlag}`,
    `#`,
    `# Used by MCP tools YAML via $.path syntax, e.g.:`,
    `#   description: "$.${pluginName}.<group>.<command>.options.<optName>"`,
    `#   -> resolves to the option's description string`,
    ``,
  ].join('\n');

  const output = header + yamlBody;

  if (args.output) {
    // Ensure the output directory exists before writing.
    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, output, 'utf8');
    info(`Wrote ${output.length} bytes to ${args.output}`);
  } else {
    process.stdout.write(output);
  }

  info('Done.');
}

// ============================================================================
// Entry point
// ============================================================================

const args = parseArgs(process.argv);

if (!process.env._CLI_YAML_WORKER) {
  // ---- PARENT PROCESS: download/install plugin, find NODE_PATH, re-spawn ----

  let needUninstall = false;
  let npmTempDir = null; // temp dir created for --npm; cleaned up after extraction

  try {
    // --npm: download latest package from npm, then treat as --tgz
    if (args.npm) {
      let downloaded;
      try {
        downloaded = downloadFromNpm(args.npm);
      } catch (e) {
        console.error(`[generate-cli-bridge-yaml] ${e.message}`);
        process.exit(1);
      }
      args.tgz = downloaded.tgzPath;
      npmTempDir = downloaded.tempDir;
    }

    // --tgz (or resolved from --npm): install plugin into Zowe CLI
    if (args.tgz) {
      try {
        installPlugin(args.tgz);
        needUninstall = !args.keepInstalled;
      } catch (e) {
        console.error(`[generate-cli-bridge-yaml] ${e.message}`);
        process.exit(1);
      }
    }

    let zoweCliNm;
    try {
      zoweCliNm = findZoweCliNodeModules();
      info(`Using Zowe CLI node_modules: ${zoweCliNm}`);
    } catch (e) {
      console.error(`[generate-cli-bridge-yaml] ${e.message}`);
      process.exit(1);
    }

    const nodePath = [zoweCliNm, process.env.NODE_PATH].filter(Boolean).join(':');

    const result = spawnSync(process.execPath, [__filename, ...process.argv.slice(2)], {
      env: { ...process.env, NODE_PATH: nodePath, _CLI_YAML_WORKER: '1' },
      stdio: 'inherit',
    });

    if (needUninstall) {
      uninstallPlugin(args.plugin);
    }

    process.exit(result.status ?? (result.signal ? 1 : 0));
  } finally {
    // Clean up the temp directory used for --npm download
    if (npmTempDir) {
      try {
        rmSync(npmTempDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  }
} else {
  // ---- WORKER PROCESS: NODE_PATH is set, plugin requires resolve correctly ----
  try {
    runExtraction(args);
  } catch (e) {
    console.error(`[generate-cli-bridge-yaml] Error: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(1);
  }
}
