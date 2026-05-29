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
 * The field set is what `@zowe/core-for-zowe-sdk`'s CheckStatus expects. Values
 * are plausible but not tied to a specific z/OS release — adjust if a test
 * needs to assert a particular version string. (A future `--zosmf-hostname`
 * flag could parameterize a couple of these.)
 */

export interface ZosmfInfoPayload {
  zos_version: string;
  zosmf_port: string;
  zosmf_version: string;
  zosmf_hostname: string;
  plugins: unknown[];
  zosmf_saf_realm: string;
  zosmf_full_version: string;
  api_version: string;
  zos_subreleases: string[];
}

export const DEFAULT_ZOSMF_INFO: ZosmfInfoPayload = {
  zos_version: '04.28.00',
  zosmf_port: '10443',
  zosmf_version: '29',
  zosmf_hostname: 'mock-zos.local',
  plugins: [],
  zosmf_saf_realm: 'SAFRealm',
  zosmf_full_version: '29.0',
  api_version: '1',
  zos_subreleases: [],
};
