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
 * Loader for the `zos-attls` native addon (native/attls.cc), which issues the
 * SIOCTTLSCTL TTLS_QUERY_ONLY ioctl against an accepted socket. Like node-racf
 * for the SAF IdP, the addon is never packed into npm tarballs — it is built
 * once per LPAR (native/build.sh) and referenced by absolute path via the
 * `ZOWE_MCP_ATTLS_MODULE` env var.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Policy status decoded from TTLSi_Stat_Policy (ezbztlsc.h). */
export type AtTlsPolicyStatus = 'off' | 'noPolicy' | 'notEnabled' | 'enabled' | 'applControlled';

/** Connection status decoded from TTLSi_Stat_Conn (ezbztlsc.h). */
export type AtTlsConnStatus = 'notSecure' | 'handshakeInProgress' | 'secure';

/** Result of one SIOCTTLSCTL query on a connected TCP socket. */
export interface AtTlsQueryResult {
  policyStatus: AtTlsPolicyStatus;
  connStatus: AtTlsConnStatus;
  /** Present only when connStatus === 'secure'. */
  protocol?: string;
  protocolCode?: number;
  cipher?: string;
  fips140?: number;
  securityType?: string;
  partnerUserId?: string;
}

/**
 * The subset of the addon this package uses. `query` is synchronous (the ioctl
 * is a local, fast kernel call). It never throws for an insecure connection —
 * that is a status; it throws (with `code` = errno name and numeric `errno`)
 * only when the ioctl itself fails (ENOTCONN, EPROTOTYPE, EWOULDBLOCK, …).
 */
export interface AtTlsAddon {
  query(fd: number): AtTlsQueryResult;
}

/** Actionable build hint used in load-failure and doctor messages. */
export const ATTLS_BUILD_HINT =
  'build the addon on the LPAR with packages/zos-attls/native/build.sh and point ' +
  'ZOWE_MCP_ATTLS_MODULE at the resulting module directory';

/**
 * Loads the AT-TLS query addon. Resolution order: the explicit path (callers
 * pass `ZOWE_MCP_ATTLS_MODULE`), then the in-package build
 * (`native/build/Release/attls.node`, for on-LPAR development). Throws with
 * the loader's message on failure — callers decide whether that is fatal
 * (`required` mode) or a degradation (`monitor` mode).
 */
export function loadAtTlsModule(explicitPath?: string): AtTlsAddon {
  const require = createRequire(import.meta.url);
  let loaded: unknown;
  if (explicitPath) {
    loaded = require(explicitPath);
  } else {
    const localBuild = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'native',
      'build',
      'Release',
      'attls.node'
    );
    if (!existsSync(localBuild)) {
      throw new Error(
        `ZOWE_MCP_ATTLS_MODULE is not set and no local build exists at ${localBuild}; ${ATTLS_BUILD_HINT}`
      );
    }
    loaded = require(localBuild);
  }
  const candidate = loaded as Partial<AtTlsAddon>;
  if (typeof candidate.query !== 'function') {
    throw new Error(
      `module loaded from ${explicitPath ?? 'the local build'} has no query() function`
    );
  }
  return candidate as AtTlsAddon;
}
