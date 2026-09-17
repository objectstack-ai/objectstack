// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17231] ADR-0113's column constraint reaches the MULTI-VALUE column too.
 *
 * ## The defect
 *
 * `SqlDriver.createColumn` decides the JSON column shape before its per-type
 * switch and used to `return` right there — above BOTH the nullability line and
 * the column DEFAULT. So `storage: { notNull: true }` on a multi-valued field
 * was silently inert on the platform's own table while both `os generate
 * migration` formats emitted the constraint (`"tags_nn" JSONB NOT NULL` /
 * `table.jsonb('tags_nn').notNullable()`, pinned in
 * `packages/cli/src/commands/generate-multiple-json-column.pin.test.ts`). An
 * INSERT omitting the field was accepted by the platform's table and refused by
 * both generated ones — one declaration, two databases.
 *
 * ## Which side moved, and why it is this one
 *
 * ADR-0113 P0 names the site verbatim — 「the physical constraint now keys off
 * the explicitly-authored `storage.notNull` at that same `#createColumn` site」 —
 * and lists `@objectstack/driver-sql` (`sql-driver.ts` column DDL,
 * `schema-drift.ts`) as its consumer. The ADR carves out no type: `storage.notNull`
 * is a field-level knob whose only declared exclusivity is `requiredWhen`
 * (`FieldSchema.superRefine`), and the ENTRANCE test below shows the multi-value
 * declaration parses green. So this was an implementation gap, not a decision:
 * 补实现, never narrowing the declaration at the consumer.
 *
 * ⚠️ The nearest counter-reading, answered rather than stepped over: ADR-0113's
 * Context row about the drift classifier records that 「imposing `NOT NULL` over
 * possibly-null data is the classifier's `destructive` class」. That is about an
 * EXISTING column acquiring a constraint — the `tighten_not_null` ceremony,
 * untouched here. `createColumn` runs on `CREATE TABLE` and on `ALTER TABLE ADD
 * COLUMN`, so the column it constrains is always empty, exactly as the #11431
 * note on the string-family arm already says for the varchar width.
 *
 * ## The parity that proves it internally
 *
 * ADR-0113's other named consumer in this package — `diffManagedTable` — already
 * compares `storage.notNull` against the physical column for every field
 * `fieldHasColumn` answers true for, and that includes multi-value columns
 * (`isMultiValueField` is its first question). Before this repair the platform
 * therefore reported DESTRUCTIVE `tighten_not_null` drift against a table it had
 * just created itself, on a table with no rows in it — the same self-inflicted
 * shape #11431 removed for `varchar` widths. The last test here is that parity,
 * driven: read the columns back out of the database the driver just built and
 * hand them to the differ.
 *
 * ## What this file deliberately does NOT assert
 *
 * A column DEFAULT on the multi-value path. Both generators skip it too
 * (`declaredColumnDefault` in `generate.ts`: 「the `multiple` shape has no scalar
 * DDL form」), so the producers already agree there and nothing diverges.
 *
 * @see SqlDriver.createColumn — the site ADR-0113 P0 names.
 * @see packages/cli/src/commands/generate-multiple-json-column.pin.test.ts — the
 *   generator side of the same pair, which is the side that was already right.
 * @see https://github.com/objectstack-ai/objectstack/issues/17231
 * @see https://github.com/objectstack-ai/objectstack/issues/17469 (the ONE
 *   definition of "multi-valued" this short-circuit now asks)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import { FieldSchema } from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';
import { diffManagedTable, type FieldDef, type PhysicalColumn, type SqlDialectName } from './schema-drift.js';
import {
  DIALECT_CELLS,
  declareUnprovisionedCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

/** Issue-prefixed: the live cells share one database with every other suite here. */
const PROBE_OBJECT = 'os17231_multi_notnull';

/**
 * The fixture, built as a 2×2 plus the harness control.
 *
 *   multi_nn     multi-valued + `storage.notNull` — THE SUBJECT
 *   multi_plain  multi-valued, no constraint      — the column must stay nullable
 *   multi_req    multi-valued + `required` only   — ADR-0113: the write contract
 *                                                   never binds the column
 *   scalar_nn    scalar + `storage.notNull`       — the HARNESS control: proves
 *                                                   this reader can observe a
 *                                                   NOT NULL at all, so a green
 *                                                   subject is a measurement
 *   scalar_plain scalar, no constraint            — the column-TYPE control
 */
const PROBE_FIELDS: Record<string, Record<string, unknown>> = {
  multi_nn: { type: 'lookup', reference: 'sys_user', multiple: true, storage: { notNull: true } },
  multi_plain: { type: 'lookup', reference: 'sys_user', multiple: true },
  multi_req: { type: 'lookup', reference: 'sys_user', multiple: true, required: true },
  scalar_nn: { type: 'string', storage: { notNull: true } },
  scalar_plain: { type: 'string' },
};

/** The differ speaks dialect names, the matrix speaks cell ids. */
const DIALECT_OF: Record<string, SqlDialectName> = { sqlite: 'sqlite', pg: 'postgres', mysql: 'mysql' };

describe('[#17231] the entrance — the declaration under repair is authorable', () => {
  /**
   * The reachability half. A rule about a VALUE (`storage.notNull === true`)
   * means nothing if the spec refuses the declaration carrying it, so this is
   * asserted as a full parse rather than as an absence of `unrecognized_keys`.
   * ADR-0113 gives `storage.notNull` exactly one exclusivity — `requiredWhen` —
   * and `multiple` is not it.
   */
  it('`multiple: true` + `storage: { notNull: true }` parses green', () => {
    const parsed = FieldSchema.safeParse({
      name: 'tags_nn', type: 'lookup', reference: 'sys_user', multiple: true, storage: { notNull: true },
    });
    expect(parsed.success, 'the card\'s own declaration must be authorable for this repair to have a population').toBe(true);
  });

  it('…and the one exclusivity ADR-0113 does declare is still refused — the discriminating control', () => {
    const refused = FieldSchema.safeParse({
      name: 'tags_when', type: 'lookup', reference: 'sys_user', multiple: true,
      requiredWhen: { field: 'stage', operator: '=', value: 'closed' },
      storage: { notNull: true },
    });
    expect(refused.success, '`storage.notNull` × `requiredWhen` is rejected at the parse seam (ADR-0113 Q1 rider)').toBe(false);
  });
});

for (const cell of DIALECT_CELLS) {
  if (!cell.available) {
    declareUnprovisionedCell(cell, '[#17231] multi-value column nullability');
    continue;
  }
  declareMultiValueNullability(cell);
}

function declareMultiValueNullability(cell: DialectCell): void {
  describe(`[#17231] SqlDriver.createColumn — storage.notNull on a JSON column (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: Knex;
    let info: Record<string, { nullable: boolean; type: string }>;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      knexInstance = driver.getKnex();
      await knexInstance.schema.dropTableIfExists(PROBE_OBJECT);
      await driver.initObjects([{ name: PROBE_OBJECT, fields: PROBE_FIELDS } as never]);
      info = (await knexInstance(PROBE_OBJECT).columnInfo()) as typeof info;
    });

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(PROBE_OBJECT).catch(() => {});
      await driver?.disconnect?.();
    });

    it('control — the table exists and every probe column reached it', () => {
      for (const name of Object.keys(PROBE_FIELDS)) {
        expect(info, `${name} never became a column, so nothing below measures anything`).toHaveProperty(name);
      }
    });

    it('control — this reader can see a NOT NULL, and sees NULL where nothing declared one', () => {
      // Without this pair a green subject below is indistinguishable from a
      // reader that reports `nullable: false` for everything (or for nothing).
      expect(info.scalar_nn.nullable, 'the scalar half of ADR-0113 P0').toBe(false);
      expect(info.scalar_plain.nullable).toBe(true);
    });

    it('the multi-value column honours `storage.notNull` — the repair', () => {
      expect(
        info.multi_nn.nullable,
        'createColumn returned at the multi-value short-circuit before reaching the ADR-0113 ' +
        'nullability line, so the platform left open a column both migration generators constrain',
      ).toBe(false);
    });

    it('…and nothing else acquired the constraint: `multiple` and `required` still do not bind the column', () => {
      expect(info.multi_plain.nullable, 'the flag is not a constraint').toBe(true);
      expect(info.multi_req.nullable, 'ADR-0113: `required` is the write contract, not the column').toBe(true);
    });

    it('the column is still a JSON column — the constraint rides the short-circuit, it does not replace it', () => {
      // The repair must not cost the type decision the short-circuit exists for.
      expect(info.multi_nn.type, 'the constrained multi-value column changed shape').toBe(info.multi_plain.type);
      expect(info.multi_nn.type).not.toBe(info.scalar_plain.type);
    });

    it('an INSERT omitting the field is refused — the divergence the card measured, closed', async () => {
      await expect(
        driver.create(PROBE_OBJECT, { scalar_nn: 'present' }),
      ).rejects.toThrow(/NOT NULL|not null|null value in column|cannot be null/i);
    });

    it('the differ agrees with the writer — no nullability drift against a table the driver just built', () => {
      const columns: PhysicalColumn[] = Object.entries(info).map(([name, c]) => ({
        name, type: String(c.type), nullable: c.nullable,
      }));
      const drift = diffManagedTable({
        table: PROBE_OBJECT,
        fields: PROBE_FIELDS as unknown as Record<string, FieldDef>,
        columns,
        dialect: DIALECT_OF[cell.id],
      }).filter((d) => d.kind === 'nullability_mismatch');
      expect(
        drift,
        'the platform reported drift against its own freshly-created, empty table — the #11431 shape',
      ).toEqual([]);
    });
  });
}
