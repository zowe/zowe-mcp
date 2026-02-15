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
 * mock-data/
 *   systems.json
 *   sys1.example.com/
 *     IBMUSER/                     # HLQ directory
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
import type {
  CreateDatasetOptions,
  DatasetAttributes,
  DatasetEntry,
  DatasetOrg,
  MemberEntry,
  ReadDatasetResult,
  RecordFormat,
  WriteDatasetResult,
  ZosBackend,
} from '../backend.js';
import type { SystemId } from '../system.js';
import type { MockDatasetMeta } from './mock-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a fully-qualified dataset name to a filesystem path relative
 * to the system directory.
 *
 * `IBMUSER.SRC.COBOL` → `IBMUSER/SRC.COBOL`
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
 * - A trailing `*` as the last qualifier (e.g. `IBMUSER.*`) is treated
 *   as `**` — matching across any number of remaining qualifiers.
 *   This follows the standard ISPF 3.4 convention where `IBMUSER.*`
 *   lists all datasets under the IBMUSER HLQ.
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

  async listDatasets(systemId: SystemId, pattern: string): Promise<DatasetEntry[]> {
    const sysDir = this.systemDir(systemId);
    if (!(await pathExists(sysDir))) {
      return [];
    }

    const results: DatasetEntry[] = [];

    // Walk HLQ directories
    const hlqDirs = await fs.readdir(sysDir);
    for (const hlq of hlqDirs) {
      const hlqPath = path.join(sysDir, hlq);
      if (!(await isDirectory(hlqPath))) continue;
      // Skip hidden files and systems.json
      if (hlq.startsWith('.') || hlq.endsWith('.json')) continue;

      const entries = await fs.readdir(hlqPath);
      for (const entry of entries) {
        if (entry === '_meta.json' || entry.startsWith('.')) continue;

        const dsn = `${hlq}.${entry}`.toUpperCase();
        const fullPath = path.join(hlqPath, entry);

        if (!matchPattern(dsn, pattern)) continue;

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

  async listMembers(systemId: SystemId, dsn: string, pattern?: string): Promise<MemberEntry[]> {
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
        const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`, 'i');
        if (!regex.test(memberName)) continue;
      }

      members.push({ name: memberName });
    }

    return members.sort((a, b) => a.name.localeCompare(b.name));
  }

  async readDataset(
    systemId: SystemId,
    dsn: string,
    member?: string,
    codepage?: string
  ): Promise<ReadDatasetResult> {
    const dsPath = this.datasetPath(systemId, dsn);
    let filePath: string;

    if (member) {
      // PDS/PDSE member — find the file in the dataset directory
      const found = await this.findMemberFile(dsPath, member);
      if (!found) {
        throw new Error(
          `Member '${member}' not found in dataset '${dsn}' on ${systemId}. ` +
            'Use list_members to see available members.'
        );
      }
      filePath = found;
    } else {
      // Sequential dataset — the dataset itself is a file
      if (await isDirectory(dsPath)) {
        throw new Error(
          `Dataset '${dsn}' is a PDS/PDSE on ${systemId}. ` +
            'Specify a member name to read, or use list_members to see available members.'
        );
      }
      if (!(await pathExists(dsPath))) {
        throw new Error(
          `Dataset '${dsn}' not found on ${systemId}. ` +
            'Use list_datasets to see available datasets.'
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
      codepage: codepage ?? 'IBM-1047',
    };
  }

  async writeDataset(
    systemId: SystemId,
    dsn: string,
    content: string,
    member?: string,
    etag?: string,
    codepage?: string
  ): Promise<WriteDatasetResult> {
    const dsPath = this.datasetPath(systemId, dsn);
    let filePath: string;

    if (member) {
      // Ensure the PDS directory exists
      if (!(await pathExists(dsPath))) {
        throw new Error(
          `Dataset '${dsn}' not found on ${systemId}. ` +
            'Create the dataset first with create_dataset.'
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

    // ETag check for optimistic locking
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

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');

    const stat = await fs.stat(filePath);
    return {
      etag: computeEtag(stat.mtimeMs),
    };

    // codepage is ignored in mock mode (files are stored as UTF-8)
    void codepage;
  }

  async createDataset(
    systemId: SystemId,
    dsn: string,
    options: CreateDatasetOptions
  ): Promise<void> {
    const dsPath = this.datasetPath(systemId, dsn);

    if (await pathExists(dsPath)) {
      throw new Error(
        `Dataset '${dsn}' already exists on ${systemId}. ` +
          'Delete it first if you want to recreate it.'
      );
    }

    if (options.type === 'PO' || options.type === 'PO-E') {
      // Create directory for PDS/PDSE
      await fs.mkdir(dsPath, { recursive: true });
    } else {
      // Create empty file for sequential dataset
      await fs.mkdir(path.dirname(dsPath), { recursive: true });
      await fs.writeFile(dsPath, '', 'utf-8');
    }

    // Write metadata
    const meta: MockDatasetMeta = {
      dsn,
      dsorg: options.type,
      recfm: options.recfm ?? 'FB',
      lrecl: options.lrecl ?? 80,
      blksz: options.blksz ?? 27920,
      volser: 'VOL001',
      creationDate: new Date().toISOString().slice(0, 10),
    };

    const metaPath =
      options.type === 'PO' || options.type === 'PO-E'
        ? path.join(dsPath, '_meta.json')
        : path.join(path.dirname(dsPath), `${path.basename(dsPath)}_meta.json`);

    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  }

  async deleteDataset(systemId: SystemId, dsn: string, member?: string): Promise<void> {
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

  async getAttributes(systemId: SystemId, dsn: string): Promise<DatasetAttributes> {
    const dsPath = this.datasetPath(systemId, dsn);

    if (!(await pathExists(dsPath))) {
      throw new Error(
        `Dataset '${dsn}' not found on ${systemId}. ` +
          'Use list_datasets to see available datasets.'
      );
    }

    const isDir = await isDirectory(dsPath);
    const metaPath = isDir
      ? path.join(dsPath, '_meta.json')
      : path.join(path.dirname(dsPath), `${path.basename(dsPath)}_meta.json`);

    const meta = await readMeta(metaPath);

    return {
      dsn: meta?.dsn ?? dsn,
      dsorg: (meta?.dsorg as DatasetOrg | undefined) ?? (isDir ? 'PO-E' : 'PS'),
      recfm: (meta?.recfm as RecordFormat | undefined) ?? 'FB',
      lrecl: meta?.lrecl ?? 80,
      blksz: meta?.blksz ?? 27920,
      volser: meta?.volser ?? 'VOL001',
      creationDate: meta?.creationDate,
      referenceDate: meta?.referenceDate,
      smsClass: meta?.smsClass,
    };
  }

  async copyDataset(
    systemId: SystemId,
    sourceDsn: string,
    targetDsn: string,
    sourceMember?: string,
    targetMember?: string
  ): Promise<void> {
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
    newMember?: string
  ): Promise<void> {
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
