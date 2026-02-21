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
 * Loader for the Zowe Native (SSH) backend.
 *
 * Builds SystemRegistry, NativeCredentialProvider, and NativeBackend from
 * a list of user@host connection specs.
 */

import { ZSshClient } from 'zowe-native-proto-sdk';
import type { ZosBackend } from '../backend.js';
import type { CredentialProvider } from '../credentials.js';
import { SystemRegistry } from '../system.js';
import type { ParsedConnectionSpec } from './connection-spec.js';
import { parseConnectionSpecs } from './connection-spec.js';
import { NativeBackend } from './native-backend.js';
import type { NativeCredentialProviderOptions } from './native-credential-provider.js';
import { NativeCredentialProvider } from './native-credential-provider.js';
import {
  DEFAULT_NATIVE_RESPONSE_TIMEOUT_SEC,
  SshClientCache,
  type NativeOptions,
} from './ssh-client-cache.js';

export interface LoadNativeOptions {
  /** Connection specs: "user@host" or "user@host:port". May be empty when extension will send systems via systems-update. */
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
  /** When true (default), deploy ZNP via ZSshUtils.installServer when "Server not found" is detected. */
  autoInstallZnp?: boolean;
  /** Remote path where the ZNP server is installed/run (default: ~/.zowe-server). */
  nativeServerPath?: string;
  /** Response timeout in seconds for ZNP requests (standalone only; default 60). When getNativeOptions is set, use that instead. */
  responseTimeout?: number;
  /** When set, native options are read at connection time (allows runtime updates from extension). */
  getNativeOptions?: () => NativeOptions;
}

export interface NativeSetup {
  backend: ZosBackend;
  credentialProvider: CredentialProvider;
  systemRegistry: SystemRegistry;
  /** When set (VS Code mode), updates systems from a new list (e.g. systems-update event). */
  updateSystems?: (systems: string[]) => void;
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
    options.getNativeOptions
      ? {
          getOptions: (): NativeOptions => {
            const o = options.getNativeOptions!();
            return {
              autoInstallZnp: o.autoInstallZnp,
              serverPath: o.serverPath,
              responseTimeout: o.responseTimeout ?? DEFAULT_NATIVE_RESPONSE_TIMEOUT_SEC,
            };
          },
        }
      : {
          autoInstallZnp: options.autoInstallZnp ?? true,
          serverPath: options.nativeServerPath ?? ZSshClient.DEFAULT_SERVER_PATH,
          responseTimeout: options.responseTimeout ?? DEFAULT_NATIVE_RESPONSE_TIMEOUT_SEC,
        }
  );

  /** Mutable ref so getSpec and updateSystems see the same list (used for systems-update from VS Code). */
  const specsRef = { current: specs };

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
      options.getNativeOptions != null
        ? () => options.getNativeOptions!().responseTimeout ?? DEFAULT_NATIVE_RESPONSE_TIMEOUT_SEC
        : () => options.responseTimeout ?? DEFAULT_NATIVE_RESPONSE_TIMEOUT_SEC,
  });

  function registerSystemsFromSpecs(specList: ParsedConnectionSpec[]): void {
    systemRegistry.clear();
    const seenHosts = new Set<string>();
    for (const spec of specList) {
      if (!seenHosts.has(spec.host)) {
        seenHosts.add(spec.host);
        systemRegistry.register({
          host: spec.host,
          port: spec.port,
          description: `SSH (${spec.host})`,
        });
      }
    }
  }

  registerSystemsFromSpecs(specs);

  const updateSystems =
    options.passwordStore != null && options.requestPasswordCallback != null
      ? (systems: string[]) => {
          if (systems.length === 0) return;
          const newSpecs = parseConnectionSpecs(systems);
          specsRef.current = newSpecs;
          credentialProvider.updateSpecs(newSpecs);
          registerSystemsFromSpecs(newSpecs);
        }
      : undefined;

  return { backend, credentialProvider, systemRegistry, updateSystems };
}
