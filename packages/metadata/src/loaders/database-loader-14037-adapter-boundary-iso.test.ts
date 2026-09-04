// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14037] The four `DatabaseLoader` adapter boundaries that assert a `string`
 * over a driver timestamp column must canonicalise what the live dialects
 * actually hand them: a JS `Date`.
 *
 * ## The defect
 *
 * `rowToRecord` reaches `createdAt` / `updatedAt` through
 * `row.created_at as string | undefined`, and both history adapters reach
 * `recordedAt` through `row.recorded_at as string`. All four are UNCHECKED
 * casts — an assertion about a driver row, never a measurement of one — which
 * is why tsc reported nothing.
 *
 * On Postgres and MySQL the assertion is false for BOTH column classes:
 * `SqlDriver#formatOutput` repairs the builtin audit columns
 * (`repairNaiveUtcAuditTimestamp`) and folds declared `Field.datetime` columns
 * (`normalizeSqliteDatetimeOutput`) only inside its `if (this.isSqlite)` arm,
 * and `withPostgresCalendarDayAsText` leaves `timestamptz` / `timestamp`
 * deliberately untouched. That dialect fact is pinned live in
 * `packages/drivers/driver-sql/src/sql-driver-13567-audit-stamp-materialisation.test.ts`.
 * `recorded_at` being a declared `Field.datetime` on `sys_metadata_history`
 * does NOT protect it — the fold is inside the SQLite arm too.
 *
 * All three declarations are `z.string().datetime()`
 * (`packages/spec/src/system/metadata-persistence.zod.ts`), a refinement a
 * `Date` fails outright. Nothing exploded only because no production path
 * parses these: `rowToRecord`'s output is consumed as an already-typed
 * `MetadataRecord` with nothing revalidating it.
 *
 * ## Why the fixtures drive a hand-made `Date`
 *
 * The same trap the #13997 sibling names: a fixture built from a hand-made
 * ISO string is already the declared shape before the adapter runs, so the
 * assertion and the input share an identity and the case measures nothing.
 * Every case here plants the one shape the live dialects produce and no
 * existing fixture ever did, and each carries a non-vacuity guard asserting
 * the planted value really is a `Date` before the output is read.
 *
 * ⛔ No driver dependency: `@objectstack/metadata` has none on `driver-sql`
 * and must not grow one. The `Date` is hand-made here for the reason the
 * #13567 pin states next door.
 *
 * ## What is asserted
 *
 * The declared contracts themselves — `MetadataRecordSchema.safeParse` and
 * `MetadataHistoryRecordSchema.safeParse` — not a hand-rolled regex standing
 * in for them. A bare `typeof` check would pass for reasons unrelated to the
 * `.datetime()` refinement that is the sharp edge here.
 *
 * §D is the #14078 NEUTRALITY pin and is load-bearing for this card's scope:
 * an Invalid `Date` must reach the consumer UNCHANGED, exactly as these casts
 * pass it through today. The shared `canonicalIsoInstant` spelling would
 * instead raise `RangeError: Invalid time value` there — measured reachable on
 * both live dialects — and whether it should is the open subject of #14078,
 * which #13973 is blocked on. This card imports neither answer, and §D goes
 * red the moment someone swaps the contested spelling in.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import {
  MetadataRecordSchema,
  MetadataHistoryRecordSchema,
} from '@objectstack/spec/system';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { DatabaseLoader } from './database-loader.js';

type Row = Record<string, unknown>;

/** Canonical instant text — exactly what `Date.prototype.toISOString` emits. */
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The instant every case drives, as Postgres and MySQL hand it out. Non-zero
 * milliseconds on purpose: `String(date)` and `date.toString()` both drop
 * them, so a truncating regression stays observable instead of coinciding
 * with the canonical text.
 */
const PG_INSTANT = new Date('2026-03-04T05:06:07.089Z');

/** What SQLite hands out for the same instant — already the declared shape. */
const SQLITE_TEXT = '2026-03-04T05:06:07.089Z';

/**
 * Minimal engine double. Stores and returns exactly what it is handed — no
 * key dropping, no coercion — so a `Date` planted in a row survives to the
 * read door the way a live driver's would.
 *
 * Read verbs only: this file drives no write path, so there is no write-verb
 * dispatch to pin (`check:engine-double-contract`). `findOne` asks the
 * producer's own #4419 predicate so the double cannot accept a call ObjectQL
 * refuses, and `find` applies the caller's `limit` BY PRESENCE and AFTER the
 * filter (`check:objectql-double-limit`).
 */
function makeReadEngine(tables: Record<string, Row[]>) {
  const matches = (r: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`engine double: unsupported operator ${k}`);
      if (v !== null && typeof v === 'object') {
        throw new Error(`engine double: unsupported operator object on ${k}`);
      }
      return v === undefined || r[k] === v;
    });

  const rowsOf = (table: string): Row[] => tables[table] ?? [];

  return {
    async find(table: string, opts: { where: Record<string, unknown>; limit?: number; offset?: number }) {
      const matched = rowsOf(table).filter((r) => matches(r, opts?.where));
      const offset = typeof opts?.offset === 'number' ? opts.offset : 0;
      const windowed = matched.slice(offset);
      return typeof opts?.limit === 'number' ? windowed.slice(0, opts.limit) : windowed;
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

/**
 * A `sys_metadata` row as the loader reads it. `metadata` is deliberately
 * absent: `rowToRecord` folds a missing payload to `{}` without entering the
 * stored-item conversion codec, which keeps every case below about the
 * timestamp columns rather than about the payload.
 */
function metadataRow(overrides: Row = {}): Row {
  return {
    id: 'meta_1',
    name: 'case_grid',
    type: 'view',
    namespace: 'default',
    managed_by: 'platform',
    scope: 'platform',
    state: 'active',
    version: 3,
    checksum: 'sha256-abc',
    source: 'database',
    created_by: 'usr_1',
    updated_by: 'usr_1',
    ...overrides,
  };
}

/** A `sys_metadata_history` row as the loader reads it. */
function historyRow(overrides: Row = {}): Row {
  return {
    id: 'hist_1',
    name: 'case_grid',
    type: 'view',
    version: 3,
    operation_type: 'update',
    metadata: { name: 'case_grid', object: 'case' },
    checksum: 'sha256-abc',
    previous_checksum: 'sha256-prev',
    change_note: 'tweak',
    recorded_by: 'usr_1',
    ...overrides,
  };
}

/**
 * Reach `rowToRecord` the way the loader's own callers do. It is private and
 * — measured on `origin/main` — no public method returns its `createdAt` /
 * `updatedAt`: `load()` reads only `record.checksum`, and `stat()` passes the
 * value through `canonicalIsoInstant` before publishing it as
 * `MetadataStats.mtime` (#13997). Driving `stat()` would therefore measure
 * that helper, not the cast this card is about.
 */
function rowToRecordVia(loader: DatabaseLoader, row: Row) {
  return (loader as unknown as { rowToRecord(r: Row): Record<string, unknown> }).rowToRecord(row);
}

describe('#14037 — DatabaseLoader adapter boundaries emit the declared ISO string', () => {
  let tables: Record<string, Row[]>;
  let loader: DatabaseLoader;

  beforeEach(() => {
    tables = { sys_metadata: [], sys_metadata_history: [] };
    loader = new DatabaseLoader({ engine: makeReadEngine(tables) });
  });

  describe('§A rowToRecord — createdAt / updatedAt, the BUILTIN audit columns', () => {
    it('emits canonical ISO strings when the row carries JS Dates', () => {
      const row = metadataRow({ created_at: PG_INSTANT, updated_at: PG_INSTANT });

      // Non-vacuity: a fixture that degraded to a string would keep this file
      // green while measuring the shape that was never broken.
      expect(row.created_at).toBeInstanceOf(Date);
      expect(row.updated_at).toBeInstanceOf(Date);

      const record = rowToRecordVia(loader, row);

      expect(typeof record.createdAt).toBe('string');
      expect(typeof record.updatedAt).toBe('string');
      expect(record.createdAt).toMatch(ISO_Z);
      expect(record.updatedAt).toMatch(ISO_Z);
      expect(record.createdAt).toBe(PG_INSTANT.toISOString());
      expect(record.updatedAt).toBe(PG_INSTANT.toISOString());

      // The declared contract itself. `createdAt` / `updatedAt` are
      // `z.string().datetime()` — a refinement a `Date` fails outright.
      const parsed = MetadataRecordSchema.safeParse(record);
      expect(parsed.success).toBe(true);
    });

    it('passes an already-canonical SQLite string through byte-identically', () => {
      const row = metadataRow({ created_at: SQLITE_TEXT, updated_at: SQLITE_TEXT });
      expect(typeof row.created_at).toBe('string');

      const record = rowToRecordVia(loader, row);

      // Idempotent: the dialect that was already correct must not be reshaped.
      expect(record.createdAt).toBe(SQLITE_TEXT);
      expect(record.updatedAt).toBe(SQLITE_TEXT);
    });

    it('leaves an absent column absent, so the callers keep their `??` meaning', () => {
      const record = rowToRecordVia(loader, metadataRow());

      expect(record.createdAt).toBeUndefined();
      expect(record.updatedAt).toBeUndefined();
    });
  });

  describe('§B getHistoryRecord — recordedAt, a declared Field.datetime', () => {
    it('emits a canonical ISO string when the history row carries a JS Date', async () => {
      const row = historyRow({ recorded_at: PG_INSTANT });
      tables.sys_metadata_history.push(row);
      expect(row.recorded_at).toBeInstanceOf(Date);

      const record = await loader.getHistoryRecord('view', 'case_grid', 3);

      expect(record).not.toBeNull();
      expect(typeof record!.recordedAt).toBe('string');
      expect(record!.recordedAt).toMatch(ISO_Z);
      expect(record!.recordedAt).toBe(PG_INSTANT.toISOString());

      const parsed = MetadataHistoryRecordSchema.safeParse(record);
      expect(parsed.success).toBe(true);
    });

    it('passes an already-canonical SQLite string through byte-identically', async () => {
      tables.sys_metadata_history.push(historyRow({ recorded_at: SQLITE_TEXT }));

      const record = await loader.getHistoryRecord('view', 'case_grid', 3);

      expect(record!.recordedAt).toBe(SQLITE_TEXT);
    });
  });

  describe('§C queryHistory — the same column, the other door', () => {
    it('emits a canonical ISO string for every row it maps', async () => {
      const rowA = historyRow({ id: 'hist_1', version: 3, recorded_at: PG_INSTANT });
      const rowB = historyRow({ id: 'hist_2', version: 2, recorded_at: PG_INSTANT });
      tables.sys_metadata_history.push(rowA, rowB);
      expect(rowA.recorded_at).toBeInstanceOf(Date);

      const page = await loader.queryHistory('view', 'case_grid');

      expect(page.records).toHaveLength(2);
      for (const record of page.records) {
        expect(typeof record.recordedAt).toBe('string');
        expect(record.recordedAt).toBe(PG_INSTANT.toISOString());
        expect(MetadataHistoryRecordSchema.safeParse(record).success).toBe(true);
      }
    });
  });

  describe('§D #14078 neutrality — an Invalid Date is NOT converted here', () => {
    /**
     * ⛔ This card does not decide #14078. An Invalid `Date` is measured
     * reachable on both live dialects (a MySQL zero datetime; any Postgres
     * year in 275760..294276), and whether the shared canonical-ISO spelling
     * should throw on it (option A) or fall back to a rendering (option B) is
     * a maintainer call across four packages. Until it is ruled, these sites
     * hand that one shape through exactly as they do today — no new throw, no
     * invented rendering. This case is what makes that a pin rather than a
     * claim.
     */
    const INVALID = new Date(NaN);

    it('hands the value through unchanged instead of raising RangeError', async () => {
      expect(INVALID).toBeInstanceOf(Date);
      expect(Number.isNaN(INVALID.getTime())).toBe(true);
      // The contested spelling's `Date` arm, on this input, for contrast.
      expect(() => INVALID.toISOString()).toThrow(RangeError);

      tables.sys_metadata_history.push(historyRow({ recorded_at: INVALID }));

      const record = await loader.getHistoryRecord('view', 'case_grid', 3);
      expect(record!.recordedAt).toBe(INVALID);

      const viaRecord = rowToRecordVia(loader, metadataRow({ updated_at: INVALID }));
      expect(viaRecord.updatedAt).toBe(INVALID);
    });
  });
});
