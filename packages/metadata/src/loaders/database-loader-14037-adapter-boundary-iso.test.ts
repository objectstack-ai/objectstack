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
 * When this landed, the assertion was false on Postgres and MySQL for BOTH
 * column classes: `SqlDriver#formatOutput` repaired the builtin audit columns
 * (`repairNaiveUtcAuditTimestamp`) and folded declared `Field.datetime` columns
 * (`normalizeSqliteDatetimeOutput`) only inside its `if (this.isSqlite)` arm,
 * so `recorded_at` being a declared `Field.datetime` on `sys_metadata_history`
 * did not protect it either. #13973 ([ADR-0053 D-F1]) has since lifted both
 * passes out of that gate — they run on EVERY dialect — and the pin that
 * recorded the asymmetry now records the canonical-text contract
 * (`packages/drivers/driver-sql/src/sql-driver-13567-audit-stamp-materialisation.test.ts`
 * §B, inverted on purpose).
 *
 * ⚠️ `withPostgresCalendarDayAsText` is untouched by that ruling and still
 * leaves `timestamptz` / `timestamp` deliberately alone ([ADR-0053 D-F2]) — the
 * client still hands back a `Date`; the driver now folds it at its own read
 * boundary. And the `Date` domain these cases pin did not close: an INVALID
 * `Date` still leaves `driver-sql` unchanged ([ADR-0053 D-F3]), and non-SQL
 * drivers materialise their own. So these cases pin a live adapter arm, not a
 * historical one — what they own is the adapter's behaviour per input shape.
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
 * §D WAS the #14078 neutrality pin — "an Invalid `Date` must reach the
 * consumer UNCHANGED, exactly as these casts pass it through" — written to go
 * red the moment anyone swapped the shared spelling in. #16422 made that swap
 * DELIBERATELY, so §D is rewritten as the RULED pin rather than kept or
 * deleted, and it now asserts the terminal value chosen at each boundary.
 * They are NOT one value: `MetadataRecord.createdAt` / `.updatedAt` are
 * `.optional()` and take `undefined`, while `MetadataHistoryRecord.recordedAt`
 * is REQUIRED and takes the epoch from `recordedAtFallback()` — the site this
 * card was filed for, and the one with no legal terminal value at all before
 * the change.
 *
 * ⚠️ The casts those lines carried (`as string | undefined`, `as string`) are
 * gone, not restated: `canonicalIsoInstant` RETURNS `string | undefined`, so
 * the declared type is a measurement now. §A/§B/§C are unchanged — a valid
 * `Date` and a canonical string were never shapes the two helpers disagreed
 * on.
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

  describe('§D [#16422] RULED — the terminal value per site, and the schemas now accept it', () => {
    /**
     * This section was the #14078 NEUTRALITY pin, asserting these boundaries
     * hand an Invalid `Date` through UNCHANGED. It was written to go red on
     * exactly the swap #16422 then performed, and is rewritten rather than
     * deleted because that swap was deliberate and carries its own evidence.
     *
     * The card exists because `MetadataHistoryRecord.recordedAt` is a REQUIRED
     * `z.string().datetime()` for which NONE of the three candidate answers
     * was legal: the visible text `"Invalid Date"` fails the refinement,
     * `undefined` fails the required field, and the pass-through fed it a
     * `Date` object, which fails both. The third answer is a caller-side
     * default — `recordedAtFallback()`, the epoch — and this is its pin.
     *
     * `MetadataRecord.createdAt` / `.updatedAt` are `.optional()`, so their
     * terminal value is `undefined` and no default is invented there. Two
     * different answers on purpose; a single one would have been the tell that
     * nobody followed each site to its declared schema.
     */
    const INVALID = new Date(NaN);

    it('recordedAt: the epoch, and MetadataHistoryRecordSchema now accepts the record', async () => {
      expect(INVALID).toBeInstanceOf(Date);
      expect(Number.isNaN(INVALID.getTime())).toBe(true);
      // Non-vacuity: the shape really is the one with no canonical text.
      expect(() => INVALID.toISOString()).toThrow(RangeError);

      tables.sys_metadata_history.push(historyRow({ recorded_at: INVALID }));

      const record = await loader.getHistoryRecord('view', 'case_grid', 3);

      expect(record!.recordedAt).toBe(new Date(0).toISOString());
      // ⛔ NOT the retired pass-through, which is what this section used to
      // assert and what the declared schema refused.
      expect(record!.recordedAt).not.toBe(INVALID as unknown as string);

      const parsed = MetadataHistoryRecordSchema.safeParse(record);
      expect(parsed.success, JSON.stringify((parsed as { error?: { issues: unknown } }).error?.issues)).toBe(true);
    });

    it('queryHistory takes the same terminal value — the two doors do not drift', async () => {
      tables.sys_metadata_history.push(historyRow({ recorded_at: INVALID }));

      const { records } = await loader.queryHistory('view', 'case_grid');

      expect(records[0].recordedAt).toBe(new Date(0).toISOString());
      expect(MetadataHistoryRecordSchema.safeParse(records[0]).success).toBe(true);
    });

    it('createdAt / updatedAt: `undefined`, because the declared field is optional', () => {
      const viaRecord = rowToRecordVia(loader, metadataRow({ created_at: INVALID, updated_at: INVALID }));

      expect(viaRecord.updatedAt).toBeUndefined();
      expect(viaRecord.createdAt).toBeUndefined();
      // ⛔ Specifically NOT the epoch: inventing a creation instant for a
      // field the schema lets be absent would be a fabricated fact.
      expect(viaRecord.updatedAt).not.toBe(new Date(0).toISOString());

      expect(MetadataRecordSchema.safeParse(viaRecord).success).toBe(true);
    });

    it('a `null` column reaches the same terminal values — not just the Invalid `Date`', async () => {
      // The neutrality version measured ONE shape. The collapse moved four,
      // and `null` is the one a reader is most likely to assume was already
      // handled: it used to arrive as a literal `null` in fields declared
      // `string | undefined`, which both schemas refused.
      tables.sys_metadata_history.push(historyRow({ recorded_at: null }));
      const record = await loader.getHistoryRecord('view', 'case_grid', 3);
      expect(record!.recordedAt).toBe(new Date(0).toISOString());
      expect(MetadataHistoryRecordSchema.safeParse(record).success).toBe(true);

      const viaRecord = rowToRecordVia(loader, metadataRow({ created_at: null, updated_at: null }));
      expect(viaRecord.createdAt).toBeUndefined();
      expect(viaRecord.updatedAt).toBeUndefined();
      expect(MetadataRecordSchema.safeParse(viaRecord).success).toBe(true);
    });
  });
});
