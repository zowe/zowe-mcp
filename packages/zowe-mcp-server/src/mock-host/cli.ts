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
 * yargs CLI for the `mock-zos` subcommand.
 *
 * Subcommands:
 *   start          — bring up the daemon. Always starts the SSH listener;
 *                    additionally starts the z/OSMF HTTP listener if --http-port
 *                    is provided.
 *   gen-host-key   — force-regenerate the SSH host key under <mockDir>/_ssh/host_key.
 *   gen-fixtures   — seed users.json + sample datasets/USS/jobs.
 */

import yargs from 'yargs';
import { generateAndPersistHostKey } from './host-keys.js';
import { writeSampleFixtures } from './sample-data.js';
import { startMockZosHost } from './server.js';

export async function runMockZosCli(argv: string[]): Promise<void> {
  await yargs(argv)
    .scriptName('zowe-mcp-server mock-zos')
    .usage(
      'Run a standalone mock z/OS host.\n\n' +
        'The daemon speaks real SSH on --port (default 4022) and, when --http-port is\n' +
        'provided, also speaks a subset of the z/OSMF REST API (authentication only)\n' +
        'on that HTTP port. Both share the same fixtures under <mockDir>.\n\n' +
        'A real ssh client (ssh USER@127.0.0.1 -p PORT) can connect interactively;\n' +
        'a real Zowe SDK client (z/OSMF) can POST /zosmf/services/authenticate over HTTP.'
    )
    .command(
      'start',
      'Start the mock z/OS host (SSH always; HTTP/z/OSMF when --http-port is set)',
      y =>
        y.options({
          port: { type: 'number', default: 4022, describe: 'SSH port (0 for ephemeral)' },
          'mock-dir': { type: 'string', demandOption: true, describe: 'Mock data directory' },
          host: { type: 'string', default: '127.0.0.1', describe: 'Bind address for SSH' },
          'log-level': {
            type: 'string',
            default: 'info',
            choices: ['error', 'warn', 'info', 'debug', 'trace'] as const,
            describe: 'Log verbosity',
          },
          banner: {
            type: 'string',
            describe:
              'Pre-auth banner file (default: <mockDir>/_ssh/banner.txt, else built-in Zowe banner)',
          },
          'ssh-ident': {
            type: 'string',
            describe: 'SSH protocol ident string (default: SSH-2.0-OpenSSH_7.6p1)',
          },
          'host-key': {
            type: 'string',
            describe:
              'Explicit host key file. Otherwise resolved from ZOWE_MCP_MOCK_HOST_KEY env, ' +
              '<mockDir>/_ssh/host_key, or ~/.zowe-mcp/mock-host_key (a machine-stable cache).',
          },
          'isolate-host-key': {
            type: 'boolean',
            default: false,
            describe:
              'Do not consult or write the machine-stable cache. Treat the mockDir as self-contained.',
          },
          'http-port': {
            type: 'number',
            describe:
              'Enable the z/OSMF HTTP listener on this port (0 for ephemeral). ' +
              'Omitting the flag disables HTTP. Plain HTTP only; no TLS yet.',
          },
          'http-host': {
            type: 'string',
            default: '127.0.0.1',
            describe: 'Bind address for the z/OSMF HTTP listener',
          },
          verbose: {
            type: 'boolean',
            default: false,
            describe:
              'Dump full HTTP request + response details (headers, bodies). Authorization, ' +
              'Cookie, Set-Cookie, and X-CSRF-ZOSMF-HEADER values are redacted; bodies are ' +
              'truncated at 4 KiB. Independent of --log-level.',
          },
          'zosmf-version': {
            type: 'string',
            default: '5.30',
            choices: ['5.30'] as const,
            describe:
              'z/OSMF version to advertise in GET /zosmf/info ' +
              '(zos_version, zosmf_version, zosmf_full_version). ' +
              'Only applies when --http-port is set.',
          },
        }),
      async args => {
        const result = await startMockZosHost({
          host: args.host,
          port: args.port,
          mockDir: args['mock-dir'],
          logLevel: args['log-level'] as 'error' | 'warn' | 'info' | 'debug' | 'trace',
          bannerFile: args.banner,
          sshIdent: args['ssh-ident'],
          hostKeyFile: args['host-key'],
          isolateHostKey: args['isolate-host-key'],
          httpPort: args['http-port'],
          httpHost: args['http-host'],
          verbose: args.verbose,
          zosmfVersion: args['zosmf-version'] as '5.30',
        });
        // startMockZosHost emits listener banners (`SSH listening on …`,
        // `z/OSMF listening on …`) through the daemon's central logger, so
        // we don't echo them here. Just install signal handlers and stay alive.
        //
        // dispose() shuts the SSH + HTTP listeners and frees the token store.
        // We await it before exiting so callers running the daemon under a
        // process manager see the right exit code AND any in-flight access-log
        // writes get a chance to flush. A 5-second safety timer guarantees we
        // exit even if a listener.close() never fires its callback (this used
        // to hang the daemon on plain `kill <pid>`).
        let shuttingDown = false;
        const shutdown = (signal: string): void => {
          if (shuttingDown) {
            // Second signal — operator wants out NOW. Bail immediately.
            process.exit(130);
          }
          shuttingDown = true;
          process.stderr.write(`Mock z/OS host stopping (${signal})\n`);
          const safetyTimer = setTimeout(() => {
            process.stderr.write('Mock z/OS host shutdown timeout — forcing exit\n');
            process.exit(1);
          }, 5000);
          safetyTimer.unref();
          result.dispose().then(
            () => process.exit(0),
            err => {
              const msg = err instanceof Error ? err.message : String(err);
              process.stderr.write(`Mock z/OS host dispose error: ${msg}\n`);
              process.exit(1);
            }
          );
        };
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
      }
    )
    .command(
      'gen-host-key',
      'Generate a fresh RSA host key under <mockDir>/_ssh/host_key',
      y =>
        y.options({
          'mock-dir': { type: 'string', demandOption: true, describe: 'Mock data directory' },
        }),
      async args => {
        const out = await generateAndPersistHostKey(args['mock-dir'], { force: true });
        process.stderr.write(`Wrote host key to ${out}\n`);
      }
    )
    .command(
      'gen-fixtures',
      'Seed <mockDir>/_ssh/users.json and minimal sample data',
      y =>
        y.options({
          'mock-dir': { type: 'string', demandOption: true, describe: 'Mock data directory' },
          preset: {
            type: 'string',
            default: 'default',
            describe: 'Preset (default | minimal)',
          },
          force: { type: 'boolean', default: false, describe: 'Overwrite existing fixtures' },
        }),
      async args => {
        await writeSampleFixtures({
          mockDir: args['mock-dir'],
          preset: args.preset,
          force: args.force,
        });
        process.stderr.write(`Wrote sample fixtures to ${args['mock-dir']}\n`);
      }
    )
    .demandCommand(1, 'A subcommand is required (start | gen-host-key | gen-fixtures)')
    .strict()
    .help()
    .parseAsync();
}
