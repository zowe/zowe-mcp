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

import type { certificates as ZowexCerts } from '@zowe/zowex-for-zowe-sdk';
import type {
  CertActionResult,
  DatasetEntry,
  ExportCertificateResult,
  JobEntry,
  MemberEntry,
  SearchInDatasetOptions,
  SearchInDatasetSummary,
  ShowCertificateResult,
} from './backend.js';
import { sanitizeZowexString } from './native/zowex-debug.js';

/** Keep transport-specific job metadata out of the MCP response contract. */
export function mapJobToEntry(item: Partial<JobEntry>, jobId = ''): JobEntry {
  return {
    id: sanitizeZowexString(item.id) ?? jobId,
    name: sanitizeZowexString(item.name) ?? '',
    owner: sanitizeZowexString(item.owner) ?? '',
    status: sanitizeZowexString(item.status) ?? '',
    type: sanitizeZowexString(item.type) ?? '',
    class: sanitizeZowexString(item.class) ?? '',
    retcode: sanitizeZowexString(item.retcode) ?? item.retcode,
    subsystem: sanitizeZowexString(item.subsystem) ?? item.subsystem,
    phase: item.phase ?? 0,
    phaseName: sanitizeZowexString(item.phaseName) ?? '',
    correlator: sanitizeZowexString(item.correlator) ?? item.correlator,
  };
}

export interface ZoDatasetItem {
  name: string;
  dsorg?: string;
  recfm?: string;
  lrecl?: number;
  blksize?: number;
  cdate?: string;
  volser?: string;
  rdate?: string;
  edate?: string;
  multivolume?: boolean;
  migrated?: boolean;
  encrypted?: boolean;
  dsntype?: string;
  dataclass?: string;
  mgmtclass?: string;
  storclass?: string;
  spacu?: string;
  usedp?: number;
  usedx?: number;
  primary?: number;
  secondary?: number;
  devtype?: string;
  volsers?: string[];
}

export function mapDatasetToEntry(item: ZoDatasetItem): DatasetEntry {
  return {
    dsn: item.name,
    dsorg: item.dsorg as DatasetEntry['dsorg'],
    recfm: item.recfm as DatasetEntry['recfm'],
    lrecl: item.lrecl,
    blksz: item.blksize,
    volser: item.volser,
    creationDate: item.cdate,
    referenceDate: item.rdate,
    expirationDate: item.edate,
    multivolume: item.multivolume,
    migrated: item.migrated,
    encrypted: item.encrypted,
    dsntype: item.dsntype,
    dataclass: item.dataclass,
    mgmtclass: item.mgmtclass,
    storclass: item.storclass,
    spaceUnits: item.spacu,
    usedPercent: item.usedp,
    usedExtents: item.usedx,
    primary: item.primary,
    secondary: item.secondary,
    devtype: item.devtype,
    volsers: item.volsers,
  };
}

/** Maps a raw listDsMembers item (SDK DsMember shape) to MemberEntry, including ISPF statistics. */
export interface ZoMemberItem {
  name: string;
  user?: string;
  vers?: number;
  mod?: number;
  c4date?: string;
  m4date?: string;
  mtime?: string;
  cnorc?: number;
  inorc?: number;
  mnorc?: number;
  sclm?: string;
}

export function mapMemberToEntry(item: ZoMemberItem): MemberEntry {
  return {
    name: item.name.toUpperCase(),
    user: item.user,
    version: item.vers,
    modLevel: item.mod,
    createdDate: item.c4date,
    modifiedDate: item.m4date,
    modifiedTime: item.mtime,
    currentRecords: item.cnorc,
    initialRecords: item.inorc,
    modifiedRecords: item.mnorc,
    sclm: item.sclm,
  };
}

/** Maps a certificate/key ring action response to our RACF-neutral CertActionResult. */
export function mapCertActionResult(response: ZowexCerts.CertCommandResponse): CertActionResult {
  return {
    ...(response.warning !== undefined && {
      warning: sanitizeZowexString(response.warning) ?? response.warning,
    }),
    ...(response.safReturns !== undefined && {
      safReturnCodes: {
        functionCode: response.safReturns.functionCode,
        safReturnCode: response.safReturns.safReturnCode,
        productReturnCode: response.safReturns.esmReturnCode,
        productReasonCode: response.safReturns.esmReasonCode,
      },
    }),
    ...(response.gskReturnCode !== undefined && { gskReturnCode: response.gskReturnCode }),
  };
}

export function mapCertificateExport(
  response: ZowexCerts.ExportCertificateResponse
): ExportCertificateResult {
  const format = sanitizeZowexString(response.format) ?? response.format;
  return {
    label: sanitizeZowexString(response.label) ?? response.label,
    owner: sanitizeZowexString(response.owner) ?? response.owner,
    keyring: sanitizeZowexString(response.keyring) ?? response.keyring,
    format,
    file: response.file !== undefined ? sanitizeZowexString(response.file) : undefined,
    bytesWritten: response.bytesWritten,
    data:
      response.data !== undefined && format !== 'p12'
        ? Buffer.from(response.data, 'base64').toString('utf-8')
        : undefined,
  };
}

export function mapCertificateDetails(
  response: ZowexCerts.ShowCertificateResponse
): ShowCertificateResult {
  return {
    label: sanitizeZowexString(response.label) ?? response.label,
    owner: sanitizeZowexString(response.owner) ?? response.owner,
    usage: sanitizeZowexString(response.usage) ?? response.usage,
    status: sanitizeZowexString(response.status) ?? response.status,
    isDefault: response.default,
    keyType: response.keyType,
    keySize: response.keySize,
    serialNumber:
      response.serialNumber !== undefined ? sanitizeZowexString(response.serialNumber) : undefined,
    notBefore: response.notBefore,
    notAfter: response.notAfter,
    recordId: response.recordId !== undefined ? sanitizeZowexString(response.recordId) : undefined,
  };
}

/** Normalize the SuperC summary shared by both native zo transports. */
export function mapSearchSummary(
  summary: Omit<SearchInDatasetSummary, 'searchPattern' | 'processOptions'> & {
    searchPattern?: string;
    processOptions?: string;
  },
  options: Pick<SearchInDatasetOptions, 'string' | 'parms'>
): SearchInDatasetSummary {
  return {
    linesFound: summary.linesFound,
    linesProcessed: summary.linesProcessed,
    membersWithLines: summary.membersWithLines,
    membersWithoutLines: summary.membersWithoutLines,
    searchPattern: summary.searchPattern ?? options.string,
    processOptions: summary.processOptions ?? options.parms,
  };
}
