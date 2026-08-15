// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5240] `{ field: {} }` — a field constrained by ZERO operators — is REFUSED,
 * in every position, with the ADR-0112 `INVALID_FILTER` envelope.
 *
 * # The three answers this replaces
 *
 * | path | before | after |
 * |---|---|---|
 * | `applyFilters` top-level plain map | refused (#5041 comparand gate) | refused (#5240 message) |
 * | `applyFilterCondition`, inside `$and`/`$or`/`$not` | zero operators → no SQL → **TRUE** | refused |
 * | `driver-memory` | FALSE (structural equality) | refused |
 * | `@objectstack/formula` | FALSE (explicit fail-closed arm) | refused |
 *
 * This driver contradicted ITSELF: the same `{ a: {} }` was a 400 at the top
 * level and a silent match-everything one combinator deep, so
 * `{ $or: [ { a: {} }, { b: 2 } ] }` compiled to `(b = 2)` while the algorithm
 * that treats a zero-constraint node as TRUE says it should match every row and
 * the two JS backends say it should match only `b = 2`. Three readings of one
 * declared shape; the maintainer ruled REFUSE (#5240) — an authoring accident
 * (a filter builder that recorded a field and never its operator) must fail at
 * the producer, not change a row count per backend.
 *
 * # Where the gate sits, and why
 *
 * On the `reduceFilterNode` / `reduceFilterKey` VALIDATION WALK (#5134), beside
 * `assertFilterNode`, not in the emitter. The walk is exhaustive and does not
 * short-circuit; the emitter returns early whenever an identity settles the
 * node. A gate in the emitter would let `{ $or: [ { a: {} }, {} ] }` through
 * untouched — the `{}` disjunct reduces the `$or` to TRUE and the emitter never
 * reaches `{ a: {} }` — making the refusal depend on the shape's SIBLINGS. The
 * verdict function is otherwise unchanged: a field key still contributes
 * `'clause'`, so every filter that compiled before compiles identically.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';
import type { FilterCondition } from '@objectstack/spec/data';

/**
 * [#8197] Every filter here is the TEST AUTHOR's own, so it is marked as one.
 *
 * This refusal names the offending field AND its path, and on a read-scope
 * predicate both are the administrator's — so the message is now redacted
 * unless the subtree is positively marked author-written. The author population
 * still gets the whole sentence, path included, and that sentence is what the
 * positions table below exists to pin.
 *
 * The withhold and its three-population discrimination live in
 * `sql-driver-target-field-provenance.test.ts`.
 */
const authored = <T>(where: T): T => markFilterSubtreeProvenance(where, 'author');

const FIXTURE = [
  { id: '1', stage: 'won', owner: 'u1', amount: 10 },
  { id: '2', stage: 'lost', owner: 'u2', amount: 20 },
  { id: '3', stage: 'open', owner: 'u1', amount: 30 },
];

const ALL = ['1', '2', '3'];

/** The shape `mapDataError` / `sendError` read off a thrown driver error. */
interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

describe('[#5240] SqlDriver refuses a field constrained by zero operators', () => {
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

  // The casts are deliberate: `{ field: {} }` is a shape `FilterConditionSchema`
  // still DECLARES as legal (its non-recursive half is `z.record(z.string(),
  // z.unknown())`), which is the whole point — the implementation is now
  // stricter than the declared contract, and narrowing the schema is the spec
  // lane's half of #5240 (#5239 / #5146 batch).
  const ids = async (where: unknown): Promise<string[]> => {
    const rows = await driver.find('deal', {
      fields: ['id'],
      where: authored(where) as FilterCondition,
    });
    return rows.map((r: any) => String(r.id)).sort();
  };

  const refusalOf = async (where: unknown): Promise<WireBearingError> => {
    try {
      await ids(where);
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error('expected the driver to refuse this filter, but it resolved');
  };

  const sqlFor = (where: unknown): string => {
    const qb = knex('deal').select('id');
    (driver as any).applyFilters(qb, authored(where));
    return qb.toString();
  };

  // ── The pinned positions ──────────────────────────────────────────────────

  const positions: Array<[string, unknown, string]> = [
    ['top level', { stage: {} }, 'filter.stage'],
    ['top level beside a real operator constraint', { stage: {}, amount: { $gt: 1 } }, 'filter.stage'],
    ['inside $or', { $or: [{ stage: {} }, { owner: 'u2' }] }, 'filter.$or[0].stage'],
    ['inside $and', { $and: [{ stage: 'won' }, { owner: {} }] }, 'filter.$and[1].owner'],
    ['inside $not', { $not: { stage: {} } }, 'filter.$not.stage'],
    ['nested two combinators deep', { $and: [{ $or: [{ stage: {} }] }] }, 'filter.$and[0].$or[0].stage'],
    ['beside a sibling that would settle the node first', { $or: [{ stage: {} }, {} ] }, 'filter.$or[0].stage'],
    ['under a $not whose operand also has a real constraint', { $not: { stage: {}, owner: 'u1' } }, 'filter.$not.stage'],
  ];

  for (const [name, where, position] of positions) {
    it(`${name} → 400 INVALID_FILTER naming ${position}`, async () => {
      const err = await refusalOf(where);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain(position);
      expect(err.message).toContain('zero operators');
      // #3867 — driver-internal wording never reaches the wire.
      expect(err.message).not.toContain('[sql-driver]');
    });
  }

  // ── The internal inconsistency this closes ────────────────────────────────

  describe('the top level and a combinator now give the SAME answer', () => {
    it('`{stage:{}}` alone and `{$or:[{stage:{}},…]}` are both refused, with the same code', async () => {
      const top = await refusalOf({ stage: {} });
      const nested = await refusalOf({ $or: [{ stage: {} }, { owner: 'u2' }] });
      expect(top.code).toBe(nested.code);
      expect(top.status).toBe(nested.status);
      expect(top.code).toBe('INVALID_FILTER');
    });

    it('wrapping the refused shape in a combinator no longer turns it into match-all', async () => {
      // The reported defect, verbatim: `{$or:[{a:{}},{b:2}]}` compiled to
      // `(b = 2)` — neither the TRUE that "zero constraints" implies nor the
      // FALSE the JS backends answered, but a DROPPED clause that coincided
      // with one of them. It is now refused instead of quietly picking a side.
      await expect(ids({ $or: [{ stage: {} }, { owner: 'u2' }] })).rejects.toThrow(/zero operators/);
    });

    it('and `$not` does not swallow it into the #5146 NULL-safe rewrite either', async () => {
      // `nullGuardForFieldSpec` used to answer `'none'` for an empty spec
      // precisely so it would not rule on #5240 from there. The refusal now
      // fires on the validation walk, which runs BEFORE that rewrite.
      await expect(ids({ $not: { stage: {} } })).rejects.toThrow(/zero operators/);
    });
  });

  // ── The guard must not touch anything else ────────────────────────────────

  describe('non-empty shapes compile byte-identically', () => {
    it('a plain equality map is unchanged', () => {
      expect(sqlFor({ stage: 'won' })).toBe("select `id` from `deal` where `stage` = 'won'");
    });

    it('an operator constraint is unchanged', () => {
      expect(sqlFor({ amount: { $gt: 15 } })).toBe('select `id` from `deal` where `amount` > 15');
    });

    it('a $or of plain comparisons is unchanged', () => {
      expect(sqlFor({ $or: [{ stage: 'won' }, { owner: 'u2' }] })).toBe(
        "select `id` from `deal` where ((`stage` = 'won') or (`owner` = 'u2'))",
      );
    });

    it('a $not of a plain comparison keeps its #5146 NULL guard', () => {
      expect(sqlFor({ $not: { stage: 'won' } })).toBe(
        "select `id` from `deal` where not (((`stage` is not null) and (`stage` = 'won')))",
      );
    });

    it('a $in list is unchanged', () => {
      expect(sqlFor({ stage: { $in: ['won', 'open'] } })).toBe(
        "select `id` from `deal` where `stage` in ('won', 'open')",
      );
    });

    it('and they still select the same rows', async () => {
      expect(await ids({ stage: 'won' })).toEqual(['1']);
      expect(await ids({ amount: { $gt: 15 } })).toEqual(['2', '3']);
      expect(await ids({ $or: [{ stage: 'won' }, { owner: 'u2' }] })).toEqual(['1', '2']);
      expect(await ids({ $not: { stage: 'won' } })).toEqual(['2', '3']);
      expect(await ids({})).toEqual(ALL);
    });
  });

  describe('the #5134 boolean identities are untouched', () => {
    it('an EMPTY NODE is still TRUE — `{}` is not `{ field: {} }`', async () => {
      expect(await ids({ $or: [{ stage: 'won' }, {}] })).toEqual(ALL);
      expect(await ids({ $and: [] })).toEqual(ALL);
    });

    it('an empty $or is still FALSE and an empty $not still zero rows', async () => {
      expect(await ids({ $or: [] })).toEqual([]);
      expect(await ids({ $not: {} })).toEqual([]);
    });
  });

  describe('shapes that merely LOOK empty are not caught by the gate', () => {
    it('a Date comparand is a comparand, not a zero-operator constraint', async () => {
      // `Object.keys(new Date())` is also `[]`; the gate requires a PLAIN object,
      // so a temporal comparand keeps whatever the compiler does with it.
      await expect(ids({ stage: new Date('2026-01-01') })).resolves.toBeDefined();
    });

    it('an empty $in list is a list operator, not an empty constraint', async () => {
      expect(await ids({ stage: { $in: [] } })).toEqual([]);
    });
  });
});
