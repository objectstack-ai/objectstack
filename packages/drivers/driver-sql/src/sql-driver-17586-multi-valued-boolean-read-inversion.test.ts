// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17586 · retargeted by #17469] A JSON column's stored array survives the
 * read — and `booleanFields` never contains one.
 *
 * ## What this file was filed for
 *
 * `formatOutput` runs its `jsonFields` pass first, which `JSON.parse`s the cell
 * into a real array, and then its `booleanFields` pass does
 * `data[field] = Boolean(data[field])`. Every non-empty array is truthy, so the
 * presented value was `true` whatever the array held — and a stored `[false]`
 * presenting as `true` is not a mis-SHAPED answer, it is the OPPOSITE of what
 * is stored, with no error anywhere. The repair was at the REGISTRY: narrow
 * both fills so a multi-valued column is never in `booleanFields`, which moves
 * all four readers of that registry at once.
 *
 * ## ⭐ What the #17469 ruling did to it
 *
 * The card's cell was `{ type: 'boolean', multiple: true }` — a shape whose
 * existence rested on `FieldSchema.multiple` refusing exactly one type
 * (`radio`). The maintainer ruling of 2026-09-13 (decision batch #128 item 5,
 * option 1′) gives "multi-valued" ONE definition — `isMultiValueField` —
 * refuses `multiple: true` at the authoring entrance on every type outside
 * `MULTI_CAPABLE_TYPES` ∪ `MULTI_OPTION_TYPES`, and derives this driver's
 * storage decision from it. A `boolean` / `toggle` column therefore **cannot be
 * a JSON column at all** any more, which is a stronger guarantee than the
 * registry carve-out was: the collapse has no reachable input.
 *
 * So the registry rule is restated in the terms that survive — **the two
 * registries partition the columns: a JSON column is never in `booleanFields`,
 * and a scalar boolean always is** — and asserted over the multi-valued shapes
 * that still exist (`select` / `lookup` flagged `multiple: true`, and the
 * inherently-multi `tags`). Two further rows pin the ruling itself, one per
 * half, so a revert on EITHER side reddens this file:
 *
 *   1. `FieldSchema` refuses `boolean` / `toggle` + `multiple: true`;
 *   2. the driver gives that declaration a plain boolean column and registers
 *      it in `booleanFields` — registry and storage agreeing, which is exactly
 *      the invariant the original repair was reaching for.
 *
 * ⛔ Do not restore a `{ type: 'boolean', multiple: true }` array fixture to
 * "keep the original cell". The column is a boolean column now; writing an
 * array into it is not a test of this file's subject.
 *
 * ## Controls
 *
 * - **Positive** (must not move): the `tags` row — correct before the original
 *   change, per the card's own table.
 * - **Negative** (the rule must not become a hole): a SCALAR `boolean` /
 *   `toggle` still takes the read coercion it exists for — stored `1`/`0` on
 *   SQLite and `tinyint(1)` on MySQL presented as JS `true`/`false` (#11782).
 *
 * ## Which cells execute, and the one door that cannot
 *
 *   - **sqlite** — always, embedded.
 *   - **live postgres** — runs when provisioned. Every ROW-read row answers
 *     here exactly as it does on SQLite, because `formatOutput`'s boolean pass
 *     was always gated `isSqlite || isMysql`. Its `distinct()` door is the
 *     exception and is pinned as a NAMED DIVERGENCE — see
 *     {@link distinctExecutes}.
 *   - **live mysql** — runs when provisioned; it takes the same coercion gate
 *     as SQLite, so its rows answer identically.
 *
 * @see SqlDriver.formatOutput — the row-read pass the inversion lived in.
 * @see SqlDriver.readPresentationKind — the `aggregate()`/`distinct()` door.
 * @see SqlDriver.isNonTextColumn — the reader that carves out at the reader.
 * @see SqlDriver.isJsonField — the storage half of the #17469 ruling.
 * @see https://github.com/objectstack-ai/objectstack/issues/17469 (the ruling that retargeted this file)
 * @see https://github.com/objectstack-ai/objectstack/issues/17586
 * @see https://github.com/objectstack-ai/objectstack/issues/17343 (the filter half)
 * @see https://github.com/objectstack-ai/objectstack/issues/11782 (the pass)
 * @see https://github.com/objectstack-ai/objectstack/issues/11635 (the PG cast)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import type { DriverOptions } from '@objectstack/spec/data';
import { FieldSchema } from '@objectstack/spec/data';
import { SqlDriver, type SqlDriverConfig } from './sql-driver.js';
import {
  DIALECT_CELLS,
  declareUnprovisionedCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

/** Issue-prefixed: the live cells share one database with every other suite here. */
const READ_OBJECT = 'os17586_multi_boolean_read';

/** Diagnostics-only; it never changes which rows a read touches. */
const BYPASS: DriverOptions = { bypassTenantAudit: true };

/**
 * Can `distinct()` EXECUTE over a JSON column on this backend?
 *
 * A JSON column is a JSON column on every dialect, but PostgreSQL's `json` type
 * defines no equality operator, and `SELECT DISTINCT` needs one — so the
 * statement is refused before any row is presented (`could not identify an
 * equality operator for type json`). A property of the COLUMN CLASS, measured
 * on live PostgreSQL 16.13 across both legs of the original card's change and
 * unchanged by it — the mirror of the `LIKE`-over-`json` divergence #17590 owns
 * on the filter side, reached through the read door instead.
 */
const distinctExecutes = (cell: DialectCell): boolean => cell.id !== 'pg';

/**
 * The fixture, after #17469.
 *
 * `picks` / `refs` are multi-valued by `isMultiValueField` and therefore JSON
 * columns — the cell this file's rule now owns. `tags_` is the positive
 * control. `scalar_flag` / `scalar_toggle` prove the read coercion the registry
 * exists for is untouched. `retired_flags` is the RULING's own pin: the
 * declaration the entrance refuses, which reaches this driver only through a
 * hand-built fixture like this one and is a plain boolean column when it does.
 */
const READ_FIELDS: Record<string, Record<string, unknown>> = {
  label: { type: 'string' },
  picks: { type: 'select', multiple: true },
  refs: { type: 'lookup', multiple: true },
  tags_: { type: 'tags' },
  scalar_flag: { type: 'boolean' },
  scalar_toggle: { type: 'toggle' },
  retired_flags: { type: 'boolean', multiple: true },
};

/**
 * Row 2's single-member arrays are the shape a repair that special-cased array
 * width would get wrong; row 3's two-member arrays are the same read one width
 * over.
 */
const READ_ROWS = [
  {
    id: '1', label: 'alpha',
    picks: ['a', 'b'], refs: ['r1', 'r2'], tags_: ['red'],
    scalar_flag: true, scalar_toggle: false, retired_flags: true,
  },
  {
    id: '2', label: 'beta',
    picks: ['c'], refs: ['r3'], tags_: ['blue'],
    scalar_flag: false, scalar_toggle: true, retired_flags: false,
  },
  {
    id: '3', label: 'gamma',
    picks: ['a', 'c'], refs: ['r1'], tags_: ['red', 'blue'],
    scalar_flag: true, scalar_toggle: true, retired_flags: false,
  },
] as const;

describe('[#17469] the entrance half — the declaration this file was filed about is REFUSED', () => {
  it('`FieldSchema` refuses `boolean` / `toggle` + `multiple: true`', () => {
    for (const type of ['boolean', 'toggle']) {
      const r = FieldSchema.safeParse({ name: 'flags', type, multiple: true });
      expect(r.success, `\`${type}\` + multiple: true must be refused at the entrance`).toBe(false);
    }
  });

  it('…and still accepts the multi-capable declarations this file now uses — the negative control', () => {
    expect(FieldSchema.safeParse({ name: 'refs', type: 'lookup', reference: 'account', multiple: true }).success).toBe(true);
    expect(FieldSchema.safeParse({ name: 'flag', type: 'boolean' }).success).toBe(true);
  });
});

for (const cell of DIALECT_CELLS) {
  if (!cell.available) {
    declareUnprovisionedCell(cell, '[#17586] the JSON-column read presentation');
    continue;
  }
  declareReadSweep(cell);
}

/**
 * The `initObjects` REGISTRY FILL, executed against a real backend — the fill
 * a repair applied to `registerExternalObject` alone would leave live, and the
 * only layer that can say what the driver actually HANDS BACK rather than what
 * it compiles.
 */
function declareReadSweep(cell: DialectCell): void {
  describe(`[#17586] SqlDriver — reading a JSON column (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: Knex;
    let rows: Record<string, any>[];

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      knexInstance = driver.getKnex();
      await knexInstance.schema.dropTableIfExists(READ_OBJECT);
      await driver.initObjects([{ name: READ_OBJECT, fields: READ_FIELDS } as never]);
      for (const row of READ_ROWS) await driver.create(READ_OBJECT, { ...row }, BYPASS);
      rows = await driver.find(READ_OBJECT, { sort: [{ field: 'id', order: 'asc' }] } as never, BYPASS);
    });

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(READ_OBJECT).catch(() => {});
      await driver?.disconnect?.();
    });

    it('⭐ a stored array does NOT collapse to a single scalar — the inversion the card is filed for', () => {
      for (const row of rows) {
        for (const field of ['picks', 'refs', 'tags_']) {
          expect(row[field], `${field} on row ${row.id} collapsed to a scalar`).not.toBe(true);
          expect(Array.isArray(row[field]), `${field} on row ${row.id}`).toBe(true);
        }
      }
    });

    it('the stored array survives the read, member for member', () => {
      expect(rows.find((r) => r.id === '1')!.picks).toEqual(['a', 'b']);
      expect(rows.find((r) => r.id === '2')!.picks).toEqual(['c']);
      expect(rows.find((r) => r.id === '3')!.picks).toEqual(['a', 'c']);
      expect(rows.find((r) => r.id === '1')!.refs).toEqual(['r1', 'r2']);
      expect(rows.find((r) => r.id === '2')!.refs).toEqual(['r3']);
    });

    it('POSITIVE CONTROL — the tags row is unmoved', () => {
      expect(rows.find((r) => r.id === '1')!.tags_).toEqual(['red']);
      expect(rows.find((r) => r.id === '3')!.tags_).toEqual(['red', 'blue']);
    });

    it('NEGATIVE CONTROLS — a SCALAR boolean/toggle still takes its #11782 read coercion', () => {
      for (const row of rows) {
        expect(typeof row.scalar_flag, `scalar_flag on row ${row.id}`).toBe('boolean');
        expect(typeof row.scalar_toggle, `scalar_toggle on row ${row.id}`).toBe('boolean');
      }
      expect(rows.find((r) => r.id === '1')!.scalar_flag).toBe(true);
      expect(rows.find((r) => r.id === '2')!.scalar_flag).toBe(false);
      expect(rows.find((r) => r.id === '2')!.scalar_toggle).toBe(true);
      expect(rows.find((r) => r.id === '3')!.scalar_toggle).toBe(true);
    });

    /**
     * ⭐ [#17469] The storage half of the ruling, read end to end: a `boolean`
     * carrying `multiple: true` is a PLAIN BOOLEAN COLUMN, so it takes the
     * ordinary scalar coercion and presents the boolean that was written.
     * Registry and storage agree, which is the invariant the original
     * registry-narrowing repair was reaching for.
     */
    it('[#17469] a RETIRED `boolean` + `multiple: true` reads back as the scalar boolean it now is', () => {
      for (const row of rows) {
        expect(typeof row.retired_flags, `retired_flags on row ${row.id}`).toBe('boolean');
      }
      expect(rows.find((r) => r.id === '1')!.retired_flags).toBe(true);
      expect(rows.find((r) => r.id === '2')!.retired_flags).toBe(false);
      expect(rows.find((r) => r.id === '3')!.retired_flags).toBe(false);
    });

    if (distinctExecutes(cell)) {
      /**
       * Reader 2, executed. `distinct()` returns raw builder output presented
       * through {@link SqlDriver.readPresentationKind}, so a registry that
       * claimed a JSON column was boolean answered `true` for every row — the
       * same inversion the row door gave, which is why the card notes the
       * collapse "is not confined to the row-read door".
       */
      it('reader 2 — `distinct()` does not collapse a JSON column to a single `true`', async () => {
        const values = await driver.distinct(READ_OBJECT, 'picks', undefined, BYPASS);
        expect(values, 'distinct() over a multi-valued select').not.toEqual([true]);
        expect(values.every((v) => v === true), 'every distinct value coerced to `true`').toBe(false);
      });

      /**
       * …and the refusal/answer really is about the COLUMN CLASS rather than
       * about this door: a SCALAR boolean answers normally in the same run.
       */
      it('the SCALAR boolean answers normally at the same door — the reading is per storage shape', async () => {
        const values = await driver.distinct(READ_OBJECT, 'scalar_flag', undefined, BYPASS);
        expect([...values].sort()).toEqual([false, true]);
      });

      /**
       * Reader 1, executed — the #11635 Postgres aggregate cast, on the one
       * dialect it exists for. The SCALAR half deliberately: #11635 exists so a
       * declared boolean can be aggregated on Postgres at all, and no narrowing
       * of this registry may cost it.
       */
      it('reader 1 — the #11635 cast still answers for a SCALAR boolean', async () => {
        const aggregated = await driver.aggregate(
          READ_OBJECT,
          { aggregations: [{ function: 'max', field: 'scalar_flag', alias: 'm' }] } as never,
          BYPASS,
        );
        // `min`/`max` are pinned as the 0/1 the cast computes (#11152).
        expect(Number(aggregated[0].m), 'max over a scalar boolean must still compute').toBe(1);
      });
    }
  });
}

/**
 * The registry itself, and every reader that consults it — decided WITHOUT a
 * server, so this layer also covers the dialects no cell provisions and the
 * OTHER registry fill (`registerExternalObject`).
 */
describe('[#17586] the `booleanFields` registry and its four readers', () => {
  class RegistryProbeDriver extends SqlDriver {
    declareExternal(fields: Record<string, Record<string, unknown>> = READ_FIELDS): this {
      this.registerExternalObject({ name: READ_OBJECT, fields } as never);
      return this;
    }

    booleanRegistry(): string[] {
      return this.booleanFields[READ_OBJECT] ?? [];
    }

    jsonRegistry(): string[] {
      return this.jsonFields[READ_OBJECT] ?? [];
    }

    presentationKind(field: string): string | null {
      return this.readPresentationKind(READ_OBJECT, field);
    }

    nonTextColumn(field: string): boolean {
      return this.isNonTextColumn(READ_OBJECT, field);
    }
  }

  const DIALECTS: Array<[string, SqlDriverConfig]> = [
    ['sqlite', { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }],
    ['postgres', { client: 'pg', connection: { host: '127.0.0.1' } }],
    ['mysql', { client: 'mysql2', connection: { host: '127.0.0.1' } }],
  ];
  const external = (config: SqlDriverConfig) => new RegistryProbeDriver(config).declareExternal();

  for (const [label, config] of DIALECTS) {
    it(`${label}: the two registries PARTITION the columns — no JSON column is in \`booleanFields\``, () => {
      const d = external(config);
      const booleans = d.booleanRegistry();
      const json = d.jsonRegistry();
      for (const field of json) {
        expect(booleans, `${field} is a JSON column and must not be in booleanFields`).not.toContain(field);
      }
      // Non-vacuity in both directions: the run really saw JSON columns…
      expect(json).toEqual(expect.arrayContaining(['picks', 'refs', 'tags_']));
      // …and the boolean class is registered, so this is a partition and not a
      // registry that gave up on the class.
      expect(booleans).toContain('scalar_flag');
      expect(booleans).toContain('scalar_toggle');
    });

    it(`${label}: [#17469] a RETIRED \`boolean\` + \`multiple\` is a SCALAR column — registry follows storage`, () => {
      const d = external(config);
      expect(d.jsonRegistry(), 'retired_flags must not be a JSON column').not.toContain('retired_flags');
      expect(d.booleanRegistry(), 'retired_flags is an ordinary boolean column').toContain('retired_flags');
    });

    it(`${label}: reader 1 — no Postgres aggregate CAST is bought for a JSON column`, () => {
      // The #11635 gate is `isPostgres && … && booleanFields[table].includes(fieldExpr)`.
      // Its registry input is the assertion: absent from the registry, the cast
      // cannot fire, and `cast(json as int)` is never emitted.
      expect(external(config).booleanRegistry()).not.toContain('picks');
    });

    it(`${label}: reader 2 — \`readPresentationKind\` never claims a JSON column is boolean`, () => {
      const d = external(config);
      for (const field of ['picks', 'refs', 'tags_']) {
        expect(d.presentationKind(field), field).not.toBe('boolean');
      }
      // The scalar column keeps the kind on exactly the dialects that store it
      // as a number — the per-dialect posture #11782 pinned.
      const scalarKind = d.presentationKind('scalar_flag');
      expect(scalarKind, 'scalar_flag').toBe(label === 'postgres' ? null : 'boolean');
    });

    it(`${label}: reader 4 — \`isNonTextColumn\` never gates a JSON column`, () => {
      const d = external(config);
      // The reader's own carve-out (`&& !isJsonColumn`) excludes these…
      for (const field of ['picks', 'refs', 'tags_']) {
        expect(d.nonTextColumn(field), field).toBe(false);
      }
      // …and the scalar ones stay inside the gate, which is what makes this a
      // carve-out rather than a hole in #14079's declared-type gate. [#17469]
      // `retired_flags` is inside it too: it is a scalar boolean column now.
      expect(d.nonTextColumn('scalar_flag'), 'scalar_flag').toBe(true);
      expect(d.nonTextColumn('scalar_toggle'), 'scalar_toggle').toBe(true);
      expect(d.nonTextColumn('retired_flags'), 'retired_flags').toBe(true);
    });
  }

  /**
   * The two registry fills, side by side. The omission the card repairs was
   * present in BOTH, and they are separate code with no shared helper to make
   * that impossible — so a repair reaching only one leaves the defect live on
   * the other, exactly as #17343's round found.
   */
  it('BOTH registry fills agree — initObjects and registerExternalObject register the same columns', async () => {
    const ext = external(DIALECTS[0][1]);
    const managed = new RegistryProbeDriver(DIALECTS[0][1]);
    await managed.getKnex().schema.dropTableIfExists(READ_OBJECT);
    await managed.initObjects([{ name: READ_OBJECT, fields: READ_FIELDS } as never]);
    try {
      expect(managed.booleanRegistry()).toEqual(ext.booleanRegistry());
      expect(managed.jsonRegistry()).toEqual(ext.jsonRegistry());
      // …and the agreed registries are the partitioned ones, not an agreed
      // omission.
      expect(managed.booleanRegistry()).not.toContain('picks');
      expect(managed.jsonRegistry()).toContain('picks');
    } finally {
      await managed.getKnex().schema.dropTableIfExists(READ_OBJECT).catch(() => {});
      await managed.disconnect?.();
    }
  });
});
