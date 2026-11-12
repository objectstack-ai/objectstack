// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32590] Publishing a field change on a live object updated the metadata and
 * left the table as it was. Two shapes, both measured on the pre-fix tree on
 * better-sqlite3 and Postgres 16 through `syncSchema`, the call the publish
 * makes:
 *
 *   - `date` → `datetime` (a change the field-type table says "passes
 *     cleanly"): Postgres kept the `date` column, so every time written after
 *     the publish was dropped at the column; SQLite kept the field in the
 *     driver's date registry, so the read collapsed the value to its day.
 *   - `required: true` → `false` with `storage: { notNull: false }`: the column
 *     kept its NOT NULL, so every create omitting the field was refused by the
 *     database while the declaration said it was optional.
 *
 * `syncSchema` is additive by contract (ADR-0104) and stays so — the fixture
 * case below pins that it still alters nothing. What changed is that the
 * publish now asks for the column half by name,
 * `SqlDriver.applyPublishedColumnChanges`, and this file pins what that door
 * applies, what it leaves alone, and the differ entries it selects from.
 *
 * ## The differ half: every dialect's spelling, no database
 *
 * The `date` → `datetime` widening is a new `safe` entry on Postgres and MySQL
 * only — SQLite has no temporal column type, so there is nothing to widen and
 * the entry must not appear there. The explicit `storage: { notNull: false }`
 * over a NOT NULL column is reported whatever `required` says, and stays
 * ADR-0113 D5's `needs_confirm`, so dev auto-reconcile still never applies it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import { diffManagedTable, type ManagedDriftEntry, type PhysicalColumn, type SqlDialectName } from './schema-drift.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const MATRIX = 'published column changes (#32590)';

const diff = (fields: Record<string, unknown>, columns: PhysicalColumn[], dialect: SqlDialectName) =>
  diffManagedTable({ table: 'leave_req', fields: fields as any, columns, dialect });

// ── Half 1: the differ ─────────────────────────────────────────────────────

describe('diffManagedTable — a `datetime` declaration over a `date` column (#32590)', () => {
  const dateColumn: PhysicalColumn[] = [{ name: 'start_date', type: 'date', nullable: true }];

  it.each([
    ['postgres', 'timestamptz'],
    ['mysql', 'datetime(3)'],
  ] as const)('%s: one `safe` widen entry on the right column, naming both types', (dialect, expected) => {
    const out = diff({ start_date: { type: 'datetime' } }, dateColumn, dialect);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      table: 'leave_req',
      column: 'start_date',
      kind: 'type_mismatch',
      expected,
      actual: 'date',
      category: 'safe',
      op: { type: 'widen_date_to_datetime', table: 'leave_req', column: 'start_date' },
    });
    expect(out[0].message).toContain('leave_req.start_date');
    expect(out[0].message).toContain('keeps only the calendar day');
    expect(out[0].message).toContain('publishing the object applies it');
  });

  it('sqlite: silent — the column has no temporal type to widen', () => {
    expect(diff({ start_date: { type: 'datetime' } }, dateColumn, 'sqlite')).toEqual([]);
  });

  it('a `datetime` column under a `datetime` field is silent on every dialect (no false positive)', () => {
    expect(diff({ at: { type: 'datetime' } }, [{ name: 'at', type: 'timestamp with time zone', nullable: true }], 'postgres')).toEqual([]);
    expect(diff({ at: { type: 'datetime' } }, [{ name: 'at', type: 'datetime', nullable: true }], 'mysql')).toEqual([]);
  });

  it('a `date` field over a `date` column is silent, and the reverse narrowing proposes no op', () => {
    expect(diff({ d: { type: 'date' } }, [{ name: 'd', type: 'date', nullable: true }], 'postgres')).toEqual([]);
    const narrowed = diff({ d: { type: 'date' } }, [{ name: 'd', type: 'timestamp with time zone', nullable: true }], 'postgres');
    expect(narrowed.map((e) => e.op.type)).not.toContain('widen_date_to_datetime');
  });
});

describe('diffManagedTable — a NOT NULL column under `storage: { notNull: false }` (#32590)', () => {
  const notNull: PhysicalColumn[] = [{ name: 'title', type: 'text', nullable: false }];

  it.each(['sqlite', 'postgres', 'mysql'] as const)('%s: a relax entry, still `needs_confirm`, naming the declaration', (dialect) => {
    const out = diff({ title: { type: 'text', required: false, storage: { notNull: false } } }, notNull, dialect);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      column: 'title',
      kind: 'nullability_mismatch',
      expected: 'NULL',
      actual: 'NOT NULL',
      category: 'needs_confirm',
      op: { type: 'relax_not_null', table: 'leave_req', column: 'title' },
    });
    expect(out[0].message).toContain('`storage: { notNull: false }`');
    expect(out[0].message).toContain('publishing the object applies it');
    expect(out[0].message).not.toContain('declares no storage constraint');
  });

  it('is reported under `required: true` too — the declaration, not the write gate, owns the column', () => {
    const out = diff({ title: { type: 'text', required: true, storage: { notNull: false } } }, notNull, 'postgres');
    expect(out.map((e) => [e.op.type, e.category])).toEqual([['relax_not_null', 'needs_confirm']]);
  });

  it('the UNDECLARED shapes are unchanged: needs_confirm without `required`, silent with it (ADR-0113 D5)', () => {
    const plain = diff({ title: { type: 'text' } }, notNull, 'postgres');
    expect(plain).toHaveLength(1);
    expect(plain[0].category).toBe('needs_confirm');
    expect(plain[0].message).toContain('declares no storage constraint');
    expect(diff({ title: { type: 'text', required: true } }, notNull, 'postgres')).toEqual([]);
  });
});

// ── Half 2: the publish's column half, on a live table ──────────────────────

const TABLE = 'pub32590_leave';

/** What the object looked like when its table was created. */
const V1 = {
  name: TABLE,
  fields: {
    title: { type: 'text', required: true, storage: { notNull: true } },
    start_date: { type: 'date', required: true },
    // NOT NULL at creation, then its `storage` declaration is REMOVED rather
    // than written `false`: the undeclared case, which the publish must leave
    // alone (ADR-0113 D5 — nobody said to relax it).
    code: { type: 'text', storage: { notNull: true } },
  },
};

/** The published change: the two the card reports, and the undeclared control. */
const V2 = {
  name: TABLE,
  fields: {
    title: { type: 'text', required: false, storage: { notNull: false } },
    start_date: { type: 'datetime', required: true },
    code: { type: 'text' },
  },
};

const LATER = '2026-11-13T01:30:00.000Z';

const opsOf = (entries: readonly ManagedDriftEntry[]) => entries.map((e) => `${e.op.type}:${e.column}`).sort();

function declarePublishedColumnSuite(cell: DialectCell): void {
  describe(`the publish's column half — ${cell.label} (#32590)`, () => {
    const widens = cell.id !== 'sqlite';
    const logged: string[] = [];
    let driver: SqlDriver;
    let before: Record<string, { type: string; nullable: boolean }>;
    let report: { applied: ManagedDriftEntry[]; skipped: ManagedDriftEntry[] };
    let after: Record<string, { type: string; nullable: boolean }>;
    let keptId: string;
    let editedId: string;

    const columns = async () => (await driver.getKnex()(TABLE).columnInfo()) as unknown as Record<string, { type: string; nullable: boolean }>;

    beforeAll(async () => {
      const sink = (m: unknown) => logged.push(String(m));
      driver = new SqlDriver(cell.config());
      // The driver's logger is its own; the neighbouring drift suites capture
      // it the same way (`schema-drift.base-type-mismatch.test.ts`).
      (driver as unknown as { logger: unknown }).logger = { info: sink, warn: sink, error: sink, debug: () => {} };
      await driver.connect();
      await driver.getKnex().schema.dropTableIfExists(TABLE);

      // 1. the live table, with rows written under the old declaration
      await driver.syncSchema(TABLE, V1);
      keptId = String((await driver.create(TABLE, { title: 'kept', start_date: '2026-11-12', code: 'k' })).id);
      editedId = String((await driver.create(TABLE, { title: 'edited', start_date: '2026-11-12', code: 'e' })).id);

      // 2. the publish: its storage sync (additive) …
      await driver.syncSchema(TABLE, V2);
      before = await columns();
      // … then the column half it now asks for
      report = await driver.applyPublishedColumnChanges(V2);
      after = await columns();
    });

    afterAll(async () => {
      await driver?.getKnex().schema.dropTableIfExists(TABLE).catch(() => {});
      await driver?.disconnect().catch(() => {});
    });

    it('the fixture is real: the additive sync alone left NOT NULL (and, off SQLite, the `date` column) in place', () => {
      // Non-vacuity, and ADR-0104's "syncSchema stays additive" in one breath:
      // every assertion below is about what the column half changed.
      expect(before.title.nullable).toBe(false);
      expect(before.code.nullable).toBe(false);
      if (widens) expect(String(before.start_date.type).toLowerCase()).toBe('date');
    });

    it('applies exactly the declared relax and, off SQLite, the widening — and reports nothing skipped', () => {
      expect(opsOf(report.applied)).toEqual(
        widens ? ['relax_not_null:title', 'widen_date_to_datetime:start_date'] : ['relax_not_null:title'],
      );
      expect(report.skipped).toEqual([]);
      for (const e of report.applied) {
        expect(logged).toContain(`[schema-drift] the publish of '${TABLE}' applied ${e.op.type} on ${TABLE}.${e.column}`);
      }
    });

    it('the columns follow the declaration', () => {
      expect(after.title.nullable).toBe(true);
      if (widens) expect(String(after.start_date.type).toLowerCase()).toMatch(cell.id === 'pg' ? /^timestamp with time zone$/ : /^datetime$/);
    });

    it('an ISO datetime written after the publish reads back with its time', async () => {
      await driver.update(TABLE, editedId, { start_date: LATER });
      const row: any = await driver.findOne(TABLE, { where: { id: editedId } } as any);
      expect(row.start_date).toBe(LATER);
    });

    it('a day stored before the publish keeps its day', async () => {
      const row: any = await driver.findOne(TABLE, { where: { id: keptId } } as any);
      expect(String(row.start_date).slice(0, 10)).toBe('2026-11-12');
    });

    it('a create omitting the field the declaration made optional succeeds', async () => {
      const created: any = await driver.create(TABLE, { start_date: LATER, code: 'n' });
      const row: any = await driver.findOne(TABLE, { where: { id: created.id } } as any);
      expect(row.title ?? null).toBeNull();
      expect(row.start_date).toBe(LATER);
    });

    it('leaves the UNDECLARED NOT NULL alone — nobody said to relax it (ADR-0113 D5)', async () => {
      expect(after.code.nullable).toBe(false);
      expect(opsOf(report.applied)).not.toContain('relax_not_null:code');
      await expect(driver.create(TABLE, { title: 't', start_date: LATER })).rejects.toThrow();
    });

    it('is idempotent: a second publish finds nothing left to apply', async () => {
      const again = await driver.applyPublishedColumnChanges(V2);
      expect(again).toEqual({ applied: [], skipped: [] });
      const left = await driver.detectManagedDrift([V2]);
      expect(opsOf(left)).toEqual(['relax_not_null:code']);
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, MATRIX, declarePublishedColumnSuite);
}
