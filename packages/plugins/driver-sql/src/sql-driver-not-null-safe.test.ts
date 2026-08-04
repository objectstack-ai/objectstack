// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5146] `$not` is NULL-safe: a row whose compared column is NULL is returned
 * by a negation, exactly as `driver-memory` and `formula` already return it.
 *
 * # What was wrong
 *
 * SQL is three-valued. `NULL = 'won'` is UNKNOWN, `NOT UNKNOWN` is UNKNOWN, and
 * a `WHERE` keeps only TRUE — so `{ $not: { stage: 'won' } }` compiled to
 * `not (stage = 'won')` and silently dropped every row whose `stage` is NULL.
 * The other two backends evaluate the same filter in ordinary two-valued JS
 * (`undefined !== 'won'` → the row matches) and returned those rows. One
 * declared operator, two answers, chosen by which driver happened to run it.
 *
 * That is not a cosmetic difference. A CEL `!expr` in a permission rule lowers
 * to `{ $not: {…} }` (`packages/formula/src/cel-to-filter.ts`), so the SAME read
 * scope admitted a different set of rows per backend. #5146 ruled the JS answer
 * canonical (it is the 2:1 majority, and nobody writing `!(stage == 'won')`
 * expects rows with no stage to be hidden by it).
 *
 * # What the fix emits
 *
 * Each leaf INSIDE a `$not` is compiled to a total predicate — never UNKNOWN —
 * before the negation is applied: `NOT (stage IS NOT NULL AND stage = 'won')`.
 * For the flat shape that is exactly the `NOT (…) OR col IS NULL` the issue
 * asks for; pushing the guard down to the leaf is what keeps it correct when the
 * operand nests (see the `$or` case below, where a hoisted guard would re-admit
 * row 3) and lets the direction of the guard follow each operator's own answer
 * for a missing value (`$ne` / `$nin` are NOT widened).
 *
 * Nothing outside a `$not` changes: an ordinary comparison compiles to the same
 * SQL it always did, so no plain predicate loses an index to this.
 *
 * These expectations are duplicated by hand in the two JS backends'
 * `*-not-null-safe.test.ts`. They belong in `FILTER_LOGIC_CASES`
 * (`@objectstack/spec/data`) so every backend is held to them at once — that
 * table is being extended under #5239 / the spec lane of #5146, which lands
 * with driver-mongodb; until then these three files are the pin.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import type { FilterCondition } from '@objectstack/spec/data';

/**
 * Rows 3 and 4 are the point: `stage` is NULL in both, and row 3 additionally
 * carries a NULL `amount` while row 4 carries a NULL `owner`, so a guard that is
 * applied to the wrong column shows up as a wrong id rather than by luck.
 */
const FIXTURE = [
  { id: '1', stage: 'won', owner: 'u1', amount: 10 },
  { id: '2', stage: 'lost', owner: 'u2', amount: 20 },
  { id: '3', stage: null, owner: 'u1', amount: null },
  { id: '4', stage: null, owner: null, amount: 40 },
];

const ALL = ['1', '2', '3', '4'];

describe('[#5146] SqlDriver compiles $not NULL-safely', () => {
  let driver: SqlDriver;
  let knex: any;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knex = (driver as any).knex;
    await knex.schema.createTable('deal', (t: any) => {
      t.string('id').primary();
      t.string('stage');
      t.string('owner');
      t.float('amount');
    });
    await knex('deal').insert(FIXTURE);
  });

  afterEach(async () => {
    await knex.destroy();
  });

  const ids = async (where: unknown): Promise<string[]> => {
    const rows = await driver.find('deal', {
      object: 'deal',
      fields: ['id'],
      where: where as FilterCondition,
    });
    return rows.map((r: any) => String(r.id)).sort();
  };

  /** The SQL this filter compiles to — the same assertion style as #3912's. */
  const sqlFor = (where: unknown): string => {
    const qb = knex('deal').select('id');
    (driver as any).applyFilterCondition(qb, where, 'and', 'deal');
    return qb.toString();
  };

  // ── The headline: a NULL column no longer hides the row from a negation ────

  describe('a NULL column does not satisfy the negated condition', () => {
    it('$not on an implicit equality returns the NULL rows', async () => {
      // Was ['2'] — rows 3 and 4 fell into UNKNOWN and disappeared.
      expect(await ids({ $not: { stage: 'won' } })).toEqual(['2', '3', '4']);
    });

    it('the guard rides the leaf, so the emitted SQL is NOT-of-a-total predicate', () => {
      const sql = sqlFor({ $not: { stage: 'won' } });
      expect(sql).toContain('`stage` is not null');
      expect(sql).toContain("`stage` = 'won'");
      expect(sql).toMatch(/^select `id` from `deal` where not \(/);
    });

    it('$not over MULTIPLE columns admits a row that is NULL in EITHER', async () => {
      // `NOT (a = 1 AND b = 2)` is UNKNOWN when either column is NULL, so both
      // row 3 (NULL stage) and row 4 (NULL stage AND NULL owner) were dropped.
      expect(await ids({ $not: { stage: 'won', owner: 'u1' } })).toEqual(['2', '3', '4']);
      const sql = sqlFor({ $not: { stage: 'won', owner: 'u1' } });
      expect(sql).toContain('`stage` is not null');
      expect(sql).toContain('`owner` is not null');
    });

    it('the RLS shape: a CEL `!(stage == "won")` scope stops hiding stage-less rows', async () => {
      // What `cel-to-filter.ts` lowers `!(stage == 'won')` to. Before this fix
      // the same rule showed 1 row on a SQL datasource and 3 on the in-memory
      // one — the visible-set divergence #5146 reports.
      expect(await ids({ $not: { stage: 'won' } })).toHaveLength(3);
    });
  });

  // ── Nesting: why the guard cannot be hoisted next to the NOT ───────────────

  describe('the guard composes through nested combinators', () => {
    it('$not of a $or excludes a NULL row whose OTHER branch matches', async () => {
      // Row 3 has a NULL stage but owner = 'u1', so the inner $or IS satisfied
      // and the negation must reject it. A `NOT (…) OR stage IS NULL` hoisted to
      // the top would hand row 3 back — a widening, and the exact reason the
      // guard is compiled onto each leaf instead.
      expect(await ids({ $not: { $or: [{ stage: 'won' }, { owner: 'u1' }] } })).toEqual(['2', '4']);
    });

    it('$not of a $and admits every row that fails either conjunct', async () => {
      expect(await ids({ $not: { $and: [{ stage: 'won' }, { owner: 'u1' }] } })).toEqual(['2', '3', '4']);
    });

    it('a double negation is the identity again, NULL rows included', async () => {
      // `NOT NOT (stage = 'won')` used to answer UNKNOWN twice over. With total
      // leaves it collapses to the positive filter — including for NULL rows,
      // which must be EXCLUDED here.
      expect(await ids({ $not: { $not: { stage: 'won' } } })).toEqual(['1']);
      expect(await ids({ $not: { $not: { stage: 'won' } } })).toEqual(await ids({ stage: 'won' }));
    });

    it('$not still ANDs with its sibling keys', async () => {
      expect(await ids({ $not: { stage: 'won' }, owner: 'u1' })).toEqual(['3']);
    });

    it('a $not nested inside a $or branch stays NULL-safe', async () => {
      expect(await ids({ $or: [{ $not: { stage: 'won' } }, { owner: 'u2' }] })).toEqual(['2', '3', '4']);
    });
  });

  // ── Polarity: the guard follows the operator, it is never blanket ──────────

  describe('each operator is guarded in the direction it answers for a missing value', () => {
    it('$not of $ne is NOT widened — it still means "the column IS that value"', async () => {
      // `{$not: {stage: {$ne: 'won'}}}` ≡ `{stage: 'won'}`. A blanket
      // `OR stage IS NULL` would have handed back rows 3 and 4, i.e. rows the
      // filter excludes — the silent widening class of #2704 / #5134.
      expect(await ids({ $not: { stage: { $ne: 'won' } } })).toEqual(['1']);
      expect(sqlFor({ $not: { stage: { $ne: 'won' } } })).toContain('`stage` is null');
    });

    it('$not of $nin is not widened either', async () => {
      expect(await ids({ $not: { stage: { $nin: ['won'] } } })).toEqual(['1']);
    });

    it('$not of $in returns the NULL rows', async () => {
      expect(await ids({ $not: { stage: { $in: ['won'] } } })).toEqual(['2', '3', '4']);
    });

    it('$not of an ordering comparison returns the NULL rows', async () => {
      // Row 3's amount is NULL: `NOT (amount > 15)` was UNKNOWN, now TRUE.
      expect(await ids({ $not: { amount: { $gt: 15 } } })).toEqual(['1', '3']);
    });

    it('$not of $contains returns the NULL rows', async () => {
      expect(await ids({ $not: { stage: { $contains: 'w' } } })).toEqual(['2', '3', '4']);
    });

    it('$not of $notContains keeps this driver\'s existing answer', async () => {
      // The one operator where the two JS backends disagree on a null-valued
      // field (`driver-memory` says a NULL does not satisfy `$notContains`,
      // `formula` says it does). The rewrite follows `formula`, which is what
      // this driver already answered — so nothing here is decided by accident;
      // the disagreement is filed on its own.
      expect(await ids({ $not: { stage: { $notContains: 'w' } } })).toEqual(['1']);
    });

    it('$not of a null predicate is untouched — it was already two-valued', async () => {
      expect(await ids({ $not: { stage: { $null: true } } })).toEqual(['1', '2']);
      expect(await ids({ $not: { stage: { $null: false } } })).toEqual(['3', '4']);
      expect(await ids({ $not: { stage: { $exists: true } } })).toEqual(['3', '4']);
      expect(await ids({ $not: { stage: { $exists: false } } })).toEqual(['1', '2']);
      // No guard is added around a predicate that can never be UNKNOWN.
      expect(sqlFor({ $not: { stage: { $null: true } } })).toBe(
        'select `id` from `deal` where not (`stage` is null)',
      );
    });

    it('$not of an explicit `null` comparand is untouched', async () => {
      // `{ stage: null }` and `{ stage: { $eq: null } }` compile to `IS NULL`,
      // which is total already.
      expect(await ids({ $not: { stage: null } })).toEqual(['1', '2']);
      expect(await ids({ $not: { stage: { $eq: null } } })).toEqual(['1', '2']);
      expect(await ids({ $not: { stage: { $ne: null } } })).toEqual(['3', '4']);
    });
  });

  // ── Nothing outside `$not` moves ───────────────────────────────────────────

  describe('only the $not path is rewritten', () => {
    it('a plain comparison compiles to exactly the SQL it always did', () => {
      expect(sqlFor({ stage: 'won' })).toBe("select `id` from `deal` where `stage` = 'won'");
      expect(sqlFor({ stage: { $ne: 'won' } })).toBe("select `id` from `deal` where `stage` <> 'won'");
      expect(sqlFor({ amount: { $gt: 15 } })).toBe('select `id` from `deal` where `amount` > 15');
      expect(sqlFor({ stage: { $in: ['won'] } })).toBe("select `id` from `deal` where `stage` in ('won')");
    });

    it('a plain comparison returns the rows it always did', async () => {
      expect(await ids({ stage: 'won' })).toEqual(['1']);
      // Still SQL semantics outside a negation: `<> 'won'` drops the NULL rows.
      // That divergence from the JS backends is real but out of #5146's scope —
      // it is filed separately rather than smuggled in here.
      expect(await ids({ stage: { $ne: 'won' } })).toEqual(['2']);
      expect(await ids({})).toEqual(ALL);
    });

    it('a $or / $and of plain comparisons is unchanged', () => {
      expect(sqlFor({ $or: [{ stage: 'won' }, { owner: 'u2' }] })).toBe(
        "select `id` from `deal` where ((`stage` = 'won') or (`owner` = 'u2'))",
      );
    });
  });

  // ── #5134 / #5243 boolean identities still hold ───────────────────────────

  describe('the boolean identities of #5134 are preserved', () => {
    it('$not: {} is still FALSE (zero rows), not the whole table', async () => {
      expect(await ids({ $not: {} })).toEqual([]);
      expect(sqlFor({ $not: {} })).toContain('1 = 0');
    });

    it('$not of a FALSE group is still TRUE', async () => {
      expect(await ids({ $not: { $or: [] } })).toEqual(ALL);
    });

    it('$not of a TRUE group is still FALSE', async () => {
      expect(await ids({ $not: { $and: [] } })).toEqual([]);
    });

    it('a non-node $not operand is still refused, not rewritten', async () => {
      await expect(ids({ $not: null })).rejects.toThrow(/filter\.\$not/);
      await expect(ids({ $not: 'x' })).rejects.toThrow(/filter\.\$not/);
      await expect(ids({ $not: [] })).rejects.toThrow(/filter\.\$not/);
    });

    it('a field constrained by zero operators is still not ruled on (#5240)', async () => {
      // `{ stage: {} }` compiles to no SQL; guarding it would have turned that
      // into a live `IS NULL` and decided #5240 from here.
      expect(await ids({ $not: { stage: {} } })).toEqual(ALL);
      expect(sqlFor({ $not: { stage: {} } })).toBe('select `id` from `deal`');
    });
  });
});
