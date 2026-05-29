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
 * download-zosmf-specs.mjs
 *
 * Downloads z/OSMF OpenAPI/Swagger JSON specs from a live z/OSMF server and
 * saves them to resources/zosmf/<zos-version>/ (gitignored).
 *
 * z/OSMF uses IBM WebSphere Liberty's mpOpenAPI feature. The merged spec for
 * all services is served at /zosmf/api/docs; individual service specs are at
 * /zosmf/api/docs/<serviceContextRoot>. The /zosmf/info endpoint exposes the
 * z/OS version, which is used to label the output directory.
 *
 * Usage:
 *   node scripts/download-zosmf-specs.mjs [options]
 *
 *   --host <hostname>       z/OSMF HTTPS hostname (or ZOWE_MCP_ZOSMF_HOST)
 *   --port <port>           z/OSMF HTTPS port (default: 10443; or ZOWE_MCP_ZOSMF_PORT)
 *   --user <user>           z/OS user ID (or ZOWE_MCP_ZOSMF_USER)
 *   --password <pass>       Password (or ZOWE_MCP_ZOSMF_PASSWORD, ZOWE_MCP_CREDENTIALS,
 *                           ZOWE_MCP_PASSWORD_<USER>_<HOST>)
 *   --insecure              Skip TLS certificate verification (needed for self-signed certs)
 *   --output <dir>          Output directory (default: resources/zosmf)
 *   --no-version-subdir     Save directly to output dir, skip <version>/ subdirectory
 *   --from-config [path]    Load host/user from native-config.json (default path)
 *   --list-only             Fetch /zosmf/info and list discovered endpoints without saving
 *
 * Password resolution (highest priority first):
 *   1. --password CLI option
 *   2. ZOWE_MCP_ZOSMF_PASSWORD env var
 *   3. ZOWE_MCP_PASSWORD_<USER>_<HOST> (dots → underscores, uppercase)
 *   4. ZOWE_MCP_CREDENTIALS JSON map (user@host key)
 *
 * Examples:
 *   node scripts/download-zosmf-specs.mjs --host mymvs.example.com --user MYUSER --insecure
 *   node scripts/download-zosmf-specs.mjs --from-config native-config.json --insecure
 *   ZOWE_MCP_ZOSMF_HOST=mymvs.example.com ZOWE_MCP_ZOSMF_USER=MYUSER \
 *     ZOWE_MCP_PASSWORD_MYUSER_MYMVS_EXAMPLE_COM=secret node scripts/download-zosmf-specs.mjs
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');

// ─── Known z/OSMF service context roots ──────────────────────────────────────
// These are the Liberty application context roots used by z/OSMF services.
// Each maps to a separate swagger doc at /zosmf/api/docs/<context>.
const KNOWN_SERVICES = [
  {
    context: 'restfiles',
    filename: 'restfiles.json',
    desc: 'z/OS data set and file REST interface',
  },
  { context: 'restjobs', filename: 'restjobs.json', desc: 'z/OS jobs REST interface' },
  { context: 'tsoApp', filename: 'tso.json', desc: 'TSO/E address space services' },
  { context: 'restconsoles', filename: 'console.json', desc: 'z/OS console services' },
  { context: 'workflow', filename: 'workflow.json', desc: 'z/OSMF workflow services' },
  { context: 'zosmf', filename: 'zosmf-info.json', desc: 'z/OSMF information retrieval service' },
  {
    context: 'CloudProvisioning',
    filename: 'cloud-provisioning.json',
    desc: 'Cloud provisioning services',
  },
  {
    context: 'StorageManagement',
    filename: 'storage-management.json',
    desc: 'Storage management services',
  },
  { context: 'topology', filename: 'topology.json', desc: 'Sysplex management services' },
];

// ─── CLI argument parsing ─────────────────────────────────────────────────────

const { values: args, positionals } = parseArgs({
  options: {
    host: { type: 'string' },
    port: { type: 'string', default: '10443' },
    user: { type: 'string' },
    password: { type: 'string' },
    insecure: { type: 'boolean', default: false },
    output: { type: 'string', default: join(REPO_ROOT, 'resources', 'zosmf') },
    'no-version-subdir': { type: 'boolean', default: false },
    'from-config': { type: 'string', default: '' },
    'list-only': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
  strict: false,
});

if (args.help) {
  console.log(`
Usage: node scripts/download-zosmf-specs.mjs [options]

Downloads z/OSMF OpenAPI/Swagger JSON specs from a live z/OSMF server.
Output directory: resources/zosmf/<zos-version>/ (gitignored).

Options:
  --host <hostname>       z/OSMF HTTPS hostname (or ZOWE_MCP_ZOSMF_HOST)
  --port <port>           z/OSMF HTTPS port (default: 10443; or ZOWE_MCP_ZOSMF_PORT)
  --user <user>           z/OS user ID (or ZOWE_MCP_ZOSMF_USER)
  --password <pass>       Password (or ZOWE_MCP_ZOSMF_PASSWORD, ZOWE_MCP_CREDENTIALS,
                          ZOWE_MCP_PASSWORD_<USER>_<HOST>)
  --insecure              Skip TLS certificate verification (needed for self-signed certs)
  --output <dir>          Output directory (default: resources/zosmf)
  --no-version-subdir     Save directly to output dir, skip <version>/ subdirectory
  --from-config [path]    Load host/user from native-config.json (default if no path given)
  --list-only             Fetch /zosmf/info and list endpoints without saving files
  -h, --help              Show this help

Password resolution (highest priority first):
  1. --password CLI option
  2. ZOWE_MCP_ZOSMF_PASSWORD env var
  3. ZOWE_MCP_PASSWORD_<USER>_<HOST> (dots → underscores, uppercase)
  4. ZOWE_MCP_CREDENTIALS JSON map (user@host key)

Examples:
  node scripts/download-zosmf-specs.mjs --host mymvs.example.com --user MYUSER --insecure
  node scripts/download-zosmf-specs.mjs --from-config native-config.json --insecure
  node scripts/download-zosmf-specs.mjs --list-only --host mymvs.example.com --user MYUSER --insecure
`);
  process.exit(0);
}

// ─── Connection resolution ────────────────────────────────────────────────────

/**
 * Resolves host/user from native-config.json (SSH connection spec user@host).
 * Returns { host, user } or throws if the file is missing/malformed.
 */
function loadFromNativeConfig(configPath) {
  const resolved = resolvePath(configPath || join(REPO_ROOT, 'native-config.json'));
  if (!existsSync(resolved)) {
    throw new Error(
      `native-config.json not found at ${resolved} — provide --host and --user explicitly`
    );
  }
  const raw = JSON.parse(readFileSync(resolved, 'utf8'));
  const systems = raw.systems ?? [];
  if (!systems.length) {
    throw new Error(`No systems found in ${resolved}`);
  }
  // Use the first system entry. Format: "user@host" or "user@host:port".
  const first = systems[0];
  const match = /^([^@]+)@([^:]+)(?::\d+)?$/.exec(first);
  if (!match) {
    throw new Error(
      `Cannot parse system spec "${first}" in ${resolved} — expected user@host or user@host:port`
    );
  }
  return { host: match[2], user: match[1].toUpperCase() };
}

/**
 * Resolves the password using the same precedence as the MCP server's
 * resolveStandalonePassword() (without Vault/MCP-elicitation since this is a
 * short-lived CLI script).
 */
function resolvePassword(user, host) {
  // 1. Explicit --password flag
  if (args.password) return args.password;

  // 2. ZOWE_MCP_ZOSMF_PASSWORD env var
  const envDirect = process.env.ZOWE_MCP_ZOSMF_PASSWORD;
  if (envDirect) return envDirect;

  // 3. ZOWE_MCP_PASSWORD_<USER>_<HOST> (dots/colons/hyphens → underscores)
  const userPart = user.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const hostPart = host.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const envKey = `ZOWE_MCP_PASSWORD_${userPart}_${hostPart}`;
  const envPerHost = process.env[envKey];
  if (envPerHost) return envPerHost;

  // 4. ZOWE_MCP_CREDENTIALS JSON map
  const credentialsEnv = process.env.ZOWE_MCP_CREDENTIALS;
  if (credentialsEnv) {
    try {
      const map = JSON.parse(credentialsEnv);
      // Try user@host (case-insensitive)
      const key = `${user.toLowerCase()}@${host.toLowerCase()}`;
      for (const [k, v] of Object.entries(map)) {
        if (
          k
            .toLowerCase()
            .replace(/^([^@]+)@/, m => m)
            .startsWith(key) ||
          k.toLowerCase() === key
        ) {
          return v;
        }
      }
    } catch {
      // Malformed ZOWE_MCP_CREDENTIALS — silently skip
    }
  }

  return undefined;
}

// Determine host
let host = args.host ?? process.env.ZOWE_MCP_ZOSMF_HOST;
let user = args.user ?? process.env.ZOWE_MCP_ZOSMF_USER ?? process.env.ZOWE_MCP_ZOSMF_USERNAME;

// If --from-config was passed (with or without a path), load from native-config
const fromConfigPath = args['from-config'];
if (fromConfigPath !== '' || (!host && !user)) {
  // Load from config if --from-config was explicitly passed,
  // or if neither --host nor --user was given (auto-detect native-config.json)
  const loadConfig =
    fromConfigPath !== '' || (!host && !user && existsSync(join(REPO_ROOT, 'native-config.json')));
  if (loadConfig) {
    try {
      const loaded = loadFromNativeConfig(fromConfigPath || '');
      host = host ?? loaded.host;
      user = user ?? loaded.user;
    } catch (err) {
      if (fromConfigPath !== '') {
        // Explicitly requested --from-config → fatal
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
      // Auto-detect failed — will fall through to the missing-host error below
    }
  }
}

if (!host) {
  console.error(
    'Error: z/OSMF hostname is required. Use --host <hostname> or set ZOWE_MCP_ZOSMF_HOST.'
  );
  process.exit(1);
}
if (!user) {
  console.error('Error: z/OS user ID is required. Use --user <user> or set ZOWE_MCP_ZOSMF_USER.');
  process.exit(1);
}

const port = parseInt(args.port ?? process.env.ZOWE_MCP_ZOSMF_PORT ?? '10443', 10);
const password = resolvePassword(user, host);
const insecure = args.insecure;
const outputBase = resolvePath(args.output);
const noVersionSubdir = args['no-version-subdir'];
const listOnly = args['list-only'];

if (!password) {
  console.error(
    `Error: Password not found for ${user}@${host}.\n` +
      `Provide it via --password, ZOWE_MCP_ZOSMF_PASSWORD, ` +
      `ZOWE_MCP_PASSWORD_${user.toUpperCase()}_${host.toUpperCase().replace(/\./g, '_')}, ` +
      `or ZOWE_MCP_CREDENTIALS.`
  );
  process.exit(1);
}

console.log(`\nz/OSMF Spec Downloader`);
console.log(`  Server : https://${host}:${port}`);
console.log(`  User   : ${user}`);
console.log(`  TLS    : ${insecure ? 'skip verification (--insecure)' : 'verify certificate'}`);
if (!listOnly) {
  console.log(`  Output : ${outputBase}`);
}
console.log();

// ─── HTTPS request helper ─────────────────────────────────────────────────────

/**
 * Makes an HTTPS GET request to the z/OSMF server and resolves with
 * { statusCode, headers, body } (body as string).
 */
function zosmfGet(path, { follow = 2 } = {}) {
  return new Promise((res, rej) => {
    const options = {
      hostname: host,
      port,
      path,
      method: 'GET',
      rejectUnauthorized: !insecure,
      auth: `${user}:${password}`,
      headers: {
        'X-CSRF-ZOSMF-HEADER': 'zosmf-spec-downloader',
        Accept: 'application/json, */*',
      },
    };

    const req = https.request(options, resp => {
      // Follow redirects up to `follow` times
      if (
        (resp.statusCode === 301 || resp.statusCode === 302 || resp.statusCode === 307) &&
        resp.headers.location &&
        follow > 0
      ) {
        req.destroy();
        // Build new URL from location (may be absolute or relative)
        const loc = resp.headers.location;
        const newPath = loc.startsWith('http')
          ? new URL(loc).pathname + (new URL(loc).search ?? '')
          : loc;
        zosmfGet(newPath, { follow: follow - 1 })
          .then(res)
          .catch(rej);
        return;
      }

      let body = '';
      resp.setEncoding('utf8');
      resp.on('data', chunk => {
        body += chunk;
      });
      resp.on('end', () => res({ statusCode: resp.statusCode, headers: resp.headers, body }));
      resp.on('error', rej);
    });

    req.on('error', err => {
      if (
        err.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
        err.code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
        err.code === 'CERT_HAS_EXPIRED' ||
        err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
      ) {
        rej(new Error(`TLS error (${err.code}): use --insecure to skip certificate verification`));
      } else {
        rej(err);
      }
    });
    req.end();
  });
}

// ─── Spec download logic ──────────────────────────────────────────────────────

/**
 * Fetches a path and returns the parsed JSON, or null on non-200 / parse error.
 * Logs a one-line status.
 */
async function fetchSpec(path, label) {
  process.stdout.write(`  Fetching ${label} (${path}) … `);
  let resp;
  try {
    resp = await zosmfGet(path);
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    return null;
  }

  if (resp.statusCode === 401) {
    console.log('401 Unauthorized — check credentials');
    return null;
  }
  if (resp.statusCode === 404) {
    console.log('404 Not Found (endpoint not available on this server)');
    return null;
  }
  if (resp.statusCode !== 200) {
    console.log(`HTTP ${resp.statusCode}`);
    return null;
  }

  const ct = resp.headers['content-type'] ?? '';
  if (!ct.includes('json') && !ct.includes('yaml') && !ct.includes('text')) {
    console.log(`Unexpected Content-Type: ${ct}`);
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(resp.body);
    console.log(`OK (${Math.round(resp.body.length / 1024)} KB)`);
    return { json: parsed, raw: resp.body };
  } catch {
    // Some servers return YAML — save as raw text if not JSON
    if (resp.body.trim().startsWith('openapi:') || resp.body.trim().startsWith('swagger:')) {
      console.log(`OK (YAML, ${Math.round(resp.body.length / 1024)} KB)`);
      return { json: null, raw: resp.body, isYaml: true };
    }
    console.log(`JSON parse error — body starts: ${resp.body.slice(0, 80)}`);
    return null;
  }
}

/**
 * Saves a spec file to the output directory and logs the path.
 */
function saveSpec(outDir, filename, content) {
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, filename);
  writeFileSync(
    outPath,
    typeof content === 'string' ? content : JSON.stringify(content, null, 2),
    'utf8'
  );
  console.log(`  Saved  → ${outPath.replace(REPO_ROOT + '/', '')}`);
  return outPath;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Step 1: Fetch /zosmf/info to get z/OS version and validate credentials
  console.log('Step 1: Querying /zosmf/info for z/OS version …');
  const infoResult = await fetchSpec('/zosmf/info', 'z/OSMF info');
  if (!infoResult) {
    console.error('\nFailed to fetch /zosmf/info — check host, port, user, and password.');
    process.exit(1);
  }

  const info = infoResult.json;
  const zosVersion = info?.zos_version ?? 'unknown';
  const zosmfVersion = info?.zosmf_full_version ?? info?.zosmf_version ?? 'unknown';
  const zosmfHostname = info?.zosmf_hostname ?? host;

  console.log(`\n  z/OS version  : ${zosVersion}`);
  console.log(`  z/OSMF version: ${zosmfVersion}`);
  console.log(`  z/OSMF host   : ${zosmfHostname}`);

  // Derive a clean version tag like "2.5" or "3.1" from the raw value "04.28.00"
  const versionTag = deriveVersionTag(zosVersion, zosmfVersion);
  console.log(`  Version tag   : ${versionTag}`);

  const outDir = noVersionSubdir ? outputBase : join(outputBase, versionTag);

  if (listOnly) {
    console.log('\nStep 2: Listing available OpenAPI endpoints …');
    console.log(`  Main merged spec : https://${host}:${port}/zosmf/api/docs`);
    for (const svc of KNOWN_SERVICES) {
      console.log(
        `  ${svc.desc.padEnd(45)} https://${host}:${port}/zosmf/api/docs/${svc.context}`
      );
    }
    console.log('\nRun without --list-only to download all specs.');
    return;
  }

  console.log(`\nStep 2: Downloading OpenAPI specs → ${outDir.replace(REPO_ROOT + '/', '')}/`);
  let savedCount = 0;

  // Save the /zosmf/info response itself — useful as a version reference
  saveSpec(outDir, 'zosmf-info.json', info ?? infoResult.raw);
  savedCount++;

  // Step 2a: Main merged spec from /zosmf/api/docs
  const mergedResult = await fetchSpec('/zosmf/api/docs', 'merged all-services spec');
  if (mergedResult) {
    const ext = mergedResult.isYaml ? 'yaml' : 'json';
    saveSpec(outDir, `zosmf-api.${ext}`, mergedResult.json ?? mergedResult.raw);
    savedCount++;
  }

  // Step 2b: Per-service specs from /zosmf/api/docs/<context>
  console.log('\nStep 3: Downloading per-service specs …');
  for (const svc of KNOWN_SERVICES) {
    const result = await fetchSpec(`/zosmf/api/docs/${svc.context}`, svc.desc);
    if (result) {
      const ext = result.isYaml ? 'yaml' : 'json';
      const filename = svc.filename.replace(/\.[^.]+$/, `.${ext}`);
      saveSpec(outDir, filename, result.json ?? result.raw);
      savedCount++;
    }
  }

  console.log(`\nDone. Saved ${savedCount} file(s) to: ${outDir.replace(REPO_ROOT + '/', '')}/`);
  console.log('(These files are gitignored and will not be committed.)');
}

// ─── Version tag helper ───────────────────────────────────────────────────────

/**
 * Derives a clean version tag from the raw z/OSMF info fields.
 *
 * zos_version format: "04.28.00" where the first two digits encode:
 *   04.xx.00 → z/OS 2.x  (04 = release 4 of z/OS, major version 2)
 *   05.xx.00 → z/OS 3.x
 *
 * IBM's mapping (from release notes):
 *   04.28.00 → z/OS 2.5   (release 28 of OS/390 / z/OS product, MVS level 04.28)
 *   05.01.00 → z/OS 3.1
 *   05.02.00 → z/OS 3.2
 *
 * Fallback: use zosmf_full_version (e.g. "29.0") as the tag if mapping is unknown.
 */
function deriveVersionTag(zosVersion, zosmfFullVersion) {
  // Try to parse the raw z/OS version "MM.PP.00"
  const m = /^(\d{2})\.(\d{2})\.\d{2}$/.exec(zosVersion);
  if (m) {
    const major = parseInt(m[1], 10);
    const minor = parseInt(m[2], 10);
    // IBM z/OS version mapping
    const known = {
      // z/OS 2.x
      4.24: '2.1',
      4.25: '2.2',
      4.26: '2.3',
      4.27: '2.4',
      4.28: '2.5',
      // z/OS 3.x
      5.1: '3.1',
      5.2: '3.2',
      5.3: '3.3',
    };
    const key = `${major}.${minor}`;
    if (known[key]) return `zos-${known[key]}`;
    // Unknown sub-release: return raw "zos-MM.PP"
    return `zos-${major}.${minor}`;
  }

  // Fallback: use zosmf_full_version string, sanitized
  const sanitized = zosmfFullVersion.replace(/[^a-zA-Z0-9._-]/g, '-');
  return sanitized !== 'unknown' ? `zosmf-${sanitized}` : 'unknown-version';
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  if (process.env.ZOWE_MCP_DEBUG) console.error(err.stack);
  process.exit(1);
});
