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

import { startFakeModelServer } from './fake-model-server.js';

interface CliArgs {
  port?: number;
  host?: string;
  modelId?: string;
  logFile?: string;
  toolPattern?: string;
  datasetPattern?: string;
}

/** Escapes all regex metacharacters (backslash first) so a value can be embedded literally in a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      i += 1;
      const value = argv[i];
      if (value === undefined) {
        throw new Error(`missing value for ${arg}`);
      }
      return value;
    };
    switch (arg) {
      case '--port':
        args.port = Number(next());
        break;
      case '--host':
        args.host = next();
        break;
      case '--model-id':
        args.modelId = next();
        break;
      case '--log-file':
        args.logFile = next();
        break;
      case '--tool-pattern':
        args.toolPattern = next();
        break;
      case '--dataset-pattern':
        args.datasetPattern = next();
        break;
      default:
        // Ignore unknown flags rather than failing a CI harness on a typo.
        break;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const server = await startFakeModelServer({
    port: args.port,
    host: args.host,
    modelId: args.modelId,
    logFile: args.logFile,
    toolPattern: args.toolPattern ? new RegExp(escapeRegExp(args.toolPattern), 'i') : undefined,
    datasetPattern: args.datasetPattern,
  });

  // Machine-readable line for shell harnesses to pick up the assigned port/url
  // (important when --port is omitted/0 and the OS picks an ephemeral port).
  process.stdout.write(`${JSON.stringify({ port: server.port, url: server.url })}\n`);

  const shutdown = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
