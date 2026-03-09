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
 * Loader for the mock data directory.
 *
 * Reads `systems.json`, creates the {@link FilesystemMockBackend},
 * {@link MockCredentialProvider}, and populates a {@link SystemRegistry}.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ZosBackend } from '../backend.js';
import type { CredentialProvider } from '../credentials.js';
import { SystemRegistry } from '../system.js';
import { FilesystemMockBackend } from './filesystem-mock-backend.js';
import { MockCredentialProvider } from './mock-credential-provider.js';
import type { MockSystemsConfig } from './mock-types.js';

/** Everything needed to run in mock mode. */
export interface MockSetup {
  backend: ZosBackend;
  credentialProvider: CredentialProvider;
  systemRegistry: SystemRegistry;
}

/**
 * Load mock configuration from a directory containing `systems.json`
 * and per-system dataset directories.
 *
 * @param mockDir - Path to the mock data directory.
 * @returns The backend, credential provider, and system registry.
 */
export async function loadMock(mockDir: string): Promise<MockSetup> {
  const systemsPath = path.join(mockDir, 'systems.json');
  const raw = await fs.readFile(systemsPath, 'utf-8');
  const config = JSON.parse(raw) as MockSystemsConfig;

  const backend = new FilesystemMockBackend(mockDir);
  const credentialProvider = new MockCredentialProvider(config);
  const systemRegistry = new SystemRegistry();

  for (const sys of config.systems) {
    systemRegistry.register({
      host: sys.host,
      port: sys.port,
      description: sys.description,
    });
  }

  return { backend, credentialProvider, systemRegistry };
}
