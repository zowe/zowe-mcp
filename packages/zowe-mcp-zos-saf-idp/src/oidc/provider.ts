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
 * Assembles the `oidc-provider` authorization server around the package's
 * existing in-memory signing key and SAF-account model.
 *
 * Deliberate choices (see docs/zos-saf-idp.md):
 * - One keyset: the same in-memory RSA key signs both oidc-provider tokens and
 *   the legacy `POST /login` tokens, and is served from both `/jwks` (provider)
 *   and `/.well-known/jwks.json` (legacy alias). Never persisted — a restart
 *   invalidates everything, which also sidesteps the z/OS fs.readFileSync
 *   EBCDIC-corruption bug.
 * - Access tokens are always resource-bound RS256 JWTs (`features.userinfo`
 *   disabled so they can never degrade to opaque userinfo tokens), shaped so
 *   `@zowe/mcp-server`'s bearer-jwt verifier accepts them unchanged:
 *   `iss` = this issuer, `sub` = the SAF userid, `aud` = the MCP resource URL.
 * - OAuth 2.1 posture: authorization code + PKCE S256 required, no implicit,
 *   public clients allowed, refresh tokens rotate.
 * - In-memory adapter only: clients registered via DCR, codes, sessions and
 *   grants are all lost on restart. Clients (VS Code) recover by re-registering.
 */

import { randomBytes } from 'node:crypto';
import Provider, { errors, type ClientMetadata, type Configuration } from 'oidc-provider';
import type { IdpKeyPair } from '../keys.js';
import { errorPage } from './html.js';

export interface OidcProviderOptions {
  issuer: string;
  keyPair: IdpKeyPair;
  /** MCP server URL the access tokens are bound to (RFC 8707); becomes `aud`. */
  mcpResource: string;
  /** Access-token lifetime in seconds. */
  tokenTtlSeconds: number;
  /** Statically configured clients (in addition to DCR). */
  staticClients?: ClientMetadata[];
  /** Honor X-Forwarded-* headers (behind a TLS-terminating proxy). */
  trustProxy?: boolean;
  /** External header-less TLS termination (AT-TLS): the app forces X-Forwarded-Proto itself. */
  tlsTerminated?: boolean;
  log?: (message: string) => void;
}

export const OIDC_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

export function buildOidcProvider(options: OidcProviderOptions): Provider {
  const { issuer, keyPair, mcpResource, tokenTtlSeconds } = options;
  const log =
    options.log ??
    ((): void => {
      /* logging disabled by default */
    });

  const privateJwk = {
    ...(keyPair.privateKey.export({ format: 'jwk' }) as Record<string, unknown>),
    kid: keyPair.kid,
    alg: 'RS256',
    use: 'sig',
  };

  const configuration: Configuration = {
    jwks: { keys: [privateJwk] },
    cookies: {
      // Same lifecycle as the signing key: fresh per instance, never persisted.
      keys: [randomBytes(32).toString('hex')],
      // Over plain http a SameSite=None cookie without Secure is dropped by
      // browsers, which silently breaks the interaction round trip.
      long: { sameSite: 'lax' },
      short: { sameSite: 'lax' },
    },
    scopes: OIDC_SCOPES,
    claims: {
      openid: ['sub'],
      profile: ['preferred_username'],
      email: ['email'],
    },
    // v9 supports only S256; `required` makes PKCE mandatory (OAuth 2.1 posture).
    pkce: {
      required: () => true,
    },
    clientAuthMethods: ['none', 'client_secret_basic', 'client_secret_post'],
    clientDefaults: {
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    clients: options.staticClients ?? [],
    findAccount: (_ctx, id) => ({
      accountId: id,
      claims: () => ({ sub: id, preferred_username: id }),
    }),
    interactions: {
      url: (_ctx, interaction) => `/interaction/${interaction.uid}`,
    },
    features: {
      devInteractions: { enabled: false },
      // Keep access tokens resource-bound JWTs: with userinfo enabled, an
      // openid-scoped token issued without a resource becomes an opaque
      // userinfo token that the MCP server cannot verify.
      userinfo: { enabled: false },
      registration: {
        enabled: true,
        initialAccessToken: false,
      },
      revocation: { enabled: true },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => mcpResource,
        useGrantedResource: () => true,
        getResourceServerInfo: (_ctx, indicator) => {
          if (indicator !== mcpResource) {
            throw new errors.InvalidTarget();
          }
          return {
            scope: OIDC_SCOPES.join(' '),
            audience: mcpResource,
            accessTokenFormat: 'jwt',
            accessTokenTTL: tokenTtlSeconds,
            jwt: { sign: { alg: 'RS256' } },
          };
        },
      },
    },
    // VS Code registers the refresh_token grant but does not request the
    // offline_access scope the default policy insists on; key on the grant
    // type alone so short-lived access tokens refresh without re-login.
    issueRefreshToken: (_ctx, client) => client.grantTypeAllowed('refresh_token'),
    rotateRefreshToken: true,
    ttl: {
      AccessToken: tokenTtlSeconds,
      AuthorizationCode: 60,
      IdToken: 300,
      Interaction: 3600,
      Session: 24 * 3600,
      Grant: 24 * 3600,
      RefreshToken: 8 * 3600,
    },
    renderError: (ctx, out, _error) => {
      ctx.type = 'html';
      ctx.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      ctx.set('Cache-Control', 'no-store');
      ctx.body = errorPage({
        error: typeof out.error === 'string' ? out.error : 'server_error',
        errorDescription:
          typeof out.error_description === 'string' ? out.error_description : undefined,
      });
    },
  };

  const provider = new Provider(issuer, configuration);
  // tlsTerminated also needs proxy mode: the forced X-Forwarded-Proto header is
  // only honored by Koa (ctx.secure) when the provider trusts proxy headers.
  if (options.trustProxy || options.tlsTerminated) {
    provider.proxy = true;
  }
  provider.on('server_error', (_ctx, err) => {
    // Message only — request bodies can contain credentials.
    log(`oidc server_error: ${err.message}`);
  });
  return provider;
}
