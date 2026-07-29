// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SQLite occupancy detection (#3917).
 *
 * The scenario these encode is the one that produced the report: a dev server
 * holding `.objectstack/data/standalone.db` open while `os migrate apply` runs
 * in another terminal. The probe has to tell that apart from a database nobody
 * is attached to — including a database that merely has `-wal`/`-shm` left over
 * from a crash, which sidecar presence alone cannot do.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { probeSqliteOccupancy, sqliteSidecars, describeOccupancy } from './sqlite-occupancy.js';
import { probeMigrationTarget } from './migrate-occupancy-gate.js';

let dir: string;
const openHandles: any[] = [];

function newDb(name: string, journalMode: 'wal' | 'delete'): string {
  const file = join(dir, name);
  const db = new Database(file);
  db.pragma(`journal_mode = ${journalMode}`);
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  db.exec("INSERT INTO t (v) VALUES ('a')");
  db.close();
  return file;
}

/** Keep a connection attached for the duration of one test. */
function attach(file: string): any {
  const db = new Database(file);
  openHandles.push(db);
  return db;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-occupancy-'));
});

afterEach(() => {
  while (openHandles.length > 0) {
    try { openHandles.pop()?.close(); } catch { /* already closed */ }
  }
});

afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('probeSqliteOccupancy', () => {
  it('is not applicable to a non-file target', async () => {
    expect(await probeSqliteOccupancy(null)).toEqual({ status: 'not_applicable' });
    expect(await probeSqliteOccupancy(undefined)).toEqual({ status: 'not_applicable' });
    expect(await probeSqliteOccupancy(':memory:')).toEqual({ status: 'not_applicable' });
  });

  it('treats a database that does not exist yet as idle', async () => {
    const res = await probeSqliteOccupancy(join(dir, 'never-created.db'));
    expect(res.status).toBe('idle');
  });

  it('reports idle for a WAL database nobody has open', async () => {
    const file = newDb('idle-wal.db', 'wal');
    const res = await probeSqliteOccupancy(file);
    expect(res.status).toBe('idle');
  });

  it('reports busy for a WAL database an ATTACHED-BUT-IDLE connection holds open', async () => {
    // The reported scenario: a dev server between requests. It is holding no
    // lock and running no transaction — only `-shm` and the exclusive-locking
    // probe can see it, which is the whole reason the checkpoint probe was
    // rejected.
    const file = newDb('busy-wal-idle.db', 'wal');
    const other = attach(file);
    other.prepare('SELECT * FROM t').all();

    const res = await probeSqliteOccupancy(file);
    expect(res.status).toBe('busy');
    if (res.status === 'busy') {
      expect(res.signal).toBe('wal_attached');
      expect(describeOccupancy(res)).toContain(file);
    }
  });

  it('reports busy for a WAL database another connection is reading in a transaction', async () => {
    const file = newDb('busy-wal.db', 'wal');
    const other = attach(file);
    other.exec('BEGIN');
    other.prepare('SELECT * FROM t').all();

    const res = await probeSqliteOccupancy(file);
    expect(res.status).toBe('busy');
    if (res.status === 'busy') expect(res.signal).toBe('wal_attached');
  });

  it('reports busy for a WAL database another connection is writing', async () => {
    const file = newDb('busy-wal-write.db', 'wal');
    const other = attach(file);
    other.exec('BEGIN IMMEDIATE');
    other.exec("INSERT INTO t (v) VALUES ('b')");

    const res = await probeSqliteOccupancy(file);
    expect(res.status).toBe('busy');
  });

  it('reports busy for a rollback-journal database under a write lock', async () => {
    const file = newDb('busy-journal.db', 'delete');
    const other = attach(file);
    other.exec('BEGIN IMMEDIATE');
    other.exec("INSERT INTO t (v) VALUES ('b')");

    const res = await probeSqliteOccupancy(file);
    expect(res.status).toBe('busy');
    if (res.status === 'busy') expect(res.signal).toBe('write_lock');
  });

  it('reports idle for a rollback-journal database nobody is writing', async () => {
    const file = newDb('idle-journal.db', 'delete');
    expect((await probeSqliteOccupancy(file)).status).toBe('idle');
  });

  it('does not mistake crash-left sidecars for a live connection', async () => {
    // The exact false positive sidecar-presence-only detection would produce:
    // files left behind by a process that died, with nobody attached now.
    const file = newDb('stale-sidecars.db', 'wal');
    writeFileSync(`${file}-wal`, '');
    writeFileSync(`${file}-shm`, '');
    expect(sqliteSidecars(file)).toHaveLength(2);

    const res = await probeSqliteOccupancy(file);
    expect(res.status).toBe('idle');
  });

  it('leaves the data intact — the probe locks, it does not modify', async () => {
    const file = newDb('intact.db', 'wal');
    const live = attach(file);
    live.exec("INSERT INTO t (v) VALUES ('b')");
    live.close();
    openHandles.pop();

    await probeSqliteOccupancy(file);

    const check = attach(file);
    expect(check.prepare('SELECT COUNT(*) AS n FROM t').get().n).toBe(2);
    expect(existsSync(file)).toBe(true);
  });

  it('describeOccupancy says nothing about a database that is not busy', async () => {
    const file = newDb('quiet.db', 'wal');
    expect(describeOccupancy(await probeSqliteOccupancy(file))).toBe('');
  });
});

/**
 * The gate the migrate commands actually call. Its job is to resolve the target
 * the same way the boot does — probing a different file than the one about to
 * be migrated would be worse than not probing at all.
 */
describe('probeMigrationTarget', () => {
  // The first call cold-loads @objectstack/runtime (the resolver lives there),
  // which dwarfs the probe itself. Warm it once so the per-test budgets measure
  // the gate rather than module resolution.
  beforeAll(async () => {
    await probeMigrationTarget('memory://warmup');
  }, 60_000);

  it('resolves --database-url to the file it names and probes THAT file', async () => {
    const file = newDb('gate-target.db', 'wal');
    const other = attach(file);
    other.prepare('SELECT * FROM t').all();

    const res = await probeMigrationTarget(`file:${file}`);
    expect(res.status).toBe('busy');
    if (res.status === 'busy') expect(res.filename).toBe(file);
  });

  it('has nothing to say about a non-SQLite target', async () => {
    expect(await probeMigrationTarget('postgres://localhost:5432/app'))
      .toEqual({ status: 'not_applicable' });
    expect(await probeMigrationTarget('memory://gate'))
      .toEqual({ status: 'not_applicable' });
  });

  it('never fails the command over an unusable URL', async () => {
    expect(await probeMigrationTarget('nonsense://not-a-database'))
      .toEqual({ status: 'not_applicable' });
  });
});
