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

import { ZSshClient } from 'zowex-sdk';
import type { CeedumpCollectedEventData } from '../../events.js';
import type { ZosBackend } from '../backend.js';
import type { CredentialProvider } from '../credentials.js';
import { SystemRegistry } from '../system.js';
import type { ParsedConnectionSpec } from './connection-spec.js';
import { parseConnectionSpecs } from './connection-spec.js';
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
  const specs = parseConnectionSpecs(options.systems);

  const systemRegistry = new SystemRegistry();
  const credentialProvider = new NativeCredentialProvider({
    connectionSpecs: specs,
    useEnvForPassword: options.useEnvForPassword,
    passwordStore: options.passwordStore,
    requestPasswordCallback: options.requestPasswordCallback,
    requestPasswordViaElicitation: options.requestPasswordViaElicitation,
    onElicitedPasswordUsed: options.onElicitedPasswordUsed,
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
    const forHost = specsRef.current.filter(s => s.host === systemId);
    if (forHost.length === 0) return undefined;
    if (userId) {
      const match = forHost.find(s => s.user.toUpperCase() === userId.toUpperCase());
      return match;
    }
    return forHost[0];
  }

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
  }

  registerSystemsFromSpecs(specs);

  function updateSystems(systems: string[]): void {
    if (systems.length === 0) {
      return;
    }
    const newSpecs = parseConnectionSpecs(systems);
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
    credentialProvider,
    systemRegistry,
    updateSystems,
    resolveJobCardConnectionSpec,
  };
}
