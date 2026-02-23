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
  /** Content as UTF-8 text (local/client encoding). */
  text: string;
  /** ETag for optimistic locking. */
  etag: string;
  /** Mainframe (source) EBCDIC encoding used for conversion to UTF-8. */
  encoding: string;
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
// Search types
// ---------------------------------------------------------------------------

/** A single matching line from a search. */
export interface SearchMatchEntry {
  /** 1-based line number. */
  lineNumber: number;
  /** Line content (UTF-8). */
  content: string;
}

/** Search result for one member: name and matching lines. */
export interface SearchMemberResult {
  /** Member name (or synthetic name for sequential dataset). */
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
  /** Optional member name to limit search to one PDS/PDSE member. */
  member?: string;
  /** SuperC process options string (e.g. "ANYC COBOL"), built from natural options. */
  parms: string;
  /** Mainframe (EBCDIC) encoding for reading dataset content. Resolved by tool layer (operation → system → server default). */
  encoding?: string;
}

/** Full result of a search in a dataset (all members with matches and summary). */
export interface SearchInDatasetResult {
  /** Resolved dataset name. */
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

/** Result of submitting a job (JCL or from dataset/USS). */
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
   * When `attributes` is false, backends may return only dsn (and volser if needed for
   * resource links); when true or omitted, return full attributes when supported.
   *
   * @param systemId - Target z/OS system.
   * @param pattern - Dataset name pattern (e.g. `"USER.*"`).
   * @param volser - Optional volume serial for uncataloged datasets.
   * @param userId - Optional user ID (for backends that need it, e.g. SSH per-user session).
   * @param attributes - When false, return only dataset names; when true or omitted, include attributes when supported.
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
   * List members of a PDS/PDSE.
   *
   * Member name pattern wildcards (when pattern is provided):
   * - `*` — zero or more characters
   * - `%` — exactly one character
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified PDS/PDSE name.
   * @param pattern - Optional member name filter pattern (e.g. "ABC*", "A%C").
   */
  listMembers(
    systemId: SystemId,
    dsn: string,
    pattern?: string,
    progress?: BackendProgressCallback
  ): Promise<MemberEntry[]>;

  /**
   * Read the content of a sequential dataset or PDS/PDSE member.
   *
   * Returned text is always UTF-8 (local/client encoding). The optional
   * encoding parameter is the mainframe (source) EBCDIC encoding used to
   * convert to UTF-8. When not provided, the tool layer supplies the resolved
   * value (system override or MCP server default).
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified dataset name.
   * @param member - Member name (for PDS/PDSE).
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
   * Write content to a sequential dataset or PDS/PDSE member.
   *
   * Content is provided as UTF-8 text. The backend converts to the
   * target encoding. When not provided, the tool layer supplies the
   * resolved value (system override or MCP server default).
   *
   * When both startLine and endLine are provided, the backend replaces the
   * block of records from startLine to endLine (1-based, inclusive) with the
   * given content; the number of lines in content need not match (dataset can
   * grow or shrink). When only startLine is provided, the block replaced
   * has the same number of lines as content. When both are omitted, the
   * entire dataset or member is replaced.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified dataset name.
   * @param content - UTF-8 text content to write.
   * @param member - Member name (for PDS/PDSE).
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
    options: CreateDatasetOptions,
    progress?: BackendProgressCallback
  ): Promise<CreateDatasetResult>;

  /**
   * Delete a dataset or a specific PDS/PDSE member.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified dataset name.
   * @param member - If provided, delete only this member.
   */
  deleteDataset(
    systemId: SystemId,
    dsn: string,
    member?: string,
    progress?: BackendProgressCallback
  ): Promise<void>;

  /**
   * Get detailed attributes of a dataset.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified dataset name.
   */
  getAttributes(
    systemId: SystemId,
    dsn: string,
    progress?: BackendProgressCallback
  ): Promise<DatasetAttributes>;

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
    targetMember?: string,
    progress?: BackendProgressCallback
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
    newMember?: string,
    progress?: BackendProgressCallback
  ): Promise<void>;

  /**
   * Search for a string in a sequential dataset or PDS/PDSE (all members or one member).
   * Returns matching lines with line numbers and a summary.
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified dataset name.
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
   * Get the USS home directory path for a user on the system.
   * Native backend uses echo $HOME when ZNP supports unixCommand.
   * If not implemented, the tool layer may use runUnixCommand('echo $HOME') and cache the result.
   * Note: TSO "OSHELL cmd" fails with rc 255 in ZNP, so it is not used for home resolution.
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
   * Submit a job from a dataset (e.g. a PDS member containing JCL).
   *
   * @param systemId - Target z/OS system.
   * @param dsn - Fully-qualified dataset name (and optional member, e.g. USER.JCL.CNTL(MYJOB)).
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
