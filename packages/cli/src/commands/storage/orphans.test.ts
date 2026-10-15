// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os storage orphans` — what its help says the inventory writes.
 *
 * The inventory boots read-only (deferred DDL, no seed, no file brought into
 * existence), but the boot's connect can switch a SQLite file's journal mode,
 * which rewrites the file's header and no row (measured on a rollback-journal
 * file: header bytes 18 and 19 from 1,1 to 2,2, the change counter up by one,
 * schema and rows byte-identical). So the help claims no row or table, never
 * that the command writes nothing. The help names no target, so it carries no
 * SQLite note.
 */

import { describe, expect, it } from 'vitest';
import StorageOrphans from './orphans.js';

describe('os storage orphans --help', () => {
  it('says the inventory writes no row or table, tombstones nothing and deletes nothing', () => {
    expect(StorageOrphans.description).toContain('Writes no row or table, tombstones nothing, deletes nothing.');
    expect(StorageOrphans.description).not.toContain('Writes nothing');
  });
});
