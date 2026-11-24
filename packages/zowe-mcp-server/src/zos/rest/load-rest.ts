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

import { getLogger } from '../../server.js';
import type { NativeSetup } from '../native/load-native.js';
import {
  NativeCredentialProvider,
  type NativeCredentialProviderOptions,
  type RequestPasswordViaElicitation,
} from '../native/native-credential-provider.js';
import { SystemRegistry } from '../system.js';
import { ZoRestApi } from './api.js';
import { parseRestConnections } from './connection.js';
import { ZoRestBackend } from './zo-rest-backend.js';

export interface LoadRestOptions extends Omit<
  NativeCredentialProviderOptions,
  'connectionSpecs' | 'disableSshKey'
> {
  systems: unknown;
  onPasswordInvalid?: (user: string, host: string, port?: number) => void;
}

export type RestSetup = Omit<NativeSetup, 'updateSystems'>;

/** HTTP callers elicit through their own MCP session; an editor pipe belongs to its local user. */
export function loadRestForHttpTenant(options: {
  systems: unknown;
  requestPasswordViaElicitation: RequestPasswordViaElicitation;
}): RestSetup {
  return loadRest({
    systems: options.systems,
    useEnvForPassword: true,
    requestPasswordViaElicitation: options.requestPasswordViaElicitation,
  });
}

export function loadRest(options: LoadRestOptions): RestSetup {
  const systems = parseRestConnections(options.systems);
  const connectionSpecs = systems.map(connection => {
    const url = new URL(connection.url);
    return { user: connection.user, host: url.hostname, port: Number(url.port || 443) };
  });
  const credentialProvider = new NativeCredentialProvider({
    ...options,
    connectionSpecs,
    disableSshKey: true,
    // REST elicitation is memory-only. A session exchange will discard it entirely.
    onElicitedPasswordUsed: undefined,
    transientPasswords: true,
  });
  const systemRegistry = new SystemRegistry();
  const apis = new Map<string, ZoRestApi>();
  for (const [i, connection] of systems.entries()) {
    const spec = connectionSpecs[i];
    systemRegistry.register({
      host: spec.host,
      port: spec.port,
      basePath: new URL(connection.url).pathname,
      description: `zo REST (${connection.deployment})`,
      connectionSpecs: [`${spec.user}@${spec.host}:${spec.port}`],
    });
    apis.set(spec.host, new ZoRestApi(connection, credentialProvider));
    if (!connection.rejectUnauthorized)
      getLogger().warning('TLS certificate verification disabled for zo-rest test connection', {
        host: spec.host,
        port: spec.port,
      });
  }
  return {
    backend: new ZoRestBackend(apis),
    credentialProvider: {
      getCredentials: (systemId, userId, opts) =>
        credentialProvider.getCredentials(systemId, userId, opts),
      listUsers: systemId => credentialProvider.listUsers(systemId),
      getIdentity: (systemId, userId) => {
        const spec = connectionSpecs.find(
          item => item.host === systemId && (!userId || item.user === userId.toUpperCase())
        );
        return spec
          ? Promise.resolve({ user: spec.user })
          : Promise.reject(new Error(`No zo-rest identity configured for ${systemId}.`));
      },
    },
    systemRegistry,
    resolveJobCardConnectionSpec: (systemId, userId) => {
      const spec = connectionSpecs.find(
        item => item.host === systemId && item.user === userId.toUpperCase()
      );
      return spec ? `${spec.user}@${spec.host}:${spec.port}` : `${userId}@${systemId}`;
    },
  };
}
