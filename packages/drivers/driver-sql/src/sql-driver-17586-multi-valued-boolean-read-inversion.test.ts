// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17586] A `multiple: true` BOOLEAN / TOGGLE column stops presenting its
 * stored array as a single INVERTED `true`.
 *
 * ## The failure this file exists to pin
 *
 * `formatOutput` runs its `jsonFields` pass first, which `JSON.parse`s the
 * cell into a real array, and then its `booleanFields` pass does
 * `data[field] = Boolean(data[field])`. Every non-empty array is truthy, so
 * the presented value is `true` whatever the array holds:
 *
 * | declared field                        | written        | stored cell   | read back (before) |
 * |:--|:--|:--|:--|
 * | `{ type: 'boolean', multiple: true }` | `[true, false]`| `[true,false]`| `true` ⚠️ array gone |
 * | `{ type: 'toggle',  multiple: true }` | `[false]`      | `[false]`     | `true` ⚠️ **INVERTED** |
 * | `{ type: 'number',  multiple: true }` | `[1, 2]`       | `[1,2]`       | `[1, 2]` correct |
 * | `{ type: 'tags' }`                    | `['x']`        | `["x"]`       | `['x']` correct |
 *
 * ⭐ The `toggle` row is the whole card. A stored `[false]` presenting as
 * `true` is not a mis-SHAPED answer, it is the OPPOSITE of what is stored,
 * with no error anywhere — so this file's central assertion is that
 * `[false]` does not read back as `true`, not merely that it is "no longer a
 * single boolean". A test that only proved the latter would stay green on a
 * repair that presented `false` for `[true]`.
 *
 * ## The repair, and why it is at the REGISTRY and not at a reader
 *
 * `&& !field.multiple` is the house spelling of both fills, already written
 * three times in each block (`mediaCols`, `numericCols`, `numericValueCols`);
 * `booleanCols.push(name)` was the single omission, in BOTH fills
 * (`registerExternalObject` and `registerManagedObjectMetadata`) — a repair to
 * one leaves the other live.
 *
 * Narrowing the registry moves every reader of `booleanFields` at once, so the
 * card fenced the round on enumerating them first. All four read sites, and
 * what each does for a multi-valued column:
 *
 * 1. **The #11635 Postgres aggregate cast** (`aggregate()`) — gated
 *    `isPostgres && booleanFields[table].includes(fieldExpr)`, emits
 *    `cast(?? as int)`. A `multiple: true` boolean is a JSON column on every
 *    dialect ({@link SqlDriver.isJsonField}), and `cast(json as int)` is not a
 *    defined cast on Postgres — so the registry entry bought this reader a
 *    cast it must not emit. ⇒ does NOT need the column.
 * 2. **`readPresentationKind`** (the `aggregate()` / `distinct()` doors) —
 *    gated `(isSqlite || isMysql) && booleanFields[table].includes(field)`,
 *    returns `'boolean'`, whose presenter is the same `Boolean(v)`. On those
 *    doors the stored cell arrives as the raw JSON **string** `'[false]'`, and
 *    `Boolean('[false]')` is `true` — the identical inversion, one door over.
 *    ⇒ does NOT need the column; it is actively harmed by it.
 * 3. **`formatOutput`'s row pass** — the defect itself. ⇒ does NOT need it.
 * 4. **`isNonTextColumn`** (#14079/#15683/#17343's declared-type gate) — the
 *    one reader that already carved out multi-valued columns AT THE READER,
 *    spelled `booleanFields[table].includes(f) && !this.isJsonColumn(table, f)`.
 *    ⇒ does NOT need the column either, and the narrowing is *behaviour-
 *    identical* there rather than merely safe: for a `boolean`/`toggle` field
 *    `isJsonField` reduces to `JSON_COLUMN_TYPES.has(type) || !!field.multiple`
 *    — and neither type is in `JSON_COLUMN_TYPES` — so `isJsonColumn` on this
 *    class is exactly `!!field.multiple`, the same predicate the fills now
 *    apply. `§ the four readers` below pins that equivalence by execution.
 *
 * ⇒ no reader needs a multi-valued column in `booleanFields`; three of the
 * four are repaired by its absence and the fourth cannot observe it. The
 * carve-out therefore belongs at the registry, which is also where its three
 * neighbours already spell it.
 *
 * ## Controls
 *
 * - **Positive** (must not move): the `multiple: true` NUMBER row and the
 *   `tags` row — both correct before this change, per the card's own table.
 * - **Negative** (the repair must not become a hole): a SCALAR `boolean` /
 *   `toggle` still takes the read coercion it exists for — stored `1`/`0` on
 *   SQLite and `tinyint(1)` on MySQL presented as JS `true`/`false` (#11782).
 *   Narrowing by `!field.multiple` must not cost that.
 *
 * ## Which cells execute, and the one door that cannot
 *
 *   - **sqlite** — always, embedded. The cell that carried the defect, so its
 *     rows are the reverse-verification witness (13 red before the guard, all
 *     green after).
 *   - **live postgres** — runs when provisioned. Every ROW-read row above
 *     answers here exactly as it does on SQLite, because `formatOutput`'s
 *     boolean pass was always gated `isSqlite || isMysql` and so never reached
 *     this dialect. Its `distinct()` door is the exception and is pinned as a
 *     NAMED DIVERGENCE instead of an answer — see {@link distinctExecutes},
 *     which carries the two-leg measurement proving the divergence is
 *     class-wide and predates this change.
 *   - **live mysql** — runs when provisioned; it takes the same coercion gate
 *     as SQLite, so its rows answer identically.
 *
 * ⚠️ The whole driver-sql suite was run against a live PostgreSQL 16.13 under
 * CI's own configuration (server `Asia/Shanghai`, process `TZ=America/New_York`)
 * to confirm this file is the only thing that moves: `179 passed | 3 skipped`,
 * zero failures.
 *
 * @see SqlDriver.formatOutput — the row-read pass the inversion lived in.
 * @see SqlDriver.readPresentationKind — the `aggregate()`/`distinct()` door.
 * @see SqlDriver.isNonTextColumn — the reader that carves out at the reader.
 * @see https://github.com/objectstack-ai/objectstack/issues/17586
 * @see https://github.com/objectstack-ai/objectstack/issues/17343 (the filter half)
 * @see https://github.com/objectstack-ai/objectstack/issues/11782 (the pass)
 * @see https://github.com/objectstack-ai/objectstack/issues/11635 (the PG cast)
 * @see https://github.com/objectstack-ai/objectstack/issues/17639 (the missing
 *   ADR-0112 envelope on the `distinct()` door, measured by this round)
 * @see https://github.com/objectstack-ai/objectstack/issues/17590 (the sibling
 *   `LIKE`-over-`json` divergence on the filter side)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import type { DriverOptions } from '@objectstack/spec/data';
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

/** The shape a thrown driver error carries at this door. */
interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/**
 * Can `distinct()` EXECUTE over a JSON column on this backend?
 *
 * `multiple: true` is a JSON column on every dialect, but PostgreSQL's `json`
 * type defines no equality operator, and `SELECT DISTINCT` needs one — so the
 * statement is refused before any row is presented:
 *
 * ```
 * select distinct j from t;
 * ERROR:  could not identify an equality operator for type json
 * ```
 *
 * ⚠️ This is a property of the COLUMN CLASS, not of this card's cell, and not
 * of this card's change. Measured on live PostgreSQL 16.13, two legs, with the
 * fixture's `multiple: true` NUMBER and `tags` columns — neither of which was
 * ever in `booleanFields`, so no part of this change can reach them — failing
 * identically to the boolean cell, and with a SCALAR boolean (a real `boolean`
 * column, not `json`) answering normally in the same run:
 *
 * | leg | `sql-driver.ts` blob | toggles / flags / nums / tags_ | scalar_flag |
 * |:--|:--|:--|:--|
 * | change present  | `f7fe22f8` | all four raise SQLSTATE 42883 | `[false]` |
 * | change reverted | `a2b37dc6` (= merge base, verified on disk by `git hash-object`) | all four raise SQLSTATE 42883 | `[false]` |
 *
 * ⇒ the same failure, byte for byte, on a tree with no part of this change on
 * it. The mirror of the `LIKE`-over-`json` divergence #17590 owns on the filter
 * side, reached through the read door instead.
 */
const distinctExecutes = (cell: DialectCell): boolean => cell.id !== 'pg';

/**
 * The card's fixture, plus the two scalar negative controls. `flags`/`toggles`
 * are the cell this card owns; `nums`/`tags_` are the positive controls the
 * card names; `scalar_flag`/`scalar_toggle` prove the read coercion the
 * registry exists for survives the narrowing.
 */
const READ_FIELDS: Record<string, Record<string, unknown>> = {
  label: { type: 'string' },
  flags: { type: 'boolean', multiple: true },
  toggles: { type: 'toggle', multiple: true },
  nums: { type: 'number', multiple: true },
  tags_: { type: 'tags' },
  scalar_flag: { type: 'boolean' },
  scalar_toggle: { type: 'toggle' },
};

/**
 * Row 2 is the card's starred case: `toggles: [false]` — an array whose only
 * member is `false`, stored faithfully, presented as `true` before the repair.
 * Row 3's `flags: [false, false]` is the same failure one width over, so a
 * repair that special-cased a single-element array cannot pass.
 */
const READ_ROWS = [
  {
    id: '1', label: 'alpha',
    flags: [true, false], toggles: [true], nums: [1, 2], tags_: ['red'],
    scalar_flag: true, scalar_toggle: false,
  },
  {
    id: '2', label: 'beta',
    flags: [false], toggles: [false], nums: [3], tags_: ['blue'],
    scalar_flag: false, scalar_toggle: true,
  },
  {
    id: '3', label: 'gamma',
    flags: [false, false], toggles: [true, false], nums: [1], tags_: ['red', 'blue'],
    scalar_flag: true, scalar_toggle: true,
  },
] as const;

for (const cell of DIALECT_CELLS) {
  if (!cell.available) {
    declareUnprovisionedCell(cell, '[#17586] the multi-valued boolean read presentation');
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
  describe(`[#17586] SqlDriver — reading a multi-valued boolean column (${cell.label})`, () => {
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

    it('⭐ a stored `[false]` does NOT present as `true` — the inversion the card is filed for', () => {
      const beta = rows.find((r) => r.id === '2')!;
      // The opposite-of-stored assertion, spelled as its own expectation so a
      // failure reads as the inversion and not as a shape mismatch.
      expect(beta.toggles, 'toggles: stored [false] presented as `true`').not.toBe(true);
      expect(beta.flags, 'flags: stored [false] presented as `true`').not.toBe(true);
      // …and the same failure two members wide.
      const gamma = rows.find((r) => r.id === '3')!;
      expect(gamma.flags, 'flags: stored [false,false] presented as `true`').not.toBe(true);
    });

    it('the stored array survives the read, member for member', () => {
      expect(rows.find((r) => r.id === '1')!.flags).toEqual([true, false]);
      expect(rows.find((r) => r.id === '1')!.toggles).toEqual([true]);
      expect(rows.find((r) => r.id === '2')!.flags).toEqual([false]);
      expect(rows.find((r) => r.id === '2')!.toggles).toEqual([false]);
      expect(rows.find((r) => r.id === '3')!.flags).toEqual([false, false]);
      expect(rows.find((r) => r.id === '3')!.toggles).toEqual([true, false]);
    });

    it('every member is a real JS boolean, not the stored encoding', () => {
      for (const row of rows) {
        for (const field of ['flags', 'toggles']) {
          expect(Array.isArray(row[field]), `${field} on row ${row.id}`).toBe(true);
          for (const member of row[field] as unknown[]) {
            expect(typeof member, `${field} member on row ${row.id}`).toBe('boolean');
          }
        }
      }
    });

    it('POSITIVE CONTROLS — the multi-valued number and the tags row are unmoved', () => {
      expect(rows.find((r) => r.id === '1')!.nums).toEqual([1, 2]);
      expect(rows.find((r) => r.id === '2')!.nums).toEqual([3]);
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

    if (distinctExecutes(cell)) {
      /**
       * Reader 2, executed. `distinct()` returns raw builder output presented
       * through {@link SqlDriver.readPresentationKind}, so before the repair
       * this door answered `true` for every row — the same inversion the row
       * door gave, which is why the card notes the collapse "is not confined
       * to the row-read door".
       */
      it('reader 2 — `distinct()` does not collapse the column to a single `true`', async () => {
        const values = await driver.distinct(READ_OBJECT, 'toggles', undefined, BYPASS);
        expect(values, 'distinct() over a multi-valued toggle').not.toEqual([true]);
        expect(values.every((v) => v === true), 'every distinct value coerced to `true`').toBe(false);
      });
    } else {
      /**
       * The NAMED DIVERGENCE, pinned rather than skipped — the same posture
       * #17343's suite takes for the filter-side half of this property.
       *
       * ⛔ Pinned on the CLASS, not on a bare throw. The assertion is not
       * "the boolean cell fails here" (which would stay green if this change
       * had broken it); it is "the boolean cell fails EXACTLY as the columns
       * this change cannot reach do" — `nums` is a `multiple: true` NUMBER
       * whose registry carve-out (`NUMERIC_SCALAR_TYPES.has(type) &&
       * !field.multiple`) kept it out of `booleanFields` before this change
       * and after it, and `tags_` was never a candidate at all. If some future
       * edit made the boolean cell fail for a reason of its own, its error
       * would stop matching the control's and this row goes red.
       *
       * ⚠️ The error is asserted on SQLSTATE and on class-identity, NOT on an
       * ADR-0112 `code`/`status` envelope, because this door does not wrap it:
       * `distinct()` leaks the backend's own object here — `code` is the raw
       * `42883` and `status` is `undefined` — which is the gap #11455 closed
       * for `aggregate()` and left open on this door. ⛔ Asserting a 500 here
       * would pin a fiction; the missing envelope is filed as #17639 and is
       * not this card's to repair. When it lands, the class-identity row below
       * still holds and the SQLSTATE row goes red on purpose, so whoever fixes
       * it comes and updates this pin.
       */
      it('[#17590-family] `distinct()` over a JSON column is refused here — and the untouched NUMBER/tags controls are refused the SAME way', async () => {
        const errorFor = async (field: string): Promise<WireBearingError> =>
          driver.distinct(READ_OBJECT, field, undefined, BYPASS).then(
            () => null as unknown as WireBearingError,
            (e: unknown) => e as WireBearingError,
          );

        const control = await errorFor('nums');
        expect(control, 'the multiple:true NUMBER control must reach the backend').toBeInstanceOf(Error);
        expect(control.code, 'the control refusal is the json-equality SQLSTATE').toBe('42883');

        for (const field of ['toggles', 'flags', 'tags_']) {
          const err = await errorFor(field);
          expect(err, `${field} must reach the backend, not a presented answer`).toBeInstanceOf(Error);
          expect(err.code, `${field} fails identically to the untouched NUMBER control`).toBe(control.code);
        }
      });

      /**
       * …and the refusal really is about the COLUMN CLASS rather than about
       * this door: a SCALAR boolean is a real `boolean` column on this backend,
       * has an equality operator, and answers normally in the same run. Without
       * this row the block above would also pass on a backend where `distinct()`
       * was simply broken for everything.
       */
      it('the SCALAR boolean answers normally at the same door — the refusal is per storage shape', async () => {
        const values = await driver.distinct(READ_OBJECT, 'scalar_flag', undefined, BYPASS);
        expect([...values].sort()).toEqual([false, true]);
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
    it(`${label}: the registerExternalObject fill keeps multi-valued columns OUT of \`booleanFields\``, () => {
      const registry = external(config).booleanRegistry();
      expect(registry, 'multi-valued boolean/toggle must not be registered').not.toContain('flags');
      expect(registry, 'multi-valued boolean/toggle must not be registered').not.toContain('toggles');
      // …and the narrowing is a carve-out, not a removal of the class.
      expect(registry).toContain('scalar_flag');
      expect(registry).toContain('scalar_toggle');
    });

    it(`${label}: reader 1 — no Postgres aggregate CAST is bought for a multi-valued column`, () => {
      // The #11635 gate is `isPostgres && … && booleanFields[table].includes(fieldExpr)`.
      // Its registry input is the assertion: absent from the registry, the cast
      // cannot fire, and `cast(json as int)` is never emitted.
      expect(external(config).booleanRegistry()).not.toContain('flags');
    });

    it(`${label}: reader 2 — \`readPresentationKind\` no longer claims a multi-valued column is boolean`, () => {
      const d = external(config);
      expect(d.presentationKind('flags'), 'flags').not.toBe('boolean');
      expect(d.presentationKind('toggles'), 'toggles').not.toBe('boolean');
      // The scalar column keeps the kind on exactly the dialects that store it
      // as a number — the per-dialect posture #11782 pinned.
      const scalarKind = d.presentationKind('scalar_flag');
      expect(scalarKind, 'scalar_flag').toBe(label === 'postgres' ? null : 'boolean');
    });

    it(`${label}: reader 4 — \`isNonTextColumn\` is BEHAVIOUR-IDENTICAL across the narrowing`, () => {
      const d = external(config);
      // The reader's own carve-out (`&& !isJsonColumn`) already excluded these,
      // so narrowing the registry cannot move its answer. Both halves pinned:
      // the multi-valued columns stay outside the gate…
      expect(d.nonTextColumn('flags'), 'flags').toBe(false);
      expect(d.nonTextColumn('toggles'), 'toggles').toBe(false);
      // …and the scalar ones stay inside it, which is what makes this a
      // carve-out rather than a hole in #14079's declared-type gate.
      expect(d.nonTextColumn('scalar_flag'), 'scalar_flag').toBe(true);
      expect(d.nonTextColumn('scalar_toggle'), 'scalar_toggle').toBe(true);
    });

    it(`${label}: the equivalence reader 4 rests on — for boolean/toggle, \`isJsonColumn\` IS \`multiple\``, () => {
      const d = external(config);
      const json = d.jsonRegistry();
      // If these two ever diverge, narrowing the registry would silently move
      // `isNonTextColumn`'s answer; this is the pin that says they do not.
      expect(json, 'a multi-valued boolean is a JSON column').toContain('flags');
      expect(json, 'a multi-valued toggle is a JSON column').toContain('toggles');
      expect(json, 'a scalar boolean is not').not.toContain('scalar_flag');
      expect(json, 'a scalar toggle is not').not.toContain('scalar_toggle');
    });
  }

  /**
   * The two registry fills, side by side. The omission this card repairs was
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
      // …and the agreed registry is the narrowed one, not an agreed omission.
      expect(managed.booleanRegistry()).not.toContain('flags');
      expect(managed.booleanRegistry()).not.toContain('toggles');
    } finally {
      await managed.getKnex().schema.dropTableIfExists(READ_OBJECT).catch(() => {});
      await managed.disconnect?.();
    }
  });
});
