// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #21734: `SqlDriver.connect()` used to run `PRAGMA auto_vacuum = INCREMENTAL`
// on every connect. On a file that already answers INCREMENTAL the setter
// changes no mode, but it still runs a write transaction that stamps two header
// counters — the file change counter (bytes 24–27) and the version-valid-for
// number (bytes 92–95) — so a connect made only to READ (`os migrate
// duplicates`) left the file's md5 different from how it found it. The driver
// now reads `PRAGMA auto_vacuum` first (byte-neutral) and sets it only when the
// file does not answer INCREMENTAL, on every connect alike.
//
// What is pinned:
//   1. an already-INCREMENTAL WAL file comes out of connect + disconnect
//      byte-identical — with a control proving the md5 instrument sees the
//      setter's header stamp on the same file;
//   2. a fresh file and `:memory:` still come out INCREMENTAL (ADR-0057);
//   3. a legacy NONE file that already holds tables still gets the setter it
//      always got, and stays NONE — this driver runs no VACUUM, before or after;
//   4. the non-SQLite dialects issue no PRAGMA at all.

import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from './sql-driver.js';

const dirs: string[] = [];
const drivers: SqlDriver[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-21734-'));
  dirs.push(dir);
  return join(dir, 'app.db');
}

function make(cfg: Record<string, unknown>): SqlDriver & { knex: any } {
  const d = new SqlDriver({ useNullAsDefault: true, ...cfg } as any);
  drivers.push(d);
  return d as any;
}

function sqlite(filename: string): SqlDriver & { knex: any } {
  return make({ client: 'better-sqlite3', connection: { filename } });
}

/** Every statement the driver sends, in order — knex's own `query` event. */
function trace(driver: any): string[] {
  const seen: string[] = [];
  driver.knex.on('query', (q: { sql?: unknown }) => seen.push(String(q.sql)));
  return seen;
}

const md5 = (file: string): string => createHash('md5').update(readFileSync(file)).digest('hex');

/** Byte offsets at which two images differ. */
function differingOffsets(a: Buffer, b: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

/** `PRAGMA auto_vacuum` / `journal_mode` as a fresh connection of our own reads them. */
async function fileModes(file: string): Promise<{ autoVacuum: number; journalMode: string }> {
  const probe = sqlite(file);
  try {
    const av = await probe.knex.raw('PRAGMA auto_vacuum');
    const jm = await probe.knex.raw('PRAGMA journal_mode');
    return { autoVacuum: Number(av[0].auto_vacuum), journalMode: String(jm[0].journal_mode).toLowerCase() };
  } finally {
    await probe.disconnect();
  }
}

/** An install as a serving boot leaves it: connected once on a fresh file, then holding rows. */
async function bootedOnce(file: string): Promise<void> {
  const d = sqlite(file);
  await d.connect();
  await d.knex.raw('CREATE TABLE t (id integer primary key, v text)');
  for (let i = 0; i < 50; i++) await d.knex.raw('INSERT INTO t (v) VALUES (?)', [`row-${i}`]);
  await d.disconnect();
}

afterEach(async () => {
  await Promise.all(drivers.splice(0).map((d) => d.disconnect().catch(() => {})));
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

describe('SqlDriver — auto_vacuum is read first and set only when different (#21734)', () => {
  it('a connect to an already-INCREMENTAL file leaves the file byte-identical', async () => {
    const file = tempDb();
    await bootedOnce(file);
    expect(await fileModes(file)).toEqual({ autoVacuum: 2, journalMode: 'wal' });
    const before = md5(file);

    const d = sqlite(file);
    await d.connect();
    await d.disconnect();

    expect(md5(file)).toBe(before);
  });

  it('control: the md5 instrument does see the setter stamp the header of that same file', async () => {
    const file = tempDb();
    await bootedOnce(file);
    const image = readFileSync(file);

    const d = sqlite(file);
    await d.knex.raw('PRAGMA auto_vacuum = INCREMENTAL');
    await d.disconnect();

    const offsets = differingOffsets(image, readFileSync(file));
    // A pin 1 that could not fail would read green here too; it must not.
    expect(offsets.length).toBeGreaterThan(0);
    // The two header counters, and nothing else: the mode itself did not move.
    for (const at of offsets) expect((at >= 24 && at <= 27) || (at >= 92 && at <= 95)).toBe(true);
    expect((await fileModes(file)).autoVacuum).toBe(2);
  });

  it('a fresh file still comes out INCREMENTAL', async () => {
    const file = tempDb();
    const d = sqlite(file);
    await d.connect();
    await d.knex.raw('CREATE TABLE t (a integer)');
    await d.disconnect();

    expect((await fileModes(file)).autoVacuum).toBe(2);
  });

  it('`:memory:` still comes out INCREMENTAL', async () => {
    const d = sqlite(':memory:');
    await d.connect();
    const av = await d.knex.raw('PRAGMA auto_vacuum');
    expect(Number(av[0].auto_vacuum)).toBe(2);
  });

  it('a legacy NONE file that holds tables still gets the setter, and stays NONE (no VACUUM is run)', async () => {
    const file = tempDb();
    // Written without ever connecting, so nothing set its mode: NONE, with a table.
    const legacy = sqlite(file);
    await legacy.knex.raw('CREATE TABLE t (a integer)');
    await legacy.knex.raw('INSERT INTO t VALUES (1)');
    await legacy.disconnect();
    expect((await fileModes(file)).autoVacuum).toBe(0);

    const d = sqlite(file);
    const seen = trace(d);
    await d.connect();
    await d.disconnect();

    expect(seen).toContain('PRAGMA auto_vacuum = INCREMENTAL');
    expect(seen.some((sql) => /^\s*VACUUM\b/i.test(sql))).toBe(false);
    expect((await fileModes(file)).autoVacuum).toBe(0);
  });
});
