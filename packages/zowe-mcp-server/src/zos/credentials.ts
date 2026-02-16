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
 * Credential provider abstraction.
 *
 * Each z/OS system can have multiple user identities. The
 * {@link CredentialProvider} interface hides authentication details
 * from the tool layer — agents never see credentials.
 */

import type { SystemId } from './system.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Credentials for authenticating to a z/OS system. */
export interface Credentials {
  /** z/OS user ID (e.g. `"USER"`). */
  user: string;
  /** Password or passphrase. */
  password: string;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Resolves credentials for a given system and (optional) user.
 *
 * When `userId` is omitted the provider returns credentials for the
 * system's default user.
 */
export interface CredentialProvider {
  /** Get credentials for a system, optionally for a specific user. */
  getCredentials(systemId: SystemId, userId?: string): Promise<Credentials>;

  /** List all user IDs available for a system. */
  listUsers(systemId: SystemId): Promise<string[]>;
}
