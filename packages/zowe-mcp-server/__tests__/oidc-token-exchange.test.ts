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

import { describe, expect, it, vi } from 'vitest';
import {
  OidcTokenExchange,
  OidcTokenExchangeError,
  type OidcTokenExchangeConfig,
  type OidcTokenExchangeOptions,
} from '../src/auth/oidc-token-exchange.js';
import type { SessionHttpResponse } from '../src/auth/rest-session-auth.js';

const URL = 'https://issuer.example.test/oauth/token';
const SUBJECT = 'frontend-access-token-A';
const OTHER_SUBJECT = 'frontend-access-token-B';
const DOWNSTREAM = 'downstream-access-token-A';
const NEXT_DOWNSTREAM = 'downstream-access-token-B';
const CLIENT_SECRET = 'test-client-secret';
const REFRESH = 'refresh-token-never-used';
const ACCESS_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const START = Date.parse('2030-01-01T00:00:00Z');

function response(status: number, body: unknown): SessionHttpResponse {
  return { status, headers: {}, body: Buffer.from(JSON.stringify(body)) };
}

function success(overrides: Record<string, unknown> = {}): SessionHttpResponse {
  return response(200, {
    access_token: DOWNSTREAM,
    token_type: 'Bearer',
    issued_token_type: ACCESS_TYPE,
    expires_in: 300,
    ...overrides,
  });
}

function jwt(exp: unknown): string {
  return [
    Buffer.from('{"alg":"RS256"}').toString('base64url'),
    Buffer.from(JSON.stringify({ exp })).toString('base64url'),
    'test-signature',
  ].join('.');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}

function setup(
  config: Partial<OidcTokenExchangeConfig> = {},
  getClientSecret?: () => string | undefined
) {
  let currentTime = START;
  const send = vi.fn<OidcTokenExchangeOptions['send']>().mockResolvedValue(success());
  const exchange = new OidcTokenExchange({
    config: { url: URL, audience: 'backend-service', ...config },
    send,
    getClientSecret,
    now: () => currentTime,
  });
  return {
    exchange,
    send,
    advance: (milliseconds: number) => {
      currentTime += milliseconds;
    },
  };
}

function expectPrivate(exchange: OidcTokenExchange, errors: unknown[] = []) {
  const diagnostics = JSON.stringify([
    exchange.getStatus(),
    exchange.getStatus(SUBJECT),
    exchange.getCacheIdentity(SUBJECT),
    ...errors.map(error =>
      error instanceof Error ? { ...error, message: error.message } : error
    ),
  ]);
  for (const secret of [
    SUBJECT,
    OTHER_SUBJECT,
    DOWNSTREAM,
    NEXT_DOWNSTREAM,
    CLIENT_SECRET,
    REFRESH,
  ])
    expect(diagnostics).not.toContain(secret);
}

describe('OIDC token exchange proof of concept', () => {
  it('inspects status without an exchange, credentials, or shared subject state', () => {
    const fixture = setup();
    expect(fixture.exchange.getStatus()).toEqual({
      stage: 'proof-of-concept',
      state: 'not-tested',
    });
    expect(fixture.exchange.getStatus(SUBJECT)).toEqual({
      stage: 'proof-of-concept',
      state: 'not-tested',
    });
    expect(fixture.send).not.toHaveBeenCalled();
    expectPrivate(fixture.exchange);
  });

  it('sends a single RFC8693 form POST and caches the backend Bearer token', async () => {
    const fixture = setup({
      audience: 'target-service',
      resource: 'https://backend.example.test/api',
      scope: 'read write',
      clientId: 'public-client',
    });
    const authentication = await fixture.exchange.getAuthentication(SUBJECT);
    expect(authentication).toEqual({ authorization: `Bearer ${DOWNSTREAM}` });
    expect(await fixture.exchange.getAuthentication(SUBJECT)).toBe(authentication);
    expect(fixture.send).toHaveBeenCalledTimes(1);
    const [url, authorization, request] = fixture.send.mock.calls[0];
    expect(url.href).toBe(URL);
    expect(authorization).toBeUndefined();
    expect(request.method).toBe('POST');
    expect(request.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(request.body))).toEqual({
      grant_type: GRANT,
      subject_token_type: ACCESS_TYPE,
      requested_token_type: ACCESS_TYPE,
      subject_token: SUBJECT,
      audience: 'target-service',
      resource: 'https://backend.example.test/api',
      scope: 'read write',
      client_id: 'public-client',
    });
    expect(fixture.exchange.getStatus(SUBJECT)).toEqual({
      stage: 'proof-of-concept',
      state: 'valid',
      expiresAt: START + 300_000,
      lastHttpStatus: 200,
    });
    expectPrivate(fixture.exchange);
    const retained = JSON.stringify(fixture.exchange, (_key, value: unknown) =>
      value instanceof Map ? [...value] : value
    );
    expect(retained).not.toContain(SUBJECT);
  });

  it('allows a resource-only target and omits unspecified request parameters', async () => {
    const fixture = setup({ audience: undefined, resource: 'https://backend.example.test/api' });
    await fixture.exchange.getAuthentication(SUBJECT);
    const form = new URLSearchParams(fixture.send.mock.calls[0][2].body);
    expect(form.get('resource')).toBe('https://backend.example.test/api');
    expect(form.has('audience') || form.has('scope') || form.has('client_id')).toBe(false);
  });

  it('uses form-encoded Basic client authentication without duplicating client_id in the body', async () => {
    const fixture = setup(
      { clientId: 'id: x', clientSecretEnv: 'EXCHANGE_CLIENT_SECRET' },
      () => 's: /'
    );
    await fixture.exchange.getAuthentication(SUBJECT);
    const [, authorization, request] = fixture.send.mock.calls[0];
    expect(authorization).toBe(`Basic ${Buffer.from('id%3A+x:s%3A+%2F').toString('base64')}`);
    expect(new URLSearchParams(request.body).has('client_id')).toBe(false);
    expect(new URLSearchParams(request.body).has('client_secret')).toBe(false);
  });

  it('supports an explicitly supplied client secret callback without an environment declaration', async () => {
    const fixture = setup({ clientId: 'service-client' }, () => CLIENT_SECRET);
    await fixture.exchange.getAuthentication(SUBJECT);
    expect(fixture.send.mock.calls[0][1]).toBe(
      `Basic ${Buffer.from(`service-client:${CLIENT_SECRET}`).toString('base64')}`
    );
  });

  it.each([undefined, ''])(
    'fails locally when declared client credentials are missing (%#)',
    async secret => {
      const fixture = setup(
        { clientId: 'service-client', clientSecretEnv: 'EXCHANGE_CLIENT_SECRET' },
        () => secret
      );
      await expect(fixture.exchange.getAuthentication(SUBJECT)).rejects.toMatchObject({
        fallbackAllowed: false,
      });
      expect(fixture.send).not.toHaveBeenCalled();
      expectPrivate(fixture.exchange);
    }
  );

  it('does not send a callback-supplied secret without a client identity', async () => {
    const fixture = setup({}, () => CLIENT_SECRET);
    await expect(fixture.exchange.getAuthentication(SUBJECT)).rejects.toMatchObject({
      fallbackAllowed: false,
    });
    expect(fixture.send).not.toHaveBeenCalled();
  });

  it('removes a secret provider exception from diagnostics', async () => {
    const fixture = setup({ clientId: 'service-client' }, () => {
      throw new Error(CLIENT_SECRET);
    });
    const failure = await fixture.exchange
      .getAuthentication(SUBJECT)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OidcTokenExchangeError);
    expectPrivate(fixture.exchange, [failure]);
    expect(fixture.send).not.toHaveBeenCalled();
  });

  it.each([
    { url: 'http://issuer.example.test/token' },
    { url: 'https://user:password@issuer.example.test/token' },
    { url: 'https://issuer.example.test/token?key=secret' },
    { url: 'https://issuer.example.test/token?' },
    { url: 'https://issuer.example.test/token#fragment' },
    { url: 'not-a-url' },
    { audience: undefined, resource: undefined },
    { audience: '' },
    { audience: '   ' },
    { scope: 'read\r\nwrite' },
    { clientSecretEnv: 'EXCHANGE_CLIENT_SECRET', clientId: undefined },
  ])('rejects unsafe or incomplete local configuration (%#)', config => {
    expect(() => setup(config)).toThrow(OidcTokenExchangeError);
  });

  it.each(['', 'token\r\nheader', 'token\n', 'token\u2028', 'token with spaces'])(
    'rejects unsafe subject tokens without contacting the issuer (%#)',
    async subject => {
      const fixture = setup();
      await expect(fixture.exchange.getAuthentication(subject)).rejects.toMatchObject({
        fallbackAllowed: false,
      });
      expect(fixture.send).not.toHaveBeenCalled();
    }
  );

  it('coalesces concurrent exchanges for the same subject', async () => {
    const fixture = setup();
    const pending = deferred<SessionHttpResponse>();
    fixture.send.mockReturnValueOnce(pending.promise);
    const requests = Array.from({ length: 20 }, () => fixture.exchange.getAuthentication(SUBJECT));
    expect(fixture.send).toHaveBeenCalledTimes(1);
    pending.resolve(success());
    const results = await Promise.all(requests);
    expect(results.every(result => result === results[0])).toBe(true);
    expectPrivate(fixture.exchange);
  });

  it('keeps concurrent subjects and their invalidation independent', async () => {
    const fixture = setup();
    fixture.send.mockImplementation((_url, _authorization, request) =>
      Promise.resolve(
        success({
          access_token:
            new URLSearchParams(request.body).get('subject_token') === SUBJECT
              ? DOWNSTREAM
              : NEXT_DOWNSTREAM,
        })
      )
    );
    const [first, other] = await Promise.all([
      fixture.exchange.getAuthentication(SUBJECT),
      fixture.exchange.getAuthentication(OTHER_SUBJECT),
    ]);
    const otherIdentity = fixture.exchange.getCacheIdentity(OTHER_SUBJECT);
    fixture.exchange.invalidate(SUBJECT, first);
    expect(fixture.exchange.getStatus(SUBJECT).state).toBe('rejected');
    expect(await fixture.exchange.getAuthentication(OTHER_SUBJECT)).toBe(other);
    expect(fixture.exchange.getCacheIdentity(OTHER_SUBJECT)).toBe(otherIdentity);
    expect(fixture.send).toHaveBeenCalledTimes(2);
  });

  it('ignores a delayed rejection of the replaced authentication', async () => {
    const fixture = setup();
    const old = await fixture.exchange.getAuthentication(SUBJECT);
    expect(fixture.exchange.invalidate(SUBJECT, old)).toBe(true);
    fixture.send.mockResolvedValueOnce(success({ access_token: NEXT_DOWNSTREAM }));
    const replacement = await fixture.exchange.getAuthentication(SUBJECT);
    const identity = fixture.exchange.getCacheIdentity(SUBJECT);
    expect(fixture.exchange.invalidate(SUBJECT, old)).toBe(false);
    expect(await fixture.exchange.getAuthentication(SUBJECT)).toBe(replacement);
    expect(fixture.exchange.getCacheIdentity(SUBJECT)).toBe(identity);
    expect(fixture.send).toHaveBeenCalledTimes(2);
  });

  it('coalesces re-acquisition after parallel downstream rejections', async () => {
    const fixture = setup();
    const old = await fixture.exchange.getAuthentication(SUBJECT);
    const pending = deferred<SessionHttpResponse>();
    fixture.send.mockReturnValueOnce(pending.promise);
    fixture.exchange.invalidate(SUBJECT, old);
    const first = fixture.exchange.getAuthentication(SUBJECT);
    fixture.exchange.invalidate(SUBJECT, old);
    const second = fixture.exchange.getAuthentication(SUBJECT);
    pending.resolve(success({ access_token: NEXT_DOWNSTREAM }));
    expect(await first).toBe(await second);
    expect(fixture.send).toHaveBeenCalledTimes(2);
  });

  it('does not let an invalidated pending exchange overwrite or clear its replacement', async () => {
    const fixture = setup();
    const oldResponse = deferred<SessionHttpResponse>();
    const newResponse = deferred<SessionHttpResponse>();
    fixture.send.mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(newResponse.promise);
    const old = fixture.exchange.getAuthentication(SUBJECT);
    fixture.exchange.invalidate(SUBJECT);
    const replacement = fixture.exchange.getAuthentication(SUBJECT);
    oldResponse.resolve(success());
    await expect(old).rejects.toMatchObject({ fallbackAllowed: false });
    const alsoReplacement = fixture.exchange.getAuthentication(SUBJECT);
    expect(fixture.send).toHaveBeenCalledTimes(2);
    newResponse.resolve(success({ access_token: NEXT_DOWNSTREAM }));
    expect(await replacement).toBe(await alsoReplacement);
    expect(fixture.exchange.getStatus(SUBJECT).state).toBe('valid');
  });

  it.each([
    { expiresIn: 60, jwtSeconds: 30, expectedSeconds: 30 },
    { expiresIn: 30, jwtSeconds: 60, expectedSeconds: 30 },
    { expiresIn: undefined, jwtSeconds: 30, expectedSeconds: 30 },
  ])(
    'expires at the earliest declared lifetime (%#)',
    async ({ expiresIn, jwtSeconds, expectedSeconds }) => {
      const fixture = setup();
      fixture.send
        .mockResolvedValueOnce(
          success({ access_token: jwt(START / 1000 + jwtSeconds), expires_in: expiresIn })
        )
        .mockResolvedValueOnce(success({ access_token: NEXT_DOWNSTREAM }));
      const first = await fixture.exchange.getAuthentication(SUBJECT);
      const identity = fixture.exchange.getCacheIdentity(SUBJECT);
      expect(fixture.exchange.getStatus(SUBJECT).expiresAt).toBe(START + expectedSeconds * 1000);
      fixture.advance(expectedSeconds * 1000);
      expect(fixture.exchange.getStatus(SUBJECT).state).toBe('expired');
      expect(fixture.exchange.getCacheIdentity(SUBJECT)).not.toBe(identity);
      expect(await fixture.exchange.getAuthentication(SUBJECT)).not.toBe(first);
      expect(fixture.send).toHaveBeenCalledTimes(2);
    }
  );

  it('never retains an opaque token without expiry beyond its acquisition', async () => {
    const fixture = setup();
    fixture.send.mockResolvedValue(success({ expires_in: undefined }));
    const before = fixture.exchange.getCacheIdentity(SUBJECT);
    const first = await fixture.exchange.getAuthentication(SUBJECT);
    const after = fixture.exchange.getCacheIdentity(SUBJECT);
    expect(after).not.toBe(before);
    expect(fixture.exchange.getStatus(SUBJECT).state).toBe('expired');
    expect(fixture.exchange.getStatus(SUBJECT).expiresAt).toBeUndefined();
    expect(await fixture.exchange.getAuthentication(SUBJECT)).not.toBe(first);
    expect(fixture.exchange.getCacheIdentity(SUBJECT)).not.toBe(after);
    expect(fixture.send).toHaveBeenCalledTimes(2);
  });

  it('does not let a delayed one-shot token rejection cancel a fresh acquisition', async () => {
    const fixture = setup();
    fixture.send.mockResolvedValueOnce(success({ expires_in: undefined }));
    const old = await fixture.exchange.getAuthentication(SUBJECT);
    const next = deferred<SessionHttpResponse>();
    fixture.send.mockReturnValueOnce(next.promise);
    const replacement = fixture.exchange.getAuthentication(SUBJECT);
    fixture.exchange.invalidate(SUBJECT, old);
    next.resolve(success({ access_token: NEXT_DOWNSTREAM }));
    await expect(replacement).resolves.toEqual({ authorization: `Bearer ${NEXT_DOWNSTREAM}` });
    expect(fixture.exchange.getStatus(SUBJECT).state).toBe('valid');
    expect(fixture.send).toHaveBeenCalledTimes(2);
  });

  it('bounds history and prevents a re-presented evicted token from reviving an old cache key', async () => {
    const fixture = setup();
    const initialIdentity = fixture.exchange.getCacheIdentity(SUBJECT);
    await fixture.exchange.getAuthentication(SUBJECT);
    const validIdentity = fixture.exchange.getCacheIdentity(SUBJECT);
    for (let index = 0; index < 8; index++)
      await fixture.exchange.getAuthentication(`other-subject-${index}`);
    expect(fixture.exchange.getStatus(SUBJECT).state).toBe('not-tested');
    const newIdentity = fixture.exchange.getCacheIdentity(SUBJECT);
    expect(newIdentity).not.toBe(initialIdentity);
    expect(newIdentity).not.toBe(validIdentity);
    await fixture.exchange.getAuthentication(SUBJECT);
    expect(fixture.send).toHaveBeenCalledTimes(10);
  });

  it('coalesces in-flight work even when the bounded history entry was evicted', async () => {
    const fixture = setup();
    const pending = deferred<SessionHttpResponse>();
    fixture.send.mockReturnValueOnce(pending.promise);
    const first = fixture.exchange.getAuthentication(SUBJECT);
    for (let index = 0; index < 9; index++)
      await fixture.exchange.getAuthentication(`other-subject-${index}`);
    const joined = fixture.exchange.getAuthentication(SUBJECT);
    expect(fixture.send).toHaveBeenCalledTimes(10);
    pending.resolve(success());
    expect(await first).toBe(await joined);
    expect(fixture.exchange.getStatus(SUBJECT).state).toBe('not-tested');
  });

  it.each([
    { status: 400, fallbackAllowed: true, state: 'rejected' },
    { status: 401, fallbackAllowed: true, state: 'rejected' },
    { status: 404, fallbackAllowed: true, state: 'unavailable' },
    { status: 405, fallbackAllowed: true, state: 'unavailable' },
    { status: 501, fallbackAllowed: true, state: 'unavailable' },
    { status: 403, fallbackAllowed: false, state: 'rejected' },
    { status: 429, fallbackAllowed: false, state: 'unavailable' },
    { status: 500, fallbackAllowed: false, state: 'unavailable' },
    { status: 502, fallbackAllowed: false, state: 'unavailable' },
    { status: 503, fallbackAllowed: false, state: 'unavailable' },
    { status: 504, fallbackAllowed: false, state: 'unavailable' },
  ])(
    'classifies HTTP$status without retries or echoed response bodies',
    async ({ status, fallbackAllowed, state }) => {
      const fixture = setup();
      fixture.send.mockResolvedValueOnce(
        response(status, { error_description: `${SUBJECT} ${CLIENT_SECRET} ${DOWNSTREAM}` })
      );
      const error = await fixture.exchange
        .getAuthentication(SUBJECT)
        .catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(OidcTokenExchangeError);
      expect(error).toMatchObject({ fallbackAllowed, status });
      expect(fixture.exchange.getStatus(SUBJECT)).toMatchObject({ state, lastHttpStatus: status });
      expect(fixture.send).toHaveBeenCalledTimes(1);
      expectPrivate(fixture.exchange, [error]);
    }
  );

  it('does not allow fallback on a transport exception or leak its diagnostic text', async () => {
    const fixture = setup();
    fixture.send.mockRejectedValueOnce(new Error(`${SUBJECT} ${CLIENT_SECRET}`));
    const error = await fixture.exchange
      .getAuthentication(SUBJECT)
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ fallbackAllowed: false });
    expect(fixture.exchange.getStatus(SUBJECT).state).toBe('unavailable');
    expect(fixture.send).toHaveBeenCalledTimes(1);
    expectPrivate(fixture.exchange, [error]);
  });

  it.each([
    { access_token: '' },
    { access_token: SUBJECT },
    { access_token: 'token\r\nheader' },
    { access_token: 'token\n' },
    { access_token: 'token\u2028' },
    { access_token: 'token with spaces' },
    { token_type: undefined },
    { token_type: 'DPoP' },
    { token_type: 'Bearer\r\n' },
    { issued_token_type: undefined },
    { issued_token_type: 'urn:ietf:params:oauth:token-type:jwt' },
    { expires_in: '60' },
    { expires_in: null },
    { expires_in: 0 },
    { expires_in: -1 },
    { expires_in: 1e308 },
    { access_token: jwt(START / 1000 - 1) },
    { access_token: jwt('later') },
  ])('rejects malformed successful responses without password fallback (%#)', async overrides => {
    const fixture = setup();
    fixture.send.mockResolvedValueOnce(success(overrides));
    const error = await fixture.exchange
      .getAuthentication(SUBJECT)
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(OidcTokenExchangeError);
    expect(error).toMatchObject({ fallbackAllowed: false, status: 200 });
    expect(fixture.exchange.getStatus(SUBJECT).state).toBe('rejected');
    expectPrivate(fixture.exchange, [error]);
  });

  it('rejects invalid JSON without exposing the response text', async () => {
    const fixture = setup();
    fixture.send.mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: Buffer.from(`not-json ${SUBJECT}`),
    });
    const error = await fixture.exchange
      .getAuthentication(SUBJECT)
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ fallbackAllowed: false });
    expectPrivate(fixture.exchange, [error]);
  });

  it('accepts case-insensitive Bearer and ignores refresh tokens', async () => {
    const fixture = setup();
    fixture.send.mockResolvedValue(
      success({ token_type: 'bEaReR', expires_in: 1, refresh_token: REFRESH })
    );
    await fixture.exchange.getAuthentication(SUBJECT);
    fixture.advance(1000);
    await fixture.exchange.getAuthentication(SUBJECT);
    expect(fixture.send).toHaveBeenCalledTimes(2);
    expect(
      fixture.send.mock.calls.every(
        ([, , request]) => new URLSearchParams(request.body).get('grant_type') === GRANT
      )
    ).toBe(true);
    expectPrivate(fixture.exchange);
  });
});
