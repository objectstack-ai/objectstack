// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#37258] A `storage: { notNull: true }` field added to an object whose table
 * already holds rows is added NULLABLE by the schema sync, reported as
 * `tighten_not_null` drift, and the object stays writable.
 *
 * # What was wrong
 *
 * The additive sync emitted `ALTER TABLE … ADD COLUMN … NOT NULL` with no
 * DEFAULT. Every existing row would hold NULL in the new column, so SQLite
 * refuses the statement (`Cannot add a NOT NULL column with default value
 * NULL`) and Postgres refuses it too (`column … contains null values`). The
 * failure aborted that object's whole sync, and the object became unwritable
 * on upgrade.
 *
 * `storage.notNull`'s own contract (`FieldSchema.storage`, ADR-0113) says what
 * declaring the constraint over existing null rows is: "a destructive
 * migration gated by the schema-drift ceremony (backfill first)". A new column
 * on a populated table is exactly that, so the sync adds the column the only
 * way the database accepts, and the differ — which compares the column against
 * `storage.notNull` — reports the `tighten_not_null` the ceremony performs
 * after the backfill. `required` is the engine's write contract and is
 * untouched by any of this.
 *
 * # What is pinned, per live dialect cell
 *
 * 1. Populated table: the sync succeeds; the added column exists NULLABLE; the
 *    drift report carries `tighten_not_null` for it (scalar and multi-value
 *    alike); a write providing the field succeeds and reads back.
 * 2. Populated table, the field also declares a literal `defaultValue`: the
 *    column is added NOT NULL as before — the database fills existing rows
 *    from the DEFAULT, so there is nothing to defer and no drift.
 * 3. Empty table: the column is added NOT NULL as before, with no drift —
 *    there are no existing rows for the constraint to be declared over.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import type { ManagedDriftEntry } from './schema-drift.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const MATRIX = 'ADD COLUMN of a storage.notNull field (#37258)';

const V1 = (name: string) => ({ name, fields: { plain: { type: 'text' } } });

/** The upgrade: three `storage.notNull` fields the table does not have yet. */
const V2 = (name: string) => ({
  name,
  fields: {
    plain: { type: 'text' },
    added: { type: 'text', required: true, storage: { notNull: true } },
    added_tags: { type: 'tags', storage: { notNull: true } },
    added_dflt: { type: 'text', storage: { notNull: true }, defaultValue: 'd' },
  },
});

const opsOf = (entries: readonly ManagedDriftEntry[]) => entries.map((e) => `${e.op.type}:${e.column}`).sort();

function declareAddColumnNotNullSuite(cell: DialectCell): void {
  describe(`ADD COLUMN of a storage.notNull field — ${cell.label} (#37258)`, () => {
    const POPULATED = 'nn_add_populated';
    const EMPTY = 'nn_add_empty';
    let driver: SqlDriver;

    const columns = async (table: string) =>
      (await driver.getKnex()(table).columnInfo()) as unknown as Record<string, { nullable: boolean }>;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      const quiet = () => {};
      (driver as unknown as { logger: unknown }).logger = { info: quiet, warn: quiet, error: quiet, debug: quiet };
      await driver.connect();
      for (const t of [POPULATED, EMPTY]) {
        await driver.getKnex().schema.dropTableIfExists(t);
        await driver.syncSchema(t, V1(t));
      }
      await driver.create(POPULATED, { plain: 'existing' });
    });

    afterAll(async () => {
      for (const t of [POPULATED, EMPTY]) await driver?.getKnex().schema.dropTableIfExists(t).catch(() => {});
      await driver?.disconnect().catch(() => {});
    });

    describe('a table that already holds rows', () => {
      beforeAll(async () => {
        await driver.syncSchema(POPULATED, V2(POPULATED));
      });

      it('adds the declared column nullable, scalar and multi-value alike', async () => {
        const cols = await columns(POPULATED);
        expect(cols.added?.nullable).toBe(true);
        expect(cols.added_tags?.nullable).toBe(true);
      });

      it('keeps NOT NULL where the field declares a literal default the existing rows take', async () => {
        expect((await columns(POPULATED)).added_dflt?.nullable).toBe(false);
        const rows = await driver.getKnex()(POPULATED).select('added_dflt');
        expect(rows.map((r: { added_dflt: unknown }) => r.added_dflt)).toEqual(['d']);
      });

      it('reports tighten_not_null for each column it added nullable, and for no other', async () => {
        const ops = opsOf(await driver.detectManagedDrift([V2(POPULATED)]));
        expect(ops).toContain('tighten_not_null:added');
        expect(ops).toContain('tighten_not_null:added_tags');
        expect(ops).not.toContain('tighten_not_null:added_dflt');
      });

      // [#37320] The DEFAULT the column took is the one the field declares, so
      // the differ proposes nothing for it at all — not a `set_column_default`
      // restating it. MySQL reports a TEXT column's DEFAULT in its expression
      // spelling, and that is the shape that must not read as a different
      // literal (the restate statement is refused on a TEXT column there).
      it('reports no drift for the column that took its declared literal default', async () => {
        const ops = opsOf(await driver.detectManagedDrift([V2(POPULATED)]));
        expect(ops.filter((o) => o.endsWith(':added_dflt'))).toEqual([]);
      });

      it('the object stays writable', async () => {
        const created: any = await driver.create(POPULATED, { plain: 'new', added: 'named', added_tags: ['t'] });
        const row: any = await driver.findOne(POPULATED, { where: { id: created.id } });
        expect(row.added).toBe('named');
        expect(row.added_dflt).toBe('d');
      });
    });

    describe('an empty table', () => {
      it('adds the declared column NOT NULL, with no drift', async () => {
        await driver.syncSchema(EMPTY, V2(EMPTY));
        const cols = await columns(EMPTY);
        expect(cols.added?.nullable).toBe(false);
        expect(cols.added_tags?.nullable).toBe(false);
        expect(opsOf(await driver.detectManagedDrift([V2(EMPTY)])).filter((o) => o.startsWith('tighten_not_null'))).toEqual([]);
      });
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, MATRIX, declareAddColumnNotNullSuite);
}
