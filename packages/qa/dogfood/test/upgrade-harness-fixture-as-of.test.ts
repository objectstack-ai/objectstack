// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The upgrade fixtures' rotation shards survive a boot on ANY run date, once
// read through `readFixtureAsOf` (`upgrade-harness/fixture-as-of.ts`).
//
// A fixture's `sys_activity` rows live in shards named by the day the
// generator ran, and every boot runs driver-sql's rotation against its clock,
// dropping each shard older than the window. Here the real rotation
// (`SqlDriver#rotateShards`, the entry point the boot and the lifecycle sweep
// call) runs with `sys_activity`'s own declaration over a copy of each fixture
// at a spread of run dates — the fixture's own day, the day its window closed,
// months and a leap year later, and a date before it was generated — and the
// fixture's shard must come out retained with every row. The control: the same
// rotation over the fixture read as it was written drops the shard once the
// run is past its window, so the pin can fail.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysActivity } from '../../../plugins/plugin-audit/src/objects/sys-activity.object.js';
import { readFixtureAsOf, renameShardTables, shardRenamesAsOf } from './upgrade-harness/fixture-as-of.js';
import { loadSqlIntoSqlite } from './upgrade-harness/sqlite-text-dump.js';

const DAY = 86_400_000;
const FIXTURES = [
  { name: '18.0', dir: new URL('./upgrade-harness/fixture-18.0/', import.meta.url) },
  { name: '18.0.0', dir: new URL('./upgrade-harness/fixture-18.0.0/', import.meta.url) },
] as const;

/** Run dates, by their offset in days from the fixture's newest shard. */
const RUN_OFFSETS = [-20, 0, 1, 13, 14, 30, 180, 400] as const;

const dayKeyOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
const msOf = (key: string): number => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)));

/** The shard tables of `file` and their row counts. */
function shardRows(file: string): Record<string, number> {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'sys_activity__r%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
    return Object.fromEntries(names.map((n) => [n, Number((db.prepare(`SELECT COUNT(*) AS n FROM "${n}"`).get() as { n: number }).n)]));
  } finally {
    db.close();
  }
}

/** `sql` loaded into a new file under `dir`, then the real rotation of `sys_activity` at `nowMs`. */
async function rotateAt(dir: string, tag: string, sql: string, nowMs: number) {
  const file = join(dir, `${tag}.db`);
  loadSqlIntoSqlite(sql, file);
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
  await driver.connect();
  try {
    return { file, rotation: await driver.rotateShards(SysActivity as never, nowMs) };
  } finally {
    await driver.disconnect();
  }
}

describe.each(FIXTURES)('the $name fixture, read as of the run, keeps its activity shard through a boot on any date', ({ name, dir }) => {
  const work = mkdtempSync(join(tmpdir(), `dogfood-fixture-as-of-${name}-`));
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  /** The dump as the generator wrote it, and the shard it names. */
  const written = readFileSync(new URL('database.sql', dir), 'utf8');
  const shards = [...shardRenamesAsOf(written).keys()];
  const fixtureShard = shards[0] ?? '';
  const shardDayMs = msOf(fixtureShard.slice(-8));

  it('carries one activity shard (a vacuous fixture is no pin)', () => {
    expect(shards).toHaveLength(1);
    expect(fixtureShard).toMatch(/^sys_activity__r\d{8}$/);
  });

  it.each(RUN_OFFSETS)('a run %i day(s) after the fixture\'s shard: the re-dated shard is retained with every row', async (offset) => {
    const nowMs = shardDayMs + offset * DAY + 12 * 3_600_000;
    const fixture = readFixtureAsOf(dir, nowMs);
    const expected = `sys_activity__r${dayKeyOf(nowMs - DAY)}`;

    // The dump and the manifest name the same re-dated shard, and the old name is gone from the dump.
    expect([...fixture.renames.values()]).toEqual([expected]);
    if (expected !== fixtureShard) expect(fixture.sql.includes(fixtureShard)).toBe(false);
    expect(fixture.manifest.reshaped.find((t) => t.table === 'sys_activity')!.physical).toEqual([expected]);
    const rows = fixture.manifest.tables[expected];
    expect(rows, 'the manifest counts the re-dated shard').toBeGreaterThan(0);

    const { file, rotation } = await rotateAt(work, `as-of-${offset}`, fixture.sql, nowMs);
    expect(rotation.dropped).toEqual([]);
    expect(rotation.shards).toContain(expected);
    // HEAD rotates in a shard of its own beside the fixture's, as on a real upgrade.
    expect(rotation.current).not.toBe(expected);
    expect(shardRows(file)[expected]).toBe(rows);
    // The shard's indexes moved with it: every shard index is named after the table it sits on.
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const indexes = db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_sys_activity__r%'").all() as Array<{ name: string; tbl_name: string }>;
      expect(indexes.filter((i) => i.tbl_name === expected).length).toBeGreaterThan(0);
      expect(indexes.filter((i) => !i.name.startsWith(`idx_${i.tbl_name}_`))).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('control: read as it was written, the shard is dropped once the run is past the window', async () => {
    const { rotation } = await rotateAt(work, 'as-written', written, shardDayMs + 14 * DAY);
    expect(rotation.dropped).toEqual([fixtureShard]);
  });
});

describe('the re-date itself', () => {
  const two = [
    'CREATE TABLE `sys_activity__r20261019` (`id` varchar(255));',
    'CREATE TABLE `sys_activity__r20261020` (`id` varchar(255));',
    "INSERT INTO \"sys_activity__r20261019\" (\"id\") VALUES('a');",
    "INSERT INTO \"sys_activity__r20261020\" (\"id\") VALUES('b');",
    'CREATE INDEX `idx_sys_activity__r20261019_type` on `sys_activity__r20261019` (`id`);',
  ].join('\n');

  it('keeps each shard\'s distance from the newest, in one pass (a shard renamed onto another\'s old name is not renamed twice)', () => {
    const renames = shardRenamesAsOf(two, msOf('20261022'));
    expect(Object.fromEntries(renames)).toEqual({
      sys_activity__r20261019: 'sys_activity__r20261020',
      sys_activity__r20261020: 'sys_activity__r20261021',
    });
    expect(renameShardTables(two, renames).split('\n')).toEqual([
      'CREATE TABLE `sys_activity__r20261020` (`id` varchar(255));',
      'CREATE TABLE `sys_activity__r20261021` (`id` varchar(255));',
      "INSERT INTO \"sys_activity__r20261020\" (\"id\") VALUES('a');",
      "INSERT INTO \"sys_activity__r20261021\" (\"id\") VALUES('b');",
      'CREATE INDEX `idx_sys_activity__r20261020_type` on `sys_activity__r20261020` (`id`);',
    ]);
  });

  it('refuses a shard of a rotation family it cannot re-date, rather than load it on the wall clock', () => {
    expect(() => shardRenamesAsOf('CREATE TABLE `sys_other__r20261019` (`id` varchar(255));')).toThrow(/sys_other__r20261019.*ROTATION_UNITS/);
    expect(() => shardRenamesAsOf('CREATE TABLE `sys_activity__r202610` (`id` varchar(255));')).toThrow(/not a day shard key/);
  });
});
