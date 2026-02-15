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
 * Types for the mock data directory structure.
 *
 * The `systems.json` file at the root of the mock data directory
 * describes the available z/OS systems and their credentials.
 */

/** Credential entry in `systems.json`. */
export interface MockCredentialEntry {
  user: string;
  password: string;
}

/** System entry in `systems.json`. */
export interface MockSystemEntry {
  host: string;
  port: number;
  description?: string;
  defaultUser?: string;
  credentials: MockCredentialEntry[];
}

/** Top-level structure of `systems.json`. */
export interface MockSystemsConfig {
  systems: MockSystemEntry[];
}

/** Dataset-level metadata stored in `_meta.json`. */
export interface MockDatasetMeta {
  dsn: string;
  dsorg?: string;
  recfm?: string;
  lrecl?: number;
  blksz?: number;
  volser?: string;
  creationDate?: string;
  referenceDate?: string;
  smsClass?: {
    data?: string;
    storage?: string;
    management?: string;
  };
}
