// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19885] A BARE comparand (`{ field: value }`, the implicit `=`) gets the same
 * compilation and the same comparand gate wherever it sits: at top level, under
 * `$and` / `$or` / `$not` at any depth, or beside a sibling key that carries an
 * operator.
 *
 * # The two positions, and why they disagreed
 *
 * A filter with no operator anywhere compiles through the plain
 * `{ field: value }` loop in `compileFilters`, which runs
 * `assertCompilableComparand` on every value. Anything else — a combinator, or
 * ONE sibling key carrying an operator — routes the whole node through
 * `applyFilterCondition`, whose leaf handling differed from that loop twice:
 *
 * 1. Its bare-value branch carried the column gate but not the comparand gate,
 *    so an ARRAY in the equality slot was bound as it stood.
 * 2. It took "any non-array object" to be an operator map. A `Date` has no own
 *    entries, so it emitted nothing and the leaf was dropped from the `WHERE`.
 *    A NON-EMPTY binary comparand had its byte indices read as operator names,
 *    so it was refused (`INVALID_FILTER` / 400, `Unsupported filter operator
 *    "0"`) where the top level binds it; an EMPTY one had no entries and was
 *    dropped like the `Date`. The `$not` NULL guard (`nullGuardForFieldSpec`)
 *    made the same reading, so an empty binary comparand under `$not` got no
 *    guard at all.
 *
 * # What the driver answered before the fix
 *
 * Measured on this file's fixture, SQLite and a live Postgres 16.13:
 *
 * | filter | SQLite | Postgres |
 * |---|---|---|
 * | `{ tags: ['a'] }` (top level) | 400 `INVALID_FILTER` | 400 `INVALID_FILTER` |
 * | the same leaf under `$and` / `$or` / depth 2 / beside an operator sibling | 500 `DATABASE_ERROR` | resolves `['r_decoy']` |
 * | `{ $not: { tags: ['a'] } }` | 500 `DATABASE_ERROR` | resolves every row but the decoy, `r_a` included |
 * | `{ at: <Date> }` (top level) | `['r_a']` | `['r_a']` |
 * | `{ $and: [{ at: <Date> }] }`, `$or`, beside an operator sibling | every row | every row |
 *
 * The Postgres column is the reason this is not only a status-code bug: `pg`
 * serialises a JS array as its array-literal TEXT (`{"a"}`), so a text column
 * compared against it silently selects the one row storing that text (the
 * decoy, `r_decoy`) and nothing a caller meant. SQLite at least refused the
 * bind, but as a server fault for a filter the caller can fix.
 *
 * Binary comparands, measured on SQLite against the base blob of
 * `sql-driver.ts` (a `blob` column; rows `ab`, `c`, empty, NULL):
 *
 * | filter | before the fix | after |
 * |---|---|---|
 * | `{ blob: <Buffer ab> }` (top level) | `['r_ab']`, `blob = ?` | unchanged |
 * | the same leaf under `$and` / `$or` / `$not` / beside an operator sibling | 400 `Unsupported filter operator "0"` | compiles `blob = ?`, `$and` answers `['r_ab']` |
 * | `{ blob: <empty Buffer> }` (top level) | `['r_empty']`, `blob = ?` | unchanged |
 * | `{ $and: [{ blob: <empty Buffer> }] }`, `$or`, `$not` | every row (no WHERE at all) | compiles `blob = ?` |
 *
 * Binary is SQLite-only here: the dialect-matrix fixture below has no binary
 * column, and the platform doors refuse a binary comparand before any driver.
 *
 * # What is and is not pinned
 *
 * - Every refusal asserts the ADR-0112 envelope (`code` + `status`), and that it
 *   is the SAME refusal as the top-level one — the same redacted message and
 *   the same server-side diagnostic. That diagnostic names the operator and the
 *   field; it carries no filter path, at top level or nested, so none is added
 *   here: the refusal a nested leaf gets is the top-level one, unchanged.
 * - The valid shapes are pinned twice: by row set on every cell, and by the
 *   compiled SQL on the SQLite cell — the strings below were captured from the
 *   driver BEFORE the fix and are what it still emits, so "the fix changed no
 *   valid filter" is an assertion, not a claim.
 * - Run on every cell of the D-A3 driver axis. The live cells are where the
 *   silent wrong answer lived, so a SQLite-only suite would have pinned the
 *   status code and missed the half that returned rows.
 *
 * # Reverse verification — direction predicted before running it
 *
 * Plain before-green / after-red. With both emitter hunks of the fix reverted,
 * every `refuses` case goes red (SQLite: the refusal is a 500 `DATABASE_ERROR`;
 * Postgres: the find resolves), every nested `Date` case goes red (every row
 * answered), and every nested binary case goes red (non-empty: refused as
 * operator "0"; empty: every row). The top-level controls, the valid row sets
 * and the SQL pins stay green, which is what proves the fix narrow rather than
 * merely present. With only the `nullGuardForFieldSpec` hunk reverted, the one
 * case that moves is the empty buffer under `$not`, which loses its NULL row.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import type { FilterCondition } from '@objectstack/spec/data';
import { SqlDriver, withheldFilterDiagnosticOf } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, dialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

/** Issue-prefixed: the live cells share one server with every other suite here. */
const OBJECT = 'os19885_nested_comparand';

/** A whole second, so no dialect's datetime precision can make it a near-miss. */
const INSTANT = '2020-01-01T00:00:00.000Z';
const at = (): Date => new Date(INSTANT);

/**
 * `r_decoy` stores the exact text `pg` renders `['a']` as. It is what turns the
 * pre-fix Postgres answer from "zero rows" into "a row nobody asked for".
 */
const ROWS = [
  { id: 'r_a', name: 'alpha', tags: 'a', at: INSTANT },
  { id: 'r_b', name: 'beta', tags: 'b', at: '2021-06-15T12:00:00.000Z' },
  { id: 'r_decoy', name: 'decoy', tags: '{"a"}', at: null },
  { id: 'r_null', name: 'nul', tags: null, at: null },
];

/** The shape `mapDataError` / `sendError` read off a thrown driver error. */
interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/**
 * The array leaf in every position that reaches `applyFilterCondition`. The
 * last one has no combinator at all — an operator on a SIBLING key is enough.
 */
const NESTED_ARRAY_LEAVES: ReadonlyArray<readonly [string, FilterCondition]> = [
  ['under $and', { $and: [{ tags: ['a'] }] } as unknown as FilterCondition],
  ['under $or', { $or: [{ tags: ['a'] }] } as unknown as FilterCondition],
  ['under $not', { $not: { tags: ['a'] } } as unknown as FilterCondition],
  ['two deep, $or over $and', { $or: [{ $and: [{ tags: ['a'] }] }] } as unknown as FilterCondition],
  ['two deep, $not over $or', { $not: { $or: [{ tags: ['a'] }] } } as unknown as FilterCondition],
  ['beside a sibling that carries an operator', { tags: ['a'], name: { $ne: 'zz' } } as unknown as FilterCondition],
];

const TOP_LEVEL_ARRAY_LEAF = { tags: ['a'] } as unknown as FilterCondition;

/** The same positions with a scalar comparand — each must answer as before. */
const NESTED_SCALAR_LEAVES: ReadonlyArray<readonly [string, FilterCondition, string[]]> = [
  ['under $and', { $and: [{ tags: 'a' }] }, ['r_a']],
  ['under $or', { $or: [{ tags: 'a' }] }, ['r_a']],
  // NULL-safe negation (#5146): a row with no value does not satisfy `tags = 'a'`.
  ['under $not', { $not: { tags: 'a' } }, ['r_b', 'r_decoy', 'r_null']],
  ['two deep, $or over $and', { $or: [{ $and: [{ tags: 'a' }] }] }, ['r_a']],
  ['beside a sibling that carries an operator', { tags: 'a', name: { $ne: 'zz' } }, ['r_a']],
  ['a null comparand under $or', { $or: [{ tags: null }] }, ['r_null']],
];

/** The `Date` leaf in every position that used to drop it. */
const NESTED_DATE_LEAVES: ReadonlyArray<readonly [string, () => FilterCondition, string[]]> = [
  ['under $and', () => ({ $and: [{ at: at() }] }) as unknown as FilterCondition, ['r_a']],
  ['under $or', () => ({ $or: [{ at: at() }] }) as unknown as FilterCondition, ['r_a']],
  ['two deep, $or over $and', () => ({ $or: [{ $and: [{ at: at() }] }] }) as unknown as FilterCondition, ['r_a']],
  ['beside a sibling that carries an operator', () => ({ at: at(), name: { $ne: 'zz' } }) as unknown as FilterCondition, ['r_a']],
  // Pre-fix this compiled to `NOT (at IS NOT NULL)` — the guard without its
  // leaf — and answered only the two NULL rows.
  ['under $not', () => ({ $not: { at: at() } }) as unknown as FilterCondition, ['r_b', 'r_decoy', 'r_null']],
];

/**
 * The SQLite SQL each valid nested shape compiled to BEFORE this fix, captured
 * from the unfixed driver on this fixture. `?` placeholders; bindings beside.
 */
const PRE_FIX_SQLITE_SQL: ReadonlyArray<readonly [FilterCondition, string, unknown[]]> = [
  [{ $or: [{ tags: 'a' }] }, `select \`id\` from \`${OBJECT}\` where ((\`tags\` = ?))`, ['a']],
  [{ $and: [{ tags: 'a' }] }, `select \`id\` from \`${OBJECT}\` where ((\`tags\` = ?))`, ['a']],
  [
    { $not: { tags: 'a' } },
    `select \`id\` from \`${OBJECT}\` where not (((\`tags\` is not null) and (\`tags\` = ?)))`,
    ['a'],
  ],
  [{ $or: [{ $and: [{ tags: 'a' }] }] }, `select \`id\` from \`${OBJECT}\` where ((((\`tags\` = ?))))`, ['a']],
  [
    { tags: 'a', name: { $ne: 'zz' } },
    `select \`id\` from \`${OBJECT}\` where \`tags\` = ? and (\`name\` is null or \`name\` <> ?)`,
    ['a', 'zz'],
  ],
  [{ $or: [{ tags: null }] }, `select \`id\` from \`${OBJECT}\` where ((\`tags\` is null))`, []],
];

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, '[#19885] nested bare comparand', declareNestedBareComparandSuite);
}

function declareNestedBareComparandSuite(cell: DialectCell): void {
  describe(`[#19885] SqlDriver — a bare comparand nested under a combinator (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: Knex;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      knexInstance = driver.getKnex();
      // Live cells reuse one schema per file across runs, so start from a dropped table.
      await knexInstance.schema.dropTableIfExists(OBJECT);
      await driver.initObjects([
        {
          name: OBJECT,
          fields: {
            id: { type: 'text', name: 'id' },
            name: { type: 'text', name: 'name' },
            tags: { type: 'text', name: 'tags' },
            at: { type: 'datetime', name: 'at' },
          },
        } as never,
      ]);
      for (const row of ROWS) await driver.create(OBJECT, row);
    });

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(OBJECT).catch(() => {});
      await driver?.disconnect?.();
    });

    const find = (where: FilterCondition) => driver.find(OBJECT, { fields: ['id'], where });

    const ids = async (where: FilterCondition): Promise<string[]> =>
      ((await find(where)) as Array<{ id: unknown }>).map((r) => String(r.id)).sort();

    const refusalOf = async (where: FilterCondition): Promise<WireBearingError> => {
      let rows: unknown[];
      try {
        rows = await find(where);
      } catch (e) {
        return e as WireBearingError;
      }
      // Outside the `try`, so a resolution can never be returned as the refusal.
      throw new Error(
        `expected the driver to refuse this filter, but it resolved ${JSON.stringify(
          (rows as Array<{ id: unknown }>).map((r) => r.id),
        )}`,
      );
    };

    it('fixture control — every row landed, and each leaf value finds its row at top level', async () => {
      expect(await ids({})).toEqual(['r_a', 'r_b', 'r_decoy', 'r_null']);
      expect(await ids({ tags: 'a' })).toEqual(['r_a']);
      expect(await ids({ tags: '{"a"}' })).toEqual(['r_decoy']);
      expect(await ids({ at: at() } as unknown as FilterCondition)).toEqual(['r_a']);
    });

    it('top-level control — the array leaf with no operator anywhere is refused, as it always was', async () => {
      const err = await refusalOf(TOP_LEVEL_ARRAY_LEAF);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
    });

    for (const [label, where] of NESTED_ARRAY_LEAVES) {
      it(`refuses the array leaf ${label} with the top-level refusal, not a DATABASE_ERROR or a row set`, async () => {
        const top = await refusalOf(TOP_LEVEL_ARRAY_LEAF);
        const err = await refusalOf(where);
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        // The same gate, not merely the same code: one redacted message, and one
        // server-side diagnostic naming the same operator and field.
        expect(err.message).toBe(top.message);
        expect(withheldFilterDiagnosticOf(err)).toBe(withheldFilterDiagnosticOf(top));
      });
    }

    for (const [label, where, expected] of NESTED_SCALAR_LEAVES) {
      it(`valid control — the scalar leaf ${label} answers as before`, async () => {
        expect(await ids(where)).toEqual(expected);
      });
    }

    for (const [label, where, expected] of NESTED_DATE_LEAVES) {
      it(`compiles the Date leaf ${label} as the equality the top level compiles, never dropping it`, async () => {
        expect(await ids(where())).toEqual(expected);
      });
    }

    if (cell.id === 'sqlite') {
      it('valid control — each nested scalar shape compiles to the SQL it compiled to before the fix', () => {
        for (const [where, sql, bindings] of PRE_FIX_SQLITE_SQL) {
          const qb = knexInstance(OBJECT).select('id');
          // `applyFilters` is the driver's one production entry into the filter
          // compiler (its docblock); compiling onto a bare builder reads exactly
          // the WHERE it emits, with nothing `find` adds around it.
          (driver as unknown as { applyFilters(b: Knex.QueryBuilder, f: unknown): void }).applyFilters(qb, where);
          const compiled = qb.toSQL();
          expect(compiled.sql, JSON.stringify(where)).toBe(sql);
          expect(compiled.bindings, JSON.stringify(where)).toEqual(bindings);
        }
      });
    }
  });
}

// ── Binary comparands — SQLite only ─────────────────────────────────────────

/**
 * Its own table, because the matrix fixture above has no binary column. Binary
 * is a comparand this DRIVER binds (`isBindableComparand` admits
 * `ArrayBuffer.isView`) and the platform doors refuse, so only a direct driver
 * caller reaches it — which is also the only caller these pins stand in for.
 */
const BINARY_OBJECT = 'os19885_nested_binary';

const BINARY_ROWS = [
  { id: 'r_ab', blob: Buffer.from('ab') },
  { id: 'r_c', blob: Buffer.from('c') },
  { id: 'r_empty', blob: Buffer.alloc(0) },
  { id: 'r_null', blob: null },
];

const binaryWhere = (where: unknown): FilterCondition => where as FilterCondition;

describe('[#19885] SqlDriver — a binary comparand nested under a combinator (sqlite)', () => {
  let driver: SqlDriver;
  let knexInstance: Knex;

  beforeAll(async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    knexInstance = driver.getKnex();
    await knexInstance.schema.createTable(BINARY_OBJECT, (t: Knex.TableBuilder) => {
      t.string('id').primary();
      t.binary('blob');
    });
    await knexInstance(BINARY_OBJECT).insert(BINARY_ROWS);
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  const ids = async (where: FilterCondition): Promise<string[]> =>
    ((await driver.find(BINARY_OBJECT, { fields: ['id'], where })) as Array<{ id: unknown }>)
      .map((r) => String(r.id))
      .sort();

  /** The WHERE `applyFilters` emits, on a bare builder — see the SQL pin above. */
  const compile = (where: FilterCondition): { sql: string; bindings: readonly unknown[] } => {
    const qb = knexInstance(BINARY_OBJECT).select('id');
    (driver as unknown as { applyFilters(b: Knex.QueryBuilder, f: unknown): void }).applyFilters(qb, where);
    const { sql, bindings } = qb.toSQL();
    return { sql, bindings };
  };

  it('fixture control — each stored value finds its row at top level', async () => {
    expect(await ids(binaryWhere({}))).toEqual(['r_ab', 'r_c', 'r_empty', 'r_null']);
    expect(await ids(binaryWhere({ blob: Buffer.from('ab') }))).toEqual(['r_ab']);
    expect(await ids(binaryWhere({ blob: Buffer.alloc(0) }))).toEqual(['r_empty']);
  });

  it('a non-empty Buffer leaf under $and compiles to the predicate and binding the top level compiles, and answers the same rows', async () => {
    // Before the fix its byte indices were read as operator names: refused,
    // `Unsupported filter operator "0"`, while the top level bound it.
    const top = compile(binaryWhere({ blob: Buffer.from('ab') }));
    const nested = compile(binaryWhere({ $and: [{ blob: Buffer.from('ab') }] }));
    expect(top.sql).toBe(`select \`id\` from \`${BINARY_OBJECT}\` where \`blob\` = ?`);
    // The same predicate, inside the group `$and` opens.
    expect(nested.sql).toBe(`select \`id\` from \`${BINARY_OBJECT}\` where ((\`blob\` = ?))`);
    expect(top.bindings).toEqual([Buffer.from('ab')]);
    expect(nested.bindings).toEqual(top.bindings);
    expect(await ids(binaryWhere({ $and: [{ blob: Buffer.from('ab') }] }))).toEqual(['r_ab']);
  });

  it('a non-empty Buffer leaf answers as the top level does under $or, beside an operator sibling, and under $not', async () => {
    expect(await ids(binaryWhere({ $or: [{ blob: Buffer.from('ab') }] }))).toEqual(['r_ab']);
    expect(await ids(binaryWhere({ blob: Buffer.from('ab'), id: { $ne: 'zz' } }))).toEqual(['r_ab']);
    // NULL-safe negation: the NULL row satisfies `$not` of an equality.
    expect(await ids(binaryWhere({ $not: { blob: Buffer.from('ab') } }))).toEqual(['r_c', 'r_empty', 'r_null']);
  });

  it('an EMPTY Buffer leaf under $and compiles to the top-level predicate and binding instead of being dropped', async () => {
    // Before the fix it had no entries, emitted nothing, and the query had no
    // WHERE at all: every row.
    const top = compile(binaryWhere({ blob: Buffer.alloc(0) }));
    const nested = compile(binaryWhere({ $and: [{ blob: Buffer.alloc(0) }] }));
    expect(nested.sql).toBe(`select \`id\` from \`${BINARY_OBJECT}\` where ((\`blob\` = ?))`);
    expect(nested.bindings).toEqual(top.bindings);
    expect(await ids(binaryWhere({ $and: [{ blob: Buffer.alloc(0) }] }))).toEqual(['r_empty']);
    expect(await ids(binaryWhere({ $or: [{ blob: Buffer.alloc(0) }] }))).toEqual(['r_empty']);
  });

  it('an EMPTY Buffer leaf under $not keeps the NULL row, as every negated equality does', async () => {
    // Guards `nullGuardForFieldSpec`: it read an empty buffer as an operator map
    // with no operators, gave it no guard, and `NOT (blob = ?)` dropped r_null.
    expect(await ids(binaryWhere({ $not: { blob: Buffer.alloc(0) } }))).toEqual(['r_ab', 'r_c', 'r_null']);
  });
});
