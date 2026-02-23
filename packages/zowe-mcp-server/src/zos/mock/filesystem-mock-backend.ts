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
 * Filesystem-backed mock implementation of {@link ZosBackend}.
 *
 * Uses a local directory that mirrors the z/OS dataset namespace with
 * a DSFS-inspired layout:
 *
 * ```
 * zowe-mcp-mock-data/
 *   systems.json
 *   sys1.example.com/
 *     USER/                     # HLQ directory
 *       SRC.COBOL/                 # PDS/PDSE → directory
 *         HELLO.cbl               # member → file
 *       LOAD.JCL                  # sequential dataset → file
 * ```
 *
 * Metadata is stored in `_meta.json` files alongside datasets.
 * ETags are derived from file modification timestamps.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getLogger } from '../../server.js';
import type {
  BackendProgressCallback,
  CreateDatasetApplied,
  CreateDatasetOptions,
  CreateDatasetResult,
  CreateUssFileOptions,
  DatasetAttributes,
  DatasetEntry,
  DatasetOrg,
  JobStatusResult,
  ListUssFilesOptions,
  MemberEntry,
  ReadDatasetResult,
  ReadUssFileResult,
  RecordFormat,
  SearchInDatasetOptions,
  SearchInDatasetResult,
  SubmitJobResult,
  UssFileEntry,
  WriteDatasetResult,
  WriteUssFileResult,
  ZosBackend,
} from '../backend.js';
import { memberPatternToRegExp } from '../member-pattern.js';
import { runSearchWithListAndRead } from '../search-runner.js';
import type { SystemId } from '../system.js';
import type { MockDatasetMeta } from './mock-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a fully-qualified dataset name to a filesystem path relative
 * to the system directory.
 *
 * `USER.SRC.COBOL` → `USER/SRC.COBOL`
 *
 * The first qualifier (HLQ) becomes a directory; the remaining qualifiers
 * stay dot-separated as the file/directory name within the HLQ directory.
 */
function dsnToRelPath(dsn: string): string {
  const upper = dsn.toUpperCase();
  const dotIdx = upper.indexOf('.');
  if (dotIdx === -1) {
    // Single-qualifier name — just the HLQ directory itself
    return upper;
  }
  const hlq = upper.slice(0, dotIdx);
  const rest = upper.slice(dotIdx + 1);
  return path.join(hlq, rest);
}

/** Compute an ETag from a file's mtime. */
function computeEtag(mtimeMs: number): string {
  return createHash('md5').update(String(mtimeMs)).digest('hex');
}

/** Read and parse a `_meta.json` file, returning `undefined` if not found. */
async function readMeta(metaPath: string): Promise<MockDatasetMeta | undefined> {
  try {
    const raw = await fs.readFile(metaPath, 'utf-8');
    return JSON.parse(raw) as MockDatasetMeta;
  } catch {
    return undefined;
  }
}

/** Check if a path is a directory. */
async function isDirectory(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/** Check if a path exists. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Match a dataset name against a z/OS-style pattern.
 *
 * - `*` matches any characters within a single qualifier
 * - `**` matches any number of qualifiers
 * - A trailing `*` as the last qualifier (e.g. `USER.*`) is treated
 *   as `**` — matching across any number of remaining qualifiers.
 *   This follows the standard ISPF 3.4 convention where `USER.*`
 *   lists all datasets under the USER HLQ.
 */
export function matchPattern(dsn: string, pattern: string): boolean {
  const qualifiers = pattern.split('.');

  // Trailing lone `*` → treat as `**` (match any remaining qualifiers)
  if (qualifiers.length >= 2 && qualifiers[qualifiers.length - 1] === '*') {
    qualifiers[qualifiers.length - 1] = '**';
  }

  // Convert z/OS pattern to regex
  const regexStr = qualifiers
    .map(q => {
      if (q === '**') return '.*';
      // Replace * with [^.]* (match within qualifier)
      return q.replace(/\*/g, '[^.]*');
    })
    .join('\\.');

  const regex = new RegExp(`^${regexStr}$`, 'i');
  return regex.test(dsn);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class FilesystemMockBackend implements ZosBackend {
  constructor(private readonly mockDir: string) {}

  /** Resolve the filesystem path for a system's data directory. */
  private systemDir(systemId: SystemId): string {
    return path.join(this.mockDir, systemId);
  }

  /** Resolve the filesystem path for a dataset (file or directory). */
  private datasetPath(systemId: SystemId, dsn: string): string {
    return path.join(this.systemDir(systemId), dsnToRelPath(dsn));
  }

  /** Resolve the filesystem path for a USS path (e.g. /u/myuser -> mockDir/uss/systemId/u/myuser). */
  private ussPath(systemId: SystemId, ussPath: string): string {
    const normalized = ussPath.replace(/\/+/g, '/').replace(/^\//, '').trim() || '';
    return path.join(this.mockDir, 'uss', systemId, normalized);
  }

  async listDatasets(
    systemId: SystemId,
    pattern: string,
    volser?: string,
    userId?: string,
    attributes?: boolean,
    _progress?: BackendProgressCallback
  ): Promise<DatasetEntry[]> {
    void [volser, userId, _progress];
    const sysDir = this.systemDir(systemId);
    if (!(await pathExists(sysDir))) {
      return [];
    }

    const results: DatasetEntry[] = [];
    const includeAttrs = attributes !== false;

    // Walk HLQ directories
    const hlqDirs = await fs.readdir(sysDir);
    for (const hlq of hlqDirs) {
      const hlqPath = path.join(sysDir, hlq);
      if (!(await isDirectory(hlqPath))) continue;
      // Skip hidden files and systems.json
      if (hlq.startsWith('.') || hlq.endsWith('.json')) continue;

      const entries = await fs.readdir(hlqPath);
      for (const entry of entries) {
        if (entry === '_meta.json' || entry.endsWith('_meta.json') || entry.startsWith('.'))
          continue;

        const dsn = `${hlq}.${entry}`.toUpperCase();
        const fullPath = path.join(hlqPath, entry);

        if (!matchPattern(dsn, pattern)) continue;

        if (!includeAttrs) {
          results.push({ dsn });
          continue;
        }

        const isDir = await isDirectory(fullPath);
        const metaPath = isDir
          ? path.join(fullPath, '_meta.json')
          : path.join(hlqPath, `${entry}_meta.json`);
        const meta = await readMeta(metaPath);

        results.push({
          dsn: meta?.dsn ?? dsn,
          dsorg: (meta?.dsorg as DatasetOrg | undefined) ?? (isDir ? 'PO-E' : 'PS'),
          recfm: (meta?.recfm as RecordFormat | undefined) ?? 'FB',
          lrecl: meta?.lrecl ?? 80,
          blksz: meta?.blksz ?? 27920,
          volser: meta?.volser ?? 'VOL001',
          creationDate: meta?.creationDate,
        });
      }
    }

    return results.sort((a, b) => a.dsn.localeCompare(b.dsn));
  }

  async listMembers(
    systemId: SystemId,
    dsn: string,
    pattern?: string,
    _progress?: BackendProgressCallback
  ): Promise<MemberEntry[]> {
    void _progress;
    const dsPath = this.datasetPath(systemId, dsn);
    if (!(await isDirectory(dsPath))) {
      throw new Error(
        `Dataset '${dsn}' is not a PDS/PDSE on ${systemId}, or does not exist. ` +
          'Only partitioned datasets have members.'
      );
    }

    const entries = await fs.readdir(dsPath);
    const members: MemberEntry[] = [];

    for (const entry of entries) {
      if (entry === '_meta.json' || entry.startsWith('.')) continue;
      const entryPath = path.join(dsPath, entry);
      if (await isDirectory(entryPath)) continue;

      // Strip file extension to get member name
      const memberName = path.parse(entry).name.toUpperCase();

      if (pattern) {
        const regex = memberPatternToRegExp(pattern);
        if (regex && !regex.test(memberName)) continue;
      }

      members.push({ name: memberName });
    }

    return members.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Reads dataset content. Result is always UTF-8. Mainframe encoding is ignored in mock (files are UTF-8).
   */
  async readDataset(
    systemId: SystemId,
    dsn: string,
    member?: string,
    encoding?: string,
    _progress?: BackendProgressCallback
  ): Promise<ReadDatasetResult> {
    void _progress;
    const dsPath = this.datasetPath(systemId, dsn);
    let filePath: string;

    if (member) {
      // PDS/PDSE member — find the file in the dataset directory
      const found = await this.findMemberFile(dsPath, member);
      if (!found) {
        throw new Error(
          `Member '${member}' not found in dataset '${dsn}' on ${systemId}. ` +
            'Use listMembers to see available members.'
        );
      }
      filePath = found;
    } else {
      // Sequential dataset — the dataset itself is a file
      if (await isDirectory(dsPath)) {
        throw new Error(
          `Dataset '${dsn}' is a PDS/PDSE on ${systemId}. ` +
            'Specify a member name to read, or use listMembers to see available members.'
        );
      }
      if (!(await pathExists(dsPath))) {
        throw new Error(
          `Dataset '${dsn}' not found on ${systemId}. ` +
            'Use listDatasets to see available datasets.'
        );
      }
      filePath = dsPath;
    }

    const text = await fs.readFile(filePath, 'utf-8');
    const stat = await fs.stat(filePath);
    const etag = computeEtag(stat.mtimeMs);

    return {
      text,
      etag,
      encoding: encoding ?? 'IBM-1047',
    };
  }

  async writeDataset(
    systemId: SystemId,
    dsn: string,
    content: string,
    member?: string,
    etag?: string,
    encoding?: string,
    startLine?: number,
    endLine?: number,
    _progress?: BackendProgressCallback
  ): Promise<WriteDatasetResult> {
    void _progress;
    const dsPath = this.datasetPath(systemId, dsn);
    let filePath: string;

    if (member) {
      // Ensure the PDS directory exists
      if (!(await pathExists(dsPath))) {
        throw new Error(
          `Dataset '${dsn}' not found on ${systemId}. ` +
            'Create the dataset first with createDataset.'
        );
      }
      const found = await this.findMemberFile(dsPath, member);
      filePath = found ?? path.join(dsPath, `${member.toUpperCase()}.cbl`);
    } else {
      if (await isDirectory(dsPath)) {
        throw new Error(
          `Dataset '${dsn}' is a PDS/PDSE on ${systemId}. ` + 'Specify a member name to write.'
        );
      }
      filePath = dsPath;
    }

    if (startLine != null) {
      // Replace a block of records: read, replace line range, write.
      let currentText: string;
      try {
        currentText = await fs.readFile(filePath, 'utf-8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          currentText = '';
        } else {
          throw err;
        }
      }
      if (etag && currentText !== '') {
        const stat = await fs.stat(filePath);
        const currentEtag = computeEtag(stat.mtimeMs);
        if (currentEtag !== etag) {
          throw new Error(
            'Write failed: dataset was modified since your last read (ETag mismatch). ' +
              'Re-read the dataset to get the latest content and ETag before writing.'
          );
        }
      }
      const lines = currentText.split(/\r?\n/);
      const contentLines = content.split(/\r?\n/);
      const startIdx = startLine - 1;

      if (endLine != null) {
        // Replace [startLine, endLine] (inclusive) with content; line count need not match.
        const endIdx = Math.min(endLine - 1, lines.length - 1);
        const removeCount = Math.max(0, endIdx - startIdx + 1);
        while (lines.length < startIdx) {
          lines.push('');
        }
        lines.splice(startIdx, removeCount, ...contentLines);
      } else {
        // Replace N lines starting at startLine with N lines from content (backward compat).
        const N = contentLines.length;
        while (lines.length < startIdx + N) {
          lines.push('');
        }
        for (let i = 0; i < N; i++) {
          lines[startIdx + i] = contentLines[i];
        }
      }
      content = lines.join('\n');
    } else {
      // Full replace: ETag check for optimistic locking
      if (etag) {
        try {
          const stat = await fs.stat(filePath);
          const currentEtag = computeEtag(stat.mtimeMs);
          if (currentEtag !== etag) {
            throw new Error(
              'Write failed: dataset was modified since your last read (ETag mismatch). ' +
                'Re-read the dataset to get the latest content and ETag before writing.'
            );
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw err;
          }
          // File doesn't exist yet — ETag check is irrelevant for new files
        }
      }
    }

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');

    const stat = await fs.stat(filePath);
    return {
      etag: computeEtag(stat.mtimeMs),
    };

    // encoding is ignored in mock mode (files are stored as UTF-8)
    void encoding;
  }

  async createDataset(
    systemId: SystemId,
    dsn: string,
    options: CreateDatasetOptions,
    _progress?: BackendProgressCallback
  ): Promise<CreateDatasetResult> {
    void _progress;
    const dsPath = this.datasetPath(systemId, dsn);

    if (await pathExists(dsPath)) {
      throw new Error(
        `Dataset '${dsn}' already exists on ${systemId}. ` +
          'Delete it first if you want to recreate it.'
      );
    }

    const DEFAULT_RECFM: RecordFormat = 'FB';
    const DEFAULT_LRECL = 80;
    const DEFAULT_BLKSZ = 27920;
    const MOCK_VOLSER = 'VOL001';
    const DEFAULT_DIRBLK = 5;

    const appliedRecfm = options.recfm ?? DEFAULT_RECFM;
    const appliedLrecl = options.lrecl ?? DEFAULT_LRECL;
    const appliedBlksz = options.blksz ?? DEFAULT_BLKSZ;
    // PDS (PO) uses directory blocks; PDSE (PO-E) does not — match native.
    const appliedDirblk = options.type === 'PO' ? (options.dirblk ?? DEFAULT_DIRBLK) : undefined;

    const messages: string[] = [];
    if (options.recfm === undefined) {
      messages.push(`recfm defaulted to ${appliedRecfm}.`);
    }
    if (options.lrecl === undefined) {
      messages.push(`lrecl defaulted to ${appliedLrecl}.`);
    }
    if (options.blksz === undefined) {
      messages.push(`blksz defaulted to ${appliedBlksz}.`);
    }
    messages.push(`Volume ${MOCK_VOLSER} assigned by storage.`);
    if (options.type === 'PO') {
      if (options.dirblk === undefined) {
        messages.push(`dirblk defaulted to ${appliedDirblk} for partitioned dataset.`);
      }
    }
    if (options.primary !== undefined || options.secondary !== undefined) {
      messages.push('Primary/secondary space request not applied in mock (filesystem layout).');
    }

    if (options.type === 'PO' || options.type === 'PO-E') {
      await fs.mkdir(dsPath, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(dsPath), { recursive: true });
      await fs.writeFile(dsPath, '', 'utf-8');
    }

    const meta: MockDatasetMeta = {
      dsn,
      dsorg: options.type,
      recfm: appliedRecfm,
      lrecl: appliedLrecl,
      blksz: appliedBlksz,
      volser: MOCK_VOLSER,
      creationDate: new Date().toISOString().slice(0, 10),
    };

    const metaPath =
      options.type === 'PO' || options.type === 'PO-E'
        ? path.join(dsPath, '_meta.json')
        : path.join(path.dirname(dsPath), `${path.basename(dsPath)}_meta.json`);

    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

    // Same applied shape as native: primary/secondary always present (may be undefined).
    const applied: CreateDatasetApplied = {
      dsorg: options.type,
      recfm: appliedRecfm,
      lrecl: appliedLrecl,
      blksz: appliedBlksz,
      volser: MOCK_VOLSER,
      dirblk: appliedDirblk,
      primary: options.primary,
      secondary: options.secondary,
    };
    return { applied, messages };
  }

  async deleteDataset(
    systemId: SystemId,
    dsn: string,
    member?: string,
    _progress?: BackendProgressCallback
  ): Promise<void> {
    void _progress;
    const dsPath = this.datasetPath(systemId, dsn);

    if (member) {
      const found = await this.findMemberFile(dsPath, member);
      if (!found) {
        throw new Error(`Member '${member}' not found in dataset '${dsn}' on ${systemId}.`);
      }
      await fs.unlink(found);
    } else {
      if (!(await pathExists(dsPath))) {
        throw new Error(`Dataset '${dsn}' not found on ${systemId}.`);
      }
      if (await isDirectory(dsPath)) {
        await fs.rm(dsPath, { recursive: true });
      } else {
        await fs.unlink(dsPath);
        // Also remove metadata file if it exists
        const metaPath = path.join(path.dirname(dsPath), `${path.basename(dsPath)}_meta.json`);
        if (await pathExists(metaPath)) {
          await fs.unlink(metaPath);
        }
      }
    }
  }

  async getAttributes(
    systemId: SystemId,
    dsn: string,
    _progress?: BackendProgressCallback
  ): Promise<DatasetAttributes> {
    void _progress;
    const dsPath = this.datasetPath(systemId, dsn);

    if (!(await pathExists(dsPath))) {
      throw new Error(
        `Dataset '${dsn}' not found on ${systemId}. ` +
          'Use listDatasets to see available datasets.'
      );
    }

    const isDir = await isDirectory(dsPath);
    const metaPath = isDir
      ? path.join(dsPath, '_meta.json')
      : path.join(path.dirname(dsPath), `${path.basename(dsPath)}_meta.json`);

    const meta = await readMeta(metaPath);

    // Same schema as native getAttributes: only fields native returns (no referenceDate, smsClass).
    return {
      dsn: meta?.dsn ?? dsn,
      dsorg: (meta?.dsorg as DatasetOrg | undefined) ?? (isDir ? 'PO-E' : 'PS'),
      recfm: (meta?.recfm as RecordFormat | undefined) ?? 'FB',
      lrecl: meta?.lrecl ?? 80,
      blksz: meta?.blksz ?? 27920,
      volser: meta?.volser ?? 'VOL001',
      creationDate: meta?.creationDate,
    };
  }

  async copyDataset(
    systemId: SystemId,
    sourceDsn: string,
    targetDsn: string,
    sourceMember?: string,
    targetMember?: string,
    _progress?: BackendProgressCallback
  ): Promise<void> {
    void _progress;
    const sourcePath = this.datasetPath(systemId, sourceDsn);
    const targetPath = this.datasetPath(systemId, targetDsn);

    if (sourceMember) {
      // Copy a single member
      const sourceFile = await this.findMemberFile(sourcePath, sourceMember);
      if (!sourceFile) {
        throw new Error(
          `Source member '${sourceMember}' not found in dataset '${sourceDsn}' on ${systemId}.`
        );
      }
      const destMember = targetMember ?? sourceMember;
      const destFile = path.join(
        targetPath,
        `${destMember.toUpperCase()}${path.extname(sourceFile)}`
      );
      await fs.mkdir(targetPath, { recursive: true });
      await fs.copyFile(sourceFile, destFile);
    } else {
      // Copy entire dataset
      if (await isDirectory(sourcePath)) {
        await fs.cp(sourcePath, targetPath, { recursive: true });
      } else {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.copyFile(sourcePath, targetPath);
      }
    }
  }

  async renameDataset(
    systemId: SystemId,
    dsn: string,
    newDsn: string,
    member?: string,
    newMember?: string,
    _progress?: BackendProgressCallback
  ): Promise<void> {
    void _progress;
    if (member && newMember) {
      // Rename a member within the same dataset
      const dsPath = this.datasetPath(systemId, dsn);
      const sourceFile = await this.findMemberFile(dsPath, member);
      if (!sourceFile) {
        throw new Error(`Member '${member}' not found in dataset '${dsn}' on ${systemId}.`);
      }
      const ext = path.extname(sourceFile);
      const destFile = path.join(dsPath, `${newMember.toUpperCase()}${ext}`);
      await fs.rename(sourceFile, destFile);
    } else {
      // Rename the dataset itself
      const sourcePath = this.datasetPath(systemId, dsn);
      const targetPath = this.datasetPath(systemId, newDsn);

      if (!(await pathExists(sourcePath))) {
        throw new Error(`Dataset '${dsn}' not found on ${systemId}.`);
      }

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.rename(sourcePath, targetPath);
    }
  }

  async searchInDataset(
    systemId: SystemId,
    dsn: string,
    options: SearchInDatasetOptions,
    _progress?: BackendProgressCallback
  ): Promise<SearchInDatasetResult> {
    void _progress;
    const log = getLogger().child('mock');
    return runSearchWithListAndRead(this, systemId, dsn, options, log);
  }

  // -----------------------------------------------------------------------
  // USS operations
  // -----------------------------------------------------------------------

  private async toUssEntry(
    filePath: string,
    name: string,
    longFormat: boolean
  ): Promise<UssFileEntry> {
    const entry: UssFileEntry = { name };
    if (longFormat) {
      try {
        const stat = await fs.stat(filePath);
        entry.size = stat.size;
        entry.mtime = stat.mtime.toISOString();
        entry.mode = (stat.mode & 0o777).toString(8).padStart(3, '0');
        entry.isDirectory = stat.isDirectory();
      } catch {
        // keep name only
      }
    }
    return entry;
  }

  async listUssFiles(
    systemId: SystemId,
    ussPath: string,
    options?: ListUssFilesOptions,
    _userId?: string,
    _progress?: BackendProgressCallback
  ): Promise<UssFileEntry[]> {
    const localPath = this.ussPath(systemId, ussPath);
    if (!(await pathExists(localPath))) {
      throw new Error(`USS path '${ussPath}' not found on ${systemId}.`);
    }
    if (!(await isDirectory(localPath))) {
      throw new Error(`USS path '${ussPath}' is not a directory on ${systemId}.`);
    }
    const includeHidden = options?.includeHidden ?? false;
    const longFormat = options?.longFormat ?? false;
    const entries = await fs.readdir(localPath, { withFileTypes: true });
    const results: UssFileEntry[] = [];
    for (const e of entries) {
      if (!includeHidden && e.name.startsWith('.')) continue;
      if (e.name === '_meta.json' || e.name.endsWith('.tag')) continue;
      const fullPath = path.join(localPath, e.name);
      results.push(await this.toUssEntry(fullPath, e.name, longFormat));
    }
    return results.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }

  async readUssFile(
    systemId: SystemId,
    ussPath: string,
    _encoding?: string,
    _userId?: string,
    _progress?: BackendProgressCallback
  ): Promise<ReadUssFileResult> {
    const localPath = this.ussPath(systemId, ussPath);
    if (!(await pathExists(localPath))) {
      throw new Error(`USS file '${ussPath}' not found on ${systemId}.`);
    }
    if (await isDirectory(localPath)) {
      throw new Error(`USS path '${ussPath}' is a directory on ${systemId}, not a file.`);
    }
    const content = await fs.readFile(localPath, 'utf-8');
    const stat = await fs.stat(localPath);
    const etag = computeEtag(stat.mtimeMs);
    return { text: content, etag, encoding: 'UTF-8' };
  }

  async writeUssFile(
    systemId: SystemId,
    ussPath: string,
    content: string,
    etag?: string,
    _encoding?: string,
    _userId?: string,
    _progress?: BackendProgressCallback
  ): Promise<WriteUssFileResult> {
    const localPath = this.ussPath(systemId, ussPath);
    const existed = await pathExists(localPath);
    if (etag && existed) {
      const stat = await fs.stat(localPath);
      if (computeEtag(stat.mtimeMs) !== etag) {
        throw new Error(`ETag mismatch writing USS file '${ussPath}' on ${systemId}.`);
      }
    }
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, content, 'utf-8');
    const stat = await fs.stat(localPath);
    return { etag: computeEtag(stat.mtimeMs), created: !existed };
  }

  async createUssFile(
    systemId: SystemId,
    ussPath: string,
    options: CreateUssFileOptions,
    _userId?: string,
    _progress?: BackendProgressCallback
  ): Promise<void> {
    const localPath = this.ussPath(systemId, ussPath);
    if (await pathExists(localPath)) {
      throw new Error(`USS path '${ussPath}' already exists on ${systemId}.`);
    }
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    if (options.isDirectory) {
      await fs.mkdir(localPath, { recursive: true });
    } else {
      await fs.writeFile(localPath, '', 'utf-8');
    }
    if (options.permissions) {
      const mode = parseInt(options.permissions, 8);
      if (!Number.isNaN(mode)) await fs.chmod(localPath, mode);
    }
  }

  async deleteUssFile(
    systemId: SystemId,
    ussPath: string,
    recursive?: boolean,
    _userId?: string,
    _progress?: BackendProgressCallback
  ): Promise<void> {
    const localPath = this.ussPath(systemId, ussPath);
    if (!(await pathExists(localPath))) {
      throw new Error(`USS path '${ussPath}' not found on ${systemId}.`);
    }
    await fs.rm(localPath, { recursive: recursive ?? false });
  }

  async chmodUssFile(
    systemId: SystemId,
    ussPath: string,
    mode: string,
    recursive?: boolean,
    _userId?: string,
    _progress?: BackendProgressCallback
  ): Promise<void> {
    const localPath = this.ussPath(systemId, ussPath);
    if (!(await pathExists(localPath))) {
      throw new Error(`USS path '${ussPath}' not found on ${systemId}.`);
    }
    const modeNum = parseInt(mode, 8);
    if (Number.isNaN(modeNum)) throw new Error(`Invalid mode '${mode}'.`);
    await fs.chmod(localPath, modeNum);
    if (recursive && (await isDirectory(localPath))) {
      const entries = await fs.readdir(localPath, { withFileTypes: true });
      for (const e of entries) {
        await this.chmodUssFile(
          systemId,
          path.join(ussPath, e.name),
          mode,
          true,
          _userId,
          _progress
        );
      }
    }
  }

  async chownUssFile(
    systemId: SystemId,
    ussPath: string,
    _owner: string,
    recursive?: boolean,
    _userId?: string,
    _progress?: BackendProgressCallback
  ): Promise<void> {
    const localPath = this.ussPath(systemId, ussPath);
    if (!(await pathExists(localPath))) {
      throw new Error(`USS path '${ussPath}' not found on ${systemId}.`);
    }
    if (recursive && (await isDirectory(localPath))) {
      const entries = await fs.readdir(localPath, { withFileTypes: true });
      for (const e of entries) {
        await this.chownUssFile(
          systemId,
          path.join(ussPath, e.name),
          _owner,
          true,
          _userId,
          _progress
        );
      }
    }
  }

  async chtagUssFile(
    systemId: SystemId,
    ussPath: string,
    tag: string,
    recursive?: boolean,
    _userId?: string,
    _progress?: BackendProgressCallback
  ): Promise<void> {
    const localPath = this.ussPath(systemId, ussPath);
    if (!(await pathExists(localPath))) {
      throw new Error(`USS path '${ussPath}' not found on ${systemId}.`);
    }
    const tagPath = `${localPath}.tag`;
    await fs.writeFile(tagPath, tag, 'utf-8');
    if (recursive && (await isDirectory(localPath))) {
      const entries = await fs.readdir(localPath, { withFileTypes: true });
      for (const e of entries) {
        await this.chtagUssFile(
          systemId,
          path.join(ussPath, e.name),
          tag,
          true,
          _userId,
          _progress
        );
      }
    }
  }

  async runUnixCommand(
    systemId: SystemId,
    commandText: string,
    userId?: string,
    _progress?: BackendProgressCallback
  ): Promise<string> {
    const trimmed = commandText.trim();
    const user = userId ?? 'mockuser';
    if (/^echo\s+\$HOME\s*$/.test(trimmed)) {
      return `/u/${user}`;
    }
    if (/^whoami\s*$/.test(trimmed)) {
      return user;
    }
    if (/^pwd\s*$/.test(trimmed)) {
      return `/u/${user}`;
    }
    const lsMatch = /^ls\s+(-[a-zA-Z]*)?\s*(.*)$/.exec(trimmed);
    if (lsMatch) {
      const pathArg = lsMatch[2]?.trim() || '/';
      const listPath = pathArg.startsWith('/') ? pathArg : `/u/${user}/${pathArg}`;
      try {
        const entries = await this.listUssFiles(systemId, listPath, { longFormat: true });
        return entries.map(e => (e.mode ? `${e.mode} ${e.name}` : e.name)).join('\n');
      } catch {
        return `ls: ${pathArg}: No such file or directory`;
      }
    }
    const catMatch = /^cat\s+(.+)$/.exec(trimmed);
    if (catMatch) {
      const pathArg = catMatch[1].trim().replace(/^["']|["']$/g, '');
      const readPath = pathArg.startsWith('/') ? pathArg : `/u/${user}/${pathArg}`;
      try {
        const result = await this.readUssFile(systemId, readPath);
        return result.text;
      } catch (err) {
        return `cat: ${pathArg}: ${(err as Error).message}`;
      }
    }
    return `mock: command not simulated: ${trimmed}`;
  }

  getUssHome(
    systemId: SystemId,
    userId?: string,
    _progress?: BackendProgressCallback
  ): Promise<string> {
    void systemId;
    const user = userId ?? 'mockuser';
    return Promise.resolve(`/u/${user}`);
  }

  async getUssTempDir(
    systemId: SystemId,
    basePath: string,
    _userId?: string,
    _progress?: BackendProgressCallback
  ): Promise<string> {
    const base = this.ussPath(systemId, basePath);
    await fs.mkdir(base, { recursive: true });
    const randomBytes = (await import('node:crypto')).randomBytes(4).toString('hex');
    const candidate = path.join(base, `tmp.${randomBytes}`);
    if (await pathExists(candidate)) {
      return this.getUssTempDir(systemId, basePath, _userId, _progress);
    }
    return basePath.replace(/\/$/, '') + '/' + `tmp.${randomBytes}`;
  }

  async getUssTempPath(
    systemId: SystemId,
    dirPath: string,
    prefix?: string,
    _userId?: string,
    _progress?: BackendProgressCallback
  ): Promise<string> {
    const dir = this.ussPath(systemId, dirPath);
    await fs.mkdir(dir, { recursive: true });
    const randomBytes = (await import('node:crypto')).randomBytes(4).toString('hex');
    const name = prefix ? `${prefix}.${randomBytes}` : randomBytes;
    const candidate = path.join(dir, name);
    if (await pathExists(candidate)) {
      return this.getUssTempPath(systemId, dirPath, prefix, _userId, _progress);
    }
    return dirPath.replace(/\/$/, '') + '/' + name;
  }

  async deleteUssUnderPath(
    systemId: SystemId,
    ussPath: string,
    _userId?: string,
    progress?: BackendProgressCallback
  ): Promise<{ deleted: string[] }> {
    const localPath = this.ussPath(systemId, ussPath);
    if (!(await pathExists(localPath))) {
      return { deleted: [] };
    }
    const deleted: string[] = [];
    const collect = async (dir: string, rel: string): Promise<string[]> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const paths: string[] = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          paths.push(...(await collect(full, r)));
        }
        paths.push(ussPath.replace(/\/$/, '') + '/' + r);
      }
      return paths;
    };
    const all = await collect(localPath, '');
    all.sort((a, b) => b.split('/').length - a.split('/').length);
    for (const p of all) {
      const local = this.ussPath(systemId, p);
      if (await pathExists(local)) {
        progress?.(`Deleting ${p}`);
        await fs.rm(local, { recursive: true });
        deleted.push(p);
      }
    }
    if (await pathExists(localPath)) {
      await fs.rm(localPath, { recursive: true });
      deleted.push(ussPath.replace(/\/$/, ''));
    }
    return { deleted };
  }

  submitJob(
    _systemId: SystemId,
    _jcl: string,
    _progress?: BackendProgressCallback
  ): Promise<SubmitJobResult> {
    return Promise.reject(new Error('Jobs operations are not implemented in the mock backend'));
  }

  getJobStatus(
    _systemId: SystemId,
    _jobId: string,
    _progress?: BackendProgressCallback
  ): Promise<JobStatusResult> {
    return Promise.reject(new Error('Jobs operations are not implemented in the mock backend'));
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Find a member file in a PDS directory using case-insensitive lookup.
   * Members may have file extensions (e.g. `.cbl`, `.jcl`).
   */
  private async findMemberFile(dsPath: string, member: string): Promise<string | undefined> {
    if (!(await isDirectory(dsPath))) return undefined;

    const entries = await fs.readdir(dsPath);
    const upperMember = member.toUpperCase();

    for (const entry of entries) {
      if (entry === '_meta.json' || entry.startsWith('.')) continue;
      const parsed = path.parse(entry);
      if (parsed.name.toUpperCase() === upperMember) {
        return path.join(dsPath, entry);
      }
    }
    return undefined;
  }
}
