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
 * ## The composition this file also pins
 *
 * `stat()` reads `record.updatedAt` out of `rowToRecord`, which canonicalises
 * through the SEPARATE `isoFromValidDate` helper (#14037) — and that helper
 * hands an Invalid `Date` through UNCHANGED by design. So the bad value
 * reaches `canonicalIsoInstant` as a `Date`, not as text, and this arm is the
 * one that has to be total. §C states that as an assertion so the two helpers
 * cannot drift apart unnoticed.
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

    it('falls back for updated_at alone, without letting `??` mistake it for absent', async () => {
      const bad = new Date(NaN);
      assertOldSpellingWouldThrow(bad);

      // `canonicalIsoInstant(record.updatedAt ?? record.createdAt)` — an
      // Invalid `Date` is NOT nullish, so `??` does not fall through to
      // `created_at`. The guard, not the `??`, is what makes this total.
      const stats = await loaderFor(metadataRow({ updated_at: bad, created_at: PG_INSTANT })).stat('view', 'case_grid');

      expect(stats!.mtime).not.toBe(PG_INSTANT.toISOString());
      expect(stats!.mtime).toMatch(ISO_Z);
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

  describe('§C the composition with #14037 `isoFromValidDate`, stated as an assertion', () => {
    it('hands the Invalid Date to this arm as a Date — the other helper does NOT convert it', async () => {
      const bad = new Date(NaN);
      const loader = loaderFor(metadataRow({ updated_at: bad }));

      // `rowToRecord` is the step before `stat`'s own; it routes through the
      // separate `isoFromValidDate` helper, which passes this shape through
      // untouched. If that ever changes, the arm under test stops being the
      // one that has to be total and this file should be re-read.
      const record = (loader as unknown as { rowToRecord(r: Row): Record<string, unknown> })
        .rowToRecord(metadataRow({ updated_at: bad }));
      expect(record.updatedAt).toBe(bad);
      expect(record.updatedAt).toBeInstanceOf(Date);

      // …and the total arm is what turns that into a contract-satisfying stat.
      const stats = await loader.stat('view', 'case_grid');
      expect(MetadataStatsSchema.safeParse(stats).success).toBe(true);
    });
  });
});
