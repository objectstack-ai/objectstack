// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14078] `canonicalIsoInstant`'s `Date` arm is TOTAL — an Invalid `Date`
 * leaves as `undefined`, so `stat()`'s own `?? new Date().toISOString()` chain
 * publishes a parseable `MetadataStats.mtime` instead of the read raising
 * `RangeError: Invalid time value`.
 *
 * ## The defect
 *
 * The arm was `if (value instanceof Date) return value.toISOString();`. For
 * the one `Date` whose time value is `NaN` that call throws, and `stat()` is a
 * hot read path (REST `/meta/*`, ObjectQL plan resolution, runtime overlay
 * merges) — so one legacy row answered 500 where the spelling this replaced,
 * `String(value)`, had served the visible text `"Invalid Date"`.
 *
 * ## Reachability is measured, not argued
 *
 * PR #14409 (landed `3ecb7dc1a`): mysql2 3.23.1 returns a module constant
 * literally named `INVALID_DATE` for a zero `DATETIME`; postgres-date 1.0.7
 * builds `new Date(NaN)` for every year in 275760..294276, which Postgres
 * itself stores. Ruled option B by the maintainer on 2026-09-02, on all five
 * arms of the shared spelling at once.
 *
 * ## Why `undefined` is the terminal value at THIS arm
 *
 * The ruling sets it per call site. `stat()` — the only caller — already ends
 * in `?? new Date().toISOString()`, the branch an absent column takes today,
 * which is the ruling's "optional, and the caller already carries a
 * `?? default` chain". And `MetadataStats.mtime` is declared
 * `z.string().datetime()` in `packages/spec/src/system/metadata-persistence.zod.ts`:
 * feeding it the literal text `"Invalid Date"` would not produce a visible
 * cell, it would produce a zod refusal at the consumer — the same 500 moved
 * one layer out. ⛔ And not `''`, the silent blank the ruling forbids.
 *
 * ## The composition this file also pins — REWRITTEN by #16422
 *
 * `stat()` reads `record.updatedAt` out of `rowToRecord`. That step used to
 * canonicalise through the SEPARATE `isoFromValidDate` helper (#14037), which
 * handed an Invalid `Date` through UNCHANGED, so the bad value reached
 * `canonicalIsoInstant` here as a `Date` and THIS arm was the one that had to
 * be total. #16422 collapsed `rowToRecord` onto `canonicalIsoInstant` itself
 * and deleted that helper, so the fold now happens one step EARLIER and
 * `stat()` receives `undefined`.
 *
 * ⚠️ Two consequences, both asserted below rather than described:
 *
 *  1. `stat()`'s arm is still live and still total — it is the nullish arm
 *     that answers now, not the `Date` arm. §A's first case is unchanged and
 *     still publishes a `mtime` the declared schema accepts.
 *  2. `record.updatedAt ?? record.createdAt` resolves DIFFERENTLY for a row
 *     whose `updated_at` is unreadable and whose `created_at` is good. The
 *     Invalid `Date` used to win that `??` — a `Date` is truthy and not
 *     nullish — and the row published `new Date()`; it now loses it and the
 *     row publishes `created_at`. That is a real, deliberate behaviour change
 *     on a published read surface: a stored instant replacing a fabricated
 *     one, and exactly the "same chain an absent column takes" that #14078's
 *     own ruling text prescribes for the shape. §A's second case is rewritten
 *     to assert it, ⛔ not left to fail and ⛔ not deleted.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { MetadataStatsSchema } from '@objectstack/spec/system';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { DatabaseLoader } from './database-loader.js';

type Row = Record<string, unknown>;

/** Canonical ISO-8601 UTC with milliseconds — what `mtime` is declared as. */
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Non-zero milliseconds, so a truncating regression stays observable. */
const PG_INSTANT = new Date('2026-03-04T05:06:07.089Z');
const SQLITE_TEXT = '2026-03-04T05:06:07.089Z';

/**
 * The removed guard, reproduced: the OLD arm's expression on the very object
 * the case plants. Red here means the fixture is no longer the contested shape
 * and every assertion below would be vacuous.
 */
function assertOldSpellingWouldThrow(value: Date): void {
  expect(value, 'fixture degraded — not a Date').toBeInstanceOf(Date);
  expect(Number.isNaN(value.getTime()), 'fixture is a VALID Date — case is vacuous').toBe(true);
  expect(() => value.toISOString()).toThrow(RangeError);
}

/**
 * Minimal read-only engine double — the same shape the #14037 sibling in this
 * directory uses. Stores and returns exactly what it is handed, so a `Date`
 * planted in a row survives to the read door the way a live driver's would.
 */
function makeReadEngine(tables: Record<string, Row[]>) {
  const matches = (r: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`engine double: unsupported operator ${k}`);
      return v === undefined || r[k] === v;
    });
  const rowsOf = (table: string): Row[] => tables[table] ?? [];
  return {
    async find(table: string, opts: { where: Record<string, unknown>; limit?: number }) {
      const matched = rowsOf(table).filter((r) => matches(r, opts?.where));
      return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
    },
    async findOne(table: string, opts: { where: Record<string, unknown> }) {
      assertEngineFindOnePredicate(table, opts);
      return rowsOf(table).find((r) => matches(r, opts.where)) ?? null;
    },
    async count(table: string, opts: { where: Record<string, unknown> }) {
      return rowsOf(table).filter((r) => matches(r, opts?.where)).length;
    },
  } as unknown as IDataEngine;
}

function metadataRow(overrides: Row = {}): Row {
  return {
    id: 'meta_1', name: 'case_grid', type: 'view', namespace: 'default',
    managed_by: 'platform', scope: 'platform', state: 'active', version: 3,
    metadata: { name: 'case_grid', object: 'case' },
    checksum: 'sha256-abc', source: 'database',
    created_by: 'usr_1', updated_by: 'usr_1',
    ...overrides,
  };
}

describe('[#14078] DatabaseLoader.stat — an Invalid Date yields the caller fallback, not a RangeError', () => {
  let tables: Record<string, Row[]>;
  const loaderFor = (row: Row) => {
    tables = { sys_metadata: [row], sys_metadata_history: [] };
    return new DatabaseLoader({ engine: makeReadEngine(tables) });
  };

  beforeEach(() => {
    tables = { sys_metadata: [], sys_metadata_history: [] };
  });

  describe('§A the contested shape', () => {
    it('publishes a parseable mtime instead of throwing', async () => {
      const bad = new Date(NaN);
      assertOldSpellingWouldThrow(bad);

      const before = Date.now();
      const stats = await loaderFor(metadataRow({ updated_at: bad, created_at: bad })).stat('view', 'case_grid');
      const after = Date.now();

      expect(stats).not.toBeNull();
      expect(stats!.mtime).toMatch(ISO_Z);
      const stamped = Date.parse(stats!.mtime!);
      expect(stamped).toBeGreaterThanOrEqual(before);
      expect(stamped).toBeLessThanOrEqual(after);

      // ⛔ The two answers the ruling forbids at THIS arm: the visible text
      // (which `z.string().datetime()` refuses downstream) and the blank.
      expect(stats!.mtime).not.toBe('Invalid Date');
      expect(stats!.mtime).not.toBe('');

      // The declared contract — `mtime` is `z.string().datetime()`, so this
      // limb is exactly what rules the visible text out at this call site.
      const parsed = MetadataStatsSchema.safeParse(stats);
      expect(parsed.success, JSON.stringify((parsed as { error?: { issues: unknown } }).error?.issues)).toBe(true);
    });

    it('[#16422] an unreadable updated_at now falls through to created_at, a stored instant', async () => {
      const bad = new Date(NaN);
      assertOldSpellingWouldThrow(bad);

      // BEFORE #16422 this case asserted the opposite: `rowToRecord` handed
      // the Invalid `Date` straight through, so `record.updatedAt ??
      // record.createdAt` saw a truthy, non-nullish `Date`, the `??` did not
      // fall through, and `stat` published `new Date()`.
      //
      // AFTER #16422 `rowToRecord` folds it to `undefined` — #14078's own
      // ruled answer for the shape — so the `??` DOES fall through and the
      // row publishes its `created_at`. The change is deliberate and is the
      // better answer: `new Date()` claimed the record had been modified at
      // read time, a fact nobody measured, while `created_at` is an instant
      // actually on disk. ⛔ It is not a widening: an Invalid `updated_at` is
      // indistinguishable from an absent one to every reader of `mtime`, and
      // #14078's ruling text prescribes exactly "the same `?? <default>` chain
      // an absent column takes".
      const stats = await loaderFor(metadataRow({ updated_at: bad, created_at: PG_INSTANT })).stat('view', 'case_grid');

      expect(stats!.mtime).toBe(PG_INSTANT.toISOString());
      expect(stats!.mtime).toMatch(ISO_Z);
      expect(MetadataStatsSchema.safeParse(stats).success).toBe(true);
    });

    it('[#16422] with BOTH columns unreadable the caller default still answers', async () => {
      const bad = new Date(NaN);
      assertOldSpellingWouldThrow(bad);

      // Nothing to fall through to, so `stat`'s own `?? new Date().toISOString()`
      // is what answers — the arm that has to be total, still reached, just by
      // the nullish input rather than by the `Date` one.
      const before = Date.now();
      const stats = await loaderFor(metadataRow({ updated_at: bad, created_at: bad })).stat('view', 'case_grid');
      const after = Date.now();

      expect(stats!.mtime).toMatch(ISO_Z);
      const stamped = Date.parse(stats!.mtime!);
      expect(stamped).toBeGreaterThanOrEqual(before);
      expect(stamped).toBeLessThanOrEqual(after);
      expect(MetadataStatsSchema.safeParse(stats).success).toBe(true);
    });
  });

  describe('§B the guard discriminates — the arm it guards still works', () => {
    it('canonicalises a VALID Date byte-exactly', async () => {
      const stats = await loaderFor(metadataRow({ updated_at: PG_INSTANT })).stat('view', 'case_grid');
      expect(stats!.mtime).toBe(PG_INSTANT.toISOString());
    });

    it('leaves an already-canonical SQLite string byte-identical', async () => {
      const stats = await loaderFor(metadataRow({ updated_at: SQLITE_TEXT })).stat('view', 'case_grid');
      expect(stats!.mtime).toBe(SQLITE_TEXT);
    });
  });

  describe('§C [#16422] the composition after the collapse, stated as an assertion', () => {
    it('rowToRecord absorbs the Invalid Date FIRST — this arm then answers for `undefined`', async () => {
      const bad = new Date(NaN);
      const loader = loaderFor(metadataRow({ updated_at: bad }));

      // `rowToRecord` is the step before `stat`'s own. Until #16422 it routed
      // through the separate `isoFromValidDate` helper and passed this shape
      // through untouched, so `stat` received a `Date`. It now routes through
      // `canonicalIsoInstant` itself, so `stat` receives `undefined` and the
      // arm under test is reached by the NULLISH input instead. Asserted, not
      // assumed: if the fold ever moves again, this is where it shows.
      const record = (loader as unknown as { rowToRecord(r: Row): Record<string, unknown> })
        .rowToRecord(metadataRow({ updated_at: bad }));
      expect(record.updatedAt).toBeUndefined();
      expect(record.updatedAt).not.toBeInstanceOf(Date);

      // …and `stat`'s own `?? new Date().toISOString()` is what turns that
      // into a contract-satisfying stat. Still total, still live, ⛔ not dead:
      // a non-SQL driver materialises its own `Date`s and `stat` is reachable
      // with a `Date` from every row shape `rowToRecord` does not own.
      const stats = await loader.stat('view', 'case_grid');
      expect(MetadataStatsSchema.safeParse(stats).success).toBe(true);
    });

    it('the `Date` arm of this helper is still exercised directly, by the collapsed sites', () => {
      // ⛔ The point of the assertion above is NOT that the `Date` arm became
      // unnecessary. #16422 moved it: `rowToRecord` is now the caller that
      // hands a `Date` to `canonicalIsoInstant`, so the arm runs one frame
      // earlier and its output is what `stat` reads.
      const loader = loaderFor(metadataRow({}));
      const record = (loader as unknown as { rowToRecord(r: Row): Record<string, unknown> })
        .rowToRecord(metadataRow({ updated_at: PG_INSTANT }));
      expect(record.updatedAt).toBe(PG_INSTANT.toISOString());
    });
  });
});
