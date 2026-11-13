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
 * Loader for the Zowe Remote SSH (native SSH) backend.
 *
 * Builds SystemRegistry, NativeCredentialProvider, and NativeBackend from
 * a list of user@host connection specs.
 */

import { ZSshClient } from '@zowe/zowex-for-zowe-sdk';
import type { CeedumpCollectedEventData } from '../../events.js';
import type { ZosBackend } from '../backend.js';
import type { CredentialProvider } from '../credentials.js';
import { SystemRegistry } from '../system.js';
import type { ParsedConnectionSpec } from './connection-spec.js';
import { parseConnectionSpecs } from './connection-spec.js';
import { isLocalConnectionSpec, isValidSafUserid, LOCAL_SYSTEM_ID } from './local-system.js';
import { NativeBackend } from './native-backend.js';
import type { NativeCredentialProviderOptions } from './native-credential-provider.js';
import { NativeCredentialProvider } from './native-credential-provider.js';
import {
  DEFAULT_ZOWEX_RESPONSE_TIMEOUT_SEC,
  SshClientCache,
  type ZowexClientOptions,
} from './ssh-client-cache.js';

export interface LoadNativeOptions {
  /** Connection specs: "user@host" or "user@host:port". May be empty when extension will send connections via connections-update. */
  systems: string[];
  /**
   * true = standalone: passwords from env vars.
   * false = VS Code: passwords from passwordStore + requestPasswordCallback.
   */
  useEnvForPassword: boolean;
  /** VS Code only: store that receives passwords from extension events. */
  passwordStore?: NativeCredentialProviderOptions['passwordStore'];
  /** VS Code only: callback when password is needed (sends request-password event). */
  requestPasswordCallback?: NativeCredentialProviderOptions['requestPasswordCallback'];
  /** When set, try MCP elicitation first (if client supports it) before requestPasswordCallback. */
  requestPasswordViaElicitation?: NativeCredentialProviderOptions['requestPasswordViaElicitation'];
  /** When set, called when an elicited password is used so the extension can persist it. */
  onElicitedPasswordUsed?: NativeCredentialProviderOptions['onElicitedPasswordUsed'];
  /** When true, never attempt SSH key authentication (standalone: ZOWE_MCP_DISABLE_SSH_KEY; VS Code: zoweMCP.preferSshKey off). */
  disableSshKey?: boolean;
  /** VS Code only: callback when auth fails (sends password-invalid event). */
  onPasswordInvalid?: (user: string, host: string, port?: number) => void;
  /** When true (default), deploy the z/OS server via ZSshUtils.installServer when "Server not found" is detected. */
  autoInstallZowex?: boolean;
  /** Remote path where the zowex z/OS server is installed/run (default: ~/.zowe-server). */
  zowexServerPath?: string;
  /** Response timeout in seconds for zowex-sdk requests (standalone only; default 60). When getZowexClientOptions is set, use that instead. */
  responseTimeout?: number;
  /** When set, zowex client options are read at connection time (allows runtime updates from extension). */
  getZowexClientOptions?: () => ZowexClientOptions;
  /** VS Code mode: call when a CEEDUMP file was saved after an abend (sends ceedump-collected event). */
  onCeedumpCollected?: (data: CeedumpCollectedEventData) => void;
  /**
   * The userid a `local` systems entry runs zowex as (see local-system.ts and
   * docs/zos-local-zowex-identity.md). HTTP+JWT per-tenant setups: the
   * authenticated JWT `sub` (canonical uppercase SAF userid). Stdio on z/OS
   * (with `localSameUser`): the invoking process's own userid. When unset,
   * `local` entries are filtered out and not registered — falling back to a
   * shared identity is never done.
   */
  localUserid?: string;
  /**
   * With `localUserid`: stdio same-user execution (deployment shape 2) — the
   * userid is the invoking process's own, and the transport spawns zowex
   * directly with no launcher and no identity switch.
   */
  localSameUser?: boolean;
}

export interface NativeSetup {
  backend: ZosBackend;
  credentialProvider: CredentialProvider;
  systemRegistry: SystemRegistry;
  /**
   * Replace the active connection spec list and refresh the system registry.
   * Used for connections-update (VS Code), tenant file merges, and addZosConnection.
   */
  updateSystems: (systems: string[]) => void;
  /**
   * Connection spec string for job card lookup (`user@host` or `user@host:port` when port ≠ 22).
   * Falls back to `userId@systemId` when no matching spec exists.
   */
  resolveJobCardConnectionSpec: (systemId: string, userId: string) => string;
}

/**
 * Load the native backend and its dependencies.
 *
 * @param options - Systems list and credential mode (env vs VS Code).
 * @returns Backend, credential provider, and system registry for createServer().
 */
export function loadNative(options: LoadNativeOptions): NativeSetup {
  if (options.localUserid !== undefined && !isValidSafUserid(options.localUserid)) {
    // Contract error, not user input: callers must validate the sub before
    // passing it (index.ts logs and omits it instead) — never fold or repair
    // an identity here.
    throw new Error(
      `localUserid "${options.localUserid}" is not a canonical SAF userid (1-8 chars, A-Z 0-9 # $ @)`
    );
  }
  /**
   * The `local` entry (same-system zowex execution) is not a user@host spec:
   * it is registered separately, and only when this setup carries an
   * authenticated userid to run as.
   */
  const localRequested = options.systems.some(isLocalConnectionSpec);
  const localUserid = localRequested ? options.localUserid : undefined;
  const localSpec: ParsedConnectionSpec | undefined = localUserid
    ? {
        user: localUserid,
        host: LOCAL_SYSTEM_ID,
        port: 22,
        local: true,
        ...(options.localSameUser ? { sameUser: true as const } : {}),
      }
    : undefined;
  const specs = parseConnectionSpecs(options.systems.filter(s => !isLocalConnectionSpec(s)));

  const systemRegistry = new SystemRegistry();
  const credentialProvider = new NativeCredentialProvider({
    connectionSpecs: specs,
    useEnvForPassword: options.useEnvForPassword,
    passwordStore: options.passwordStore,
    requestPasswordCallback: options.requestPasswordCallback,
    requestPasswordViaElicitation: options.requestPasswordViaElicitation,
    onElicitedPasswordUsed: options.onElicitedPasswordUsed,
    disableSshKey: options.disableSshKey,
  });

  const clientCache = new SshClientCache(
    options.getZowexClientOptions
      ? {
          getOptions: (): ZowexClientOptions => {
            const o = options.getZowexClientOptions!();
            return {
              autoInstallZowex: o.autoInstallZowex,
              serverPath: o.serverPath,
              responseTimeout: o.responseTimeout ?? DEFAULT_ZOWEX_RESPONSE_TIMEOUT_SEC,
            };
          },
        }
      : {
          autoInstallZowex: options.autoInstallZowex ?? true,
          serverPath: options.zowexServerPath ?? ZSshClient.DEFAULT_SERVER_PATH,
          responseTimeout: options.responseTimeout ?? DEFAULT_ZOWEX_RESPONSE_TIMEOUT_SEC,
        }
  );

  /** Mutable ref so getSpec and updateSystems see the same list (used for connections-update from VS Code). */
  const specsRef = { current: specs };

  function formatConnectionSpec(spec: ParsedConnectionSpec): string {
    return spec.port === 22
      ? `${spec.user}@${spec.host}`
      : `${spec.user}@${spec.host}:${spec.port}`;
  }

  function getSpec(systemId: string, userId?: string): ParsedConnectionSpec | undefined {
    if (systemId === LOCAL_SYSTEM_ID) {
      // The local system has exactly one identity — the authenticated user.
      // A userId naming anyone else gets nothing, never a different spec.
      if (localSpec && userId && userId.toUpperCase() !== localSpec.user) {
        return undefined;
      }
      return localSpec;
    }
    const forHost = specsRef.current.filter(s => s.host === systemId);
    if (forHost.length === 0) return undefined;
    if (userId) {
      const match = forHost.find(s => s.user.toUpperCase() === userId.toUpperCase());
      return match;
    }
    return forHost[0];
  }

  /**
   * Credential provider handed to the tool layer. The tool layer resolves a
   * (system, user) context through getCredentials before any operation, so the
   * `local` system must answer — but its identity is the JWT sub and its
   * transport (the SURROGAT launcher) never takes a credential, so the answer
   * is an identity-only stub carrying no secret. The NativeBackend keeps the
   * unwrapped provider and never consults it for local specs; SSH systems pass
   * through unchanged.
   */
  const toolCredentialProvider: CredentialProvider = localSpec
    ? {
        getCredentials: (systemId, userId, options) => {
          if (systemId === LOCAL_SYSTEM_ID) {
            if (userId && userId.toUpperCase() !== localSpec.user) {
              return Promise.reject(
                new Error(
                  `The "local" system runs only as the authenticated user ${localSpec.user}.`
                )
              );
            }
            return Promise.resolve({ user: localSpec.user, authMethod: 'password' as const });
          }
          return credentialProvider.getCredentials(systemId, userId, options);
        },
        listUsers: systemId =>
          systemId === LOCAL_SYSTEM_ID
            ? Promise.resolve([localSpec.user])
            : credentialProvider.listUsers(systemId),
      }
    : credentialProvider;

  const backend = new NativeBackend({
    credentialProvider,
    clientCache,
    getSpec,
    onPasswordInvalid: options.onPasswordInvalid,
    getResponseTimeout:
      options.getZowexClientOptions != null
        ? () =>
            options.getZowexClientOptions!().responseTimeout ?? DEFAULT_ZOWEX_RESPONSE_TIMEOUT_SEC
        : () => options.responseTimeout ?? DEFAULT_ZOWEX_RESPONSE_TIMEOUT_SEC,
    onCeedumpCollected: options.onCeedumpCollected,
  });

  function registerSystemsFromSpecs(specList: ParsedConnectionSpec[]): void {
    systemRegistry.clear();
    const byHost = new Map<string, ParsedConnectionSpec[]>();
    for (const spec of specList) {
      const list = byHost.get(spec.host) ?? [];
      list.push(spec);
      byHost.set(spec.host, list);
    }
    for (const [host, hostSpecs] of byHost) {
      const first = hostSpecs[0];
      const connectionSpecs = hostSpecs.map(s => formatConnectionSpec(s));
      systemRegistry.register({
        host,
        port: first.port,
        description: `SSH (${host})`,
        connectionSpecs,
      });
    }
    if (localSpec) {
      systemRegistry.register({
        host: LOCAL_SYSTEM_ID,
        port: 0,
        description: `This z/OS system (local zowex as ${localSpec.user})`,
        connectionSpecs: [formatConnectionSpec(localSpec)],
      });
    }
  }

  registerSystemsFromSpecs(specs);

  function updateSystems(systems: string[]): void {
    if (systems.length === 0) {
      return;
    }
    // `local` stays as configured at setup creation: whether it is active is
    // bound to this setup's authenticated userid, not to the merged list.
    const newSpecs = parseConnectionSpecs(systems.filter(s => !isLocalConnectionSpec(s)));
    specsRef.current = newSpecs;
    credentialProvider.updateSpecs(newSpecs);
    registerSystemsFromSpecs(newSpecs);
  }

  function resolveJobCardConnectionSpec(systemId: string, userId: string): string {
    const spec = getSpec(systemId, userId);
    if (spec) {
      return formatConnectionSpec(spec);
    }
    return `${userId}@${systemId}`;
  }

  return {
    backend,
    credentialProvider: toolCredentialProvider,
    systemRegistry,
    updateSystems,
    resolveJobCardConnectionSpec,
  };
}
