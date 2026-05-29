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
 * IBM z/OSMF REST response shapes for the data-set endpoints.
 *
 * The Zowe SDK (`@zowe/zos-files-for-zowe-sdk`) and Zowe Explorer's data-set
 * panel both consume the response from `GET /zosmf/restfiles/ds`. Field names
 * here come from the published z/OSMF REST API ("List the z/OS data sets on a
 * system"), NOT from the ZNP RPC wire shape used over SSH:
 *
 *   z/OSMF REST     ZNP RPC
 *   ───────────     ───────
 *   dsname          name
 *   blksz           blksize
 *   vol / vols      volser / volsers
 *
 * Fields the FilesystemMockBackend doesn't supply (used, extx, sizex, dev,
 * catnm) are stable plausible defaults. Undefined fields are dropped from the
 * JSON so the wire shape stays compact.
 */

import type { DatasetEntry } from '../../zos/backend.js';

export interface ZosmfDataSetItem {
  /** Fully-qualified data set name (always present). */
  dsname: string;
  dsorg?: string;
  recfm?: string;
  lrecl?: number;
  blksz?: number;
  /** Primary volume serial. */
  vol?: string;
  /** Multi-volume list. Always set to a one-element array when `vol` is known. */
  vols?: string[];
  /** Creation date (ISO 8601 yyyy-MM-dd). */
  cdate?: string;
  /** Last-referenced date. Falls back to `cdate` when the entry has none. */
  rdate?: string;
  /** Expiration date. Real z/OSMF returns `null` for never-expiring data sets. */
  edate?: string | null;
  /** True if HSM-migrated. */
  migr?: boolean;
  /** True if the data set spans multiple volumes. */
  mvol?: boolean;
  /** Space unit ('TRACKS' | 'CYLINDERS' | ...). */
  spacu?: string;
  /** Used tracks. */
  used?: number;
  /** Used extents. */
  extx?: number;
  /** Size (records). */
  sizex?: number;
  /** Device type, e.g. '3390'. */
  dev?: string;
  /** Data-set-name type — 'PDS', 'LIBRARY' (== PDSE), 'BASIC', etc. */
  dsntp?: string;
  /** Containing catalog. */
  catnm?: string;
}

export interface ZosmfDataSetListResponse {
  items: ZosmfDataSetItem[];
  returnedRows: number;
  JSONversion: 1;
}

const DEFAULT_CATALOG = 'SYS1.MASTER.CATALOG';
const DEFAULT_DEVICE = '3390';
const DEFAULT_SPACE_UNIT = 'TRACKS';

/**
 * Map a backend {@link DatasetEntry} into a wire item using the z/OSMF field
 * names. Drop undefined keys so the response payload stays small.
 */
export function datasetEntryToZosmfItem(entry: DatasetEntry): ZosmfDataSetItem {
  const item: ZosmfDataSetItem = {
    dsname: entry.dsn,
    dsorg: entry.dsorg,
    recfm: entry.recfm,
    lrecl: entry.lrecl,
    blksz: entry.blksz,
    vol: entry.volser,
    vols: entry.volsers ?? (entry.volser ? [entry.volser] : undefined),
    cdate: entry.creationDate,
    rdate: entry.referenceDate ?? entry.creationDate,
    edate: entry.expirationDate ?? null,
    migr: entry.migrated ?? false,
    mvol: entry.multivolume ?? false,
    spacu: entry.spaceUnits ?? DEFAULT_SPACE_UNIT,
    // z/OSMF doc field `used` is the used percentage (0–100). `DatasetEntry`
    // exposes the same value as `usedPercent`. The richer `usedTracks` is only
    // on `DatasetAttributes` from getAttributes(), not on the list-entry shape.
    used: entry.usedPercent ?? 0,
    extx: entry.usedExtents ?? 0,
    sizex: 0,
    dev: entry.devtype ?? DEFAULT_DEVICE,
    dsntp: entry.dsntype ?? defaultDsntp(entry.dsorg),
    catnm: DEFAULT_CATALOG,
  };
  return stripUndefined(item);
}

/** Build the top-level wrapper {items, returnedRows, JSONversion:1}. */
export function buildDatasetListResponse(entries: DatasetEntry[]): ZosmfDataSetListResponse {
  const items = entries.map(datasetEntryToZosmfItem);
  return { items, returnedRows: items.length, JSONversion: 1 };
}

/**
 * One row in the response from `GET /zosmf/restfiles/ds/<dsname>/member`.
 * Field name is `member` (z/OSMF spelling), not `name` (RPC spelling).
 *
 * Real z/OSMF adds richer attributes — `vers`, `mod`, `c4date`, `m4date`,
 * `cnorc`, `inorc`, `mnorc`, `user`, `mtime` — when the caller passes
 * `X-IBM-Attributes: member`. The mock returns just the member name in all
 * modes; clients tolerate the missing optional fields.
 */
export interface ZosmfMemberItem {
  member: string;
}

export interface ZosmfMemberListResponse {
  items: ZosmfMemberItem[];
  returnedRows: number;
  JSONversion: 1;
}

/** Build the wrapper for the member-list endpoint. */
export function buildMemberListResponse(memberNames: string[]): ZosmfMemberListResponse {
  const items: ZosmfMemberItem[] = memberNames.map(name => ({ member: name.toUpperCase() }));
  return { items, returnedRows: items.length, JSONversion: 1 };
}

/** Default DSNTYPE inference from DSORG when the entry has none. */
function defaultDsntp(dsorg: string | undefined): string | undefined {
  if (dsorg === 'PO-E') return 'LIBRARY';
  if (dsorg === 'PO') return 'PDS';
  if (dsorg === 'PS') return 'BASIC';
  return undefined;
}

function stripUndefined<T extends object>(obj: T): T {
  for (const k of Object.keys(obj) as (keyof T)[]) {
    if (obj[k] === undefined) {
      delete obj[k];
    }
  }
  return obj;
}
