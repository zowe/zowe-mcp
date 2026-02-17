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
 * Backend-agnostic interface for z/OS dataset operations.
 *
 * The {@link ZosBackend} interface is the abstraction boundary between
 * the MCP tool/resource layer and the actual z/OS API. Any API that can
 * perform dataset operations (z/OSMF, Zowe SDK, Zowe CLI, proprietary
 * APIs, filesystem mock, etc.) can be plugged in as a backend.
 *
 * The tool and resource layer is completely backend-agnostic.
 */

import type { SystemId } from './system.js';

// ---------------------------------------------------------------------------
// Dataset types
// ---------------------------------------------------------------------------

/** Dataset organization type. */
export type DatasetOrg = 'PS' | 'PO' | 'PO-E' | 'VS' | 'DA';

/** Record format. */
export type RecordFormat = 'F' | 'FB' | 'V' | 'VB' | 'U' | 'FBA' | 'VBA';

/** SMS storage classes. */
export interface SmsClasses {
  data?: string;
  storage?: string;
  management?: string;
}

/** Dataset attributes as returned by the backend. */
export interface DatasetAttributes {
  /** Fully-qualified dataset name. */
  dsn: string;
  /** Dataset organization. */
  dsorg?: DatasetOrg;
  /** Record format. */
  recfm?: RecordFormat;
  /** Logical record length. */
  lrecl?: number;
  /** Block size. */
  blksz?: number;
  /** Volume serial. */
  volser?: string;
  /** Creation date (ISO 8601 date string). */
  creationDate?: string;
  /** Last referenced date (ISO 8601 date string). */
  referenceDate?: string;
  /** SMS classes. */
  smsClass?: SmsClasses;
  /** Number of used tracks. */
  usedTracks?: number;
  /** Number of used extents. */
  usedExtents?: number;
}

/** Summary info for a dataset in a listing. */
export interface DatasetEntry {
  /** Fully-qualified dataset name. */
  dsn: string;
  /** Dataset organization. */
  dsorg?: DatasetOrg;
  /** Record format. */
  recfm?: RecordFormat;
  /** Logical record length. */
  lrecl?: number;
  /** Block size. */
  blksz?: number;
  /** Volume serial. */
  volser?: string;
  /** Creation date (ISO 8601 date string). */
  creationDate?: string;
}

/** A member entry in a PDS/PDSE listing. */
export interface MemberEntry {
  /** Member name (uppercase, up to 8 chars). */
  name: string;
}

/** Result of reading a dataset or member. */
export interface ReadDatasetResult {
  /** Content as UTF-8 text. */
  text: string;
  /** ETag for optimistic locking. */
  etag: string;
  /** Source codepage used for conversion. */
  codepage: string;
}

/** Result of writing a dataset or member. */
export interface WriteDatasetResult {
  /** New ETag after the write. */
  etag: string;
}

/** Options for creating a new dataset. */
export interface CreateDatasetOptions {
  /** Dataset organization type to create. */
  type: 'PS' | 'PO' | 'PO-E';
  /** Record format. */
  recfm?: RecordFormat;
  /** Logical record length. */
  lrecl?: number;
  /** Block size. */
  blksz?: number;
  /** Primary space allocation (in tracks). */
  primary?: number;
  /** Secondary space allocation (in tracks). */
  secondary?: number;
  /** Directory blocks (for PDS only). */
  dirblk?: number;
}

/** Attributes actually applied when a dataset is created (may differ from requested due to defaults or SMS). */
export interface CreateDatasetApplied {
  /** Dataset organization applied. */
  dsorg: DatasetOrg;
  /** Record format applied. */
  recfm: RecordFormat;
  /** Logical record length applied. */
  lrecl: number;
  /** Block size applied. */
  blksz: number;
  /** Volume serial assigned (e.g. by SMS or storage). */
  volser?: string;
  /** Primary space (tracks) applied. */
  primary?: number;
  /** Secondary space (tracks) applied. */
  secondary?: number;
  /** Directory blocks applied (PDS/PDSE). */
  dirblk?: number;
  /** SMS classes applied (if SMS managed). */
  smsClass?: SmsClasses;
}

/** Result of creating a dataset: applied attributes and allocation messages. */
export interface CreateDatasetResult {
  /** Attributes actually used for the allocation (defaults and SMS may have changed requested values). */
  applied: CreateDatasetApplied;
  /** Messages describing defaults used, SMS decisions, or differences from the request. */
  messages: string[];
}

// ---------------------------------------------------------------------------
// Backend interface
// ---------------------------------------------------------------------------

/**
 * Backend-agnostic interface for z/OS dataset operations.
 *
 * All methods accept a `systemId` to identify the target z/OS system.
 * The backend implementation resolves credentials and connection details
 * internally.
 */
export interface ZosBackend {
  /**
   * List datasets matching a pattern.
   *
   * The pattern follows z/OS conventions:
   * - `*` matches any characters within a single qualifier
   * - `**` matches any number of qualifiers
   *
   * @param systemId - Target z/OS system.
   * @param pattern - Dataset name pattern (e.g. `"USER.*"`).
   * @param volser - Optional volume serial for uncataloged datasets.
   * @param userId - Optional user ID (for backends that need it, e.g. SSH per-user session).
   */
  listDatasets(
    systemId: SystemId,
    pattern: string,
    volser?: string,
    userId?: string
  ): Promise<DatasetEntry[]>;

  /**
   * List members of a PDS/PDSE.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified PDS/PDSE name.
   * @param pattern - Optional member name filter pattern.
   */
  listMembers(systemId: SystemId, dsn: string, pattern?: string): Promise<MemberEntry[]>;

  /**
   * Read the content of a sequential dataset or PDS/PDSE member.
   *
   * The backend converts from the source codepage to UTF-8.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified dataset name.
   * @param member - Member name (for PDS/PDSE).
   * @param codepage - Source codepage (default: `"IBM-1047"`).
   */
  readDataset(
    systemId: SystemId,
    dsn: string,
    member?: string,
    codepage?: string
  ): Promise<ReadDatasetResult>;

  /**
   * Write content to a sequential dataset or PDS/PDSE member.
   *
   * Content is provided as UTF-8 text. The backend converts to the
   * target codepage.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified dataset name.
   * @param content - UTF-8 text content to write.
   * @param member - Member name (for PDS/PDSE).
   * @param etag - Optional ETag for optimistic locking.
   * @param codepage - Target codepage (default: `"IBM-1047"`).
   * @throws If `etag` is provided and does not match the current version.
   */
  writeDataset(
    systemId: SystemId,
    dsn: string,
    content: string,
    member?: string,
    etag?: string,
    codepage?: string
  ): Promise<WriteDatasetResult>;

  /**
   * Create a new dataset.
   *
   * Returns the attributes actually applied (which may differ from the request
   * due to defaults or SMS) and messages describing any defaults or SMS decisions.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified dataset name.
   * @param options - Dataset creation options (type, recfm, lrecl, etc.).
   */
  createDataset(
    systemId: SystemId,
    dsn: string,
    options: CreateDatasetOptions
  ): Promise<CreateDatasetResult>;

  /**
   * Delete a dataset or a specific PDS/PDSE member.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified dataset name.
   * @param member - If provided, delete only this member.
   */
  deleteDataset(systemId: SystemId, dsn: string, member?: string): Promise<void>;

  /**
   * Get detailed attributes of a dataset.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified dataset name.
   */
  getAttributes(systemId: SystemId, dsn: string): Promise<DatasetAttributes>;

  /**
   * Copy a dataset or member within a single system.
   *
   * @param systemId - Target z/OS system.
   * @param sourceDsn - Source dataset name.
   * @param targetDsn - Target dataset name.
   * @param sourceMember - Source member name (for PDS/PDSE).
   * @param targetMember - Target member name (for PDS/PDSE).
   */
  copyDataset(
    systemId: SystemId,
    sourceDsn: string,
    targetDsn: string,
    sourceMember?: string,
    targetMember?: string
  ): Promise<void>;

  /**
   * Rename a dataset or PDS/PDSE member.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Current dataset name.
   * @param newDsn - New dataset name.
   * @param member - Current member name (for member rename).
   * @param newMember - New member name (for member rename).
   */
  renameDataset(
    systemId: SystemId,
    dsn: string,
    newDsn: string,
    member?: string,
    newMember?: string
  ): Promise<void>;
}
