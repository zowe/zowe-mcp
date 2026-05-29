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
 * Fixed JSON payload returned by `GET /zosmf/info`.
 *
 * The field set matches what `@zowe/core-for-zowe-sdk`'s CheckStatus expects
 * and what real z/OSMF 5.30 actually returns. Version strings are driven by
 * `ZosmfVersion`; the only currently supported value is `'5.30'`.
 */

/** Supported z/OSMF version identifiers. Extend this union when adding support for new releases. */
export type ZosmfVersion = '5.30';

export interface ZosmfInfoPayload {
  zos_version: string;
  zosmf_port: string;
  zosmf_version: string;
  zosmf_hostname: string;
  plugins: unknown[];
  zosmf_saf_realm: string;
  zosmf_full_version: string;
  api_version: string;
}

/** Version-specific constants keyed by {@link ZosmfVersion}. */
const VERSION_DATA: Record<
  ZosmfVersion,
  Pick<ZosmfInfoPayload, 'zos_version' | 'zosmf_version' | 'zosmf_full_version'>
> = {
  '5.30': { zos_version: '05.30.00', zosmf_version: '30', zosmf_full_version: '30.0' },
};

export interface BuildZosmfInfoOptions {
  /** z/OSMF version to advertise. Defaults to `'5.30'`. */
  version?: ZosmfVersion;
  /** Port the HTTP listener is actually bound to. Reflected in `zosmf_port`. */
  port?: number;
  /** Hostname to advertise. Defaults to `'mock-zos.local'`. */
  hostname?: string;
}

export function buildZosmfInfoPayload(opts: BuildZosmfInfoOptions = {}): ZosmfInfoPayload {
  const ver = VERSION_DATA[opts.version ?? '5.30'];
  return {
    ...ver,
    zosmf_port: String(opts.port ?? 10443),
    zosmf_hostname: opts.hostname ?? 'mock-zos.local',
    plugins: [],
    zosmf_saf_realm: 'SAFRealm',
    api_version: '1',
  };
}

/** Default payload used when no options are supplied (z/OSMF 5.30). */
export const DEFAULT_ZOSMF_INFO: ZosmfInfoPayload = buildZosmfInfoPayload();
