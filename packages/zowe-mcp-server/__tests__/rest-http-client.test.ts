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

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { RequestListener } from 'node:http';
import { createServer, type Server } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { OidcTokenExchange } from '../src/auth/oidc-token-exchange.js';
import type { NativeCredentialProvider } from '../src/zos/native/native-credential-provider.js';
import { ZoRestApi } from '../src/zos/rest/api.js';
import { parseRestConnections } from '../src/zos/rest/connection.js';
import { requireRestSuccess, RestHttpClient } from '../src/zos/rest/http.js';
import { generateHttpsTestCertificate } from './helpers/https-test-certificate.js';

let certificate: { key: Buffer; cert: Buffer };
const servers: Server[] = [];
const directories: string[] = [];

beforeAll(() => {
  certificate = generateHttpsTestCertificate();
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>((resolve, reject) => {
          server.close(error => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        })
    )
  );
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function connection(url = 'https://localhost') {
  return parseRestConnections([
    { url, user: 'USER1', deployment: 'direct', rejectUnauthorized: false },
  ])[0];
}

async function target(handler: RequestListener): Promise<URL> {
  const server = createServer(certificate, handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTPS test address.');
  return new URL(`https://127.0.0.1:${address.port}/test`);
}

describe('REST client diagnostics', () => {
  it('reports an oversized declared response without retrying or suggesting a TLS failure', async () => {
    let requests = 0;
    const url = await target((_req, res) => {
      requests++;
      res.writeHead(200, { 'Content-Length': String(100 * 1024 * 1024 + 1) });
      res.flushHeaders();
    });
    const http = new RestHttpClient(connection(url.origin));
    await expect(http.send(url, undefined)).rejects.toThrow(
      'zo-rest response exceeds the 100 MiB content limit.'
    );
    expect(requests).toBe(1);
  });

  it('keeps an incomplete-response diagnostic and does not replay the request', async () => {
    let requests = 0;
    const url = await target((_req, res) => {
      requests++;
      res.writeHead(200, { 'Content-Length': '1000' });
      res.flushHeaders();
      res.write('partial');
      setImmediate(() => res.destroy());
    });
    await expect(new RestHttpClient(connection(url.origin)).send(url, undefined)).rejects.toThrow(
      'Incomplete zo-rest response.'
    );
    expect(requests).toBe(1);
  });

  it('names an unreadable caFile setting without exposing the raw filesystem error', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zowe-mcp-ca-test-'));
    directories.push(directory);
    const create = () =>
      new RestHttpClient({ ...connection(), caFile: join(directory, 'missing.pem') });
    expect(create).toThrow('Unable to read REST caFile.');
    expect(create).not.toThrow(directory);
    expect(create).not.toThrow('ENOENT');
  });

  it('rejects a relative caFile outside the standalone configuration loader', () => {
    expect(() => new RestHttpClient({ ...connection(), caFile: 'site-ca.pem' })).toThrow(
      'REST caFile must be an absolute path.'
    );
  });

  it('accepts an absolute CA file and verifies the HTTPS peer', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zowe-mcp-ca-test-'));
    directories.push(directory);
    const caFile = join(directory, 'site-ca.pem');
    writeFileSync(caFile, certificate.cert);
    const url = await target((_req, res) => res.end('trusted'));
    const http = new RestHttpClient({
      ...connection(url.origin),
      caFile,
      rejectUnauthorized: true,
    });
    expect((await http.send(url, undefined)).body.toString()).toBe('trusted');
  });

  it.each(['a', '12', 'x y'])(
    'keeps short-credential errors readable without exposing %s',
    async password => {
      const url = await target((_req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: `Login failed: password=${password}` }));
      });
      const authorization = `Basic ${Buffer.from(`USER1:${password}`).toString('base64')}`;
      const response = await new RestHttpClient(connection(url.origin)).send(url, authorization);
      expect(JSON.parse(response.body.toString())).toEqual({
        message:
          'Service diagnostic omitted to protect a short credential. Check the HTTP status and backend authentication status.',
      });
      expect(() => requireRestSuccess(response)).toThrow(
        'Re-authenticate through secure elicitation'
      );
      expect(() => requireRestSuccess(response)).not.toThrow(`password=${password}`);
      expect(() => requireRestSuccess(response)).not.toThrow(authorization);
    }
  );

  it('redacts long credentials in remote JSON diagnostics', async () => {
    const password = 'dummy-password-for-diagnostics';
    const cookie = 'dummy-session-cookie-for-diagnostics';
    const url = await target((_req, res) => {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `Denied ${password} ${cookie}` }));
    });
    const response = await new RestHttpClient(connection(url.origin)).send(
      url,
      `Basic ${Buffer.from(`USER1:${password}`).toString('base64')}`,
      { headers: { Cookie: `session=${cookie}` } }
    );
    expect(JSON.parse(response.body.toString())).toEqual({
      message: 'Denied [redacted] [redacted]',
    });
  });
});

describe('OAuth diagnostic privacy', () => {
  it('redacts OAuth subject tokens echoed from a form request', async () => {
    const subject = 'dummy-subject-token-with/private+characters';
    const url = await target((_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `Invalid ${subject} ${encodeURIComponent(subject)}` }));
    });
    const response = await new RestHttpClient(connection(url.origin)).send(url, undefined, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ subject_token: subject }).toString(),
    });
    expect(JSON.parse(response.body.toString())).toEqual({
      message: 'Invalid [redacted] [redacted]',
    });
  });
});

describe('token-exchange configuration', () => {
  const oidcTokenExchange = { url: 'https://idp.example.com/token', audience: 'zo-backend' };

  it('accepts an explicitly declared exchange without changing other defaults', () => {
    expect(
      parseRestConnections([
        { url: 'https://zos.example.com', user: 'USER1', oidcTokenExchange },
      ])[0]
    ).toMatchObject({ oidcTokenExchange, deployment: 'auto', rejectUnauthorized: true });
    expect(connection().oidcTokenExchange).toBeUndefined();
  });

  it.each([
    { url: 'http://idp.example.com/token', audience: 'zo-backend' },
    { url: 'https://private@idp.example.com/token', audience: 'zo-backend' },
    { url: 'https://idp.example.com/token?credential=private', audience: 'zo-backend' },
    { url: 'https://idp.example.com/token#private', audience: 'zo-backend' },
    { url: 'https://idp.example.com/token' },
    { ...oidcTokenExchange, clientSecretEnv: 'EXCHANGE_SECRET' },
    { ...oidcTokenExchange, clientSecret: 'must-not-be-written' },
    { ...oidcTokenExchange, audience: '   ' },
    { ...oidcTokenExchange, scope: '\r\n' },
    { ...oidcTokenExchange, resource: 'https://zos.example.com/#fragment' },
    { ...oidcTokenExchange, resource: 'https://private@zos.example.com/' },
  ])('rejects an unsafe or incomplete exchange declaration %#', exchange => {
    expect(() =>
      parseRestConnections([
        { url: 'https://zos.example.com', user: 'USER1', oidcTokenExchange: exchange },
      ])
    ).toThrow();
  });

  it('validates resource URIs for direct library use and accepts non-URL resource identifiers', () => {
    const config = { url: oidcTokenExchange.url, resource: 'urn:zo:backend' };
    expect(() => new OidcTokenExchange({ config, send: vi.fn() })).not.toThrow();
    expect(
      parseRestConnections([
        { url: 'https://zos.example.com', user: 'USER1', oidcTokenExchange: config },
      ])[0].oidcTokenExchange?.resource
    ).toBe('urn:zo:backend');
    for (const resource of ['relative', 'https://zos.example.com/#', 'urn:zo:backend#fragment'])
      expect(
        () => new OidcTokenExchange({ config: { ...config, resource }, send: vi.fn() })
      ).toThrow('resource must be an absolute URI without credentials or a fragment');
  });
});

describe('REST password requirements', () => {
  it.each([undefined, ''])(
    'rejects a missing password before sending Basic authentication',
    async password => {
      const authorizations: (string | undefined)[] = [];
      const url = await target((req, res) => {
        authorizations.push(req.headers.authorization);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Authentication required.' }));
      });
      const getCredentials = vi.fn().mockResolvedValue({ user: 'USER1', password });
      const forgetPassword = vi.fn();
      const api = new ZoRestApi(connection(url.origin), {
        getCredentials,
        forgetPassword,
      } as unknown as NativeCredentialProvider);
      await expect(api.request('zo', 'ds')).rejects.toThrow(
        'REST authentication requires a password.'
      );
      expect(authorizations).toEqual([undefined]);
      expect(getCredentials).toHaveBeenCalledTimes(1);
      expect(forgetPassword).not.toHaveBeenCalled();
    }
  );
});
