// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A fresh local FILE for an embedded-replica fixture.
 *
 * An embedded replica is a local file kept in sync with the remote named in
 * `syncUrl`, and `TursoDriver` refuses a replica on anything else at
 * construction (`:memory:`, a remote url). In those cases the local engine
 * would have run on a private in-memory database that no sync ever reaches.
 * A fixture that exercises the replica face therefore needs a real path. It
 * needs a NEW one per driver, so each test starts from an empty database,
 * exactly as the `:memory:` fixtures these replace did.
 *
 * ```ts
 * const files = replicaFiles();
 * afterAll(() => files.removeAll());
 * new TursoDriver({ url: files.next(), syncUrl, client, sync: { onConnect: false } });
 * ```
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ReplicaFiles {
  /** A `file:` url naming a database file in a directory of its own; the file does not exist yet. */
  next(): string;
  /** Delete every directory `next()` created. Idempotent. */
  removeAll(): void;
}

export function replicaFiles(): ReplicaFiles {
  const dirs: string[] = [];
  return {
    next() {
      const dir = mkdtempSync(join(tmpdir(), 'turso-replica-'));
      dirs.push(dir);
      return `file:${join(dir, 'replica.db')}`;
    },
    removeAll() {
      while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
    },
  };
}
