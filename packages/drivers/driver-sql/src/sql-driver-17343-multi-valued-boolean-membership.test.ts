// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17343] A `multiple: true` BOOLEAN column keeps its `$contains` MEMBERSHIP
 * filter — the carve-out #14079's declared-type gate never received on its
 * boolean limb, while its numeric limb carried one from the first line it
 * shipped and its temporal limb gained one in #15683.
 *
 * ## What was measured, and which of triage's two worlds this is
 *
 * Triage fenced this card: establish WHY the type-gate excludes boolean before
 * widening it — a deliberate exclusion (a stored array of booleans being
 * genuinely meaningless) makes the honest fix a loud refusal at authoring
 * time, not a silent `1 = 0`. The exclusion is an OMISSION, on four readings:
 *
 * 1. **The predicate declared itself scalar-only.** As `isNonTextColumn`
 *    landed (`a646120d`, #14079) its own first line read "a declared numeric
 *    or boolean SCALAR?", and it annotated the numeric registry it reads as
 *    "`numericFields` (`NUMERIC_SCALAR_TYPES`, non-`multiple`)" — the author
 *    was tracking the `multiple` axis and recorded it on the limb where the
 *    registry happened to carry it. `booleanFields` carries no such condition
 *    and none was added, so the predicate's stated scope and its behaviour
 *    disagreed from the first commit.
 * 2. **`booleanFields` is not a filter registry.** Its fill is commented for
 *    READ COERCION — "`toggle` shares boolean storage/affinity, so it needs
 *    the same read coercion (stored 1/0 → JS true/false)" — a question with no
 *    `multiple` axis in it. Nothing in either fill states a filter-side intent
 *    to include multi-valued columns.
 * 3. **Nothing could have caught it.** #7398's live rows caught exactly this
 *    omission on the temporal limb when #15683 first landed without the
 *    condition; its fixture declares a `multiple: true` LOOKUP and a
 *    `multiple: true` DATETIME and no multi-valued boolean at all, so the
 *    boolean limb was never aimed at.
 * 4. **The spec set says nothing about `multiple`.** `NON_TEXT_STORED_VALUE_TYPES`
 *    is keyed on the DECLARED TYPE; the carve-out for JSON storage is a driver
 *    concern each limb spells for itself. `boolean` + `multiple: true` is
 *    authorable — `FieldSchema.multiple` refuses exactly one type (`radio`) —
 *    and this driver already gives it a JSON column, a faithful array write and
 *    a working `$contains` on every OTHER multi-valued class.
 *
 * So there is no refusal to make loud: the shape is declared, stored and
 * filtered everywhere except here. The repair restores the membership filter.
 *
 * ## The measurement, before (`origin/main` @ `f721ef0`)
 *
 * `{ FIELD: { $contains: 'true' } }`, `better-sqlite3`, both registry fills:
 *
 * | declared field                    | compiled WHERE                | verdict |
 * |:--|:--|:--|
 * | `{ type: 'boolean', multiple: true }` | `where 1 = 0`             | ⚠️ dead |
 * | `{ type: 'toggle',  multiple: true }` | `where 1 = 0`             | ⚠️ dead |
 * | `{ type: 'number',  multiple: true }` | `` `nums` GLOB '*true*' `` | correct |
 * | `{ type: 'tags' }`                    | `` `tags_` GLOB '*true*' ``| correct |
 *
 * `1 = 0` is the fail-CLOSED direction #7398's own table calls out: the query
 * returns nothing and is byte-identical to a filter that legitimately matched
 * nothing, so an author reads "no matching records" and doubts their data.
 *
 * ## The invariant this file pins, one guard for the whole class
 *
 * **The declared-type gate never fires on a JSON column.** Swept over every
 * member of `NON_TEXT_STORED_VALUE_TYPES` rather than over the two types this
 * card names, so a class added to that set — or a registry that grows a fill
 * without the carve-out — turns this file red instead of silently retiring
 * another membership filter.
 *
 * ## Which cells executed, and the one that cannot
 *
 *   - **sqlite** — always, embedded. The cell that carried the defect, so its
 *     rows are the reverse-verification witness.
 *   - **live mysql** — runs when provisioned; its `json` column is coerced for
 *     `LIKE`, so the membership rows answer there exactly as they do on SQLite.
 *   - **live postgres** — runs when provisioned and pins a NAMED DIVERGENCE
 *     instead of the answer. Its `json` column has no `LIKE` operator
 *     (SQLSTATE 42883), so the membership spelling is a `DATABASE_ERROR` 500
 *     on that backend for EVERY multi-valued class, this card's included.
 *     ⚠️ Pre-existing and class-wide, not introduced here: measured on live
 *     PostgreSQL 16.13 with `sql-driver.ts` checked out at this branch's merge
 *     base, where the `multiple: true` NUMBER and `tags` columns answer the
 *     identical 42883 while the boolean column still answers the silent
 *     `1 = 0`. #17590 owns that ruling. What this card's repair changes on
 *     Postgres is only WHICH wrong answer the boolean cell gets — the silent
 *     one becomes the loud one every sibling class already gave.
 *   - Nothing in this repo had executed a text operator against a JSON column
 *     on a live server before this file: #7398's suite, which owns the
 *     membership spelling, constructs `better-sqlite3` in both of its
 *     fixtures.
 *
 * @see SqlDriver.isNonTextColumn — the predicate; the boolean limb is the repair.
 * @see SqlDriver.isJsonColumn — the carve-out's authority on "is this JSON".
 * @see https://github.com/objectstack-ai/objectstack/issues/17590 (the live-Postgres membership gap)
 * @see https://github.com/objectstack-ai/objectstack/issues/17343
 * @see https://github.com/objectstack-ai/objectstack/issues/14079 (the gate)
 * @see https://github.com/objectstack-ai/objectstack/issues/15683 (the temporal carve-out this copies)
 * @see https://github.com/objectstack-ai/objectstack/issues/7398 (the membership spelling it protects)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { NON_TEXT_STORED_VALUE_TYPES } from '@objectstack/spec/data';
import { SqlDriver, type SqlDriverConfig } from './sql-driver.js';
import {
  DIALECT_CELLS,
  declareUnprovisionedCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

/** Issue-prefixed: the live cells share one database with every other suite here. */
const MULTI_OBJECT = 'os17343_multi_boolean';

/** Diagnostics-only; it never changes which rows a read touches. */
const BYPASS: DriverOptions = { bypassTenantAudit: true };

/**
 * [#17590, CLOSED] The membership spelling now EXECUTES on every dialect, so
 * this file no longer carries a per-dialect branch.
 *
 * What stood here was a predicate excusing the PostgreSQL cell: `multiple:
 * true` is a JSON column on every dialect, but only some of them let a TEXT
 * operator reach it — SQLite stored the serialized array as TEXT so `GLOB
 * '*x*'` was a membership test by accident, MySQL coerced its `json` column for
 * `LIKE`, and PostgreSQL's `json` has no `LIKE` operator at all (SQLSTATE
 * 42883 → `DATABASE_ERROR` 500). This card could only pin that divergence and
 * name the issue that owned it.
 *
 * #17590's ruling (2026-09-12) replaced the text lowering with a real
 * MEMBERSHIP construct compiled PER DIALECT, so all three now answer the same
 * rows — including the boolean cell this card owns, which is what "the boolean
 * cell stays loud until the construct covers it" was waiting for. The rows
 * below are therefore asserted on every cell, with no branch to be honest
 * about.
 *
 * ⚠️ Consequence for THIS file's construct assertions: `$contains` on a
 * multi-valued column no longer compiles a pattern match on any dialect. What
 * this card is about survives unchanged — the declared-type gate must not fire
 * on a JSON column — so those assertions now read "a real predicate, not the
 * declared constant", with the shape of that predicate owned by
 * `sql-driver-17590-json-column-membership.test.ts`.
 */

/**
 * The fixture shape. `flags`/`toggles` are the cell this card owns; `nums` and
 * `tags_` are the POSITIVE CONTROLS the card names (they compile a real pattern
 * match today and must not move); `scalar_flag`/`scalar_toggle` are the
 * NEGATIVE controls — the gate must still fire on them, or the repair is a hole
 * in the gate rather than a carve-out for the JSON storage shape.
 */
const MULTI_FIELDS: Record<string, Record<string, unknown>> = {
  label: { type: 'string' },
  flags: { type: 'boolean', multiple: true },
  toggles: { type: 'toggle', multiple: true },
  nums: { type: 'number', multiple: true },
  tags_: { type: 'tags' },
  scalar_flag: { type: 'boolean' },
  scalar_toggle: { type: 'toggle' },
};

/**
 * Rows chosen so the membership filter has a real job: `true` is a member of
 * row 1's and row 3's `flags` and NOT of row 2's, so a gate that silently
 * fails to fire returns a WRONG set rather than the same empty list a fired
 * gate returns.
 */
const MULTI_ROWS = [
  { id: '1', label: 'alpha', flags: [true, false], toggles: [true], nums: [1, 2], tags_: ['red'] },
  { id: '2', label: 'beta', flags: [false], toggles: [false], nums: [3], tags_: ['blue'] },
  { id: '3', label: 'gamma', flags: [true], toggles: [true, false], nums: [1], tags_: ['red', 'blue'] },
] as const;

const POSITIVE_OPERATORS = ['$contains', '$startsWith', '$endsWith', '$icontains', '$like', '$ilike'] as const;

for (const cell of DIALECT_CELLS) {
  if (!cell.available) {
    declareUnprovisionedCell(cell, '[#17343] the multi-valued boolean membership filter');
    continue;
  }
  declareMembershipSweep(cell);
}

/**
 * The `initObjects` REGISTRY FILL, executed. This is the second of the two
 * fills — a repair applied to `registerExternalObject` alone would leave this
 * one live — and it is also the only layer that can say the membership filter
 * ANSWERS, rather than merely compiling to something other than a constant.
 */
function declareMembershipSweep(cell: DialectCell): void {
  describe(`[#17343] SqlDriver — $contains over a multi-valued boolean column (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: Knex;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      knexInstance = driver.getKnex();
      await knexInstance.schema.dropTableIfExists(MULTI_OBJECT);
      await driver.initObjects([{ name: MULTI_OBJECT, fields: MULTI_FIELDS } as never]);
      for (const row of MULTI_ROWS) await driver.create(MULTI_OBJECT, { ...row }, BYPASS);
    });

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(MULTI_OBJECT).catch(() => {});
      await driver?.disconnect?.();
    });

    const ids = async (where: FilterCondition): Promise<string[]> => {
      const rows = await driver.find(MULTI_OBJECT, { where }, BYPASS);
      return rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
    };

    /**
     * The fixture control. Without it every empty answer below has a second
     * possible cause that has nothing to do with the gate — the classic
     * vacuous green.
     */
    it('stored all three rows — the premise of every answer below', async () => {
      const rows = await driver.find(MULTI_OBJECT, {}, BYPASS);
      expect(rows.map((r) => String(r.id)).sort()).toEqual(['1', '2', '3']);
    });

    /**
     * The stored form, read raw, on the dialect whose storage makes the
     * pattern match a MEMBERSHIP test: the cell holds the serialized array as
     * TEXT, so the match is over `[true,false]` and selects the rows whose
     * array really carries `true`. Without this, a green membership row could
     * be a pattern accidentally matching something else entirely.
     *
     * ⚠️ SQLite-only deliberately, and the reason outlived #17590: on
     * PostgreSQL and MySQL the same declaration produces a real `json` column,
     * so `typeof()` has nothing to say there. What the membership filter is
     * asking on each backend is now the same question either way — see
     * `jsonMembershipPredicate`.
     */
    if (cell.id === 'sqlite') {
      it('the column really holds the JSON array text — so the matched rows below are MEMBERSHIP', async () => {
        const probe = (await knexInstance.raw(
          `select typeof(flags) as t_flags, flags as raw_flags from ${MULTI_OBJECT} where id = '1'`,
        )) as Array<Record<string, unknown>>;
        const row = (Array.isArray(probe) ? probe[0] : (probe as { rows?: Array<Record<string, unknown>> }).rows?.[0])!;
        expect(row.t_flags).toBe('text');
        expect(String(row.raw_flags)).toContain('true');
        expect(String(row.raw_flags)).toContain('false');
      });
    }

    it('$contains over a multiple:true BOOLEAN answers the rows whose array holds that member', async () => {
      expect(await ids({ flags: { $contains: 'true' } })).toEqual(['1', '3']);
      expect(await ids({ flags: { $contains: 'false' } })).toEqual(['1', '2']);
    });

    it('$contains over a multiple:true TOGGLE answers identically — same registry arm', async () => {
      expect(await ids({ toggles: { $contains: 'true' } })).toEqual(['1', '3']);
      expect(await ids({ toggles: { $contains: 'false' } })).toEqual(['2', '3']);
    });

    /**
     * The card's positive controls: these two already worked and the repair
     * must not move them.
     */
    it('the multiple:true NUMBER and the tags column beside them are unmoved', async () => {
      expect(await ids({ nums: { $contains: '1' } })).toEqual(['1', '3']);
      expect(await ids({ tags_: { $contains: 'red' } })).toEqual(['1', '3']);
    });

    /**
     * [#17590] Where the NAMED DIVERGENCE used to be pinned. It said: on
     * PostgreSQL the column is a real `json` column and `LIKE` has no operator
     * over `json`, so the membership spelling raised SQLSTATE 42883 — a
     * `DATABASE_ERROR` 500 — for EVERY multi-valued class, this card's boolean
     * cell included. It was pinned rather than skipped precisely so that "the
     * day #17590 is ruled and the membership filter starts answering here, this
     * block goes red and whoever fixes it must come and delete it". It went
     * red, and this is that deletion: the rows above now run on the PostgreSQL
     * cell like any other, and the construct that makes them run is pinned in
     * `sql-driver-17590-json-column-membership.test.ts`.
     */

    /**
     * The negative control, and the reason this is a carve-out rather than a
     * hole. A SCALAR boolean is still a declared non-text column, so every
     * positive text operator still answers the declared no-match and
     * `$notContains` its exact complement.
     */
    it('the SCALAR boolean and toggle beside them are STILL gated — the carve-out is per storage shape', async () => {
      for (const field of ['scalar_flag', 'scalar_toggle']) {
        for (const op of POSITIVE_OPERATORS) {
          expect(await ids({ [field]: { [op]: 'true' } } as FilterCondition), `${op} over ${field}`).toEqual([]);
        }
        expect(await ids({ [field]: { $notContains: 'true' } } as FilterCondition), `$notContains over ${field}`)
          .toEqual(['1', '2', '3']);
      }
    });
  });
}

/**
 * The construct each dialect compiles to, decided WITHOUT a server — the only
 * layer that can say anything about MySQL when no server is provisioned, and
 * the layer that covers the OTHER registry fill (`registerExternalObject`).
 */
describe('[#17343] the per-dialect construct, compiled — the registerExternalObject fill', () => {
  class CompilerProbeDriver extends SqlDriver {
    compileWhere(where: FilterCondition): string {
      const builder: Knex.QueryBuilder = this.getKnex()(MULTI_OBJECT);
      this.applyFilters(builder, where);
      return builder.toString();
    }

    declareMulti(fields: Record<string, Record<string, unknown>> = MULTI_FIELDS): this {
      this.registerExternalObject({ name: MULTI_OBJECT, fields } as never);
      return this;
    }
  }

  const DIALECTS: Array<[string, SqlDriverConfig]> = [
    ['sqlite', { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }],
    ['postgres', { client: 'pg', connection: { host: '127.0.0.1' } }],
    ['mysql', { client: 'mysql2', connection: { host: '127.0.0.1' } }],
  ];
  const typed = (config: SqlDriverConfig) => new CompilerProbeDriver(config).declareMulti();

  /**
   * [#17590] "A real predicate over the column" per dialect — the pattern
   * emitter OR the membership construct that replaced it for `$contains`. This
   * file's question is whether the declared-type gate fired, so it must accept
   * either; asserting one SHAPE here would make it red on the card that changes
   * the other, which is exactly what #17590 did to its predecessor.
   */
  const REAL_PREDICATE: Record<string, RegExp> = {
    sqlite: /LIKE|GLOB|json_each\(/,
    postgres: /LIKE|GLOB|::jsonb @> /,
    mysql: /LIKE|GLOB|JSON_CONTAINS\(/,
  };

  for (const [label, config] of DIALECTS) {
    it(`${label}: a multi-valued boolean/toggle compiles a real predicate, never the constant`, () => {
      const d = typed(config);
      for (const field of ['flags', 'toggles']) {
        for (const op of POSITIVE_OPERATORS) {
          const sql = d.compileWhere({ [field]: { [op]: 'true' } } as FilterCondition);
          expect(sql, `${op} over ${field}`).not.toMatch(/1 = 0|1 = 1/);
          // [#17590] `$contains` compiles the MEMBERSHIP construct now and the
          // rest of the family still compiles a pattern match. What this card
          // is about is neither shape — it is that the declared-type gate does
          // not fire — so this row asks for "a real predicate over the column",
          // and the SHAPE per operator is owned by #17590's own file.
          expect(sql, `${op} over ${field}`).toMatch(REAL_PREDICATE[label]!);
        }
      }
    });

    it(`${label}: the scalar boolean/toggle still compile to the declared constants`, () => {
      const d = typed(config);
      for (const field of ['scalar_flag', 'scalar_toggle']) {
        for (const op of POSITIVE_OPERATORS) {
          const sql = d.compileWhere({ [field]: { [op]: 'true' } } as FilterCondition);
          expect(sql, `${op} over ${field}`).toMatch(/where 1 = 0/);
          expect(sql, `${op} over ${field}`).not.toMatch(/LIKE|GLOB|lower\(|CAST\(/);
        }
        expect(d.compileWhere({ [field]: { $notContains: 'true' } } as FilterCondition), field)
          .toMatch(/where 1 = 1/);
      }
    });

    it(`${label}: the card's positive controls still compile a real predicate`, () => {
      const d = typed(config);
      for (const field of ['nums', 'tags_', 'label']) {
        expect(d.compileWhere({ [field]: { $contains: 'true' } } as FilterCondition), field)
          .toMatch(REAL_PREDICATE[label]!);
      }
      // …and the SCALAR column among them is the one still on the pattern
      // emitter, which is what keeps the row above from passing vacuously.
      expect(d.compileWhere({ label: { $contains: 'true' } } as FilterCondition)).toMatch(/LIKE|GLOB/);
    });
  }

  /**
   * The two registry fills, compiled side by side on one dialect. The
   * asymmetry this card repairs was present in BOTH, so a repair reaching only
   * one of them leaves the defect live on the other — and the two fills are
   * separate code with no shared helper to make that impossible.
   */
  it('BOTH registry fills agree — initObjects and registerExternalObject compile the same construct', async () => {
    const external = typed(DIALECTS[0][1]);
    const managed = new CompilerProbeDriver(DIALECTS[0][1]);
    await managed.getKnex().schema.dropTableIfExists(MULTI_OBJECT);
    await managed.initObjects([{ name: MULTI_OBJECT, fields: MULTI_FIELDS } as never]);
    try {
      for (const field of ['flags', 'toggles', 'nums', 'scalar_flag']) {
        const filter = { [field]: { $contains: 'true' } } as FilterCondition;
        expect(managed.compileWhere(filter), field).toBe(external.compileWhere(filter));
      }
      // …and the agreed construct is the working one, not an agreed `1 = 0`.
      expect(managed.compileWhere({ flags: { $contains: 'true' } })).toMatch(REAL_PREDICATE.sqlite!);
    } finally {
      await managed.getKnex().schema.dropTableIfExists(MULTI_OBJECT).catch(() => {});
      await managed.disconnect?.();
    }
  });

  /**
   * ONE GUARD FOR THE WHOLE CLASS — the invariant behind all three limbs of the
   * predicate rather than the two types this card names.
   *
   * `multiple: true` makes any column a JSON TEXT array ({@link
   * SqlDriver.isJsonField}), and on a JSON array `$contains` is the MEMBERSHIP
   * spelling #7398 deliberately preserved — never a substring test over a
   * stored scalar, which is the only thing the declared-type gate is about. So
   * the gate must not fire on ANY multi-valued column, whatever its declared
   * class. The numeric limb spells that at its registry, the temporal and
   * boolean limbs at the predicate; this sweep is what makes a fourth class
   * joining the set without a carve-out red on arrival instead of silent.
   */
  it('NO declared non-text class fires the gate once the column is MULTI-VALUED', () => {
    const classes = [...NON_TEXT_STORED_VALUE_TYPES].sort();
    expect(classes.length, 'the swept population — a class added upstream must reach this sweep').toBeGreaterThan(8);
    for (const declared of classes) {
      const d = new CompilerProbeDriver(DIALECTS[0][1]).declareMulti({
        many: { type: declared, multiple: true },
        one: { type: declared },
      });
      const membership = d.compileWhere({ many: { $contains: 'x' } });
      expect(membership, `multiple:true ${declared}`).not.toMatch(/1 = 0/);
      // [#17590] the membership construct on the SQLite cell this sweep runs on.
      expect(membership, `multiple:true ${declared}`).toMatch(REAL_PREDICATE.sqlite!);
      // …while the SCALAR column of the same class is gated, which is what
      // makes the row above a carve-out reading rather than a dead gate.
      expect(d.compileWhere({ one: { $contains: 'x' } }), `scalar ${declared}`).toMatch(/1 = 0/);
    }
  });
});
