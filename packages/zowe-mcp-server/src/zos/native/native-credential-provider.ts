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
 * Credential provider for the Zowe Native (SSH) backend.
 *
 * Standalone mode: reads passwords from env vars ZOWE_MCP_PASSWORD_<USER>_<HOST>.
 * Invalid credentials are blacklisted for the process lifetime.
 *
 * VS Code mode: credentials are supplied via pipe events (see load-native and event handlers).
 */

import { getLogger } from '../../server.js';
import type { CredentialProvider, Credentials, GetCredentialsOptions } from '../credentials.js';
import type { SystemId } from '../system.js';
import type { ParsedConnectionSpec } from './connection-spec.js';
import { toPasswordEnvVarName } from './connection-spec.js';
import { passwordHash } from './password-hash.js';
import { cacheKey } from './ssh-client-cache.js';

const log = getLogger().child('native.credentials');

/** Callback to request a password from the VS Code extension (sends request-password event). */
export type RequestPasswordCallback = (user: string, host: string, port?: number) => void;

/** Async callback to request a password via MCP elicitation (when client supports it). Returns the password or undefined to fall back to pipe. */
export type RequestPasswordViaElicitation = (
  user: string,
  host: string,
  port?: number
) => Promise<string | undefined>;

/** Callback when an elicited password is successfully used, so the extension can persist it (e.g. store in SecretStorage). */
export type OnElicitedPasswordUsed = (
  user: string,
  host: string,
  port: number | undefined,
  password: string
) => void;

/** In-memory store of password received from extension (VS Code mode). Key: cacheKey(spec). */
export type PasswordStore = Map<string, string>;

/** Optional waitFor for stores that support waiting for the extension to send a password. */
export interface WaitablePasswordStoreLike {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete?(key: string): void;
  waitFor(key: string, timeoutMs: number): Promise<string | undefined>;
}

export interface NativeCredentialProviderOptions {
  /** Parsed connection specs (user@host:port). Used to resolve users per system and to read env. */
  connectionSpecs: ParsedConnectionSpec[];
  /**
   * Standalone: read password from process.env.
   * VS Code: false; passwords come from passwordStore + requestPasswordCallback.
   */
  useEnvForPassword: boolean;
  /** VS Code mode: store filled when extension sends password event. If it has waitFor(), getCredentials will wait for the password instead of throwing. */
  passwordStore?: PasswordStore | WaitablePasswordStoreLike;
  /** VS Code mode: call when password is missing so server can send request-password event. */
  requestPasswordCallback?: RequestPasswordCallback;
  /** When set, try MCP elicitation first (if client supports it) before falling back to requestPasswordCallback. */
  requestPasswordViaElicitation?: RequestPasswordViaElicitation;
  /** When set, called after returning credentials that came from elicitation, so the extension can persist the password. */
  onElicitedPasswordUsed?: OnElicitedPasswordUsed;
}

/**
 * Credential provider for the native backend.
 * getCredentials(systemId, userId?) returns credentials for that system (and optional user).
 * listUsers(systemId) returns users that have a connection spec for that host.
 */
export class NativeCredentialProvider implements CredentialProvider {
  private readonly specsByHost = new Map<string, ParsedConnectionSpec[]>();
  private readonly invalidKeys = new Set<string>();
  /** In-flight password requests by key so concurrent getCredentials() for the same connection wait for the first request. */
  private readonly _passwordRequestByKey = new Map<string, Promise<string>>();

  constructor(private readonly options: NativeCredentialProviderOptions) {
    this._applySpecs(options.connectionSpecs);
  }

  /** Replace connection specs (e.g. when VS Code sends connections-update). Preserves useEnvForPassword, passwordStore, and callbacks. */
  updateSpecs(specs: ParsedConnectionSpec[]): void {
    this._applySpecs(specs);
  }

  private _applySpecs(specs: ParsedConnectionSpec[]): void {
    this.specsByHost.clear();
    for (const spec of specs) {
      const list = this.specsByHost.get(spec.host) ?? [];
      list.push(spec);
      this.specsByHost.set(spec.host, list);
    }
  }

  /** Mark a credential as invalid so it is not used again (standalone: env; VS Code: that key). */
  markInvalid(spec: ParsedConnectionSpec): void {
    const key = cacheKey(spec);
    this.invalidKeys.add(key);
    log.info('Credentials marked invalid (auth failed); disabled for this session', {
      key,
      host: spec.host,
      port: spec.port,
      user: spec.user,
    });
    const store = this.options.passwordStore;
    if (store && 'delete' in store && typeof store.delete === 'function') {
      store.delete(key);
    }
  }

  /**
   * Runs a single password request. When the pipe is available (VS Code connected), use it only.
   * When the pipe is not available, use MCP elicitation if the client supports it. Used so
   * concurrent getCredentials() for the same key await the same promise instead of each triggering a separate prompt.
   */
  private async _requestPasswordOnce(
    key: string,
    spec: ParsedConnectionSpec,
    progress?: (message: string) => void
  ): Promise<string> {
    const store = this.options.passwordStore;
    const waitable = store && 'waitFor' in store && typeof store.waitFor === 'function';

    // Pipe only when VS Code extension is connected (no fallback to elicitation on timeout/cancel)
    if (store && this.options.requestPasswordCallback) {
      progress?.('Waiting for password');
      log.debug('Requesting password from extension (pipe)', {
        key,
        host: spec.host,
        port: spec.port,
        user: spec.user,
        waitable: !!waitable,
      });
      this.options.requestPasswordCallback(spec.user, spec.host, spec.port);
      if (waitable) {
        const PASSWORD_WAIT_MS = 120_000;
        const password = await store.waitFor(key, PASSWORD_WAIT_MS);
        if (password !== undefined) {
          log.debug('Credentials obtained from extension (after wait)', {
            key,
            host: spec.host,
            port: spec.port,
            user: spec.user,
            passwordHash: passwordHash(password),
          });
          return password;
        }
        log.info('Password not received from extension in time', {
          key,
          host: spec.host,
          port: spec.port,
          user: spec.user,
          timeoutMs: PASSWORD_WAIT_MS,
        });
        throw new Error(
          `Password for ${spec.user}@${spec.host} was not received in time. Please enter it when the extension prompts.`
        );
      }
      throw new Error(
        `Password required for ${spec.user}@${spec.host}. The VS Code extension should prompt and send it.`
      );
    }

    // When pipe is not available (no VS Code): MCP elicitation when the client supports it
    if (this.options.requestPasswordViaElicitation) {
      progress?.('Waiting for password');
      try {
        const password = await this.options.requestPasswordViaElicitation(
          spec.user,
          spec.host,
          spec.port
        );
        if (password !== undefined && password !== '') {
          this.options.onElicitedPasswordUsed?.(spec.user, spec.host, spec.port, password);
          log.debug('Credentials obtained via elicitation', {
            key,
            host: spec.host,
            port: spec.port,
            user: spec.user,
            passwordHash: passwordHash(password),
          });
          return password;
        }
      } catch (err) {
        log.debug('Elicitation failed', {
          key,
          host: spec.host,
          user: spec.user,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    throw new Error(
      `Password for ${spec.user}@${spec.host} was not received in time. Please enter it when the extension prompts.`
    );
  }

  async getCredentials(
    systemId: SystemId,
    userId?: string,
    options?: GetCredentialsOptions
  ): Promise<Credentials> {
    await Promise.resolve();
    const specs = this.specsByHost.get(systemId);
    if (!specs || specs.length === 0) {
      throw new Error(`No connection spec for system "${systemId}"`);
    }

    const spec = userId
      ? specs.find(s => s.user.toUpperCase() === userId.toUpperCase())
      : specs[0];
    if (!spec) {
      throw new Error(
        `No connection spec for user "${userId}" on system "${systemId}". Known users: ${specs.map(s => s.user).join(', ')}`
      );
    }

    const key = cacheKey(spec);
    // Only block invalid credentials in standalone mode. When connected to the VS Code extension,
    // the extension can re-prompt and the password was already removed from the store in markInvalid().
    if (this.options.useEnvForPassword && this.invalidKeys.has(key)) {
      throw new Error(
        `Credentials for ${spec.user}@${spec.host} were invalid and have been disabled for this session.`
      );
    }

    let password: string | undefined;

    if (this.options.useEnvForPassword) {
      const envVar = toPasswordEnvVarName(spec.user, spec.host);
      password = process.env[envVar];
      if (password === undefined || password === '') {
        log.info('Missing password from environment', {
          key,
          host: spec.host,
          port: spec.port,
          user: spec.user,
          envVar,
        });
        throw new Error(
          `Missing password for ${spec.user}@${spec.host}. Set environment variable ${envVar}.`
        );
      }
      log.debug('Credentials obtained from environment', {
        key,
        host: spec.host,
        port: spec.port,
        user: spec.user,
        passwordHash: passwordHash(password),
      });
    } else {
      const store = this.options.passwordStore;
      password = store?.get(key);
      if (
        password === undefined &&
        (this.options.requestPasswordViaElicitation || this.options.requestPasswordCallback)
      ) {
        const inFlight = this._passwordRequestByKey.get(key);
        if (inFlight !== undefined) {
          options?.progress?.('Waiting for password');
          log.debug('Waiting for in-flight password request', {
            key,
            host: spec.host,
            user: spec.user,
          });
          password = await inFlight;
        } else {
          const requestPromise = this._requestPasswordOnce(key, spec, options?.progress);
          this._passwordRequestByKey.set(key, requestPromise);
          try {
            password = await requestPromise;
            if (store && password !== undefined) {
              store.set(key, password);
            }
          } finally {
            this._passwordRequestByKey.delete(key);
          }
        }
      }
      if (password === undefined) {
        log.info('Password required but no store or callback', {
          key,
          host: spec.host,
          port: spec.port,
          user: spec.user,
        });
        throw new Error(
          `Password required for ${spec.user}@${spec.host}. The VS Code extension should prompt and send it.`
        );
      }
      if (password !== undefined) {
        log.debug('Credentials obtained from store (cached)', {
          key,
          host: spec.host,
          port: spec.port,
          user: spec.user,
          passwordHash: passwordHash(password),
        });
      }
    }

    return { user: spec.user, password: password };
  }

  async listUsers(systemId: SystemId): Promise<string[]> {
    await Promise.resolve();
    const specs = this.specsByHost.get(systemId) ?? [];
    return [...new Set(specs.map(s => s.user))];
  }
}
