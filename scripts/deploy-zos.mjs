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
 * Deploys a workspace package (the SAF IdP or the MCP server) to a z/OS LPAR
 * over SSH (key auth) and restarts it.
 *
 *   npm run deploy:zos -- <target> [--skip-pack] [--no-restart] [--launch=shell|jcl]
 *
 * <target> names a JSON file in deploy/<target>.json — per-system, per-service
 * configuration (package, hosts, paths, ports, environment contract, start
 * arguments). Those files typically contain internal hostnames/userids, so
 * everything in deploy/ except the committed *example* is gitignored. Secrets
 * never go in the JSON: put them in deploy/.env (gitignored) and reference them
 * as "${ENV:NAME}"; the optional post-deploy login smoke test reads its
 * credentials from env names given in the config.
 *
 * Steps: npm pack (prepack bundles deps) -> scp one tgz -> npm install on the
 * LPAR -> doctor (IdP only, informational) -> stop old process -> start new ->
 * verify (startup log line + verify URL [+ optional real /login smoke, run on
 * the LPAR because /login is loopback-only]).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PACKAGE = 'zowe-mcp-zos-saf-idp';
// z/OS OpenSSH banner noise that would drown the useful output.
const SSH_NOISE = /post-quantum|store now|openssh\.com|^\*\*/;

function fail(message) {
  console.error(`deploy-zos: ${message}`);
  process.exit(1);
}

/** deploy/.env: KEY=VALUE lines (never overrides already-set variables). */
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!(key in process.env)) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

/** Replaces "${ENV:NAME}" in any string value with process.env.NAME. */
function interpolate(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{ENV:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
      const resolved = process.env[name];
      if (resolved === undefined)
        fail(`config references \${ENV:${name}} but it is not set (deploy/.env?)`);
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map(interpolate);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v)]));
  }
  return value;
}

function loadConfig(target) {
  const path = join(repoRoot, 'deploy', `${target}.json`);
  if (!existsSync(path)) {
    fail(
      `no such target: ${path}\nCreate it from deploy/example-idp.json (see deploy/README.md).`
    );
  }
  const config = interpolate(JSON.parse(readFileSync(path, 'utf8')));
  for (const key of ['sshDest', 'remoteDir', 'startArgs', 'logFile', 'stopPattern']) {
    if (!config[key]) fail(`deploy/${target}.json is missing "${key}"`);
  }
  // The stop procedure is a kill (pidfile or ps pattern), and every killed
  // z/OS node process leaks ~2 IPC message queues (epoll emulation). At the
  // system IPCMSGNIDS cap, every new node process on the LPAR — any user —
  // dies at startup (msgget EDC5133I -> SIGABRT in epoll_create1). So the
  // contract defaults __IPC_CLEANUP=1 (node reaps its own user's stale
  // queues at startup); a target can still override it explicitly.
  config.runtimeEnv = { __IPC_CLEANUP: '1', ...config.runtimeEnv };
  return config;
}

function denoised(result) {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    .split('\n')
    .filter(line => !SSH_NOISE.test(line))
    .join('\n')
    .trim();
  return { status: result.status ?? 1, output };
}

function run(command, args, options = {}) {
  return denoised(
    spawnSync(command, args, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'], ...options })
  );
}

/** Runs a shell script on the LPAR (passed via stdin to survive quoting). */
function sshScript(config, script, { allowFailure = false } = {}) {
  const result = denoised(
    spawnSync('ssh', [config.sshDest, 'sh -s'], { input: script, encoding: 'utf8' })
  );
  if (result.status !== 0 && !allowFailure) {
    // The script is deliberately not echoed: it carries the environment
    // contract, which may hold secrets interpolated from deploy/.env.
    fail(`remote step failed (rc=${result.status}):\n${result.output}`);
  }
  return result;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

// --- JCL launch mode (config "launch": "jcl" or --launch=jcl) ---------------
//
// Runs the server as a batch job (BPXBATCH) instead of an ssh-orphaned nohup
// process: operations can see, hold, and account for it like any other job.
// Two z/OS realities shape the generated JCL (validated on Host-A, 2026-09-15):
//
//  - STDENV is NOT used for the contract. BPXBATCH SH starts a LOGIN shell,
//    so /etc/profile and ~/.profile run AFTER STDENV and override anything it
//    set (IBM documents this; on Host-A it silently dropped PATH). Instead the
//    STDPARM command sources a generated env file — that runs last and wins.
//  - STDPARM in-stream records are 80-column and are joined with blanks, so
//    no single token (a path, one argument) may exceed one record. Long
//    values live in the env file, which has no such limit.
//
// The command writes $$ to .deploy.pid before exec'ing node, so the pidfile
// stop/verify logic is identical in both launch modes, and killing that pid
// ends the batch job (BPXBATCH is waiting on the child).

const JCL_ENV_FILE = '.deploy-jcl.env';
const JCL_FILE = '.deploy.jcl';
const JCL_RECORD_MAX = 71;

/** The env contract as a sourceable shell file (values single-quoted). */
function buildJclEnvFile(config) {
  const lines = ['# generated by scripts/deploy-zos.mjs -- JCL-launch env contract'];
  for (const [key, value] of Object.entries(config.runtimeEnv ?? {})) {
    lines.push(`export ${key}=${shellQuote(value)}`);
  }
  if (config.prependPath?.length) {
    lines.push(`export PATH=${shellQuote(config.prependPath.join(':'))}:"$PATH"`);
  }
  return lines.join('\n');
}

/** Packs command tokens into <=71-char STDPARM records (joined with blanks). */
function packStdparm(tokens) {
  const records = [];
  let current = 'SH';
  for (const token of tokens) {
    if (token.length > JCL_RECORD_MAX) {
      fail(
        `JCL launch: token longer than a ${JCL_RECORD_MAX}-char STDPARM record: "${token}". ` +
          'Move the long value into runtimeEnv (the env file has no length limit).'
      );
    }
    if (current.length + 1 + token.length > JCL_RECORD_MAX) {
      records.push(current);
      current = token;
    } else {
      current = current === '' ? token : `${current} ${token}`;
    }
  }
  if (current) records.push(current);
  return records;
}

/** JES jobname: config override, else Z + target (uppercased, non-alnum stripped). */
function jclJobName(config, target) {
  const name =
    config.jclJobName ?? `Z${target.toUpperCase().replace(/[^A-Z0-9]/g, '')}`.slice(0, 8);
  if (!/^[A-Z@#$][A-Z0-9@#$]{0,7}$/.test(name)) {
    fail(`JCL launch: invalid jobname "${name}" — set "jclJobName" in the target config`);
  }
  return name;
}

/** The complete generated job. */
function buildJcl(config, target, entry) {
  const jobName = jclJobName(config, target);
  const account = config.jclAccount ?? 'ACCT#';
  const jobCard = config.jclJobCard ?? [
    `//${jobName.padEnd(8)} JOB (${account}),'ZOWE MCP DEPLOY',CLASS=A,MSGCLASS=X,`,
    '//         MSGLEVEL=(1,1),TIME=NOLIMIT,REGION=0M',
  ];
  const tokens = [
    'cd',
    shellQuote(config.remoteDir),
    '&&',
    '.',
    `./${JCL_ENV_FILE}`,
    '&&',
    'echo',
    '$$',
    '>',
    '.deploy.pid',
    '&&',
    'exec',
    'node',
    ...(config.nodeFlags ?? []),
    entry,
    ...(config.startArgs ?? []).map(shellQuote),
    '>>',
    shellQuote(config.logFile),
    '2>&1',
  ];
  const lines = [
    ...jobCard,
    `//* ${config.package ?? DEFAULT_PACKAGE} under BPXBATCH -- generated by`,
    '//* scripts/deploy-zos.mjs; the env contract is sourced from',
    `//* ${config.remoteDir}/${JCL_ENV_FILE}`,
    '//RUN      EXEC PGM=BPXBATCH',
    '//STDPARM  DD *',
    ...packStdparm(tokens),
    '/*',
    '//STDOUT   DD SYSOUT=*',
    '//STDERR   DD SYSOUT=*',
  ];
  for (const line of lines) {
    if (line.length > 80) fail(`JCL launch: generated JCL line exceeds 80 columns: "${line}"`);
  }
  return lines.join('\n');
}

/** Version of the named workspace package (looked up by package.json name). */
function findWorkspacePackageVersion(name) {
  for (const dir of readdirSync(join(repoRoot, 'packages'))) {
    const packageJson = join(repoRoot, 'packages', dir, 'package.json');
    if (!existsSync(packageJson)) continue;
    const parsed = JSON.parse(readFileSync(packageJson, 'utf8'));
    if (parsed.name === name) return parsed.version;
  }
  fail(`no workspace package named "${name}" under packages/`);
}

/** npm's tarball naming: scope's @ dropped, / becomes -, then -<version>.tgz. */
function tarballName(name, version) {
  return `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
}

async function main() {
  const args = process.argv.slice(2);
  const target = args.find(a => !a.startsWith('--'));
  if (!target) fail('usage: npm run deploy:zos -- <target> [--skip-pack] [--no-restart]');
  const skipPack = args.includes('--skip-pack');
  const noRestart = args.includes('--no-restart');

  loadDotEnv(join(repoRoot, 'deploy', '.env'));
  const config = loadConfig(target);
  // Launch mode: "shell" (nohup over ssh) or "jcl" (BPXBATCH batch job).
  // CLI --launch=<mode> overrides the config's "launch"; default is shell.
  const launch =
    args.find(a => a.startsWith('--launch='))?.slice('--launch='.length) ??
    config.launch ??
    'shell';
  if (!['shell', 'jcl'].includes(launch)) fail(`unknown launch mode "${launch}" (shell | jcl)`);
  // The workspace package to deploy — its package.json name (e.g.
  // "zowe-mcp-zos-saf-idp" or "@zowe/mcp-server").
  const packageName = config.package ?? DEFAULT_PACKAGE;
  const packageVersion = findWorkspacePackageVersion(packageName);
  const nodeFlags = (config.nodeFlags ?? []).join(' ');
  const entry = config.startEntry ?? `node_modules/${packageName}/dist/index.js`;

  // Environment contract. On z/OS the inherited environment differs wildly by
  // launch path (JCL/BPXBATCH vs login shell vs non-interactive ssh, which gets
  // a bare PATH=/bin and no profile) — so every variable the runtime RELIES ON
  // is set explicitly to its expected value here, and nothing else is touched:
  // user-owned settings (TZ, LANG, HOME, ...) stay exactly as the user has
  // them. PATH is prepended, not replaced, for the same reason. `remoteSetup`
  // (sourcing a site script) remains available but is discouraged: such
  // scripts often set more than the runtime needs (compiler and npm_config_*
  // variables, say), which makes the deployment depend on their contents.
  const envPrelude = [
    config.remoteSetup ?? 'true',
    ...Object.entries(config.runtimeEnv ?? {}).map(
      ([key, value]) => `export ${key}=${shellQuote(value)}`
    ),
    ...(config.prependPath?.length
      ? [`export PATH=${config.prependPath.map(shellQuote).join(':')}:"$PATH"`]
      : []),
  ].join('\n');

  const tgz = tarballName(packageName, packageVersion);

  // Log the applied contract — the started process's log also records its
  // effective environment, so both sides of "what state did it run with" exist.
  console.log(
    `deploying ${packageName}@${packageVersion} to ${config.sshDest}:${config.remoteDir}`
  );
  console.log('environment contract (set explicitly; everything else inherited untouched):');
  for (const [key, value] of Object.entries(config.runtimeEnv ?? {})) {
    console.log(`  ${key}=${value}`);
  }
  if (config.prependPath?.length) {
    console.log(`  PATH prepend: ${config.prependPath.join(':')}`);
  }

  // 1. Pack (prepack bundles the production dependency tree into the tarball).
  if (skipPack) {
    console.log(`[1/6] pack: skipped (--skip-pack), using existing ${tgz}`);
    if (!existsSync(join(repoRoot, tgz)))
      fail(`--skip-pack, but ${tgz} does not exist at the repo root`);
  } else {
    console.log(`[1/6] npm pack -w ${packageName} ...`);
    const pack = run('npm', ['pack', '-w', packageName], { cwd: repoRoot });
    if (pack.status !== 0) fail(`npm pack failed:\n${pack.output}`);
  }

  // 2. Ship the single tgz (binary scp — never file-by-file, never shell tar).
  console.log(`[2/6] scp ${tgz} -> ${config.sshDest}:${config.remoteDir}/`);
  const scp = run('scp', ['-q', join(repoRoot, tgz), `${config.sshDest}:${config.remoteDir}/`]);
  if (scp.status !== 0) fail(`scp failed:\n${scp.output}`);

  // 3. Install on the LPAR. The package.json guard matters: npm walks UP to the
  // nearest package root, so without one here it would install into a parent.
  console.log('[3/6] remote npm install ...');
  const install = sshScript(
    config,
    `set -e
${envPrelude}
cd ${shellQuote(config.remoteDir)}
[ -f package.json ] || printf '{ "name": "zowe-mcp-deploy", "version": "1.0.0", "private": true }\\n' > package.json
npm install --no-audit --no-fund ./${tgz} 2>&1 | tail -2
echo REMOTE_INSTALL_OK`
  );
  if (!install.output.includes('REMOTE_INSTALL_OK'))
    fail(`remote install did not confirm:\n${install.output}`);
  console.log(install.output.split('\n').slice(-3).join('\n'));

  // 4. Doctor (IdP only; informational — with --saf-check auto it still starts on ssh).
  const hasDoctor = config.doctor ?? packageName === DEFAULT_PACKAGE;
  if (hasDoctor) {
    console.log('[4/6] remote doctor ...');
    const doctor = sshScript(
      config,
      `${envPrelude}
cd ${shellQuote(config.remoteDir)}
node ${nodeFlags} ${entry} doctor`,
      { allowFailure: true }
    );
    console.log(doctor.output);
  } else {
    console.log(`[4/6] doctor: skipped (${packageName} has no doctor subcommand)`);
  }

  if (noRestart) {
    console.log('--no-restart: leaving the running process alone. Done.');
    return;
  }

  // 5. Stop the old process and start the new one. Primary stop mechanism is a
  // pidfile this script writes at start; the ps fallback must use a SHORT
  // pattern — z/OS `ps -ef` truncates command lines (on the validation LPAR,
  // right at "node_modules/zowe-mcp-zos-saf"), so a pattern containing the
  // args after that point never matches.
  console.log(
    `[5/6] restart via ${launch} (pidfile + fallback pattern: ${config.stopPattern}) ...`
  );
  // The stop half is identical in both modes: in JCL mode the job's shell
  // wrote its own pid to .deploy.pid before exec'ing node, and killing that
  // pid also ends the batch job (BPXBATCH is waiting on it).
  const stopScript = `cd ${shellQuote(config.remoteDir)}
if [ -f .deploy.pid ] && kill -0 "$(cat .deploy.pid)" 2>/dev/null; then
  echo "stopping (pidfile): $(cat .deploy.pid)"; kill "$(cat .deploy.pid)"; sleep 2
fi
PIDS=$(ps -ef | grep -F ${shellQuote(config.stopPattern)} | grep -v grep | awk '{print $2}')
if [ -n "$PIDS" ]; then echo "stopping (ps match): $PIDS"; kill $PIDS; sleep 2; else echo "no ps-matched process"; fi
rm -f .deploy.pid`;
  const startScript =
    launch === 'jcl'
      ? `cat > ${JCL_ENV_FILE} <<'ZMCP_EOF_ENV'
${buildJclEnvFile(config)}
ZMCP_EOF_ENV
cat > ${JCL_FILE} <<'ZMCP_EOF_JCL'
${buildJcl(config, target, entry)}
ZMCP_EOF_JCL
chmod 600 ${JCL_ENV_FILE} ${JCL_FILE}
${
  config.envFileGroup
    ? // STC interchange (docs/zos-stc-launch.md): the started task runs as a
      // different user that reads the env file via this group — 600 would
      // break the next `S <stc>` after a redeploy.
      `chgrp ${shellQuote(config.envFileGroup)} ${JCL_ENV_FILE} && chmod 640 ${JCL_ENV_FILE}`
    : ':'
}
SUBMIT_OUT=$(submit ${JCL_FILE})
echo "$SUBMIT_OUT"
echo "$SUBMIT_OUT" | awk '{print $2}' > .deploy.jobid`
      : `nohup node ${nodeFlags} ${entry} ${(config.startArgs ?? []).map(shellQuote).join(' ')} < /dev/null >> ${shellQuote(config.logFile)} 2>&1 &
echo $! > .deploy.pid
echo "started pid $!"`;
  const restart = sshScript(config, `${envPrelude}\n${stopScript}\n${startScript}`);
  console.log(restart.output);

  // 6. Verify: process alive, the startup log line, then the discovery endpoint.
  console.log('[6/6] verify ...');
  // JCL mode waits longer: JES scheduling + BPXBATCH shell startup precede
  // the node process writing .deploy.pid and the startup log lines.
  await sleep(launch === 'jcl' ? 12_000 : 4000);
  // The env contract matters here too: the log is ASCII-tagged (written by
  // node), so reading it needs _BPXK_AUTOCVT to come out as text.
  const logCheck = sshScript(
    config,
    `${envPrelude}
cd ${shellQuote(config.remoteDir)}
if kill -0 "$(cat .deploy.pid)" 2>/dev/null; then echo "process alive: $(cat .deploy.pid)"; else echo "PROCESS DIED"; fi
tail -20 ${shellQuote(config.logFile)}`,
    { allowFailure: true }
  );
  console.log(`--- last log lines:\n${logCheck.output}`);
  if (logCheck.output.includes('PROCESS DIED')) {
    fail('the started process is no longer running — see the log lines above');
  }
  // expectLog: one line or a list — every listed line must appear at startup.
  const expectedLogLines = Array.isArray(config.expectLog)
    ? config.expectLog
    : config.expectLog
      ? [config.expectLog]
      : [];
  for (const expected of expectedLogLines) {
    if (!logCheck.output.includes(expected)) {
      fail(`expected startup log line not found: "${expected}"`);
    }
  }
  if (config.verifyUrl) {
    // verifyStatus lets a protected endpoint count as alive — e.g. the MCP
    // server's /mcp answers 401 to an unauthenticated probe by design.
    const expectedStatuses = config.verifyStatus ?? [200];
    let response;
    try {
      response = await fetch(config.verifyUrl, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      // An https verify URL behind AT-TLS with a local CA fails TLS trust
      // unless the CA is loaded at Node startup — point at the fix directly.
      const cause = err?.cause?.code ?? err?.cause?.message ?? err.message;
      if (config.verifyUrl.startsWith('https:') && !process.env.NODE_EXTRA_CA_CERTS) {
        fail(
          `verify URL fetch failed (${cause}). ${config.verifyUrl} is https and ` +
            'NODE_EXTRA_CA_CERTS is not set — if the server uses a private CA, re-run as: ' +
            `NODE_EXTRA_CA_CERTS=deploy/<ca>.pem npm run deploy:zos -- <target>`
        );
      }
      fail(`verify URL fetch failed: ${cause} (${config.verifyUrl})`);
    }
    if (!expectedStatuses.includes(response.status)) {
      fail(
        `verify URL ${config.verifyUrl} -> HTTP ${response.status} (expected ${expectedStatuses.join('/')})`
      );
    }
    console.log(`verify URL OK: HTTP ${response.status} ${config.verifyUrl}`);
    if (response.status === 200) {
      const body = await response.json().catch(() => undefined);
      if (body?.issuer) console.log(`discovery issuer: ${body.issuer}`);
    }
  }

  // Optional real-credential smoke test — /login is loopback-only, so it runs
  // ON the LPAR; credentials come from deploy/.env via the configured env names.
  const smoke = config.smokeLogin;
  const smokeUser = smoke && process.env[smoke.usernameEnv];
  const smokePassword = smoke && process.env[smoke.passwordEnv];
  if (smoke && smokeUser && smokePassword) {
    const script = `${envPrelude}
export SMOKE_USER=${shellQuote(smokeUser)} SMOKE_PASSWORD=${shellQuote(smokePassword)}
node ${nodeFlags} -e '
const res = await fetch("http://127.0.0.1:${Number(smoke.port)}/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: process.env.SMOKE_USER, password: process.env.SMOKE_PASSWORD }),
});
console.log("smoke /login:", res.status);
process.exit(res.status === 200 ? 0 : 1);
' --input-type=module`;
    const result = sshScript(config, script, { allowFailure: true });
    console.log(result.output);
    if (result.status !== 0) fail('smoke login failed');
  } else if (smoke) {
    console.log(
      'smoke login skipped (the variables named by smokeLogin are not set in deploy/.env)'
    );
  }

  console.log('Deployment complete.');
}

await main();
