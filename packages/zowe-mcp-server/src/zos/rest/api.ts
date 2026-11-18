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

import { createHash } from 'node:crypto';
import { OidcTokenExchange, OidcTokenExchangeError } from '../../auth/oidc-token-exchange.js';
import { getVerifiedRequestIdentity } from '../../auth/request-identity.js';
import {
  apimlSessionLogin,
  RestSessionAuthentication,
  type SessionLoginConfig,
} from '../../auth/rest-session-auth.js';
import { getLogger } from '../../server.js';
import type { BackendConnectionStatus, BackendProgressCallback } from '../backend.js';
import type { NativeCredentialProvider } from '../native/native-credential-provider.js';
import type { RestConnection } from './connection.js';
import { requireRestSuccess, RestHttpClient, type RestResponse } from './http.js';

export interface RestRequest {
  method?: string;
  query?: object;
  json?: object;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

export function parseRestJson<T>(response: RestResponse): T {
  try {
    return JSON.parse(response.body.toString('utf8')) as T;
  } catch {
    throw new Error(
      'zo-rest returned an invalid JSON response. Verify that the URL points to zo-rest.'
    );
  }
}

/** One verified zo service, with separate native and compatibility bases. */
export class ZoRestApi {
  private readonly http: RestHttpClient;
  private readonly endpoint: URL;
  private bases?: Promise<{ zo: string; zosmf: string }>;
  private detectedDeployment: BackendConnectionStatus['detectedDeployment'] = 'unknown';
  private discoveryStatus: BackendConnectionStatus['discovery'] = 'not-attempted';
  /** Only fingerprints and diagnostic state are retained, never raw access tokens. */
  private readonly authenticationStates = new Map<
    string,
    BackendConnectionStatus['authentication']
  >();
  private readonly authenticationGenerations = new WeakMap<
    BackendConnectionStatus['authentication'],
    number
  >();
  private nextAuthenticationGeneration = 0;
  private readonly sessionAuthentication: RestSessionAuthentication;
  private readonly oidcTokenExchange?: OidcTokenExchange;

  constructor(
    readonly connection: RestConnection,
    private readonly credentials: NativeCredentialProvider
  ) {
    this.endpoint = new URL(connection.url);
    this.http = new RestHttpClient(connection);
    if (connection.oidcTokenExchange)
      this.oidcTokenExchange = new OidcTokenExchange({
        config: connection.oidcTokenExchange,
        send: (url, authorization, request) => this.http.send(url, authorization, request),
        getClientSecret: () =>
          connection.oidcTokenExchange?.clientSecretEnv
            ? process.env[connection.oidcTokenExchange.clientSecretEnv]
            : undefined,
      });
    const spec = {
      user: connection.user,
      host: this.endpoint.hostname,
      port: Number(this.endpoint.port || 443),
    };
    this.sessionAuthentication = new RestSessionAuthentication({
      login:
        connection.sessionLogin ??
        (connection.deployment === 'apiml' ? apimlSessionLogin(this.endpoint.origin) : undefined),
      getCredentials: async forceElicitation => {
        const credentials = await this.credentials.getCredentials(spec.host, spec.user, {
          forceElicitation,
        });
        if (!credentials.password)
          throw new Error(
            'REST authentication requires a password. Provide credentials through secure elicitation or a configured credential source.'
          );
        return {
          user: credentials.user,
          password: credentials.password,
          source: this.credentials.getCredentialSource(spec.host, spec.user) ?? 'elicited',
        };
      },
      forgetCredentials: () => this.credentials.forgetPassword(spec),
      send: (url, authorization, request) => this.http.send(url, authorization, request),
    });
  }

  private authState(accessToken: string | undefined): BackendConnectionStatus['authentication'] {
    const key = accessToken
      ? createHash('sha256').update(accessToken).digest('hex')
      : 'no-frontend-token';
    let state = this.authenticationStates.get(key);
    if (!state) {
      state = {
        preferred: 'oidc',
        active: 'not-tested',
        oidcAvailable: !!accessToken,
        oidcFlow: this.oidcTokenExchange ? 'token-exchange-poc' : 'passthrough',
        oidcStatus: accessToken ? 'not-tested' : 'not-available',
        verified: false,
        ...(!accessToken ? { fallbackReason: 'no-frontend-token' as const } : {}),
        message: accessToken
          ? 'Frontend OIDC identity is available; downstream authentication has not been verified.'
          : 'No frontend OIDC token is available. Existing credential handling will be used when needed.',
      };
      if (this.authenticationStates.size >= 8)
        this.authenticationStates.delete(this.authenticationStates.keys().next().value!);
      this.authenticationStates.set(key, state);
      this.authenticationGenerations.set(state, ++this.nextAuthenticationGeneration);
    }
    return state;
  }

  getCacheIdentity(): string {
    const state = this.authState(getVerifiedRequestIdentity()?.accessToken);
    // A fresh generation prevents an evicted token state from reviving an old,
    // pre-authentication cache entry if that same token is presented again.
    return JSON.stringify([
      this.authenticationGenerations.get(state),
      state.active,
      state.oidcStatus,
      this.sessionAuthentication.getCacheIdentity(),
      this.oidcTokenExchange?.getCacheIdentity(getVerifiedRequestIdentity()?.accessToken),
    ]);
  }

  getStatus(): Pick<
    BackendConnectionStatus,
    'detectedDeployment' | 'discovery' | 'authentication'
  > {
    const accessToken = getVerifiedRequestIdentity()?.accessToken;
    const state = this.authState(accessToken);
    const session = this.sessionAuthentication.getStatus();
    const tokenExchange = this.oidcTokenExchange?.getStatus(accessToken);
    return {
      detectedDeployment: this.detectedDeployment,
      discovery: this.discoveryStatus,
      authentication: {
        ...state,
        session,
        ...(tokenExchange ? { tokenExchange } : {}),
        ...(state.active === 'oidc' && tokenExchange?.state === 'expired'
          ? {
              active: 'not-tested' as const,
              verified: false,
              message:
                'The exchanged OIDC backend token expired or has no reusable lifetime. The next operation will exchange the current frontend token again (proof of concept).',
            }
          : {}),
        ...(state.active === 'session-token' && ['expired', 'rejected'].includes(session.token)
          ? {
              active: 'not-tested' as const,
              verified: false,
              message:
                'The backend session token expired or was rejected. Fresh credential elicitation is required before the next operation.',
            }
          : {}),
      },
    };
  }

  private async send(
    url: URL,
    options: RestRequest = {},
    progress?: BackendProgressCallback,
    purpose: 'operation' | 'probe' | 'discovery' = 'operation'
  ): Promise<RestResponse> {
    const accessToken = getVerifiedRequestIdentity()?.accessToken;
    const state = this.authState(accessToken);
    const requestOptions = {
      method: options.method,
      headers: {
        ...(options.json ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.json ? JSON.stringify(options.json) : options.body,
    };
    let rejectedOidc = false;
    if (accessToken && state.oidcStatus !== 'rejected') {
      let oidcAuthentication: { authorization: string } | undefined;
      try {
        oidcAuthentication = this.oidcTokenExchange
          ? await this.oidcTokenExchange.getAuthentication(accessToken)
          : { authorization: `Bearer ${accessToken}` };
      } catch (error) {
        if (!(error instanceof OidcTokenExchangeError)) throw error;
        state.verified = false;
        state.lastHttpStatus = error.status;
        state.message = error.message;
        if (!error.fallbackAllowed) {
          if (error.status === 403) state.oidcStatus = 'forbidden';
          throw error;
        }
        // Opt-in exchange never falls back to forwarding the original MCP token.
        state.oidcStatus = 'rejected';
        state.fallbackReason = 'oidc-exchange-unavailable';
        rejectedOidc = true;
      }
      if (oidcAuthentication) {
        const response = await this.http.send(
          url,
          oidcAuthentication.authorization,
          requestOptions
        );
        // Discovery access is a separate permission; its denial does not reject OIDC for zo.
        if (purpose === 'discovery') return response;
        if (response.status !== 401) {
          if (purpose === 'operation') {
            state.active = 'oidc';
            state.lastHttpStatus = response.status;
            state.verified = response.status >= 200 && response.status < 300;
            if (state.verified) {
              this.credentials.forgetPassword({
                user: this.connection.user,
                host: this.endpoint.hostname,
                port: Number(this.endpoint.port || 443),
              });
              state.oidcStatus = 'accepted';
              state.message = this.oidcTokenExchange
                ? 'Using an exchanged backend access token (OAuth token exchange proof of concept). The configured user is the password fallback identity.'
                : 'Using the frontend OIDC token. APIML or the ESM determines the mapped z/OS identity; the configured user is the password fallback identity.';
            } else if (response.status === 403) {
              state.oidcStatus = 'forbidden';
              state.message =
                'The downstream service returned 403. Access was denied; password fallback was not attempted for an authorization denial.';
            }
          }
          return response;
        }
        // An explicit 401 rejects authentication before execution. Only this response
        // permits a retry with fallback credentials; network failures and 5xx never do.
        if (
          this.oidcTokenExchange &&
          !this.oidcTokenExchange.invalidate(accessToken, oidcAuthentication)
        )
          return response;
        state.oidcStatus = 'rejected';
        rejectedOidc = true;
        state.fallbackReason = 'oidc-rejected';
        state.lastHttpStatus = 401;
        state.verified = false;
        state.message =
          'The downstream service rejected OIDC authentication. Resolving existing credentials, including secure elicitation when needed.';
      }
    }
    if (purpose === 'discovery') {
      const cached = this.sessionAuthentication.getCachedAuthentication();
      return this.http.send(url, cached?.authorization, {
        ...requestOptions,
        headers: { ...requestOptions.headers, ...cached?.headers },
      });
    }
    if (purpose === 'probe' && !rejectedOidc) {
      const cached = this.sessionAuthentication.getCachedAuthentication();
      const response = await this.http.send(url, cached?.authorization, {
        ...requestOptions,
        headers: { ...requestOptions.headers, ...cached?.headers },
      });
      if (response.status !== 401) return response;
    }
    progress?.('Authenticating to REST service');
    let authentication = await this.sessionAuthentication.getAuthentication();
    let response = await this.http.send(url, authentication.authorization, {
      ...requestOptions,
      headers: { ...requestOptions.headers, ...authentication.headers },
    });
    if (response.status === 401 && authentication.mode === 'session-token') {
      this.sessionAuthentication.invalidate(authentication);
      progress?.('Session token expired or rejected; waiting for fresh credentials');
      authentication = await this.sessionAuthentication.getAuthentication();
      response = await this.http.send(url, authentication.authorization, {
        ...requestOptions,
        headers: { ...requestOptions.headers, ...authentication.headers },
      });
    }
    // A delayed failure must not replace status for credentials that already succeeded.
    if (response.status === 401 && !this.sessionAuthentication.invalidate(authentication))
      return response;
    state.active = authentication.mode;
    state.lastHttpStatus = response.status;
    state.passwordSource = authentication.source;
    state.verified = response.status >= 200 && response.status < 300 && purpose === 'operation';
    const fallbackDescription =
      state.fallbackReason === 'oidc-rejected'
        ? 'OIDC credentials were rejected downstream.'
        : state.fallbackReason === 'oidc-exchange-unavailable'
          ? 'The configured OIDC token exchange was rejected or is unsupported.'
          : 'No frontend OIDC token is available.';
    state.message = state.verified
      ? `${fallbackDescription} ${authentication.mode === 'session-token' ? 'Using an exchanged session token; elicited password references have been discarded.' : `Using ${state.passwordSource} credentials in memory because token exchange is unknown or unavailable.`}`
      : response.status === 401
        ? 'Backend credentials were rejected. Re-authenticate before retrying.'
        : 'Backend credentials selected; downstream authentication has not been verified by a successful operation.';
    return response;
  }

  private useGatewayLogin(): void {
    this.sessionAuthentication.setLogin(
      this.connection.sessionLogin ?? apimlSessionLogin(this.endpoint.origin)
    );
  }

  private async discover(
    progress?: BackendProgressCallback
  ): Promise<{ zo: string; zosmf: string }> {
    const { origin } = this.endpoint;
    const configuredPath = this.endpoint.pathname.replace(/\/$/, '');
    let zo = configuredPath
      ? `${origin}${configuredPath}`
      : `${origin}/${this.connection.serviceId}/api/v1`;
    let gateway = this.connection.deployment === 'apiml';
    if (gateway) this.useGatewayLogin();
    if (this.connection.deployment !== 'direct' && !configuredPath) {
      progress?.('Discovering zo through API Mediation Layer');
      const response = await this.send(
        new URL(
          `${origin}/gateway/api/v1/services/${encodeURIComponent(this.connection.serviceId)}`
        ),
        {},
        progress,
        'discovery'
      );
      if (response.status === 200) {
        this.discoveryStatus = 'available';
        const service = parseRestJson<{
          apiml?: {
            apiInfo?: {
              gatewayUrl?: string;
              basePath?: string;
              baseUrl?: string;
              defaultApi?: boolean;
            }[];
          };
        }>(response);
        const info =
          service.apiml?.apiInfo?.find(i => i.defaultApi) ?? service.apiml?.apiInfo?.[0];
        if (info?.basePath || info?.baseUrl || info?.gatewayUrl) {
          const discovered = new URL(
            info.basePath ?? info.baseUrl ?? `/${this.connection.serviceId}/${info.gatewayUrl!}`,
            origin
          );
          // Discovery metadata is data, not permission to forward credentials to a new origin.
          if (
            discovered.origin !== origin ||
            discovered.username ||
            discovered.password ||
            discovered.search ||
            discovered.hash
          ) {
            throw new Error(
              'APIML discovery returned a zo URL outside the configured gateway origin. Configure the correct gateway URL explicitly.'
            );
          }
          zo = discovered.href.replace(/\/$/, '');
          gateway = true;
          this.useGatewayLogin();
        }
      } else {
        this.discoveryStatus = 'unavailable';
        if (
          [401, 403].includes(response.status) &&
          /"messageNumber"\s*:\s*"ZWE[A-Z0-9]+"/.test(response.body.toString('utf8'))
        ) {
          gateway = true;
          this.useGatewayLogin();
        }
        if (![401, 403, 404].includes(response.status)) requireRestSuccess(response);
      }
      // Discovery permissions are independent of access to the routed service.
    }
    progress?.('Verifying zo-rest service');
    const probe = await this.send(new URL(`${zo}/system/info`), {}, progress, 'probe');
    if (probe.status === 404)
      throw new Error(
        'The configured endpoint is not zo-rest. A zo-rest service with /system/info is required; plain z/OSMF is not supported by this backend.'
      );
    requireRestSuccess(probe);
    const info = parseRestJson<{
      version?: string;
      authentication?: { sessionLogin?: SessionLoginConfig };
    }>(probe);
    if (typeof info?.version !== 'string')
      throw new Error(
        'The configured endpoint did not return zo version information. A zo-rest service is required.'
      );
    if (!this.connection.sessionLogin && !gateway && info.authentication?.sessionLogin) {
      const advertised = info.authentication.sessionLogin;
      const loginUrl = new URL(advertised.url, zo + '/');
      if (loginUrl.origin !== origin)
        throw new Error(
          'Service-advertised session login must remain on the configured origin. Set sessionLogin explicitly to trust another login endpoint.'
        );
      this.sessionAuthentication.setLogin({
        ...advertised,
        url: loginUrl.href,
        method: advertised.method ?? 'json',
      });
    }
    if (this.connection.deployment === 'auto' && !gateway) {
      const compatibility = await this.send(new URL(`${zo}/zosmf/info`), {}, progress, 'probe');
      if (compatibility.status === 200) {
        parseRestJson<unknown>(compatibility);
        gateway = true;
        this.useGatewayLogin();
      } else if (compatibility.status !== 404) requireRestSuccess(compatibility);
    }
    this.detectedDeployment = gateway ? 'apiml' : 'direct';
    return { zo, zosmf: gateway ? `${zo}/zosmf` : `${origin}/zosmf` };
  }

  async request(
    surface: 'zo' | 'zosmf',
    path: string,
    options: RestRequest = {},
    progress?: BackendProgressCallback
  ): Promise<RestResponse> {
    this.bases ??= this.discover(progress).catch(error => {
      this.bases = undefined;
      throw error;
    });
    const bases = await this.bases;
    const url = new URL(`${bases[surface]}/${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const response = await this.send(url, options, progress);
    requireRestSuccess(response);
    const warning = response.headers['x-zo-truncation-warning'];
    if (warning)
      getLogger()
        .child('zo-rest')
        .warning('zo-rest truncated records exceeding LRECL', { warning: String(warning) });
    return response;
  }

  async json<T>(
    surface: 'zo' | 'zosmf',
    path: string,
    options?: RestRequest,
    progress?: BackendProgressCallback
  ): Promise<T> {
    return parseRestJson<T>(await this.request(surface, path, options, progress));
  }
}
