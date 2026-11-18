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

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingHttpHeaders } from 'node:http';
import { createServer as createHttpsServer, type Server } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, getServer } from '../src/server.js';
import { NativeBackend, type NativeBackendOptions } from '../src/zos/native/native-backend.js';
import { loadRestConfig, parseRestConnections } from '../src/zos/rest/connection.js';
import { requireRestSuccess, RestHttpClient } from '../src/zos/rest/http.js';
import { loadRest } from '../src/zos/rest/load-rest.js';
import { generateHttpsTestCertificate } from './helpers/https-test-certificate.js';

const HOST = '127.0.0.1';
const USER = 'USER1';
const PASSWORD = 'test-password-zo-rest';
const AUTH = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`;

interface RecordedRequest {
  method: string;
  url: URL;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

interface FixtureResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

type Handler = (request: RecordedRequest) => FixtureResponse;

let fixtureDirectory: string;
let key: Buffer;
let cert: Buffer;
const servers: Server[] = [];

beforeAll(() => {
  ({ key, cert } = generateHttpsTestCertificate());
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'zowe-mcp-rest-tests-'));
  // Only the public CA certificate is needed on disk for caFile/configuration tests.
  writeFileSync(join(fixtureDirectory, 'cert.pem'), cert);
});

beforeEach(() => {
  vi.stubEnv('ZOWE_MCP_PASSWORD_USER1_127_0_0_1', PASSWORD);
  vi.stubEnv('ZOWE_MCP_CREDENTIALS', '');
});

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .filter(server => server.listening)
      .map(
        server =>
          new Promise<void>((resolve, reject) => {
            server.close(error => (error ? reject(error) : resolve()));
            server.closeAllConnections();
          })
      )
  );
  vi.unstubAllEnvs();
});

afterAll(() => {
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true });
});

/** Real HTTPS isolates protocol, TLS, encoding, and routing behavior from SDK mocks. */
async function target(handler: Handler): Promise<{ origin: string; requests: RecordedRequest[] }> {
  const requests: RecordedRequest[] = [];
  const server = createHttpsServer({ key, cert }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const request: RecordedRequest = {
        method: req.method ?? 'GET',
        url: new URL(req.url ?? '/', 'https://localhost'),
        headers: req.headers,
        body: Buffer.concat(chunks),
      };
      requests.push(request);
      const response = handler(request);
      const headers = { 'Content-Type': 'application/json', ...response.headers };
      res.writeHead(response.status ?? 200, headers);
      const body = response.body;
      res.end(
        body === undefined
          ? undefined
          : typeof body === 'string' || Buffer.isBuffer(body)
            ? body
            : JSON.stringify(body)
      );
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTPS fixture address');
  return { origin: `https://${HOST}:${address.port}`, requests };
}

function setup(origin: string, overrides: Record<string, unknown> = {}) {
  return loadRest({
    systems: parseRestConnections([
      { url: origin, user: USER, deployment: 'direct', rejectUnauthorized: false, ...overrides },
    ]),
    useEnvForPassword: true,
  });
}

function directInfo(request: RecordedRequest): FixtureResponse | undefined {
  if (request.url.pathname === '/zo/api/v1/system/info') {
    return { body: { success: true, version: 'unknown', buildDate: 'Nov 16 2026' } };
  }
  return undefined;
}

/** Exercise SSH adapter parity using the same controlled RPC results, without an SSH connection. */
function nativeBackend(client: object): NativeBackend {
  return new NativeBackend({
    getSpec: () => ({ user: USER, host: HOST, port: 22 }),
    credentialProvider: {
      getCredentials: vi
        .fn()
        .mockResolvedValue({ user: USER, password: PASSWORD, authMethod: 'password' }),
    } as unknown as NativeBackendOptions['credentialProvider'],
    clientCache: {
      getOrCreate: vi.fn().mockResolvedValue(client),
      hasKey: vi.fn().mockReturnValue(true),
      evict: vi.fn(),
    } as unknown as NativeBackendOptions['clientCache'],
  });
}

describe('zo-rest configuration', () => {
  it('normalizes minimal connections and keeps certificate verification enabled', () => {
    expect(
      parseRestConnections([{ url: 'https://zos.example.com:8443/', user: 'user1' }])
    ).toEqual([
      {
        url: 'https://zos.example.com:8443',
        user: USER,
        deployment: 'auto',
        serviceId: 'zo',
        rejectUnauthorized: true,
        timeoutSeconds: 60,
      },
    ]);
  });

  it.each([
    { url: 'http://zos.example.com', user: USER },
    { url: 'https://user:secret@zos.example.com', user: USER },
    { url: 'https://zos.example.com?token=secret', user: USER },
    { url: 'https://zos.example.com#fragment', user: USER },
    { url: 'https://zos.example.com', user: USER, password: 'secret' },
    { url: 'https://zos.example.com', user: USER, timeoutSeconds: 0 },
  ])('rejects unsafe connection configuration %#', connection => {
    expect(() => parseRestConnections([connection])).toThrow();
  });

  it('rejects ambiguous duplicate systems even when ports or users differ', () => {
    expect(() =>
      parseRestConnections([
        { url: 'https://zos.example.com:7554', user: USER },
        { url: 'https://zos.example.com:8443', user: 'USER2' },
      ])
    ).toThrow(/one.*connection.*system/i);
  });

  it('resolves caFile relative to the configuration file', () => {
    const path = join(fixtureDirectory, 'rest-config.json');
    writeFileSync(
      path,
      JSON.stringify({
        systems: [{ url: 'https://zos.example.com', user: USER, caFile: 'cert.pem' }],
      })
    );
    expect(loadRestConfig(path).systems[0].caFile).toBe(join(fixtureDirectory, 'cert.pem'));
  });
});

describe('zo-rest HTTPS integration', () => {
  it('probes zo, uses native listings, authenticates with Basic, and preserves richer attributes', async () => {
    const { origin, requests } = await target(
      request =>
        directInfo(request) ?? {
          body: {
            items: [
              {
                name: 'USER1.JCL',
                dsorg: 'PO',
                recfm: 'FB',
                lrecl: 80,
                blksize: 27920,
                volsers: ['VOL001', 'VOL002'],
                dataclass: 'DATA',
                mgmtclass: 'MGMT',
                storclass: 'STOR',
                spacu: 'TRACKS',
                usedp: 12,
                usedx: 2,
              },
            ],
            returnedRows: 1,
            moreRows: false,
          },
        }
    );
    const rest = setup(origin);
    const datasets = await rest.backend.listDatasets(HOST, 'USER1.*');
    expect(datasets[0]).toMatchObject({
      dsn: 'USER1.JCL',
      blksz: 27920,
      volsers: ['VOL001', 'VOL002'],
      dataclass: 'DATA',
      mgmtclass: 'MGMT',
      storclass: 'STOR',
      spaceUnits: 'TRACKS',
      usedPercent: 12,
      usedExtents: 2,
    });
    expect(requests.map(request => request.url.pathname)).toEqual([
      '/zo/api/v1/system/info',
      '/zo/api/v1/ds',
    ]);
    expect(
      requests
        .filter(request => request.url.pathname.endsWith('/ds'))
        .every(request => request.headers.authorization === AUTH)
    ).toBe(true);
    expect(requests.every(request => request.headers['x-csrf-zosmf-header'] === 'true')).toBe(
      true
    );
    expect(requests[1].url.searchParams.get('pattern')).toBe('USER1.*');
    expect(Number(requests[1].url.searchParams.get('maxItems'))).toBeGreaterThan(0);
    expect(rest.systemRegistry.list()).toEqual([HOST]);
    expect(await rest.credentialProvider.listUsers(HOST)).toEqual([USER]);
  });

  it('collects inclusive listing pages without duplicating the cursor item', async () => {
    const { origin, requests } = await target(
      request =>
        directInfo(request) ?? {
          body: request.url.searchParams.has('start')
            ? { items: [{ name: 'USER1.B' }, { name: 'USER1.C' }], moreRows: false }
            : { items: [{ name: 'USER1.A' }, { name: 'USER1.B' }], moreRows: true },
        }
    );
    expect(
      (await setup(origin).backend.listDatasets(HOST, 'USER1.*')).map(item => item.dsn)
    ).toEqual(['USER1.A', 'USER1.B', 'USER1.C']);
    const pages = requests.filter(request => request.url.pathname.endsWith('/ds'));
    expect(pages).toHaveLength(2);
    expect(pages[1].url.searchParams.get('start')).toBe('USER1.B');
  });

  it('lists members through zo and maps ISPF statistics', async () => {
    const { origin, requests } = await target(
      request =>
        directInfo(request) ?? {
          body: {
            items: [
              {
                name: 'JOB1',
                user: USER,
                vers: 1,
                mod: 2,
                c4date: '2026-01-02',
                m4date: '2026-11-16',
                mtime: '12:34:00',
                cnorc: 10,
                inorc: 8,
                mnorc: 2,
                sclm: 'N',
              },
            ],
            moreRows: false,
          },
        }
    );
    expect(await setup(origin).backend.listMembers(HOST, 'USER1.JCL', 'JOB*')).toEqual([
      {
        name: 'JOB1',
        user: USER,
        version: 1,
        modLevel: 2,
        createdDate: '2026-01-02',
        modifiedDate: '2026-11-16',
        modifiedTime: '12:34:00',
        currentRecords: 10,
        initialRecords: 8,
        modifiedRecords: 2,
        sclm: 'N',
      },
    ]);
    expect(requests[1].url.pathname).toBe('/zo/api/v1/ds/USER1.JCL/members');
    expect(requests[1].url.searchParams.get('pattern')).toBe('JOB*');
  });

  it('uses the same member ordering as SSH for special characters and digits', async () => {
    const items = ['A', '9LAST', '@FIRST', 'Z', '#FIRST', '0FIRST', '$FIRST'].map(name => ({
      name,
    }));
    const { origin } = await target(
      request => directInfo(request) ?? { body: { items, moreRows: false } }
    );
    const ssh = nativeBackend({ ds: { listDsMembers: vi.fn().mockResolvedValue({ items }) } });
    expect(await setup(origin).backend.listMembers(HOST, 'USER1.JCL')).toEqual(
      await ssh.listMembers(HOST, 'USER1.JCL')
    );
  });

  it('uses direct restfiles bases, UTF-8, codepage and If-Match for content edits', async () => {
    const { origin, requests } = await target(
      request =>
        directInfo(request) ??
        (request.method === 'GET'
          ? {
              headers: { ETag: '"read-v1"', 'Content-Type': 'text/plain;charset=UTF-8' },
              body: 'héllo\n世界',
            }
          : { status: 204, headers: { ETag: '"write-v2"' } })
    );
    const backend = setup(origin).backend;
    const read = await backend.readDataset(HOST, 'USER1.JCL', '###', 'IBM-037');
    expect(read).toMatchObject({ text: 'héllo\n世界', etag: '"read-v1"', encoding: 'IBM-037' });
    expect(
      await backend.writeDataset(HOST, 'USER1.JCL', 'héllo\n世界!', '###', read.etag, 'IBM-037')
    ).toMatchObject({ etag: '"write-v2"' });
    const write = requests.find(request => request.method === 'PUT');
    expect(write?.url.pathname).toBe('/zosmf/restfiles/ds/USER1.JCL(%23%23%23)');
    expect(write?.headers['content-type']).toMatch(/text\/plain;\s*charset=UTF-8/i);
    expect(write?.headers['x-ibm-data-type']).toContain('fileEncoding=IBM-037');
    expect(write?.headers['if-match']).toBe('"read-v1"');
    expect(write?.body.toString('utf8')).toBe('héllo\n世界!');
  });

  it('reads before partial edits and protects the replacement with the read ETag', async () => {
    const { origin, requests } = await target(
      request =>
        directInfo(request) ??
        (request.method === 'GET'
          ? { headers: { ETag: '"v1"' }, body: 'one\ntwo\nthree' }
          : { status: 204, headers: { ETag: '"v2"' } })
    );
    await setup(origin).backend.writeDataset(
      HOST,
      'USER1.DATA',
      'replacement',
      undefined,
      undefined,
      'IBM-037',
      2,
      2
    );
    const write = requests.find(request => request.method === 'PUT');
    expect(write?.headers['if-match']).toBe('"v1"');
    expect(write?.body.toString('utf8')).toBe('one\nreplacement\nthree');
  });

  it('surfaces ETag conflicts without replaying a write', async () => {
    const { origin, requests } = await target(
      request =>
        directInfo(request) ?? {
          status: 412,
          body: { rc: -32012, message: 'Resource was changed by another user.' },
        }
    );
    await expect(
      setup(origin).backend.writeDataset(HOST, 'USER1.DATA', 'new', undefined, '"stale"')
    ).rejects.toThrow(/412.*Resource was changed.*not retried/i);
    expect(requests.filter(request => request.method === 'PUT')).toHaveLength(1);
  });

  it('round trips raw bytes using the backend base64 contract', async () => {
    const bytes = Buffer.from([0, 1, 0x7f, 0x80, 0xff]);
    const { origin, requests } = await target(
      request =>
        directInfo(request) ??
        (request.method === 'GET'
          ? {
              headers: { ETag: '"binary"', 'Content-Type': 'application/octet-stream' },
              body: bytes,
            }
          : { status: 204, headers: { ETag: '"next"' } })
    );
    const backend = setup(origin).backend;
    const read = await backend.readDataset(HOST, 'USER1.BIN', undefined, 'binary');
    expect(read.text).toBe(bytes.toString('base64'));
    await backend.writeDataset(HOST, 'USER1.BIN', read.text, undefined, read.etag, 'binary');
    expect(requests.find(request => request.method === 'PUT')?.body.equals(bytes)).toBe(true);
    expect(
      requests
        .filter(request => request.url.pathname.includes('restfiles'))
        .every(request => request.headers['x-ibm-data-type'] === 'binary')
    ).toBe(true);
  });

  it('uses native USS listings and tags but the z/OSMF compatibility path for content', async () => {
    const { origin, requests } = await target(
      request =>
        directInfo(request) ??
        (request.url.pathname.endsWith('/fs/list')
          ? {
              body: {
                items: [
                  {
                    name: 'été.txt',
                    mode: '-rw-------',
                    user: USER,
                    group: 'GROUP1',
                    filetag: 'UTF-8',
                    size: 6,
                  },
                ],
                returnedRows: 1,
                totalRows: 1,
              },
            }
          : request.method === 'GET'
            ? { headers: { ETag: '"uss"' }, body: 'hello' }
            : { status: 204 })
    );
    const backend = setup(origin).backend;
    expect((await backend.listUssFiles(HOST, '/tmp/user1'))[0]).toMatchObject({
      name: 'été.txt',
      filetag: 'UTF-8',
      user: USER,
      group: 'GROUP1',
      isDirectory: false,
    });
    expect(await backend.readUssFile(HOST, '/tmp/user1/été.txt', 'UTF-8')).toMatchObject({
      text: 'hello',
      etag: '"uss"',
    });
    await backend.chtagUssFile(HOST, '/tmp/user1/été.txt', 'UTF-8');
    expect(requests.map(request => request.url.pathname)).toContain(
      '/zosmf/restfiles/fs/tmp/user1/%C3%A9t%C3%A9.txt'
    );
    const tag = requests.find(request => request.url.pathname.endsWith('/fs/chtag'));
    expect(JSON.parse(tag?.body.toString() ?? '{}')).toMatchObject({
      path: '/tmp/user1/été.txt',
      tag: 'UTF-8',
    });
  });

  it.each(['0700', '1777'])(
    'preserves all octal USS permission bits when creating a directory with mode %s',
    async permissions => {
      const { origin, requests } = await target(request => directInfo(request) ?? { status: 201 });
      await setup(origin).backend.createUssFile(HOST, '/tmp/user1/new-directory', {
        isDirectory: true,
        permissions,
      });
      const creation = requests.find(request => request.method === 'POST');
      expect(creation?.url.pathname).toBe('/zosmf/restfiles/fs/tmp/user1/new-directory');
      expect(JSON.parse(creation?.body.toString() ?? '{}')).toEqual({
        type: 'directory',
        mode: permissions,
      });
    }
  );

  it('uses native jobs and preserves return codes and correlators', async () => {
    const job = {
      id: 'JOB00123',
      name: 'USER1JOB',
      owner: USER,
      status: 'OUTPUT',
      type: 'JOB',
      class: 'A',
      phase: 20,
      phaseName: 'Job has completed',
      retcode: 'CC 0000',
      correlator: 'CORRELATOR',
    };
    const { origin, requests } = await target(
      request =>
        directInfo(request) ?? {
          body: request.url.pathname.endsWith('/jobs')
            ? [job]
            : request.url.pathname.endsWith('/spool')
              ? [{ id: 2, ddname: 'JESMSGLG', stepname: 'JES2' }]
              : request.url.pathname.endsWith('/spool/2')
                ? 'output line'
                : job,
        }
    );
    const backend = setup(origin).backend;
    expect(await backend.listJobs(HOST, { owner: USER, maxItems: 10 })).toEqual([job]);
    expect(await backend.getJobStatus(HOST, job.id)).toEqual(job);
    expect(await backend.listJobFiles(HOST, job.id)).toEqual([
      { id: 2, ddname: 'JESMSGLG', stepname: 'JES2' },
    ]);
    expect(await backend.readJobFile(HOST, job.id, 2)).toMatchObject({ text: 'output line' });
    expect(requests.every(request => request.url.pathname.startsWith('/zo/api/v1/'))).toBe(true);
  });

  it('rejects a nonzero TSO return code while retaining output and stripping the stateless warning', async () => {
    const { origin, requests } = await target(
      request =>
        directInfo(request) ?? {
          body: {
            command: 'LISTDS USER1.MISSING',
            rc: 8,
            output:
              'IKJ56644I NO VALID TSO USERID, DEFAULT USER ATTRIBUTES USED\nDATA SET NOT FOUND\n',
          },
        }
    );
    const attempt = setup(origin).backend.runTsoCommand(HOST, 'LISTDS USER1.MISSING');
    await expect(attempt).rejects.toThrow(/rc '8'.*DATA SET NOT FOUND/s);
    await expect(attempt).rejects.not.toThrow('IKJ56644I');
    expect(requests[1].url.pathname).toBe('/zo/api/v1/tso/command');
    expect(requests[1].method).toBe('POST');
  });

  it('returns successful TSO output without the stateless warning', async () => {
    const { origin } = await target(
      request =>
        directInfo(request) ?? {
          body: {
            command: 'TIME',
            rc: 0,
            output:
              'IKJ56644I NO VALID TSO USERID, DEFAULT USER ATTRIBUTES USED\nTIME IS 12:34:56\n',
          },
        }
    );
    expect(await setup(origin).backend.runTsoCommand(HOST, 'TIME')).toBe('TIME IS 12:34:56\n');
  });

  it('verifies a temporary candidate without listing a busy directory', async () => {
    const { origin, requests } = await target(
      request =>
        directInfo(request) ??
        (request.url.pathname === '/zo/api/v1/fs/list' &&
        request.url.searchParams.get('depth') === '0'
          ? { status: 404, body: { message: 'Path does not exist' } }
          : { body: { items: [{ name: 'unrelated' }], totalRows: 200_000 } })
    );
    const path = await setup(origin).backend.getUssTempPath(HOST, '/tmp', 'job-');
    expect(path).toMatch(/^\/tmp\/job-[a-f0-9-]{36}$/);
    const probes = requests.filter(request => request.url.pathname.endsWith('/fs/list'));
    expect(probes).toHaveLength(1);
    expect(probes[0].url.searchParams.get('path')).toBe(path);
    expect(probes[0].url.searchParams.get('depth')).toBe('0');
    expect(probes[0].url.searchParams.get('maxItems')).toBe('1');
    expect(requests.every(request => request.method === 'GET')).toBe(true);
  });

  it('tries another temporary candidate when the exact path already exists', async () => {
    const seen: string[] = [];
    const { origin } = await target(request => {
      const info = directInfo(request);
      if (info) return info;
      seen.push(request.url.searchParams.get('path') ?? '');
      return seen.length === 1
        ? { body: { items: [{ name: 'collision', mode: 'drwx------' }], totalRows: 1 } }
        : { status: 404, body: { message: 'Path does not exist' } };
    });
    const path = await setup(origin).backend.getUssTempDir(HOST, '/tmp');
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(path);
    expect(seen[0]).not.toBe(path);
  });

  it.each([403, 500])(
    'does not treat HTTP%i as proof that a temporary path is absent',
    async status => {
      const { origin } = await target(
        request => directInfo(request) ?? { status, body: { message: 'Metadata check failed' } }
      );
      await expect(setup(origin).backend.getUssTempPath(HOST, '/tmp')).rejects.toThrow(
        `HTTP ${status}`
      );
    }
  );

  it('bounds temporary path collision checks', async () => {
    const { origin, requests } = await target(
      request => directInfo(request) ?? { body: { items: [{ name: 'exists' }], totalRows: 1 } }
    );
    await expect(setup(origin).backend.getUssTempPath(HOST, '/tmp')).rejects.toThrow(
      /unique temp/i
    );
    expect(requests.filter(request => request.url.pathname.endsWith('/fs/list'))).toHaveLength(20);
  });

  it.each(['../other/', 'bad\0prefix'])(
    'rejects a temporary filename prefix that could escape its directory (%#)',
    async prefix => {
      await expect(
        setup('https://127.0.0.1:8443').backend.getUssTempPath(HOST, '/tmp', prefix)
      ).rejects.toThrow(/filename prefix/i);
    }
  );

  it.each([false, true])(
    'preserves SSH cp-style force=%s semantics for writable destinations',
    async force => {
      const copyUss = vi.fn().mockResolvedValue({ success: true });
      const options = { recursive: false, followSymlinks: false, preserveAttributes: true, force };
      const { origin, requests } = await target(request => directInfo(request) ?? { status: 201 });
      await nativeBackend({ uss: { copyUss } }).copyUssFile(
        HOST,
        '/tmp/source',
        '/tmp/destination',
        options
      );
      await setup(origin).backend.copyUssFile(HOST, '/tmp/source', '/tmp/destination', options);
      expect(copyUss).toHaveBeenCalledWith({
        srcFsPath: '/tmp/source',
        dstFsPath: '/tmp/destination',
        ...options,
      });
      const copies = requests.filter(request => request.url.pathname.endsWith('/fs/copy'));
      expect(copies).toHaveLength(1);
      expect(JSON.parse(copies[0].body.toString())).toEqual({
        from: '/tmp/source',
        to: '/tmp/destination',
        ...options,
      });
      expect(requests.some(request => request.url.pathname.endsWith('/fs/list'))).toBe(false);
    }
  );

  it('copies to a new USS target using default options', async () => {
    const { origin, requests } = await target(request => directInfo(request) ?? { status: 201 });
    await setup(origin).backend.copyUssFile(HOST, '/tmp/source', '/tmp/new-target');
    const copy = requests.find(request => request.url.pathname.endsWith('/fs/copy'));
    expect(JSON.parse(copy?.body.toString() ?? '{}')).toEqual({
      from: '/tmp/source',
      to: '/tmp/new-target',
    });
    expect(copy?.method).toBe('POST');
  });

  it('accepts an explicitly trusted site CA', async () => {
    const { origin } = await target(
      request => directInfo(request) ?? { body: { items: [], moreRows: false } }
    );
    const backend = setup(origin, {
      rejectUnauthorized: true,
      caFile: join(fixtureDirectory, 'cert.pem'),
    }).backend;
    expect(await backend.listDatasets(HOST, 'USER1.*')).toEqual([]);
  });

  it('keeps elicited credentials separate across backend instances', async () => {
    vi.stubEnv('ZOWE_MCP_PASSWORD_USER1_127_0_0_1', '');
    const { origin, requests } = await target(
      request => directInfo(request) ?? { body: { items: [], moreRows: false } }
    );
    const systems = parseRestConnections([
      { url: origin, user: USER, deployment: 'direct', rejectUnauthorized: false },
    ]);
    const firstPrompt = vi.fn().mockResolvedValue('first-user-password');
    const secondPrompt = vi.fn().mockResolvedValue('second-user-password');
    const first = loadRest({
      systems,
      useEnvForPassword: true,
      requestPasswordViaElicitation: firstPrompt,
    });
    const second = loadRest({
      systems,
      useEnvForPassword: true,
      requestPasswordViaElicitation: secondPrompt,
    });
    await first.backend.listDatasets(HOST, 'USER1.*');
    await second.backend.listDatasets(HOST, 'USER1.*');
    expect(firstPrompt).toHaveBeenCalledTimes(1);
    expect(secondPrompt).toHaveBeenCalledTimes(1);
    const listingHeaders = requests
      .filter(request => request.url.pathname.endsWith('/ds'))
      .map(request => request.headers.authorization);
    expect(listingHeaders).toEqual([
      'Basic ' + Buffer.from(`${USER}:first-user-password`).toString('base64'),
      'Basic ' + Buffer.from(`${USER}:second-user-password`).toString('base64'),
    ]);
  });
});

describe('APIML routing and discovery', () => {
  it('uses service discovery for custom native API base paths', async () => {
    const { origin, requests } = await target(request => {
      if (request.url.pathname.startsWith('/gateway/api/v1/services'))
        return {
          body: {
            serviceId: 'zo',
            status: 'UP',
            apiml: {
              apiInfo: [
                {
                  apiId: 'zowe.zo',
                  basePath: '/selected/api/v1',
                  defaultApi: true,
                  gatewayUrl: 'api/v1',
                  version: '1.0.0',
                },
              ],
            },
          },
        };
      if (request.url.pathname === '/selected/api/v1/system/info')
        return { body: { version: '0.6.0', success: true } };
      if (request.url.pathname === '/selected/api/v1/zosmf/restfiles/ds/USER1.DATA')
        return { headers: { ETag: '"gateway"' }, body: 'gateway content' };
      return { status: 404, body: { message: 'Not found' } };
    });
    const read = await setup(origin, { deployment: 'auto' }).backend.readDataset(
      HOST,
      'USER1.DATA'
    );
    expect(read).toMatchObject({ text: 'gateway content', etag: '"gateway"' });
    expect(
      requests.some(request => request.url.pathname.startsWith('/gateway/api/v1/services'))
    ).toBe(true);
    expect(requests.some(request => request.url.pathname === '/selected/api/v1/system/info')).toBe(
      true
    );
  });

  it('supports gateways whose service information endpoint is forbidden to the caller', async () => {
    const { origin, requests } = await target(request => {
      if (request.url.pathname.startsWith('/gateway/api/v1/services'))
        return {
          status: 403,
          body: { messages: [{ messageNumber: 'ZWEAT403E', messageContent: 'Access denied' }] },
        };
      if (request.url.pathname === '/zo/api/v1/system/info')
        return { body: { success: true, version: 'unknown' } };
      if (request.url.pathname === '/zo/api/v1/zosmf/info')
        return { body: { plugins: [{ pluginVersion: 'zo-rest;0.6.0' }] } };
      if (request.url.pathname === '/zo/api/v1/zosmf/restfiles/ds/USER1.DATA')
        return { headers: { ETag: '"gateway"' }, body: 'gateway content' };
      return { status: 404, body: { message: 'Not found' } };
    });
    expect(
      (await setup(origin, { deployment: 'apiml' }).backend.readDataset(HOST, 'USER1.DATA')).text
    ).toBe('gateway content');
    expect(
      requests.some(request => request.url.pathname.includes('/zo/api/v1/zosmf/restfiles/'))
    ).toBe(true);
  });

  it('detects APIML automatically when discovery is denied but zo compatibility metadata is available', async () => {
    const { origin, requests } = await target(request => {
      if (request.url.pathname.startsWith('/gateway/api/v1/services'))
        return { status: 403, body: { message: 'Service information is forbidden' } };
      if (request.url.pathname === '/zo/api/v1/system/info')
        return { body: { success: true, version: 'unknown' } };
      if (request.url.pathname === '/zo/api/v1/zosmf/info')
        return { body: { plugins: [{ pluginVersion: 'zo-rest;0.6.0' }] } };
      if (request.url.pathname === '/zo/api/v1/zosmf/restfiles/ds/USER1.DATA')
        return { headers: { ETag: '"auto-gateway"' }, body: 'auto gateway content' };
      return { status: 404, body: { message: 'Not found' } };
    });
    expect(
      (await setup(origin, { deployment: 'auto' }).backend.readDataset(HOST, 'USER1.DATA')).text
    ).toBe('auto gateway content');
    expect(requests.some(request => request.url.pathname === '/zo/api/v1/zosmf/info')).toBe(true);
  });

  it('does not forward credentials to an origin supplied by service metadata', async () => {
    const { origin, requests } = await target(() => ({
      body: {
        serviceId: 'zo',
        apiml: {
          apiInfo: [
            {
              baseUrl: 'https://untrusted.invalid/zo/api/v1',
              gatewayUrl: 'https://untrusted.invalid/zo/api/v1',
              defaultApi: true,
            },
          ],
        },
      },
    }));
    await expect(
      setup(origin, { deployment: 'auto' }).backend.listDatasets(HOST, 'USER1.*')
    ).rejects.toThrow(/origin|gateway URL/i);
    expect(requests).toHaveLength(1);
  });

  it('rejects a plain z/OSMF target instead of silently switching backend semantics', async () => {
    const { origin, requests } = await target(() => ({
      status: 404,
      body: { message: 'No zo native API here' },
    }));
    await expect(setup(origin).backend.listDatasets(HOST, 'USER1.*')).rejects.toThrow(/zo-rest/i);
    expect(requests.some(request => request.url.pathname.includes('/restfiles/ds'))).toBe(false);
  });
});

describe('zo certificate and search response contracts', () => {
  it('maps certificate defaults and PEM exported in a JSON base64 field', async () => {
    const certificate = { owner: USER, keyring: 'MY RING', label: 'MY LABEL' };
    const pem = '-----BEGIN CERTIFICATE-----\ntest-data\n-----END CERTIFICATE-----';
    const { origin, requests } = await target(
      request =>
        directInfo(request) ?? {
          body: request.url.pathname.endsWith('/export')
            ? { ...certificate, format: 'pem', data: Buffer.from(pem).toString('base64') }
            : {
                ...certificate,
                usage: 'PERSONAL',
                status: 'TRUST',
                default: true,
                keyType: 1,
                keySize: 2048,
                serialNumber: '1234',
              },
        }
    );
    const backend = setup(origin).backend;
    expect(await backend.showCertificate(HOST, certificate)).toMatchObject({
      owner: certificate.owner,
      label: certificate.label,
      isDefault: true,
      keySize: 2048,
      serialNumber: '1234',
    });
    expect(await backend.exportCertificate(HOST, certificate)).toMatchObject({
      ...certificate,
      format: 'pem',
      data: pem,
    });
    expect(
      requests.some(
        request =>
          request.url.pathname ===
          '/zo/api/v1/keyrings/USER1/MY%20RING/certificates/MY%20LABEL/export'
      )
    ).toBe(true);
  });

  it('maps product-neutral SAF codes and sends certificate mutations to native endpoints', async () => {
    const { origin, requests } = await target(
      request =>
        directInfo(request) ?? {
          body: {
            warning: 'Refresh required',
            safReturns: { functionCode: 8, safReturnCode: 4, esmReturnCode: 8, esmReasonCode: 12 },
            gskReturnCode: 2,
          },
        }
    );
    const result = await setup(origin).backend.connectCertificate(HOST, {
      owner: USER,
      keyring: 'RING',
      label: 'CERT',
      fromDatabase: true,
      isDefault: true,
      usage: 'PERSONAL',
    });
    expect(result).toEqual({
      warning: 'Refresh required',
      safReturnCodes: {
        functionCode: 8,
        safReturnCode: 4,
        productReturnCode: 8,
        productReasonCode: 12,
      },
      gskReturnCode: 2,
    });
    const mutation = requests.find(request => request.method === 'PUT');
    expect(mutation?.url.pathname).toBe('/zo/api/v1/keyrings/USER1/RING/certificates/CERT');
    expect(JSON.parse(mutation?.body.toString() ?? '{}')).toEqual({
      request: 'connect',
      fromDatabase: true,
      usage: 'PERSONAL',
      default: true,
    });
    expect(mutation?.headers['x-csrf-zosmf-header']).toBe('true');
  });

  it('accepts a zero-match SuperC listing as a successful empty search', async () => {
    const { origin, requests } = await target(
      request =>
        directInfo(request) ?? {
          body: {
            data: "SRCH DSN: USER1.JCL\n 0 20 0 2 1:80 80\nPROCESS OPTIONS USED: ANYC\nSRCHFOR 'MISSING'\n",
          },
        }
    );
    const result = await setup(origin).backend.searchInDataset(HOST, 'USER1.JCL', {
      string: 'MISSING',
      parms: 'ANYC',
    });
    expect(result.members).toEqual([]);
    expect(result.summary).toMatchObject({
      linesFound: 0,
      linesProcessed: 20,
      membersWithLines: 0,
      membersWithoutLines: 2,
      searchPattern: 'MISSING',
      processOptions: 'ANYC',
    });
    expect(
      requests.some(request => request.url.pathname === '/zo/api/v1/ds/USER1.JCL/search')
    ).toBe(true);
  });
});

describe('REST failures and retries', () => {
  it.each([400, 401, 403, 404, 409, 412, 501])(
    'preserves HTTP %i errors without retrying them',
    async status => {
      const { origin, requests } = await target(() => ({
        status,
        body: { rc: -32011, message: 'Safe backend diagnostic' },
      }));
      const http = new RestHttpClient(
        parseRestConnections([{ url: origin, user: USER, rejectUnauthorized: false }])[0]
      );
      const response = await http.send(new URL(origin + '/test'), AUTH);
      expect(() => requireRestSuccess(response)).toThrow(
        `zo-rest HTTP ${status}: Safe backend diagnostic`
      );
      expect(requests).toHaveLength(1);
    }
  );

  it('retries gateway GET failures once, and never replays POST mutations', async () => {
    const { origin, requests } = await target(() => ({
      status: 503,
      body: { message: 'Unavailable' },
    }));
    const http = new RestHttpClient(
      parseRestConnections([{ url: origin, user: USER, rejectUnauthorized: false }])[0]
    );
    expect((await http.send(new URL(origin + '/read'), AUTH)).status).toBe(503);
    expect(
      (await http.send(new URL(origin + '/write'), AUTH, { method: 'POST', body: 'payload' }))
        .status
    ).toBe(503);
    expect(requests.map(request => request.method)).toEqual(['GET', 'GET', 'POST']);
  });

  it('does not expose arbitrary gateway HTML or follow redirects with credentials', async () => {
    const { origin, requests } = await target(() => ({
      status: 302,
      headers: { Location: 'https://example.invalid/credentials' },
      body: '<html>private proxy diagnostics</html>',
    }));
    const http = new RestHttpClient(
      parseRestConnections([{ url: origin, user: USER, rejectUnauthorized: false }])[0]
    );
    const response = await http.send(new URL(origin + '/redirect'), AUTH);
    expect(() => requireRestSuccess(response)).toThrow('Request failed');
    expect(() => requireRestSuccess(response)).not.toThrow('private proxy diagnostics');
    expect(requests).toHaveLength(1);
  });
});

describe('MCP tools backed by zo REST', () => {
  it.each([
    { tool: 'queryTso', rc: 4 },
    { tool: 'queryTso', rc: 8 },
    { tool: 'runSafeTsoCommand', rc: 4 },
    { tool: 'runSafeTsoCommand', rc: 8 },
  ])('reports $tool RC$rc as isError with the host output intact', async ({ tool, rc }) => {
    const { origin, requests } = await target(
      request =>
        directInfo(request) ?? {
          body: {
            command: 'LISTDS USER1.MISSING',
            rc,
            output:
              'IKJ56644I NO VALID TSO USERID, DEFAULT USER ATTRIBUTES USED\nNO ENTRIES MEET SEARCH CRITERIA\n',
          },
        }
    );
    const rest = setup(origin);
    const server = getServer(
      createServer({ ...rest, capabilityTier: 'full', responseCache: false })
    );
    const client = new Client({ name: 'zo-rest-tso-return-code-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      const result = await client.callTool({
        name: tool,
        arguments: { system: HOST, commandText: 'LISTDS USER1.MISSING' },
      });
      const text = JSON.stringify(result.content);
      expect(result.isError).toBe(true);
      expect(text).toContain(`rc '${rc}'`);
      expect(text).toContain('NO ENTRIES MEET SEARCH CRITERIA');
      expect(text).not.toContain('IKJ56644I');
      expect(
        requests.filter(request => request.url.pathname.endsWith('/tso/command'))
      ).toHaveLength(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('projects richer native job responses into the advertised MCP job schemas', async () => {
    const job = {
      id: 'JOB00123',
      name: 'USER1JOB',
      owner: USER,
      status: 'OUTPUT',
      type: 'JOB',
      class: 'A',
      phase: 20,
      phaseName: 'Job has completed',
      retcode: 'CC 0000',
      correlator: 'CORRELATOR',
    };
    const nativeJob = {
      ...job,
      execSystem: 'SYS1',
      execMember: 'SYS1',
      execSubmitted: '2026-11-17T10:00:00',
      execStarted: '2026-11-17T10:00:01',
      execEnded: '2026-11-17T10:00:02',
    };
    const spool = {
      id: 2,
      ddname: 'JESMSGLG',
      stepname: 'JES2',
      procstep: '',
      dsname: 'USER1JOB.JOB00123.D0000002.JESMSGLG',
    };
    const { origin } = await target(
      request =>
        directInfo(request) ?? {
          body: request.url.pathname.endsWith('/jobs')
            ? [nativeJob]
            : request.url.pathname.endsWith('/spool')
              ? [spool]
              : nativeJob,
        }
    );
    const rest = setup(origin);
    const server = getServer(
      createServer({ ...rest, capabilityTier: 'read', responseCache: false })
    );
    const client = new Client({ name: 'zo-rest-job-schema-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      const listed = await client.callTool({
        name: 'listJobs',
        arguments: { system: HOST, owner: USER },
      });
      const status = await client.callTool({
        name: 'getJobStatus',
        arguments: { system: HOST, jobId: job.id },
      });
      const files = await client.callTool({
        name: 'listJobFiles',
        arguments: { system: HOST, jobId: job.id },
      });
      expect(listed.isError).not.toBe(true);
      expect(status.isError).not.toBe(true);
      expect(files.isError).not.toBe(true);
      expect(listed.structuredContent).toMatchObject({ data: [job] });
      expect(status.structuredContent).toMatchObject({ data: job });
      expect(files.structuredContent).toMatchObject({ data: [spool] });
      expect(JSON.stringify(listed.structuredContent)).not.toContain('execSubmitted');
      expect(JSON.stringify(status.structuredContent)).not.toContain('execSystem');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('omits operations absent from zo-rest even at the full capability tier', async () => {
    const rest = setup('https://127.0.0.1:8443');
    const server = getServer(createServer({ ...rest, capabilityTier: 'full' }));
    const client = new Client({ name: 'zo-rest-supported-tools-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      const names = (await client.listTools()).tools.map(tool => tool.name);
      expect(names).toContain('readDataset');
      expect(names).toContain('getBackendStatus');
      for (const unsupported of [
        'display',
        'runConsoleCommand',
        'runSafeUssCommand',
        'getUssHome',
        'submitJobFromUss',
      ])
        expect(names).not.toContain(unsupported);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns normal structured tool responses through an MCP client', async () => {
    const { origin, requests } = await target(
      request =>
        directInfo(request) ?? {
          headers: { ETag: '"mcp-read"', 'Content-Type': 'text/plain; charset=UTF-8' },
          body: '//USER1JOB JOB\n//STEP1 EXEC PGM=IEFBR14',
        }
    );
    const rest = setup(origin);
    const server = getServer(
      createServer({ ...rest, capabilityTier: 'read', responseCache: false })
    );
    const client = new Client({ name: 'zo-rest-integration-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      const context = await client.callTool({ name: 'getContext', arguments: {} });
      expect(context.isError).not.toBe(true);
      const result = await client.callTool({
        name: 'readDataset',
        arguments: { system: HOST, dsn: 'USER1.JCL(JOB1)' },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        _context: { system: HOST },
        data: { etag: '"mcp-read"' },
      });
      expect(JSON.stringify(result.content)).toContain('IEFBR14');
      expect(
        requests.some(request =>
          request.url.pathname.includes('/zosmf/restfiles/ds/USER1.JCL(JOB1)')
        )
      ).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
