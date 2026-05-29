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
 * Field names, types, and formatting come from real z/OSMF 5.30 on a real z/OS system:
 *
 *   z/OSMF REST     ZNP RPC         Notes
 *   ───────────     ───────         ──────────────────────────────────────────
 *   dsname          name
 *   blksz           blksize         STRING in z/OSMF, even though it is numeric
 *   lrecl           lrecl           STRING in z/OSMF
 *   extx            usedExtents     STRING in z/OSMF
 *   sizex           –               STRING in z/OSMF (allocated tracks/blocks)
 *   used            usedPercent     STRING ("0"–"100") in z/OSMF
 *   migr            migrated        STRING "YES"/"NO" in z/OSMF (not boolean)
 *   mvol            multivolume     STRING "Y"/"N" in z/OSMF (not boolean)
 *   ovf             –               STRING "YES"/"NO" — overflow flag (mock: always "NO")
 *   edate           expirationDate  "***None***" when none (not null)
 *   cdate / rdate   creationDate    Format "YYYY/MM/DD" (slash-separated)
 *   vol / vols      volser          vols is a STRING (not an array) — space-separated
 *                                   when multi-volume
 *
 * Fields the FilesystemMockBackend doesn't supply (dev, catnm) get plausible
 * defaults. Undefined fields are dropped from the JSON so the payload stays compact.
 */

import type { DatasetEntry } from '../../zos/backend.js';

export interface ZosmfDataSetItem {
  /** Fully-qualified data set name (always present). */
  dsname: string;
  dsorg?: string;
  recfm?: string;
  /** Logical record length — STRING per z/OSMF wire format (e.g. "80"). */
  lrecl?: string;
  /** Block size — STRING per z/OSMF wire format (e.g. "27920"). */
  blksz?: string;
  /** Primary volume serial. */
  vol?: string;
  /** Volume serial list, space-separated STRING (z/OSMF format, e.g. "VOL001 VOL002"). */
  vols?: string;
  /** Creation date "YYYY/MM/DD". */
  cdate?: string;
  /** Last-referenced date "YYYY/MM/DD". */
  rdate?: string;
  /** Expiration date "YYYY/MM/DD", or "***None***" when the data set never expires. */
  edate?: string;
  /** HSM migration status — STRING "YES" or "NO" per z/OSMF wire format. */
  migr?: string;
  /** Multi-volume flag — STRING "Y" or "N" per z/OSMF wire format. */
  mvol?: string;
  /** Overflow indicator — STRING "YES" or "NO" per z/OSMF wire format. */
  ovf?: string;
  /** Space unit ('TRACKS' | 'CYLINDERS' | ...). */
  spacu?: string;
  /** Used percentage — STRING (e.g. "60") per z/OSMF wire format. */
  used?: string;
  /** Used extents — STRING (e.g. "1") per z/OSMF wire format. */
  extx?: string;
  /** Allocated size in tracks/blocks — STRING (e.g. "41") per z/OSMF wire format. */
  sizex?: string;
  /** Device type, e.g. '3390'. */
  dev?: string;
  /** Data-set-name type — 'PDS', 'LIBRARY' (== PDS/E), 'BASIC', etc. */
  dsntp?: string;
  /** Containing catalog. */
  catnm?: string;
}

export interface ZosmfDataSetListResponse {
  items: ZosmfDataSetItem[];
  returnedRows: number;
  /**
   * Present (and `true`) when the result was truncated by `X-IBM-Max-Items`.
   * Matches real z/OSMF 5.30 behaviour — omitted when there are no more rows.
   */
  moreRows?: true;
  JSONversion: 1;
}

const DEFAULT_CATALOG = 'SYS1.MASTER.CATALOG';
const DEFAULT_DEVICE = '3390';
const DEFAULT_SPACE_UNIT = 'TRACKS';

/**
 * Convert an ISO date string ("YYYY-MM-DD") or any other format to the
 * slash-separated "YYYY/MM/DD" that real z/OSMF returns.
 * Returns `undefined` when the input is falsy.
 */
function toZosmfDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  // Already slash-separated — return as-is
  if (iso.includes('/')) return iso;
  // "YYYY-MM-DD" → "YYYY/MM/DD"
  return iso.replace(/-/g, '/');
}

/**
 * Map a backend {@link DatasetEntry} into a wire item using z/OSMF 5.30 field
 * names and types. Drop undefined keys so the payload stays small.
 */
export function datasetEntryToZosmfItem(entry: DatasetEntry): ZosmfDataSetItem {
  const item: ZosmfDataSetItem = {
    dsname: entry.dsn,
    dsorg: entry.dsorg,
    recfm: entry.recfm,
    lrecl: entry.lrecl !== undefined ? String(entry.lrecl) : undefined,
    blksz: entry.blksz !== undefined ? String(entry.blksz) : undefined,
    vol: entry.volser,
    // z/OSMF returns vols as a space-separated STRING (not an array)
    vols: entry.volsers ? entry.volsers.join(' ') : entry.volser,
    cdate: toZosmfDate(entry.creationDate),
    rdate: toZosmfDate(entry.referenceDate ?? entry.creationDate),
    // "***None***" when no expiry — matches real z/OSMF 5.30 wire format
    edate: entry.expirationDate ? toZosmfDate(entry.expirationDate) : '***None***',
    // z/OSMF uses "YES"/"NO" strings, not booleans
    migr: entry.migrated ? 'YES' : 'NO',
    mvol: entry.multivolume ? 'Y' : 'N',
    ovf: 'NO',
    spacu: entry.spaceUnits ?? DEFAULT_SPACE_UNIT,
    // z/OSMF "used" is the used percentage as a string (not a number)
    used: String(entry.usedPercent ?? 0),
    extx: String(entry.usedExtents ?? 0),
    sizex: String(0),
    dev: entry.devtype ?? DEFAULT_DEVICE,
    dsntp: entry.dsntype ?? defaultDsntp(entry.dsorg),
    catnm: DEFAULT_CATALOG,
  };
  return stripUndefined(item);
}

/** Build the top-level wrapper. Pass `truncated: true` when `X-IBM-Max-Items` clipped the list. */
export function buildDatasetListResponse(
  entries: DatasetEntry[],
  truncated = false
): ZosmfDataSetListResponse {
  const items = entries.map(datasetEntryToZosmfItem);
  const resp: ZosmfDataSetListResponse = { items, returnedRows: items.length, JSONversion: 1 };
  if (truncated) resp.moreRows = true;
  return resp;
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
  /** Present (and `true`) when the list was truncated by `X-IBM-Max-Items`. */
  moreRows?: true;
  JSONversion: 1;
}

/** Build the wrapper for the member-list endpoint. Pass `truncated: true` when capped. */
export function buildMemberListResponse(
  memberNames: string[],
  truncated = false
): ZosmfMemberListResponse {
  const items: ZosmfMemberItem[] = memberNames.map(name => ({ member: name.toUpperCase() }));
  const resp: ZosmfMemberListResponse = { items, returnedRows: items.length, JSONversion: 1 };
  if (truncated) resp.moreRows = true;
  return resp;
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
