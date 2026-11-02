// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// An upgrade-harness fixture, read as of the run: its rotation shards re-dated
// so the database reads as written the day before the run, whatever the date.
//
// ## Why
//
// A fixture is a dump taken on the day it was generated, and a rotation object
// (`sys_activity`, `lifecycle.storage: { strategy: 'rotation', unit: 'day' }`)
// stores its rows in shard tables named by that day (`sys_activity__r20261019`).
// Every boot of the fixture runs driver-sql's `ensureRotation` against the
// wall clock, and it DROPS each shard older than the retention window. So a
// fixture's activity rows were alive only for the window's length after the
// generator ran, and every test that boots it went red the morning the window
// passed them, with no commit in between.
//
// ## What this does, and why not a pinned clock
//
// Each shard table the dump creates is renamed, in the SQL text before it is
// loaded, to the shard key of the day before the run, every shard keeping its
// distance in days from the newest one: the table, its indexes and its rows'
// INSERTs move together, byte for byte otherwise. The manifest's physical
// names go through the same map, so the census and the database agree.
//
// One day before the run, not the run's own day: the fixture is a database an
// earlier install wrote, so HEAD's boot rotates in a shard of its own beside
// it, as it does for every real upgrade (the 18.0.0 leg's "HEAD's shard NOT
// NULL" reading depends on that), and a run that crosses UTC midnight still
// finds the fixture's shard inside the window.
//
// A pinned clock would have to reach every process that opens the file: the
// test's own boots AND each `os migrate …` binary the suites spawn, which run
// the same rotation on their own clock. Faking `Date` there would move every
// timestamp those processes write (sessions, deliveries, audit rows) along with
// it. The shard name is the only thing the rotation reads, so it is the only
// thing re-dated; the rows' own timestamps are left as the fixture recorded
// them, since no read the harness drives picks a shard by them (the read
// is the `UNION ALL` view over every retained shard).
//
// ⛔ Production retention and `ensureRotation` are untouched: this is the
// fixture's age, not the window.
import { readFileSync } from 'node:fs';
import type { FixtureManifest } from './fixture-manifest.js';

/**
 * The rotation families a fixture may carry, by the unit of their shard key.
 * Only day keys are re-dated: a week key must land on a Monday and a month key
 * is six digits, and no fixture carries either today. A shard of a family not
 * listed here is refused, never loaded as it is — loading it as it is would
 * reintroduce the wall-clock dependency this module removes.
 */
const ROTATION_UNITS: Readonly<Record<string, 'day'>> = { sys_activity: 'day' };

const DAY_MS = 86_400_000;

/** A shard table a dump creates: `CREATE TABLE`, quoted with backticks or double quotes. */
const SHARD_TABLE = /^CREATE TABLE [`"]([A-Za-z0-9_]+?)__r(\d+)[`"]/gm;

const dayKeyOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

function msOfDayKey(key: string): number {
  if (!/^\d{8}$/.test(key)) throw new Error(`fixture-as-of: ${key} is not a day shard key`);
  const ms = Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)));
  if (dayKeyOf(ms) !== key) throw new Error(`fixture-as-of: ${key} is not a day shard key`);
  return ms;
}

/**
 * Old shard table → new shard table for `sql`, re-dated so its newest shard is
 * the day before `nowMs`. Empty when the dump carries no shard. Throws on a
 * shard of a family `ROTATION_UNITS` does not list.
 */
export function shardRenamesAsOf(sql: string, nowMs: number = Date.now()): Map<string, string> {
  const shards: Array<{ table: string; family: string; ms: number }> = [];
  for (const m of sql.matchAll(SHARD_TABLE)) {
    const [, family, key] = m as unknown as [string, string, string];
    if (ROTATION_UNITS[family] !== 'day') {
      throw new Error(
        `fixture-as-of: the fixture creates shard ${family}__r${key} of a rotation family this harness cannot re-date; ` +
          'add the family and its unit to ROTATION_UNITS in test/upgrade-harness/fixture-as-of.ts',
      );
    }
    shards.push({ table: `${family}__r${key}`, family, ms: msOfDayKey(key) });
  }
  const renames = new Map<string, string>();
  if (shards.length === 0) return renames;
  const newest = Math.max(...shards.map((s) => s.ms));
  const shift = msOfDayKey(dayKeyOf(nowMs)) - DAY_MS - newest;
  for (const s of shards) renames.set(s.table, `${s.family}__r${dayKeyOf(s.ms + shift)}`);
  return renames;
}

/**
 * `text` with every shard table it names renamed: the table itself, and the
 * indexes named after it (`idx_<shard>_<columns>`), so they move together.
 * One pass over every name at once, so a shard renamed onto another shard's
 * old name is never renamed a second time.
 */
export function renameShardTables(text: string, renames: ReadonlyMap<string, string>): string {
  if (renames.size === 0) return text;
  const any = new RegExp(`(?<![A-Za-z0-9])(${[...renames.keys()].join('|')})(?![0-9])`, 'g');
  return text.replace(any, (from) => renames.get(from)!);
}

/** A fixture as one run reads it: the dump and the manifest, their shards re-dated together. */
export interface FixtureAsOf {
  sql: string;
  manifest: FixtureManifest;
  /** Old shard table → the name this run's copy carries; empty when the fixture has no shard. */
  renames: ReadonlyMap<string, string>;
}

/**
 * The fixture in `dir` (`database.sql` and `manifest.json`), re-dated so it
 * reads as written the day before `nowMs`.
 */
export function readFixtureAsOf(dir: URL, nowMs: number = Date.now()): FixtureAsOf {
  const sql = readFileSync(new URL('database.sql', dir), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8')) as FixtureManifest;
  const renames = shardRenamesAsOf(sql, nowMs);
  return {
    sql: renameShardTables(sql, renames),
    manifest: {
      ...manifest,
      tables: Object.fromEntries(Object.entries(manifest.tables).map(([t, n]) => [renames.get(t) ?? t, n])),
      reshaped: manifest.reshaped.map((t) => ({ ...t, physical: t.physical.map((p) => renames.get(p) ?? p) })),
    },
    renames,
  };
}
