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
 * Thin adapter around {@link FilesystemMockBackend} for the mock SSH daemon's RPC
 * handlers and USS shell interpreter. Both ride the same on-disk layout as `--mock`
 * mode, so fixtures and behaviour stay consistent.
 *
 * This intentionally re-exports the backend instance directly — full extraction of
 * a shared `MockStore` is a separate follow-up (see the plan). For now we map
 * fine-grained RPC requests onto the backend's `ZosBackend` surface where they
 * fit, and add the gaps (jobs, system info, search) here.
 */

import { FilesystemMockBackend } from '../zos/mock/filesystem-mock-backend.js';
import { MockJobStore } from './jobs.js';

export class MockHostStore {
  readonly backend: FilesystemMockBackend;
  readonly jobs: MockJobStore;

  constructor(public readonly mockDir: string) {
    this.backend = new FilesystemMockBackend(mockDir);
    this.jobs = new MockJobStore(mockDir);
  }
}
