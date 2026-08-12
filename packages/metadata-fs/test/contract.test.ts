// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// `describe`/`it`/`beforeEach`/`expect` are NOT imported here on purpose: this
// file registers the shared contract suite, which declares every case of its
// own, so the only hook this file itself uses is `afterEach` for cleanup.
import { afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runRepositoryContractTests } from '@objectstack/metadata-core/testing';
import { FileSystemRepository } from '../src/index.js';

/** Track repos + tmpdirs across the contract suite for cleanup. */
const created: FileSystemRepository[] = [];

afterEach(async () => {
  while (created.length) {
    const repo = created.pop()!;
    try { await repo.close(); } catch { /* ignore */ }
  }
});

runRepositoryContractTests(
  'FileSystemRepository',
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'objectstack-fs-'));
    const repo = new FileSystemRepository({
      root: dir,
      org: 'system',
      disableWatch: true,
    });
    await repo.start();
    created.push(repo);
    return repo;
  },
);
