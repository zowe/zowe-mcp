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
 * Unit tests for FilesystemMockBackend USS operations.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FilesystemMockBackend } from '../src/zos/mock/filesystem-mock-backend.js';
import type { SystemId } from '../src/zos/system.js';

const SYSTEM_ID: SystemId = 'mock-uss.example.com';

describe('Mock USS backend', () => {
  let mockDir: string;
  let backend: FilesystemMockBackend;

  beforeAll(async () => {
    mockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zowe-mcp-mock-uss-'));
    backend = new FilesystemMockBackend(mockDir);
    await fs.mkdir(path.join(mockDir, 'uss', SYSTEM_ID, 'u', 'testuser'), { recursive: true });
    await fs.writeFile(
      path.join(mockDir, 'uss', SYSTEM_ID, 'u', 'testuser', 'file.txt'),
      'hello world',
      'utf-8'
    );
    await fs.mkdir(path.join(mockDir, 'uss', SYSTEM_ID, 'u', 'testuser', 'subdir'), {
      recursive: true,
    });
  });

  afterAll(async () => {
    if (mockDir) {
      await fs.rm(mockDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('listUssFiles lists directory entries', async () => {
    const entries = await backend.listUssFiles(SYSTEM_ID, '/u/testuser');
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const names = entries.map(e => e.name);
    expect(names).toContain('file.txt');
    expect(names).toContain('subdir');
  });

  it('listUssFiles with longFormat includes mode and size', async () => {
    const entries = await backend.listUssFiles(SYSTEM_ID, '/u/testuser', {
      longFormat: true,
    });
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const file = entries.find(e => e.name === 'file.txt');
    expect(file).toBeDefined();
    expect(file!.size).toBe(11);
    expect(file!.mode).toBeDefined();
  });

  it('readUssFile returns file content and etag', async () => {
    const result = await backend.readUssFile(SYSTEM_ID, '/u/testuser/file.txt');
    expect(result.text).toBe('hello world');
    expect(result.etag).toBeDefined();
    expect(result.encoding).toBe('UTF-8');
  });

  it('readUssFile throws for directory', async () => {
    await expect(backend.readUssFile(SYSTEM_ID, '/u/testuser')).rejects.toThrow(/directory/);
  });

  it('writeUssFile creates new file', async () => {
    await backend.writeUssFile(SYSTEM_ID, '/u/testuser/newfile.txt', 'new content');
    const result = await backend.readUssFile(SYSTEM_ID, '/u/testuser/newfile.txt');
    expect(result.text).toBe('new content');
    expect(result.etag).toBeDefined();
  });

  it('writeUssFile overwrites existing with etag', async () => {
    const first = await backend.readUssFile(SYSTEM_ID, '/u/testuser/file.txt');
    const writeResult = await backend.writeUssFile(
      SYSTEM_ID,
      '/u/testuser/file.txt',
      'updated',
      first.etag
    );
    expect(writeResult.created).toBe(false);
    const result = await backend.readUssFile(SYSTEM_ID, '/u/testuser/file.txt');
    expect(result.text).toBe('updated');
  });

  it('createUssFile creates directory and file', async () => {
    await backend.createUssFile(SYSTEM_ID, '/u/testuser/newdir', { isDirectory: true });
    const entries = await backend.listUssFiles(SYSTEM_ID, '/u/testuser');
    expect(entries.map(e => e.name)).toContain('newdir');

    await backend.createUssFile(SYSTEM_ID, '/u/testuser/newdir/empty.txt', {
      isDirectory: false,
    });
    const content = await backend.readUssFile(SYSTEM_ID, '/u/testuser/newdir/empty.txt');
    expect(content.text).toBe('');
  });

  it('deleteUssFile removes file', async () => {
    await backend.writeUssFile(SYSTEM_ID, '/u/testuser/to-delete.txt', 'x');
    await backend.deleteUssFile(SYSTEM_ID, '/u/testuser/to-delete.txt');
    await expect(backend.readUssFile(SYSTEM_ID, '/u/testuser/to-delete.txt')).rejects.toThrow();
  });

  it('getUssHome returns /u/userId', async () => {
    const home = await backend.getUssHome(SYSTEM_ID, 'testuser');
    expect(home).toBe('/u/testuser');
  });

  it('getUssTempDir returns unique path under basePath', async () => {
    const dir1 = await backend.getUssTempDir(SYSTEM_ID, '/u/testuser/tmp');
    const dir2 = await backend.getUssTempDir(SYSTEM_ID, '/u/testuser/tmp');
    expect(dir1).toMatch(/^\/u\/testuser\/tmp\/tmp\.[a-f0-9]+$/);
    expect(dir2).toMatch(/^\/u\/testuser\/tmp\/tmp\.[a-f0-9]+$/);
    expect(dir1).not.toBe(dir2);
  });

  it('getUssTempPath returns unique file path', async () => {
    const tmpDir = await backend.getUssTempDir(SYSTEM_ID, '/u/testuser/tmp');
    const file1 = await backend.getUssTempPath(SYSTEM_ID, tmpDir, 'pre');
    const file2 = await backend.getUssTempPath(SYSTEM_ID, tmpDir, 'pre');
    expect(file1).toContain('/pre.');
    expect(file2).toContain('/pre.');
    expect(file1).not.toBe(file2);
  });

  it('runUnixCommand echoes $HOME and whoami', async () => {
    const home = await backend.runUnixCommand(SYSTEM_ID, 'echo $HOME', 'testuser');
    expect(home).toBe('/u/testuser');
    const who = await backend.runUnixCommand(SYSTEM_ID, 'whoami', 'testuser');
    expect(who).toBe('testuser');
  });

  it('runUnixCommand ls lists path', async () => {
    const out = await backend.runUnixCommand(SYSTEM_ID, 'ls /u/testuser', 'testuser');
    expect(out).toContain('file.txt');
    expect(out).toContain('subdir');
  });

  it('deleteUssUnderPath removes directory and contents', async () => {
    await backend.createUssFile(SYSTEM_ID, '/u/testuser/tmp/cleanme', { isDirectory: true });
    await backend.writeUssFile(SYSTEM_ID, '/u/testuser/tmp/cleanme/a.txt', 'a');
    const { deleted } = await backend.deleteUssUnderPath(SYSTEM_ID, '/u/testuser/tmp/cleanme');
    expect(deleted.length).toBeGreaterThanOrEqual(2);
    await expect(backend.listUssFiles(SYSTEM_ID, '/u/testuser/tmp')).resolves.not.toContainEqual(
      expect.objectContaining({ name: 'cleanme' })
    );
  });
});
