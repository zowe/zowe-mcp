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

import { parseArgs } from 'node:util';
import type { ClientMetadata } from 'oidc-provider';
import { parseAtTlsMode, parseLoopbackClear, type AtTlsMode } from 'zos-attls';
import { detectSecurityProduct } from './esm-detect.js';
import {
  describeRuntimeEnvironment,
  formatDoctorReport,
  runAtTlsDoctorChecks,
  runSafDoctor,
} from './saf-doctor.js';
import { SAF_CHECK_MODES, type SafCheckMode } from './saf-verify.js';
import { DEFAULT_MCP_RESOURCE, startIdpHttp } from './server.js';

/**
 * `ZOWE_MCP_IDP_STATIC_CLIENTS` carries inline JSON (an array of OAuth client
 * metadata objects), deliberately NOT a file path: reading config files on
 * z/OS USS risks the fs.readFileSync EBCDIC-corruption bug.
 */
function parseStaticClients(raw: string | undefined): ClientMetadata[] | undefined {
  if (!raw) return undefined;
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('ZOWE_MCP_IDP_STATIC_CLIENTS must be a JSON array of client metadata');
  }
  return parsed as ClientMetadata[];
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string', default: '8089' },
      host: { type: 'string', default: '127.0.0.1' },
      issuer: { type: 'string' },
      'token-ttl': { type: 'string', default: '300' },
      'mcp-resource': { type: 'string', default: DEFAULT_MCP_RESOURCE },
      'redirect-allow': { type: 'string', multiple: true },
      'auto-consent': { type: 'boolean', default: false },
      'trust-proxy': { type: 'boolean', default: false },
      // External header-less TLS termination (z/OS AT-TLS): serve https URLs
      // over the plaintext local socket. Mutually exclusive with --trust-proxy.
      'tls-terminated': { type: 'boolean', default: false },
      'allow-nonloopback': { type: 'boolean', default: false },
      // Login-form branding: defaults are the live host name and a
      // testing-purposes disclaimer (see server.ts).
      'system-name': { type: 'string' },
      'login-notice': { type: 'string' },
      'security-product': { type: 'string' },
      // SAF verification backend: auto (native on z/OS when node-racf loads,
      // else the SSH probe), native (require node-racf), or ssh.
      'saf-check': { type: 'string', default: 'auto' },
      // AT-TLS aware mode (off | monitor | required): verify per connection
      // that AT-TLS secured it; required = fail-closed. Needs --tls-terminated.
      attls: { type: 'string', default: 'off' },
      // doctor subcommand only: also apply the extattr +p part of the setup.
      fix: { type: 'boolean', default: false },
    },
  });

  // `zowe-mcp-zos-saf-idp doctor [--fix] [--attls <mode>]`: native-backend
  // environment checks plus setup instructions; --fix applies only the USS
  // (extattr) part. The AT-TLS section also activates when
  // ZOWE_MCP_ATTLS_MODULE is set (deploy runs doctor without the start flags).
  if (positionals[0] === 'doctor') {
    const report = runSafDoctor({ fix: values.fix });
    try {
      report.checks.push(...(await runAtTlsDoctorChecks({ mode: parseAtTlsMode(values.attls) })));
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }
    const ok = report.checks.every(check => check.status !== 'fail');
    console.log(formatDoctorReport({ ...report, ok }));
    process.exitCode = ok ? 0 : 1;
    return;
  }
  if (positionals.length > 0) {
    console.error(`unknown command '${positionals[0]}' (did you mean 'doctor'?)`);
    process.exitCode = 1;
    return;
  }

  const safCheck = values['saf-check'] as SafCheckMode;
  if (!SAF_CHECK_MODES.includes(safCheck)) {
    console.error(
      `--saf-check must be one of ${SAF_CHECK_MODES.join(', ')} (got '${values['saf-check']}')`
    );
    process.exitCode = 1;
    return;
  }

  let attls: AtTlsMode;
  let attlsLoopbackClear: boolean;
  try {
    attls = parseAtTlsMode(values.attls);
    attlsLoopbackClear = parseLoopbackClear(process.env.ZOWE_MCP_ATTLS_LOOPBACK_CLEAR);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  const host = values.host;
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`--port must be an integer 0-65535 (got '${values.port}')`);
    process.exitCode = 1;
    return;
  }
  const scheme = values['tls-terminated'] ? 'https' : 'http';
  const issuer = values.issuer ?? `${scheme}://${host}:${port}`;
  const tokenTtlSeconds = Number(values['token-ttl']);
  if (!Number.isInteger(tokenTtlSeconds) || tokenTtlSeconds <= 0) {
    // NaN here would otherwise surface far downstream as tokens with a broken
    // exp claim ("JWT missing exp claim") with no hint at the real cause.
    console.error(
      `--token-ttl must be a positive integer of seconds (got '${values['token-ttl']}')`
    );
    process.exitCode = 1;
    return;
  }

  let staticClients: ClientMetadata[] | undefined;
  try {
    staticClients = parseStaticClients(process.env.ZOWE_MCP_IDP_STATIC_CLIENTS);
  } catch (err) {
    console.error(
      'Invalid ZOWE_MCP_IDP_STATIC_CLIENTS:',
      err instanceof Error ? err.message : String(err)
    );
    process.exitCode = 1;
    return;
  }

  // The environment differs per system/user/launch path (JCL vs shell vs
  // non-interactive ssh) — log the variables this runtime relies on, so the
  // state the process actually ran with is always in its log.
  console.log(`Runtime environment: ${describeRuntimeEnvironment()}`);

  // Best-effort ESM detection (z/OS only, quiet fallback to the generic label).
  const securityProduct = values['security-product'] ?? (await detectSecurityProduct());
  if (securityProduct) {
    console.log(`Security product for the login page: ${securityProduct}`);
  }

  startIdpHttp({
    host,
    port,
    issuer,
    tokenTtlSeconds,
    safCheck,
    mcpResource: values['mcp-resource'],
    redirectAllow: values['redirect-allow'],
    autoConsent: values['auto-consent'],
    trustProxy: values['trust-proxy'],
    tlsTerminated: values['tls-terminated'],
    attls,
    attlsLoopbackClear,
    allowNonLoopback: values['allow-nonloopback'],
    systemName: values['system-name'],
    loginNotice: values['login-notice'],
    securityProduct,
    staticClients,
    log: message => console.error(message),
  })
    .then(handle => {
      console.log(
        `zowe-mcp-zos-saf-idp listening on ${scheme}://${host}:${handle.port}` +
          (values['tls-terminated']
            ? ' (plaintext local socket; TLS terminated externally, e.g. AT-TLS)'
            : '') +
          ` (issuer ${handle.issuer})`
      );
      if (attls !== 'off') {
        console.log(
          `AT-TLS aware mode: ${attls} (loopback-clear: ${attlsLoopbackClear ? 'allow' : 'reject'})`
        );
      }
      console.log(
        `OAuth AS ready: discovery ${handle.issuer}/.well-known/openid-configuration, ` +
          `tokens bound to resource ${values['mcp-resource']}`
      );
    })
    .catch((err: unknown) => {
      console.error(
        'Failed to start zowe-mcp-zos-saf-idp:',
        err instanceof Error ? err.message : err
      );
      process.exitCode = 1;
    });
}

// A synchronous throw inside main() must not escape as an unhandled
// rejection — surface it like every other startup failure.
main().catch((err: unknown) => {
  console.error('Failed to start zowe-mcp-zos-saf-idp:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
