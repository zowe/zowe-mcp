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

import type { ZosBackend } from '../backend.js';
import type { CredentialProvider } from '../credentials.js';
import { SystemRegistry } from '../system.js';
import type { ParsedConnectionSpec } from './connection-spec.js';
import { parseConnectionSpecs } from './connection-spec.js';
import { NativeBackend } from './native-backend.js';
import type { NativeCredentialProviderOptions } from './native-credential-provider.js';
import { NativeCredentialProvider } from './native-credential-provider.js';
import { SshClientCache } from './ssh-client-cache.js';

export interface LoadNativeOptions {
  /** Connection specs: "user@host" or "user@host:port". */
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
  /** VS Code only: callback when auth fails (sends password-invalid event). */
  onPasswordInvalid?: (user: string, host: string, port?: number) => void;
}

export interface NativeSetup {
  backend: ZosBackend;
  credentialProvider: CredentialProvider;
  systemRegistry: SystemRegistry;
}

/**
 * Load the native backend and its dependencies.
 *
 * @param options - Systems list and credential mode (env vs VS Code).
 * @returns Backend, credential provider, and system registry for createServer().
 */
export function loadNative(options: LoadNativeOptions): NativeSetup {
  const specs = parseConnectionSpecs(options.systems);
  if (specs.length === 0) {
    throw new Error('At least one system (user@host) is required for native mode');
  }

  const systemRegistry = new SystemRegistry();
  const seenHosts = new Set<string>();
  for (const spec of specs) {
    if (!seenHosts.has(spec.host)) {
      seenHosts.add(spec.host);
      systemRegistry.register({
        host: spec.host,
        port: spec.port,
        description: `SSH (${spec.host})`,
      });
    }
  }

  const credentialProvider = new NativeCredentialProvider({
    connectionSpecs: specs,
    useEnvForPassword: options.useEnvForPassword,
    passwordStore: options.passwordStore,
    requestPasswordCallback: options.requestPasswordCallback,
  });

  const clientCache = new SshClientCache();

  function getSpec(systemId: string, userId?: string): ParsedConnectionSpec | undefined {
    const forHost = specs.filter(s => s.host === systemId);
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
  });

  return { backend, credentialProvider, systemRegistry };
}
