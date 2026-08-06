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
 * Backend-agnostic interface for z/OS data set operations.
 *
 * The {@link ZosBackend} interface is the abstraction boundary between
 * the MCP tool/resource layer and the actual z/OS API. Any API that can
 * perform data set operations (z/OSMF, Zowe SDK, Zowe CLI, proprietary
 * APIs, filesystem mock, etc.) can be plugged in as a backend.
 *
 * The tool and resource layer is completely backend-agnostic.
 */

import type { SystemId } from './system.js';

/** Optional progress callback for long-running backend operations (e.g. connect, deploy). */
export type BackendProgressCallback = (message: string) => void;

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

/** Data set attributes as returned by the backend. */
export interface DatasetAttributes {
  /** Fully-qualified data set name. */
  dsn: string;
  /** Data set organization. */
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
  /** Expiration date (ISO 8601 date string). */
  expirationDate?: string;
  /** SMS classes. */
  smsClass?: SmsClasses;
  /** Number of used tracks. */
  usedTracks?: number;
  /** Number of used extents. */
  usedExtents?: number;
  /** Whether the data set is on multiple volumes. */
  multivolume?: boolean;
  /** Whether the data set is migrated (HSM). */
  migrated?: boolean;
  /** Whether the data set is encrypted. */
  encrypted?: boolean;
  /** Data set name type (e.g. PDS, LIBRARY). */
  dsntype?: string;
  /** SMS data class. */
  dataclass?: string;
  /** SMS management class. */
  mgmtclass?: string;
  /** SMS storage class. */
  storclass?: string;
  /** Space unit type (TRACKS, CYLINDERS, etc.). */
  spaceUnits?: string;
  /** Used space percentage. */
  usedPercent?: number;
  /** Primary allocation units. */
  primary?: number;
  /** Secondary allocation units. */
  secondary?: number;
  /** Device type. */
  devtype?: string;
  /** Multi-volume serial list. */
  volsers?: string[];
}

/** Summary info for a data set in a listing. */
export interface DatasetEntry {
  /** Fully-qualified data set name. */
  dsn: string;
  /** Data set organization. */
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
  /** Expiration date (ISO 8601 date string). */
  expirationDate?: string;
  /** Whether the data set is on multiple volumes. */
  multivolume?: boolean;
  /** Whether the data set is migrated (HSM). */
  migrated?: boolean;
  /** Whether the data set is encrypted. */
  encrypted?: boolean;
  /** Data set name type (e.g. PDS, LIBRARY). */
  dsntype?: string;
  /** SMS data class. */
  dataclass?: string;
  /** SMS management class. */
  mgmtclass?: string;
  /** SMS storage class. */
  storclass?: string;
  /** Space unit type (TRACKS, CYLINDERS, etc.). */
  spaceUnits?: string;
  /** Used space percentage. */
  usedPercent?: number;
  /** Used extents count. */
  usedExtents?: number;
  /** Primary allocation units. */
  primary?: number;
  /** Secondary allocation units. */
  secondary?: number;
  /** Device type. */
  devtype?: string;
  /** Multi-volume serial list. */
  volsers?: string[];
}

/** A member entry in a PDS or PDS/E listing. */
export interface MemberEntry {
  /** Member name (uppercase, up to 8 chars). */
  name: string;
}

/** Result of reading a data set or member. */
export interface ReadDatasetResult {
  /** Content as UTF-8 text (local/client encoding). */
  text: string;
  /** ETag for optimistic locking. */
  etag: string;
  /** Mainframe (source) EBCDIC encoding used for conversion to UTF-8. */
  encoding: string;
}

/** Result of writing a data set or member. */
export interface WriteDatasetResult {
  /** New ETag after the write. */
  etag: string;
}

/** Options for creating a new data set. */
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
  /** Volume serial to allocate on. */
  volser?: string;
  /** SMS data class. */
  dataClass?: string;
  /** SMS storage class. */
  storageClass?: string;
  /** SMS management class. */
  managementClass?: string;
}

/** Attributes actually applied when a data set is created (may differ from requested due to defaults or SMS). */
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
  /** Directory blocks applied (PDS or PDS/E). */
  dirblk?: number;
  /** SMS classes applied (if SMS managed). */
  smsClass?: SmsClasses;
}

/** Result of creating a data set: applied attributes and allocation messages. */
export interface CreateDatasetResult {
  /** Attributes actually used for the allocation (defaults and SMS may have changed requested values). */
  applied: CreateDatasetApplied;
  /** Messages describing defaults used, SMS decisions, or differences from the request. */
  messages: string[];
}

// ---------------------------------------------------------------------------
// Search types
// ---------------------------------------------------------------------------

/** A single matching line from a search. */
export interface SearchMatchEntry {
  /** 1-based line number. */
  lineNumber: number;
  /** Line content (UTF-8). */
  content: string;
  /** Lines before the match (LPSF context, ±6 lines). Present only when ZNP tool.search is used with LPSF parms. */
  beforeContext?: string[];
  /** Lines after the match (LPSF context, ±6 lines). Present only when ZNP tool.search is used with LPSF parms. */
  afterContext?: string[];
}

/** Search result for one member: name and matching lines. */
export interface SearchMemberResult {
  /** Member name (or synthetic name for sequential data set). */
  name: string;
  /** Matching lines with line numbers. */
  matches: SearchMatchEntry[];
}

/** Summary counts and options for a search result. */
export interface SearchInDatasetSummary {
  /** Total lines that matched the search string. */
  linesFound: number;
  /** Total lines processed across all members. */
  linesProcessed: number;
  /** Number of members that had at least one match. */
  membersWithLines: number;
  /** Number of members with no matches (PDS only). */
  membersWithoutLines: number;
  /** Search string used. */
  searchPattern: string;
  /** SuperC process options string (e.g. "ANYC COBOL"). */
  processOptions: string;
}

/** Options for searchInDataset. Tool builds parms from natural options and passes parms. */
export interface SearchInDatasetOptions {
  /** Search string (literal). */
  string: string;
  /** Optional member name to limit search to one PDS or PDS/E member. */
  member?: string;
  /** SuperC process options string (e.g. "ANYC COBOL"), built from natural options. */
  parms: string;
  /** Mainframe (EBCDIC) encoding for reading data set content. Resolved by tool layer (operation → system → server default). */
  encoding?: string;
}

/** Full result of a search in a data set (all members with matches and summary). */
export interface SearchInDatasetResult {
  /** Resolved data set name. */
  dataset: string;
  /** Members (or single entry for sequential) with their matching lines. */
  members: SearchMemberResult[];
  /** Summary counts and options. */
  summary: SearchInDatasetSummary;
}

// ---------------------------------------------------------------------------
// USS types
// ---------------------------------------------------------------------------

/** A single file or directory entry in a USS listing (aligned with ZNP UssItem). */
export interface UssFileEntry {
  /** File or directory name. */
  name: string;
  /** Number of links. */
  links?: number;
  /** Owner user. */
  user?: string;
  /** Owner group. */
  group?: string;
  /** Size in bytes (files only). */
  size?: number;
  /** z/OS file tag (encoding/type). */
  filetag?: string;
  /** Modification time (ISO 8601 or platform string). */
  mtime?: string;
  /** Permission string (e.g. drwxr-xr-x). */
  mode?: string;
  /** True if this entry is a directory. */
  isDirectory?: boolean;
}

/** Result of reading a USS file. */
export interface ReadUssFileResult {
  /** Content as UTF-8 text. */
  text: string;
  /** ETag for optimistic locking. */
  etag: string;
  /** Mainframe (source) encoding used for conversion to UTF-8 (if applicable). */
  encoding?: string;
}

/** Result of writing a USS file. */
export interface WriteUssFileResult {
  /** New ETag after the write. */
  etag: string;
  /** True if a new file was created. */
  created: boolean;
}

/** Options for listing USS files. */
export interface ListUssFilesOptions {
  /** Include hidden files (names starting with .). */
  includeHidden?: boolean;
  /** Return long format (mode, user, group, size, mtime, name). */
  longFormat?: boolean;
  /** Depth of subdirectories to list (default 1). */
  depth?: number;
  /** Maximum items to return (backend may return fewer; tool layer paginates). */
  maxItems?: number;
}

/** Options for copying a USS file or directory. */
export interface CopyUssFileOptions {
  /** Copy directories recursively. */
  recursive?: boolean;
  /** Follow symlinks when copying recursively. */
  followSymlinks?: boolean;
  /** Preserve permissions and ownership. */
  preserveAttributes?: boolean;
  /** Replace files that cannot be opened (like cp -f). */
  force?: boolean;
}

/** Options for creating a USS file or directory. */
export interface CreateUssFileOptions {
  /** If true, create a directory; if false, create a regular file. */
  isDirectory: boolean;
  /** Permissions (e.g. "755") for the new path. */
  permissions?: string;
}

// ---------------------------------------------------------------------------
// Job types
// ---------------------------------------------------------------------------

/** Result of submitting a job (JCL or from data set/USS). */
export interface SubmitJobResult {
  /** Job ID assigned by JES (e.g. JOB00123). */
  jobId: string;
  /** Job name from the JOB statement. */
  jobName: string;
}

/** Job status as returned by the backend (maps from ZNP Job). */
export interface JobStatusResult {
  /** Job ID. */
  id: string;
  /** Job name. */
  name: string;
  /** Job owner. */
  owner: string;
  /** Status: INPUT, ACTIVE, OUTPUT. */
  status: string;
  /** Job type: JOB, STC, TSU. */
  type: string;
  /** Execution class. */
  class: string;
  /** Return code (undefined if not complete). */
  retcode?: string;
  /** Subsystem (optional). */
  subsystem?: string;
  /** Phase number. */
  phase: number;
  /** Phase name. */
  phaseName: string;
  /** Correlator (optional, JES3). */
  correlator?: string;
}

/** A single job output file (spool) entry from listJobFiles. */
export interface JobFileEntry {
  /** Job file (spool) ID. */
  id: number;
  /** DD name (e.g. SYSOUT, JESJCL). */
  ddname?: string;
  /** Step name. */
  stepname?: string;
  /** Dataset name when applicable. */
  dsname?: string;
  /** Procedure step name. */
  procstep?: string;
}

/** Result of reading one job output file. */
export interface ReadJobFileResult {
  /** Content as UTF-8 text. */
  text: string;
  /** Encoding used (if known). */
  encoding?: string;
}

/** Job list entry (same shape as JobStatusResult for listJobs). */
export type JobEntry = JobStatusResult;

/** Options for listJobs. */
export interface ListJobsOptions {
  /** Filter by owner. */
  owner?: string;
  /** Filter by job name prefix. */
  prefix?: string;
  /** Filter by status: INPUT, ACTIVE, OUTPUT. */
  status?: string;
  /** Maximum items to return (backend may cap). */
  maxItems?: number;
}

// ---------------------------------------------------------------------------
// System information types
// ---------------------------------------------------------------------------

/** A single APF-authorized data set entry. */
export interface ApfDatasetEntry {
  /** Data set name. */
  dsn: string;
  /** Volume serial the data set resides on (empty when SMS-managed / dynamic). */
  volser: string;
}

/** Result of listing APF-authorized data sets. */
export interface ListApfResult {
  /** APF-authorized data sets. */
  items: ApfDatasetEntry[];
}

/** A single PROCLIB concatenation entry (the RPC provides no volume serial). */
export interface ProclibDatasetEntry {
  /** Data set name. */
  dsn: string;
}

/** Result of listing the PROCLIB concatenation. */
export interface ListProclibResult {
  /** PROCLIB data sets (in concatenation order). */
  items: ProclibDatasetEntry[];
}

/** A single link list (LNKLST) data set entry. */
export interface LinklistDatasetEntry {
  /** Data set name. */
  dsn: string;
  /** Volume serial the data set resides on (empty when SMS-managed / dynamic). */
  volser: string;
  /** Whether the data set is APF-authorized. */
  apfAuthorized: boolean;
}

/** Result of listing the link list (LNKLST) concatenation. */
export interface ListLinklistResult {
  /** Link list data sets (in concatenation order). */
  items: LinklistDatasetEntry[];
}

/** Options for reading the z/OS SYSLOG. Date/time and secondsAgo are mutually exclusive. */
export interface ViewSyslogOptions {
  /** Start date in yyyy-mm-dd. Mutually exclusive with secondsAgo. */
  date?: string;
  /** Start time in hh:mm:ss. Mutually exclusive with secondsAgo. */
  time?: string;
  /** Relative offset: start from (now - secondsAgo) on z/OS. Mutually exclusive with date/time. */
  secondsAgo?: number;
  /** Maximum syslog lines to read from the host. */
  maxLines?: number;
}

/** Result of reading the z/OS SYSLOG. */
export interface ViewSyslogResult {
  /** Raw syslog text (UTF-8), newline-separated lines. */
  text: string;
  /** Actual start date used for the read (yyyy-mm-dd). */
  startDate?: string;
  /** Actual start time used for the read (hh:mm:ss). */
  startTime?: string;
  /** Date of the last record returned (yyyy-mm-dd). */
  endDate?: string;
  /** Time of the last record returned (hh:mm:ss). */
  endTime?: string;
  /** Number of lines returned by the host. */
  returnedLines?: number;
  /** True when the syslog had more lines than maxLines and the host truncated the read. */
  hasMore?: boolean;
}

// ---------------------------------------------------------------------------
// Certificate / key ring types
//
// These operations act on the z/OS security database (RACF, ACF2, or Top
// Secret) via the standard SAF interface (R_datalib) — the terminology below
// is intentionally product-neutral rather than RACF-specific.
// ---------------------------------------------------------------------------

/** Certificate usage. */
export type CertificateUsage = 'PERSONAL' | 'CERTAUTH';

/** Certificate trust status. */
export type CertificateTrustStatus = 'TRUST' | 'HIGHTRUST' | 'NOTRUST';

/**
 * The exact SAF return/reason codes behind a warning or error, preserved
 * alongside the natural-language message. These come from the underlying
 * R_datalib call and apply the same way regardless of security product
 * (RACF, ACF2, or Top Secret).
 */
export interface SafReturnCodes {
  /** R_datalib function code (e.g. 0x08 DataPut, 0x09 DataRemove). */
  functionCode: number;
  /** SAF return code. */
  safReturnCode: number;
  /** Security product return code. */
  productReturnCode: number;
  /** Security product reason code. */
  productReasonCode: number;
}

/**
 * Result of a certificate/key ring action that has no other data to return.
 * `success` may be true alongside a non-fatal `warning` (e.g. a duplicate
 * label was ignored).
 */
export interface CertActionResult {
  /** Human-readable note for a non-fatal warning, when one occurred. */
  warning?: string;
  /** SAF codes behind a warning or error, when a non-zero code was returned. */
  safReturnCodes?: SafReturnCodes;
  /** System SSL / GSKCMS status code, when a GSK call failed. */
  gskReturnCode?: number;
}

/** Options for connecting a certificate to a key ring. */
export interface ConnectCertificateOptions {
  /** Certificate owner (user ID). */
  owner: string;
  /** Target key ring name. */
  keyring: string;
  /** Certificate label. */
  label: string;
  /** Source key ring the certificate is already on (its bytes are read from here). Mutually exclusive with `fromDatabase`. */
  fromRing?: string;
  /** Read the certificate from the security database instead of a specific ring (use when the certificate is not connected to any ring). Mutually exclusive with `fromRing`. */
  fromDatabase?: boolean;
  /** Certificate usage (default: the certificate's current usage). */
  usage?: CertificateUsage;
  /** Set this certificate as the target ring's default. */
  isDefault?: boolean;
}

/** Options for deleting/disconnecting a certificate. */
export interface DeleteCertificateOptions {
  /** Certificate owner (user ID). */
  owner: string;
  /** Certificate label. */
  label: string;
  /** Key ring to disconnect the certificate from. Omit and set `database: true` to delete the certificate from the security database instead. */
  keyring?: string;
  /** Delete the certificate from the security database (removes it entirely, not just from one ring). Mutually exclusive with `keyring`. */
  database?: boolean;
  /** Do not automatically refresh the DIGTCERT class if the security product reports it is required for the change to take effect (default is to refresh). */
  skipRefresh?: boolean;
}

/** Options for exporting a certificate from a key ring. */
export interface ExportCertificateOptions {
  /** Key ring owner (user ID). */
  owner: string;
  /** Key ring name. */
  keyring: string;
  /** Certificate label. */
  label: string;
  /** Export format: "pem" (certificate) or "p12" (certificate + private key). Default "pem". */
  format?: string;
  /** Output file path on z/OS (required for "p12"; "pem" is returned inline when omitted). */
  file?: string;
  /** PKCS#12 passphrase (used with format "p12"). */
  password?: string;
}

/** Result of exporting a certificate. */
export interface ExportCertificateResult {
  /** Certificate label. */
  label: string;
  /** Key ring owner (user ID). */
  owner: string;
  /** Key ring name. */
  keyring: string;
  /** Export format that was produced ("pem" or "p12"). */
  format: string;
  /** Output file path, when written to disk on z/OS. */
  file?: string;
  /** Number of bytes written to the output file. */
  bytesWritten?: number;
  /** Exported certificate text (PEM), when not written to a file. */
  data?: string;
}

/** Options for importing a certificate into a key ring from a PKCS#12 file already on z/OS. */
export interface ImportCertificateOptions {
  /** Key ring owner (user ID). */
  owner: string;
  /** Key ring name. */
  keyring: string;
  /** Certificate label to assign (used only when the certificate is new to the security database). */
  label: string;
  /** Certificate usage. */
  usage: CertificateUsage;
  /** Path to the source PKCS#12 file on z/OS. */
  file: string;
  /** PKCS#12 passphrase. */
  password: string;
  /** Do not automatically refresh the DIGTCERT class if the security product reports it is required (default is to refresh). */
  skipRefresh?: boolean;
}

/** Result of importing a certificate. */
export interface ImportCertificateResult extends CertActionResult {
  /** Certificate label. */
  label: string;
  /** Key ring owner (user ID). */
  owner: string;
  /** Key ring name. */
  keyring: string;
}

/** Options for showing detailed certificate information. */
export interface ShowCertificateOptions {
  /** Key ring owner (user ID). */
  owner: string;
  /** Key ring name. */
  keyring: string;
  /** Certificate label. */
  label: string;
}

/** Detailed certificate information. */
export interface ShowCertificateResult {
  /** Certificate label. */
  label: string;
  /** Owning user ID. */
  owner: string;
  /** Usage: PERSONAL, CERTAUTH, or OTHER. */
  usage: string;
  /** Trust status: TRUST, HIGHTRUST, NOTRUST, or UNKNOWN. */
  status: string;
  /** Whether this certificate is the ring's default. */
  isDefault: boolean;
  /** Private-key type code. */
  keyType: number;
  /** Private-key size in bits (0 if no private key). */
  keySize: number;
  /** Certificate serial number (hex), from decoding the certificate. */
  serialNumber?: string;
  /** Validity start (ISO-8601), from decoding the certificate. */
  notBefore?: string;
  /** Validity end (ISO-8601), from decoding the certificate. */
  notAfter?: string;
  /** Security-database record ID (serial + issuer identifier). */
  recordId?: string;
}

/** Options for setting a certificate as a key ring's default. */
export interface SetDefaultCertificateOptions {
  /** Key ring owner (user ID). */
  owner: string;
  /** Key ring name. */
  keyring: string;
  /** Certificate label. */
  label: string;
}

/** Options for changing a certificate's trust status. */
export interface TrustCertificateOptions {
  /** Certificate owner (user ID). */
  owner: string;
  /** Certificate label. */
  label: string;
  /** New trust status. HIGHTRUST is honored only for CERTAUTH certificates. */
  status: CertificateTrustStatus;
}

/** Options for renaming a certificate's label. */
export interface RenameCertificateOptions {
  /** Certificate owner (user ID). */
  owner: string;
  /** Current certificate label. */
  label: string;
  /** New certificate label. */
  newLabel: string;
}

// ---------------------------------------------------------------------------
// Backend interface
// ---------------------------------------------------------------------------

/**
 * Backend-agnostic interface for z/OS data set operations.
 *
 * All methods accept a `systemId` to identify the target z/OS system.
 * The backend implementation resolves credentials and connection details
 * internally.
 */
export interface ZosBackend {
  /**
   * List data sets matching a pattern.
   *
   * The pattern follows z/OS conventions:
   * - `*` matches any characters within a single qualifier
   * - `**` matches any number of qualifiers
   *
   * When `attributes` is false, backends may return only dsn (and volser if needed for
   * resource links); when true or omitted, return full attributes when supported.
   *
   * @param systemId - Target z/OS system.
   * @param pattern - Data set name pattern (e.g. `"USER.*"`).
   * @param volser - Optional volume serial for uncataloged data sets.
   * @param userId - Optional user ID (for backends that need it, e.g. SSH per-user session).
   * @param attributes - When false, return only data set names; when true or omitted, include attributes when supported.
   */
  listDatasets(
    systemId: SystemId,
    pattern: string,
    volser?: string,
    userId?: string,
    attributes?: boolean,
    progress?: BackendProgressCallback
  ): Promise<DatasetEntry[]>;

  /**
   * List members of a PDS or PDS/E.
   *
   * Member name pattern wildcards (when pattern is provided):
   * - `*` — zero or more characters
   * - `%` — exactly one character
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified PDS or PDS/E name.
   * @param pattern - Optional member name filter pattern (e.g. "ABC*", "A%C").
   */
  listMembers(
    systemId: SystemId,
    dsn: string,
    pattern?: string,
    progress?: BackendProgressCallback
  ): Promise<MemberEntry[]>;

  /**
   * Read the content of a sequential data set or PDS or PDS/E member.
   *
   * Returned text is always UTF-8 (local/client encoding). The optional
   * encoding parameter is the mainframe (source) EBCDIC encoding used to
   * convert to UTF-8. When not provided, the tool layer supplies the resolved
   * value (system override or MCP server default).
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified data set name.
   * @param member - Member name (for PDS or PDS/E).
   * @param encoding - Mainframe EBCDIC encoding (resolved by tool layer when omitted).
   */
  readDataset(
    systemId: SystemId,
    dsn: string,
    member?: string,
    encoding?: string,
    progress?: BackendProgressCallback
  ): Promise<ReadDatasetResult>;

  /**
   * Write content to a sequential data set or PDS or PDS/E member.
   *
   * Content is provided as UTF-8 text. The backend converts to the
   * target encoding. When not provided, the tool layer supplies the
   * resolved value (system override or MCP server default).
   *
   * When both startLine and endLine are provided, the backend replaces the
   * block of records from startLine to endLine (1-based, inclusive) with the
   * given content; the number of lines in content need not match (data set can
   * grow or shrink). When only startLine is provided, the block replaced
   * has the same number of lines as content. When both are omitted, the
   * entire data set or member is replaced.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified data set name.
   * @param content - UTF-8 text content to write.
   * @param member - Member name (for PDS or PDS/E).
   * @param etag - Optional ETag for optimistic locking.
   * @param encoding - Target mainframe EBCDIC encoding (resolved by tool layer when omitted).
   * @param startLine - Optional 1-based first line of the block to replace.
   * @param endLine - Optional 1-based last line of the block to replace (inclusive); when provided with startLine, the block size can differ from the number of lines in content.
   * @param progress - Optional progress callback.
   * @throws If `etag` is provided and does not match the current version.
   */
  writeDataset(
    systemId: SystemId,
    dsn: string,
    content: string,
    member?: string,
    etag?: string,
    encoding?: string,
    startLine?: number,
    endLine?: number,
    progress?: BackendProgressCallback
  ): Promise<WriteDatasetResult>;

  /**
   * Create a new data set.
   *
   * Returns the attributes actually applied (which may differ from the request
   * due to defaults or SMS) and messages describing any defaults or SMS decisions.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified data set name.
   * @param options - Data set creation options (type, recfm, lrecl, etc.).
   */
  createDataset(
    systemId: SystemId,
    dsn: string,
    options: CreateDatasetOptions,
    progress?: BackendProgressCallback
  ): Promise<CreateDatasetResult>;

  /**
   * Delete a data set or a specific PDS or PDS/E member.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified data set name.
   * @param member - If provided, delete only this member.
   */
  deleteDataset(
    systemId: SystemId,
    dsn: string,
    member?: string,
    progress?: BackendProgressCallback
  ): Promise<void>;

  /**
   * Get detailed attributes of a data set.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified data set name.
   */
  getAttributes(
    systemId: SystemId,
    dsn: string,
    progress?: BackendProgressCallback
  ): Promise<DatasetAttributes>;

  /**
   * Copy a data set or member within a single system.
   *
   * @param systemId - Target z/OS system.
   * @param sourceDsn - Source data set name.
   * @param targetDsn - Target data set name.
   * @param sourceMember - Source member name (for PDS or PDS/E).
   * @param targetMember - Target member name (for PDS or PDS/E).
   */
  copyDataset(
    systemId: SystemId,
    sourceDsn: string,
    targetDsn: string,
    sourceMember?: string,
    targetMember?: string,
    progress?: BackendProgressCallback
  ): Promise<void>;

  /**
   * Rename a data set or PDS or PDS/E member.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Current data set name.
   * @param newDsn - New data set name.
   * @param member - Current member name (for member rename).
   * @param newMember - New member name (for member rename).
   */
  renameDataset(
    systemId: SystemId,
    dsn: string,
    newDsn: string,
    member?: string,
    newMember?: string,
    progress?: BackendProgressCallback
  ): Promise<void>;

  /**
   * Search for a string in a sequential data set or PDS or PDS/E (all members or one member).
   * Returns matching lines with line numbers and a summary.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified data set name.
   * @param options - Search string, optional member, and parms (process options).
   */
  searchInDataset(
    systemId: SystemId,
    dsn: string,
    options: SearchInDatasetOptions,
    progress?: BackendProgressCallback
  ): Promise<SearchInDatasetResult>;

  // -------------------------------------------------------------------------
  // USS operations
  // -------------------------------------------------------------------------

  /**
   * List files and directories in a USS path.
   *
   * @param systemId - Target z/OS system.
   * @param path - USS path (e.g. /u/myuser).
   * @param options - Include hidden, long format, depth, maxItems.
   * @param userId - Optional user ID for backends that need it.
   */
  listUssFiles(
    systemId: SystemId,
    path: string,
    options?: ListUssFilesOptions,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<UssFileEntry[]>;

  /**
   * Read the content of a USS file as UTF-8 text.
   *
   * @param systemId - Target z/OS system.
   * @param path - USS file path.
   * @param encoding - Optional mainframe encoding (resolved by tool layer when omitted).
   * @param userId - Optional user ID.
   */
  readUssFile(
    systemId: SystemId,
    path: string,
    encoding?: string,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<ReadUssFileResult>;

  /**
   * Write content to a USS file (creates or overwrites).
   *
   * @param systemId - Target z/OS system.
   * @param path - USS file path.
   * @param content - UTF-8 text content.
   * @param etag - Optional ETag for optimistic locking.
   * @param encoding - Optional mainframe encoding.
   * @param userId - Optional user ID.
   */
  writeUssFile(
    systemId: SystemId,
    path: string,
    content: string,
    etag?: string,
    encoding?: string,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<WriteUssFileResult>;

  /**
   * Create a USS file or directory.
   *
   * @param systemId - Target z/OS system.
   * @param path - USS path to create.
   * @param options - isDirectory and optional permissions.
   * @param userId - Optional user ID.
   */
  createUssFile(
    systemId: SystemId,
    path: string,
    options: CreateUssFileOptions,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<void>;

  /**
   * Delete a USS file or directory.
   *
   * @param systemId - Target z/OS system.
   * @param path - USS path to delete.
   * @param recursive - If true, delete directory and contents.
   * @param userId - Optional user ID.
   */
  deleteUssFile(
    systemId: SystemId,
    path: string,
    recursive?: boolean,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<void>;

  /**
   * Change permissions of a USS file or directory.
   *
   * @param systemId - Target z/OS system.
   * @param path - USS path.
   * @param mode - Octal mode (e.g. "755").
   * @param recursive - If true, change recursively.
   * @param userId - Optional user ID.
   */
  chmodUssFile(
    systemId: SystemId,
    path: string,
    mode: string,
    recursive?: boolean,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<void>;

  /**
   * Change owner of a USS file or directory.
   *
   * @param systemId - Target z/OS system.
   * @param path - USS path.
   * @param owner - New owner.
   * @param recursive - If true, change recursively.
   * @param userId - Optional user ID (must be allowed to chown).
   */
  chownUssFile(
    systemId: SystemId,
    path: string,
    owner: string,
    recursive?: boolean,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<void>;

  /**
   * Set the z/OS file tag (encoding/type) for a USS file or directory.
   *
   * @param systemId - Target z/OS system.
   * @param path - USS path.
   * @param tag - New tag (e.g. ISO8859-1).
   * @param recursive - If true, set recursively.
   * @param userId - Optional user ID.
   */
  chtagUssFile(
    systemId: SystemId,
    path: string,
    tag: string,
    recursive?: boolean,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<void>;

  /**
   * Copy a USS file or directory.
   *
   * @param systemId - Target z/OS system.
   * @param sourcePath - Source USS path.
   * @param targetPath - Destination USS path.
   * @param options - Copy options (recursive, followSymlinks, preserveAttributes, force).
   * @param userId - Optional user ID.
   */
  copyUssFile(
    systemId: SystemId,
    sourcePath: string,
    targetPath: string,
    options?: CopyUssFileOptions,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<void>;

  /**
   * Run a Unix command on the z/OS system and return stdout as a string.
   *
   * @param systemId - Target z/OS system.
   * @param commandText - The command line to execute.
   * @param userId - Optional user ID.
   */
  runUnixCommand(
    systemId: SystemId,
    commandText: string,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<string>;

  /**
   * Run a TSO command on the z/OS system and return the command output as a string.
   *
   * @param systemId - Target z/OS system.
   * @param commandText - The TSO command to execute.
   * @param userId - Optional user ID.
   */
  runTsoCommand(
    systemId: SystemId,
    commandText: string,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<string>;

  /**
   * Run a z/OS console command and return the command response as a string.
   *
   * @param systemId - Target z/OS system.
   * @param commandText - The console command to execute (e.g. "D T", "D A,L").
   * @param consoleName - Optional console name.
   * @param userId - Optional user ID.
   */
  runConsoleCommand(
    systemId: SystemId,
    commandText: string,
    consoleName?: string,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<string>;

  /**
   * Restore (recall) a migrated data set from HSM.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified data set name.
   */
  restoreDataset(
    systemId: SystemId,
    dsn: string,
    progress?: BackendProgressCallback
  ): Promise<void>;

  // -------------------------------------------------------------------------
  // System information operations (read-only)
  // -------------------------------------------------------------------------

  /**
   * List the APF-authorized libraries (data sets) on the system.
   *
   * @param systemId - Target z/OS system.
   * @param userId - Optional user ID (for backends that select a connection by user).
   */
  listApfLibraries(
    systemId: SystemId,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<ListApfResult>;

  /**
   * List the PROCLIB concatenation on the system.
   *
   * @param systemId - Target z/OS system.
   * @param userId - Optional user ID (for backends that select a connection by user).
   */
  listProclib(
    systemId: SystemId,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<ListProclibResult>;

  /**
   * List the link list (LNKLST) concatenation on the system.
   *
   * @param systemId - Target z/OS system.
   * @param userId - Optional user ID (for backends that select a connection by user).
   */
  listLinklist(
    systemId: SystemId,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<ListLinklistResult>;

  /**
   * Read the z/OS SYSLOG (operations log).
   *
   * @param systemId - Target z/OS system.
   * @param options - Start window (date/time or secondsAgo) and maxLines.
   * @param userId - Optional user ID (for backends that select a connection by user).
   */
  viewSyslog(
    systemId: SystemId,
    options?: ViewSyslogOptions,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<ViewSyslogResult>;

  // -------------------------------------------------------------------------
  // Certificate / key ring operations (security database: RACF, ACF2, or Top
  // Secret via SAF)
  // -------------------------------------------------------------------------

  /**
   * Connect a certificate to a key ring, reading its bytes from another ring
   * (`fromRing`) or the security database (`fromDatabase`).
   *
   * @param systemId - Target z/OS system.
   * @param options - Owner, target keyring, label, and source (fromRing or fromDatabase).
   */
  connectCertificate(
    systemId: SystemId,
    options: ConnectCertificateOptions,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<CertActionResult>;

  /**
   * Disconnect a certificate from a key ring, or delete it from the security
   * database entirely (`options.database`).
   *
   * @param systemId - Target z/OS system.
   * @param options - Owner, label, and keyring or database.
   */
  deleteCertificate(
    systemId: SystemId,
    options: DeleteCertificateOptions,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<CertActionResult>;

  /**
   * Export a certificate from a key ring as PEM (certificate only) or PKCS#12
   * (certificate plus private key).
   *
   * @param systemId - Target z/OS system.
   * @param options - Owner, keyring, label, format, and optional output file/password.
   */
  exportCertificate(
    systemId: SystemId,
    options: ExportCertificateOptions,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<ExportCertificateResult>;

  /**
   * Import a certificate (and its private key, when present) into a key ring
   * from a PKCS#12 file that already resides on z/OS.
   *
   * @param systemId - Target z/OS system.
   * @param options - Owner, keyring, label, usage, source file, and password.
   */
  importCertificate(
    systemId: SystemId,
    options: ImportCertificateOptions,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<ImportCertificateResult>;

  /**
   * Show detailed information for a certificate in a key ring: owner, usage,
   * trust status, default flag, key size, serial number, and validity dates.
   *
   * @param systemId - Target z/OS system.
   * @param options - Owner, keyring, and label.
   */
  showCertificate(
    systemId: SystemId,
    options: ShowCertificateOptions,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<ShowCertificateResult>;

  /**
   * Set a certificate that is already connected to a key ring as that ring's
   * default certificate.
   *
   * @param systemId - Target z/OS system.
   * @param options - Owner, keyring, and label.
   */
  setDefaultCertificate(
    systemId: SystemId,
    options: SetDefaultCertificateOptions,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<CertActionResult>;

  /**
   * Change a certificate's trust status. A key ring is not required; the
   * certificate is identified by owner and label.
   *
   * @param systemId - Target z/OS system.
   * @param options - Owner, label, and new trust status.
   */
  trustCertificate(
    systemId: SystemId,
    options: TrustCertificateOptions,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<CertActionResult>;

  /**
   * Change a certificate's label. A key ring is not required; the
   * certificate is identified by owner and current label.
   *
   * @param systemId - Target z/OS system.
   * @param options - Owner, current label, and new label.
   */
  renameCertificate(
    systemId: SystemId,
    options: RenameCertificateOptions,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<CertActionResult>;

  /**
   * Refresh the DIGTCERT class so that certificate and key ring changes take effect.
   *
   * @param systemId - Target z/OS system.
   * @param userId - Optional user ID (for backends that select a connection by user).
   */
  refreshCertificateClass(
    systemId: SystemId,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<CertActionResult>;

  /**
   * Get the USS home directory path for a user on the system.
   * Native backend uses `uss.issueCmd('echo $HOME')`.
   *
   * @param systemId - Target z/OS system.
   * @param userId - User ID (default from session context).
   */
  getUssHome(
    systemId: SystemId,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<string>;

  /**
   * Return a unique USS directory path under the given base path that does not exist.
   * Used for temp directories. Backend may use listUssFiles to verify uniqueness.
   *
   * @param systemId - Target z/OS system.
   * @param basePath - Base directory (e.g. $HOME/tmp or /tmp).
   * @param userId - Optional user ID.
   */
  getUssTempDir(
    systemId: SystemId,
    basePath: string,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<string>;

  /**
   * Return a unique USS file path under the given directory that does not exist.
   *
   * @param systemId - Target z/OS system.
   * @param dirPath - Parent directory path.
   * @param prefix - Optional filename prefix.
   * @param userId - Optional user ID.
   */
  getUssTempPath(
    systemId: SystemId,
    dirPath: string,
    prefix?: string,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<string>;

  /**
   * Delete all files and directories under the given USS path (the path itself is removed).
   * Safety constraints (e.g. path must contain "tmp", minimum depth) are enforced by the tool layer.
   *
   * @param systemId - Target z/OS system.
   * @param path - USS path to delete (recursively).
   * @param userId - Optional user ID.
   * @param progress - Optional callback (e.g. before each delete).
   */
  deleteUssUnderPath(
    systemId: SystemId,
    path: string,
    userId?: string,
    progress?: BackendProgressCallback
  ): Promise<{ deleted: string[] }>;

  // -------------------------------------------------------------------------
  // Job operations
  // -------------------------------------------------------------------------

  /**
   * Submit JCL to the system. The JCL must include a complete job card when required by the system.
   *
   * @param systemId - Target z/OS system.
   * @param jcl - Full JCL text (UTF-8) to submit.
   */
  submitJob(
    systemId: SystemId,
    jcl: string,
    progress?: BackendProgressCallback
  ): Promise<SubmitJobResult>;

  /**
   * Get the current status of a job.
   *
   * @param systemId - Target z/OS system.
   * @param jobId - Job ID (e.g. JOB00123).
   */
  getJobStatus(
    systemId: SystemId,
    jobId: string,
    progress?: BackendProgressCallback
  ): Promise<JobStatusResult>;

  /**
   * List output files (spools) for a job. Job must be in OUTPUT status.
   *
   * @param systemId - Target z/OS system.
   * @param jobId - Job ID (e.g. JOB00123).
   */
  listJobFiles(
    systemId: SystemId,
    jobId: string,
    progress?: BackendProgressCallback
  ): Promise<JobFileEntry[]>;

  /**
   * Read the content of one job output file (spool).
   *
   * @param systemId - Target z/OS system.
   * @param jobId - Job ID.
   * @param jobFileId - Job file (spool) ID from listJobFiles.
   * @param progress - Optional progress callback.
   * @param encoding - Optional mainframe encoding (resolved by tool layer when omitted).
   */
  readJobFile(
    systemId: SystemId,
    jobId: string,
    jobFileId: number,
    progress?: BackendProgressCallback,
    encoding?: string
  ): Promise<ReadJobFileResult>;

  /**
   * List jobs (with optional filters).
   *
   * @param systemId - Target z/OS system.
   * @param options - Optional owner, prefix, status, maxItems.
   */
  listJobs(
    systemId: SystemId,
    options?: ListJobsOptions,
    progress?: BackendProgressCallback
  ): Promise<JobEntry[]>;

  /**
   * Get JCL for a job.
   *
   * @param systemId - Target z/OS system.
   * @param jobId - Job ID.
   */
  getJcl(systemId: SystemId, jobId: string, progress?: BackendProgressCallback): Promise<string>;

  /**
   * Cancel a job.
   *
   * @param systemId - Target z/OS system.
   * @param jobId - Job ID.
   */
  cancelJob(systemId: SystemId, jobId: string, progress?: BackendProgressCallback): Promise<void>;

  /**
   * Hold a job.
   *
   * @param systemId - Target z/OS system.
   * @param jobId - Job ID.
   */
  holdJob(systemId: SystemId, jobId: string, progress?: BackendProgressCallback): Promise<void>;

  /**
   * Release a held job.
   *
   * @param systemId - Target z/OS system.
   * @param jobId - Job ID.
   */
  releaseJob(systemId: SystemId, jobId: string, progress?: BackendProgressCallback): Promise<void>;

  /**
   * Delete a job from the output queue.
   *
   * @param systemId - Target z/OS system.
   * @param jobId - Job ID.
   */
  deleteJob(systemId: SystemId, jobId: string, progress?: BackendProgressCallback): Promise<void>;

  /**
   * Submit a job from a data set (e.g. a PDS member containing JCL).
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified data set name (and optional member, e.g. USER.JCL.CNTL(MYJOB)).
   */
  submitJobFromDataset(
    systemId: SystemId,
    dsn: string,
    progress?: BackendProgressCallback
  ): Promise<SubmitJobResult>;

  /**
   * Submit a job from a USS file path.
   *
   * @param systemId - Target z/OS system.
   * @param path - USS path to the JCL file.
   */
  submitJobFromUss(
    systemId: SystemId,
    path: string,
    progress?: BackendProgressCallback
  ): Promise<SubmitJobResult>;
}
