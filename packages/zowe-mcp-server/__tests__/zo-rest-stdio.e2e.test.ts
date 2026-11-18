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

/* eslint-disable vitest/no-disabled-tests -- Live resource availability and failed prerequisites require explicit runtime skips. */

/**
 * Opt-in live REST tests. Never run against z/OS during the default test suite.
 *
 * Set ZOWE_MCP_RUN_ZO_REST_E2E=1 and ZOWE_MCP_ZO_REST_E2E_CONFIG to a normal REST
 * config containing exactly one system. Credentials use the server's existing env/Vault
 * handling. Optional ZOWE_MCP_ZO_REST_TEST_DSN must belong to the configured user.
 *
 * Mutations are confined to a fresh USER.MCPTEST.<random> prefix and one unique /tmp
 * directory. The suite creates an 8 MiB FB80 data set, then verifies cleanup. Run once
 * with a gateway config and once with a standalone config to exercise both deployments.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getBackendStatusOutputSchema } from '../src/tools/context/context-output-schemas.js';
import type { JobEntry, JobFileEntry } from '../src/zos/backend.js';
import { parseDsnAndMember, resolveDsn } from '../src/zos/dsn.js';
import { isEnvFlagSet, toPasswordEnvVarName } from '../src/zos/native/connection-spec.js';
import { loadRestConfig, type RestConnection } from '../src/zos/rest/connection.js';

const enabled = isEnvFlagSet(process.env.ZOWE_MCP_RUN_ZO_REST_E2E);
const serverPath = fileURLToPath(new URL('../dist/index.js', import.meta.url));

interface Envelope<T> {
  data: T;
  _result?: { totalLines?: number };
}

interface ReadData {
  lines: string[];
  etag?: string;
  contentBase64?: string;
}

interface DatasetName {
  dsn: string;
}

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

function resultText(result: ToolResult): string {
  const content = result.content as { type: string; text?: string }[];
  return content.find(item => item.type === 'text')?.text ?? '';
}

describe.skipIf(!enabled).sequential('zo REST live stdio E2E', () => {
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  let connection: RestConnection;
  let host: string;
  let user: string;
  let prefix: string;
  let scratch: string;
  let datasets: Record<'original' | 'copy' | 'renamed' | 'large', string>;
  let knownDsn: string | undefined;
  let prefixConfirmedEmpty = false;
  let scratchCreated = false;
  let originalReady = false;
  let jobs: JobEntry[] = [];
  let deniedElicitations = 0;

  async function invoke(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    if (!client) throw new Error('Live MCP client is unavailable.');
    try {
      return await client.callTool({ name, arguments: { system: host, ...args } }, undefined, {
        timeout: 60_000,
      });
    } catch {
      // Never include untrusted error bodies, tokens, or credentials in a test failure.
      throw new Error(`Live MCP ${name} failed during transport or response validation.`);
    }
  }

  async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await invoke(name, args);
    if (result.isError) {
      const status = /HTTP\s+\d{3}/.exec(resultText(result))?.[0];
      throw new Error(`Live MCP ${name} failed${status ? ` (${status})` : ''}.`);
    }
    try {
      return (result.structuredContent ?? JSON.parse(resultText(result))) as T;
    } catch {
      throw new Error(`Live MCP ${name} returned an invalid structured response.`);
    }
  }

  beforeAll(async () => {
    const configuredPath = process.env.ZOWE_MCP_ZO_REST_E2E_CONFIG?.trim();
    if (!configuredPath)
      throw new Error('Set ZOWE_MCP_ZO_REST_E2E_CONFIG to a normal REST config file.');
    const configPath = resolve(configuredPath);
    let systems: RestConnection[];
    try {
      systems = loadRestConfig(configPath).systems;
    } catch {
      throw new Error(
        'Cannot load the live REST config. Verify its path and password-free format.'
      );
    }
    if (systems.length !== 1)
      throw new Error(
        'Live REST tests require exactly one system. Run separately for each config.'
      );
    connection = systems[0];
    host = new URL(connection.url).hostname;
    user = connection.user;
    prefix = `${user}.MCPTEST.M${randomBytes(4).toString('hex').slice(0, 7).toUpperCase()}`;
    datasets = {
      original: `${prefix}.PS`,
      copy: `${prefix}.COPY`,
      renamed: `${prefix}.REN`,
      large: `${prefix}.LARGE`,
    };
    resolveDsn(datasets.large);
    scratch = `/tmp/zowe-mcp-${randomUUID()}`;
    knownDsn = process.env.ZOWE_MCP_ZO_REST_TEST_DSN?.trim();
    if (knownDsn && !resolveDsn(parseDsnAndMember(knownDsn).dsn).dsn.startsWith(`${user}.`))
      throw new Error('ZOWE_MCP_ZO_REST_TEST_DSN must belong to the configured user.');

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') env[key] = value;
    }
    env.ZOWE_MCP_LOG_TOOL_CALLS = '0';
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        serverPath,
        '--stdio',
        '--zo-rest',
        '--config',
        configPath,
        '--capability-tier',
        'delete',
        '--no-response-cache',
      ],
      env,
      stderr: 'pipe',
    });
    transport.stderr?.on('data', () => undefined);
    client = new Client(
      { name: 'zo-rest-live-e2e', version: '1.0.0' },
      { capabilities: { elicitation: { form: {} } } }
    );
    client.setRequestHandler(ElicitRequestSchema, request => {
      if (request.params.mode === 'url') {
        deniedElicitations++;
        return { action: 'decline' as const };
      }
      const schema = request.params.requestedSchema;
      const confirm = schema.properties.confirm;
      const path = confirm?.description ?? '';
      const ownPath = path === scratch || path.startsWith(scratch + '/');
      if (
        Object.keys(schema.properties).length === 1 &&
        confirm?.type === 'boolean' &&
        schema.required?.length === 1 &&
        schema.required[0] === 'confirm' &&
        ownPath &&
        posix.normalize(path) === path
      ) {
        return { action: 'accept' as const, content: { confirm: true } };
      }
      // Password, command, and unrelated path requests are never approved or printed.
      deniedElicitations++;
      return { action: 'decline' as const };
    });
    await client.connect(transport);
  }, 60_000);

  afterAll(async () => {
    const failures: string[] = [];
    try {
      if (client && prefixConfirmedEmpty) {
        try {
          const remaining = await call<Envelope<DatasetName[]>>('listDatasets', {
            dsnPattern: `${prefix}.*`,
            limit: 100,
          });
          const planned = new Set(Object.values(datasets));
          if (
            !Array.isArray(remaining.data) ||
            remaining.data.some(item => !planned.has(item.dsn))
          ) {
            failures.push(`Unplanned resources found under ${prefix}; deletion refused.`);
          } else {
            for (const { dsn } of remaining.data) {
              try {
                await call('deleteDataset', { dsn });
              } catch {
                failures.push(`Could not delete owned scratch data set ${dsn}.`);
              }
            }
          }
          const left = await call<Envelope<DatasetName[]>>('listDatasets', {
            dsnPattern: `${prefix}.*`,
            limit: 100,
          });
          if (left.data.length !== 0) failures.push(`Scratch prefix ${prefix} is not empty.`);
        } catch {
          failures.push(`Could not verify cleanup of scratch prefix ${prefix}.`);
        }
      }
      if (client && scratchCreated) {
        try {
          await call('deleteUssFile', { path: scratch, recursive: true });
          const absent = await invoke('listUssFiles', { path: scratch });
          if (!absent.isError || !/HTTP\s+404/.test(resultText(absent)))
            failures.push(`Could not confirm that scratch directory ${scratch} is absent.`);
        } catch {
          failures.push(`Could not delete or verify scratch directory ${scratch}.`);
        }
      }
    } finally {
      try {
        await client?.close();
      } catch {
        failures.push('Could not close the live MCP client.');
      }
      try {
        await transport?.close();
      } catch {
        failures.push('Could not close the live MCP transport.');
      }
    }
    if (failures.length) throw new Error(failures.join('\n'));
  }, 180_000);

  it('initializes MCP and omits tools unsupported by zo REST', async () => {
    const names = (await client!.listTools()).tools.map(tool => tool.name);
    expect(names.includes('readDataset') && names.includes('getBackendStatus')).toBe(true);
    expect(
      names.some(name =>
        [
          'display',
          'runConsoleCommand',
          'runSafeUssCommand',
          'getUssHome',
          'submitJobFromUss',
        ].includes(name)
      )
    ).toBe(false);
  });

  it('reads the optional owned fixture and lists only the configured user’s jobs', async () => {
    let knownReadValid = true;
    if (knownDsn) {
      const result = await call<Envelope<ReadData>>('readDataset', {
        dsn: knownDsn,
        lineCount: 5,
      });
      knownReadValid =
        Array.isArray(result.data.lines) &&
        result.data.lines.length <= 5 &&
        typeof result.data.etag === 'string';
    }
    expect(knownReadValid).toBe(true);
    const result = await call<Envelope<JobEntry[]>>('listJobs', { owner: user, limit: 10 });
    jobs = result.data;
    expect(Array.isArray(jobs) && jobs.every(job => job.owner.toUpperCase() === user)).toBe(true);
  });

  it('reads an owned job status through the advertised output schema', async context => {
    if (!jobs[0]) return context.skip('No owned job is available.');
    const result = await call<Envelope<JobEntry>>('getJobStatus', { jobId: jobs[0].id });
    expect(result.data.id === jobs[0].id && result.data.owner.toUpperCase() === user).toBe(true);
  });

  it('reads only an owned completed job’s spool and JCL', async context => {
    const job = jobs.find(item => item.status === 'OUTPUT');
    if (!job) return context.skip('No completed owned job is available.');
    const files = await call<Envelope<JobFileEntry[]>>('listJobFiles', {
      jobId: job.id,
      limit: 10,
    });
    expect(Array.isArray(files.data)).toBe(true);
    const selected = files.data.find(file => file.ddname === 'JESMSGLG') ?? files.data[0];
    let spoolReadValid = true;
    if (selected) {
      const output = await call<Envelope<ReadData>>('readJobFile', {
        jobId: job.id,
        jobFileId: selected.id,
        lineCount: 5,
      });
      spoolReadValid = Array.isArray(output.data.lines) && output.data.lines.length <= 5;
    }
    expect(spoolReadValid).toBe(true);
    const jcl = await call<Envelope<ReadData>>('getJcl', { jobId: job.id });
    expect(Array.isArray(jcl.data.lines) && jcl.data.lines.length > 0).toBe(true);
  });

  it('creates and edits a fresh owned data set and rejects a stale ETag', async () => {
    const initial = await call<Envelope<DatasetName[]>>('listDatasets', {
      dsnPattern: `${prefix}.*`,
      limit: 100,
    });
    expect(initial.data.length).toBe(0);
    prefixConfirmedEmpty = true;
    await call('createDataset', {
      dsn: datasets.original,
      type: 'PS',
      recfm: 'FB',
      lrecl: 80,
      blockSize: 27920,
      primarySpace: 1,
      secondarySpace: 1,
    });
    await call('writeDataset', {
      dsn: datasets.original,
      lines: ['FIRST VERSION', 'SECOND RECORD'],
    });
    const first = await call<Envelope<ReadData>>('readDataset', { dsn: datasets.original });
    expect(first.data.lines.some(line => line.trimEnd() === 'FIRST VERSION')).toBe(true);
    await call('writeDataset', {
      dsn: datasets.original,
      lines: ['CHANGED VERSION', 'SECOND RECORD', 'THIRD'],
      etag: first.data.etag,
    });
    const conflict = await invoke('writeDataset', {
      dsn: datasets.original,
      lines: ['STALE WRITE MUST NOT APPLY'],
      etag: first.data.etag,
    });
    expect(conflict.isError === true && /HTTP\s+412/.test(resultText(conflict))).toBe(true);
    const after = await call<Envelope<ReadData>>('readDataset', { dsn: datasets.original });
    expect(after.data.lines.some(line => line.trimEnd() === 'CHANGED VERSION')).toBe(true);
    expect(after.data.lines.some(line => line.includes('STALE'))).toBe(false);
    originalReady = true;
  });

  it('copies and renames only the owned scratch data set', async context => {
    if (!originalReady) return context.skip('The preceding scratch data set check failed.');
    await call('copyDataset', { sourceDsn: datasets.original, targetDsn: datasets.copy });
    await call('renameDataset', { dsn: datasets.copy, newDsn: datasets.renamed });
    const result = await call<Envelope<ReadData>>('readDataset', { dsn: datasets.renamed });
    expect(result.data.lines.some(line => line.trimEnd() === 'CHANGED VERSION')).toBe(true);
  });

  it('writes an owned 8 MiB fixture and returns only three requested records', async context => {
    if (!prefixConfirmedEmpty)
      return context.skip('A safe scratch prefix could not be established.');
    await call('createDataset', {
      dsn: datasets.large,
      type: 'PS',
      recfm: 'FB',
      lrecl: 80,
      blockSize: 27920,
      primarySpace: 200,
      secondarySpace: 20,
    });
    const line = 'MCP REST LARGE READ '.padEnd(80, 'X');
    const count = Math.ceil((8 * 1024 * 1024) / 80);
    await call('writeDataset', { dsn: datasets.large, lines: Array<string>(count).fill(line) });
    const result = await call<Envelope<ReadData>>('readDataset', {
      dsn: datasets.large,
      lineCount: 3,
    });
    expect(
      result.data.lines.length === 3 && result.data.lines.every(actual => actual === line)
    ).toBe(true);
    expect((result._result?.totalLines ?? 0) >= count).toBe(true);
  });

  it('round trips UTF-8 text and raw bytes inside one owned USS directory', async () => {
    await call('createUssFile', { path: scratch, isDirectory: true, permissions: '700' });
    scratchCreated = true;
    await call('writeUssFile', {
      path: `${scratch}/text.txt`,
      lines: ['zo REST UTF-8: café'],
      encoding: 'UTF-8',
    });
    const text = await call<Envelope<ReadData>>('readUssFile', {
      path: `${scratch}/text.txt`,
      encoding: 'UTF-8',
    });
    expect(text.data.lines.some(line => line.includes('café'))).toBe(true);
    const bytes = Buffer.from([0, 1, 2, 0x7f, 0x80, 0xfe, 0xff]).toString('base64');
    await call('writeUssFile', {
      path: `${scratch}/bytes.bin`,
      binary: true,
      contentBase64: bytes,
    });
    const binary = await call<Envelope<ReadData>>('readUssFile', {
      path: `${scratch}/bytes.bin`,
      binary: true,
    });
    expect(binary.data.contentBase64 === bytes).toBe(true);
  });

  it('verifies temporary candidates without listing the parent directory', async context => {
    if (!scratchCreated) context.skip();
    const file = await call<Envelope<{ path: string }>>('getUssTempPath', {
      dirPath: scratch,
      prefix: 'candidate-',
    });
    const directory = await call<Envelope<{ path: string }>>('getUssTempDir', {
      basePath: scratch,
    });
    for (const candidate of [file.data.path, directory.data.path]) {
      expect(candidate.startsWith(scratch + '/')).toBe(true);
      const absent = await invoke('listUssFiles', { path: candidate });
      expect(absent.isError && /HTTP\s+404/.test(resultText(absent))).toBe(true);
    }
  });

  it('reports nonzero TSO return codes as errors for an owned missing data set', async () => {
    const result = await invoke('queryTso', { commandText: `LISTDS '${prefix}.ABSENT'` });
    expect(result.isError).toBe(true);
    expect(/rc\s+['"]?[1-9]\d*/i.test(resultText(result))).toBe(true);
  });

  it('reports observed authentication without exposing credentials', async () => {
    const payload = await call<unknown>('getBackendStatus');
    expect(getBackendStatusOutputSchema.safeParse(payload).success).toBe(true);
    const status = getBackendStatusOutputSchema.parse(payload).connections[0];
    expect(status.system === host && status.configuredUser === user).toBe(true);
    expect(status.authentication.verified).toBe(true);
    expect(['direct', 'apiml'].includes(status.detectedDeployment)).toBe(true);
    expect(
      connection.deployment === 'auto' || status.detectedDeployment === connection.deployment
    ).toBe(true);
    const password = process.env[toPasswordEnvVarName(user, host)];
    // Assert a boolean so even an assertion failure cannot print the password.
    expect(password ? !JSON.stringify(payload).includes(password) : true).toBe(true);
    expect(deniedElicitations).toBe(0);
  });
});
