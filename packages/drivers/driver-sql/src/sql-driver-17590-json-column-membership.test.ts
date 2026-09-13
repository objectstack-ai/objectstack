// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17590, director ruling 2026-09-12] `$contains` on a multi-valued / JSON
 * column is a MEMBERSHIP test, and `driver-sql` compiles it PER DIALECT so
 * SQLite, MySQL and PostgreSQL answer the SAME ROWS.
 *
 * ## What was broken, measured before the change
 *
 * The membership spelling was lowered by `textMatchPredicate` like any other
 * text operator, so each backend was asked about the SERIALIZATION rather than
 * about the members, and the three answered three different things:
 *
 * | dialect | construct | answer |
 * |:--|:--|:--|
 * | SQLite | `col GLOB '*v*'` over the TEXT holding `["a","b"]` | the member rows, USUALLY — a substring test |
 * | MySQL | `CAST(col AS BINARY) LIKE ?`, the `json` column coerced | the same substring test |
 * | PostgreSQL | `col LIKE $1 ESCAPE $2` over a real `json` column | **SQLSTATE 42883** → `DATABASE_ERROR` 500 |
 *
 * Reproduced on live PostgreSQL 16.13 before a line of this card was written:
 * `"tags_" LIKE $1 ESCAPE $2` → `operator does not exist: json ~~ text`, on
 * every JSON column of the fixture, with the `character varying` column beside
 * them answering normally.
 *
 * ## What this file pins, and why the rows are shaped the way they are
 *
 * Every fixture row is chosen so **substring and membership disagree**. That is
 * the whole design: a suite whose rows answer the same either way would stay
 * green through a revert to the substring emitter on the two dialects where it
 * runs, which is exactly the freeze the ruling refused (option B, `col::text
 * LIKE`). So `tags_: ['redwood']` must NOT answer `$contains: 'red'`, and
 * `nums: [10, 21]` must NOT answer `$contains: '1'`.
 *
 * The three declared classes are the ruling's own fixture — `tags`,
 * `multiselect`, and a `multiple: true` `number` — one from
 * `STRUCTURED_JSON_TYPES`' array neighbours, one from `MULTI_OPTION_TYPES`, and
 * one that is a JSON column only because `multiple: true` says so. The scalar
 * `label` column beside them is the NEGATIVE control and the other half of the
 * contract sentence: on a scalar string column `$contains` STAYS the substring
 * test, so a change that made membership universal would redden this file
 * rather than silently retire substring search.
 *
 * ## Which cells executed
 *
 * - **sqlite** — always, embedded.
 * - **live postgres** — the cell that carried the defect. Runs when
 *   provisioned; measured here on PostgreSQL 16.13.
 * - **live mysql** — measured DIRECTLY, which is what the ruling asked for:
 *   the card's MySQL row was a second-hand reading off #17343's CI job.
 *   Measured here on MySQL 8.0.46.
 *
 * The three cells assert the SAME literal row sets, which is what "answer the
 * same rows" means in a file that cannot compare two dialects inside one test.
 *
 * @see SqlDriver.applyJsonMembership — the emitter and its two fall-through cases.
 * @see jsonMembershipPredicate — the per-dialect construct and its measured table.
 * @see jsonMembershipCandidates — why one string comparand denotes two JSON scalars.
 * @see https://github.com/objectstack-ai/objectstack/issues/17590
 * @see https://github.com/objectstack-ai/objectstack/issues/7398 (the membership spelling)
 * @see https://github.com/objectstack-ai/objectstack/issues/17343 (the boolean cell this covers)
 * @see https://github.com/objectstack-ai/objectstack/issues/17469 (the population predicate, unwidened)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { SqlDriver, type SqlDriverConfig } from './sql-driver.js';
import {
  DIALECT_CELLS,
  declareUnprovisionedCell,
  LIVE_CELL_TIMEOUT_MS,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

/** Issue-prefixed: the live cells share one schema with every other suite here. */
const OBJECT = 'os17590_membership';

/** Diagnostics-only; it never changes which rows a read touches. */
const BYPASS: DriverOptions = { bypassTenantAudit: true };

/**
 * The ruling's fixture. `label` is the scalar control — the column on which
 * `$contains` must STAY the substring test.
 */
const FIELDS: Record<string, Record<string, unknown>> = {
  label: { type: 'string' },
  tags_: { type: 'tags' },
  picks: { type: 'multiselect' },
  nums: { type: 'number', multiple: true },
};

/**
 * Rows where substring and membership DISAGREE on every column — see the head
 * note. `redwood`/`ab`/`[10, 21]` are the rows a substring emitter returns and
 * a membership construct does not.
 */
const ROWS = [
  { id: '1', label: 'redwood', tags_: ['red', 'blue'], picks: ['a', 'b'], nums: [1, 2] },
  { id: '2', label: 'red', tags_: ['redwood'], picks: ['ab'], nums: [10, 21] },
  { id: '3', label: 'blue', tags_: ['blue'], picks: ['b'], nums: [2] },
  { id: '4', label: 'none', tags_: [], picks: [], nums: [] },
] as const;

const ALL_IDS = ['1', '2', '3', '4'];

for (const cell of DIALECT_CELLS) {
  if (!cell.available) {
    declareUnprovisionedCell(cell, '[#17590] the $contains JSON-column membership');
    continue;
  }
  declareMembershipCell(cell);
}

function declareMembershipCell(cell: DialectCell): void {
  describe(`[#17590] SqlDriver — $contains is MEMBERSHIP on a JSON column (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: Knex;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      knexInstance = driver.getKnex();
      await knexInstance.schema.dropTableIfExists(OBJECT);
      await driver.initObjects([{ name: OBJECT, fields: FIELDS } as never]);
      for (const row of ROWS) await driver.create(OBJECT, { ...row, tags_: [...row.tags_], picks: [...row.picks], nums: [...row.nums] }, BYPASS);
    }, LIVE_CELL_TIMEOUT_MS);

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(OBJECT).catch(() => {});
      await driver?.disconnect?.();
    });

    const ids = async (where: FilterCondition): Promise<string[]> => {
      const rows = await driver.find(OBJECT, { where }, BYPASS);
      return rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
    };

    /**
     * The fixture control. Without it every empty answer below has a second
     * cause that has nothing to do with the construct — the classic vacuous
     * green.
     */
    it('stored all four rows — the premise of every answer below', async () => {
      expect(await ids({})).toEqual(ALL_IDS);
    }, LIVE_CELL_TIMEOUT_MS);

    it('$contains over a `tags` column answers the MEMBER rows, never the substring rows', async () => {
      expect(await ids({ tags_: { $contains: 'red' } })).toEqual(['1']);
      expect(await ids({ tags_: { $contains: 'redwood' } })).toEqual(['2']);
      expect(await ids({ tags_: { $contains: 'blue' } })).toEqual(['1', '3']);
      expect(await ids({ tags_: { $contains: 'wood' } })).toEqual([]);
    }, LIVE_CELL_TIMEOUT_MS);

    it('$contains over a `multiselect` column answers identically — same construct, same rows', async () => {
      expect(await ids({ picks: { $contains: 'a' } })).toEqual(['1']);
      expect(await ids({ picks: { $contains: 'ab' } })).toEqual(['2']);
      expect(await ids({ picks: { $contains: 'b' } })).toEqual(['1', '3']);
    }, LIVE_CELL_TIMEOUT_MS);

    /**
     * The `multiple: true` NUMBER — the column whose members are JSON NUMBERS
     * while the contract declares the comparand a STRING. A type-strict
     * construct would answer nothing here, which is why the comparand denotes
     * two candidates.
     */
    it('$contains over a multiple:true NUMBER answers by MEMBER, not by digit substring', async () => {
      expect(await ids({ nums: { $contains: '1' } })).toEqual(['1']);
      expect(await ids({ nums: { $contains: '2' } })).toEqual(['1', '3']);
      expect(await ids({ nums: { $contains: '10' } })).toEqual(['2']);
      expect(await ids({ nums: { $contains: '0' } })).toEqual([]);
    }, LIVE_CELL_TIMEOUT_MS);

    /**
     * The other half of the contract sentence, and the negative control: a
     * SCALAR string column keeps the substring test, so `red` still answers the
     * row whose label is `redwood`.
     */
    it('a SCALAR string column keeps the SUBSTRING test — the membership reading is per column, not per operator', async () => {
      expect(await ids({ label: { $contains: 'red' } })).toEqual(['1', '2']);
      expect(await ids({ label: { $contains: 'wood' } })).toEqual(['1']);
    }, LIVE_CELL_TIMEOUT_MS);

    /**
     * `$notContains` is declared "the negation of $contains, on the same
     * comparand contract", so it has to move with it or the pair stops
     * partitioning the rows. Row 4's empty array and every non-member row are
     * on the complement side.
     */
    it('$notContains is the exact COMPLEMENT of $contains on the same column', async () => {
      for (const comparand of ['red', 'redwood', 'blue', 'wood']) {
        const inside = await ids({ tags_: { $contains: comparand } });
        const outside = await ids({ tags_: { $notContains: comparand } });
        expect([...inside, ...outside].sort(), `$contains ∪ $notContains for ${comparand}`).toEqual(ALL_IDS);
        expect(inside.filter((id) => outside.includes(id)), `$contains ∩ $notContains for ${comparand}`).toEqual([]);
      }
    }, LIVE_CELL_TIMEOUT_MS);

    /**
     * The comparand is matched LITERALLY — the `LITERAL_COMPARAND_DESCRIPTION`
     * contract the family shares. Under the membership construct it is literal
     * by construction (the comparand becomes a JSON scalar, never a pattern),
     * and this row is what keeps that stated: a `%` comparand must match the
     * row whose member IS `100%` and nothing else.
     */
    it('the comparand stays LITERAL — a wildcard character is a character', async () => {
      await driver.create(OBJECT, { id: '5', label: 'pct', tags_: ['100%'], picks: [], nums: [] }, BYPASS);
      try {
        expect(await ids({ tags_: { $contains: '%' } })).toEqual([]);
        expect(await ids({ tags_: { $contains: '100%' } })).toEqual(['5']);
      } finally {
        await driver.delete(OBJECT, '5', BYPASS).catch(() => {});
      }
    }, LIVE_CELL_TIMEOUT_MS);
  });
}

/**
 * The construct each dialect compiles to, decided WITHOUT a server — the layer
 * that covers `registerExternalObject`'s registry fill, and the only layer that
 * can name the SQL a dialect gets rather than the rows it returns.
 */
describe('[#17590] the per-dialect membership construct, compiled', () => {
  class CompilerProbeDriver extends SqlDriver {
    compileWhere(where: FilterCondition): string {
      const builder: Knex.QueryBuilder = this.getKnex()(OBJECT);
      this.applyFilters(builder, where);
      return builder.toString();
    }

    declare(fields: Record<string, Record<string, unknown>> = FIELDS): this {
      this.registerExternalObject({ name: OBJECT, fields } as never);
      return this;
    }
  }

  /** The SQL fragment that proves the membership construct, per dialect. */
  const CONSTRUCT: Record<string, RegExp> = {
    sqlite: /json_each\(/,
    postgres: /::jsonb @> /,
    mysql: /JSON_CONTAINS\(/,
  };

  const DIALECTS: Array<[string, SqlDriverConfig]> = [
    ['sqlite', { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }],
    ['postgres', { client: 'pg', connection: { host: '127.0.0.1' } }],
    ['mysql', { client: 'mysql2', connection: { host: '127.0.0.1' } }],
  ];

  for (const [label, config] of DIALECTS) {
    it(`${label}: every JSON column compiles the membership construct, never a pattern match`, () => {
      const d = new CompilerProbeDriver(config).declare();
      for (const field of ['tags_', 'picks', 'nums']) {
        const sql = d.compileWhere({ [field]: { $contains: 'red' } } as FilterCondition);
        expect(sql, `${field} on ${label}`).toMatch(CONSTRUCT[label]!);
        expect(sql, `${field} on ${label} must not be a pattern match`).not.toMatch(/LIKE|GLOB/);
        expect(sql, `${field} on ${label} must not be a declared constant`).not.toMatch(/1 = 0|1 = 1/);
      }
    });

    it(`${label}: the SCALAR string column still compiles the PATTERN match`, () => {
      const d = new CompilerProbeDriver(config).declare();
      const sql = d.compileWhere({ label: { $contains: 'red' } } as FilterCondition);
      expect(sql, `label on ${label}`).toMatch(/LIKE|GLOB/);
      expect(sql, `label on ${label}`).not.toMatch(CONSTRUCT[label]!);
    });

    it(`${label}: $notContains compiles the NEGATED membership construct, NULL-safe`, () => {
      const d = new CompilerProbeDriver(config).declare();
      const sql = d.compileWhere({ tags_: { $notContains: 'red' } } as FilterCondition);
      expect(sql, `negated construct on ${label}`).toMatch(CONSTRUCT[label]!);
      expect(sql, `negation on ${label}`).toMatch(/not \(|NOT \(/);
      expect(sql, `null-safety on ${label}`).toMatch(/is null/i);
    });

    /**
     * The other text operators are NOT membership spellings and this card does
     * not rule on them — they keep the lowering they had. Pinned so a later
     * widening is a deliberate edit here rather than a silent side effect.
     */
    it(`${label}: the rest of the text family is UNMOVED on a JSON column`, () => {
      const d = new CompilerProbeDriver(config).declare();
      for (const op of ['$startsWith', '$endsWith', '$icontains', '$like', '$ilike']) {
        const sql = d.compileWhere({ tags_: { [op]: 'red' } } as FilterCondition);
        expect(sql, `${op} on ${label}`).toMatch(/LIKE|GLOB/);
        expect(sql, `${op} on ${label}`).not.toMatch(CONSTRUCT[label]!);
      }
    });
  }

  /**
   * The two registry fills compile the same construct. The population this card
   * uses is `isJsonColumn`, which both `initObjects` and
   * `registerExternalObject` fill from `isJsonField` — a repair reaching only
   * one of them would leave the other on the substring emitter.
   */
  it('BOTH registry fills agree — initObjects and registerExternalObject compile the same construct', async () => {
    const external = new CompilerProbeDriver(DIALECTS[0]![1]).declare();
    const managed = new CompilerProbeDriver(DIALECTS[0]![1]);
    await managed.getKnex().schema.dropTableIfExists(OBJECT);
    await managed.initObjects([{ name: OBJECT, fields: FIELDS } as never]);
    try {
      for (const field of ['tags_', 'picks', 'nums', 'label']) {
        const filter = { [field]: { $contains: 'red' } } as FilterCondition;
        expect(managed.compileWhere(filter), field).toBe(external.compileWhere(filter));
      }
      expect(managed.compileWhere({ tags_: { $contains: 'red' } })).toMatch(CONSTRUCT.sqlite!);
    } finally {
      await managed.getKnex().schema.dropTableIfExists(OBJECT).catch(() => {});
      await managed.disconnect?.();
    }
  });

  /**
   * The POPULATION, pinned as a whole rather than as the three declared classes
   * above: `isJsonColumn` is `JSON_COLUMN_TYPES.has(type) || !!field.multiple`
   * (#17469's reading of the predicate the driver uses TODAY), so a class added
   * to that set — or a `multiple: true` of any declared class — arrives with
   * the membership construct instead of quietly keeping the substring one.
   * ⛔ The population is NOT widened here; this asserts the one that exists.
   */
  it('the population is every JSON column — declared class or multiple:true alike', () => {
    const d = new CompilerProbeDriver(DIALECTS[0]![1]).declare({
      many_str: { type: 'string', multiple: true },
      many_bool: { type: 'boolean', multiple: true },
      many_date: { type: 'datetime', multiple: true },
      checks: { type: 'checkboxes' },
      one_str: { type: 'string' },
    });
    for (const field of ['many_str', 'many_bool', 'many_date', 'checks']) {
      expect(d.compileWhere({ [field]: { $contains: 'x' } } as FilterCondition), field)
        .toMatch(CONSTRUCT.sqlite!);
    }
    // …while the scalar string column of the same sweep still gets the pattern.
    expect(d.compileWhere({ one_str: { $contains: 'x' } })).toMatch(/GLOB/);
  });
});
