// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5134] An empty `$and` / `$or` / `$not` group compiles to its BOOLEAN
 * IDENTITY, never to "nothing".
 *
 * `applyFilterCondition` used to build every combinator as a Knex group callback
 * and let the callback add nothing when the group was empty. Knex emits no SQL
 * for a group that received no clause, so "the group is empty" and "the group is
 * satisfied" became the same query. Dropping a clause is not the same as
 * applying an identity, and the two identities point in OPPOSITE directions:
 *
 * | filter          | boolean algebra        | old compile | direction of the error |
 * |-----------------|------------------------|-------------|------------------------|
 * | `{$and: []}`    | TRUE  → every row      | every row   | accidentally right     |
 * | `{$or:  []}`    | FALSE → **zero rows**  | every row   | silently WIDENED       |
 * | `{$or:[{a},{}]}`| `{}` is a TRUE disjunct → every row | `(a = ?)` | silently narrowed |
 * | `{$not: {}}`    | NOT TRUE ≡ FALSE → zero rows | every row | silently WIDENED  |
 *
 * `$and: []` was right for the wrong reason — "drop it" happens to equal TRUE on
 * the AND side, so the same line is necessarily wrong on the OR side. The
 * widening direction is the security-relevant one: `$or: []` is what an RLS read
 * scope compiles to when the loop that should have filled its disjuncts produced
 * nothing, and answering that with the WHOLE TABLE hands a user every row the
 * scope existed to hide. `matchesFilterCondition` (formula) and `driver-memory`
 * already answer all three correctly; this driver was the outlier.
 *
 * # Why the shape rejection below is part of the same fix
 *
 * Identity reduction is only safe once "this group compiled to empty" has
 * EXACTLY ONE cause. Before it, `$or: [null]`, `$or: ['x']`, `$or: [[…]]` and
 * `$or: [new Date()]` also vanished without a trace. Applying the identity
 * without rejecting those first would have PROMOTED every one of them from
 * "silently ignored" to "matches all rows" — strictly worse than the bug. So
 * non-node elements are refused loudly (ADR-0112 `INVALID_FILTER`, the envelope
 * every sibling filter refusal in this driver speaks) BEFORE any identity is
 * applied. Same discipline as cloud#1073, which fixed the identical defect in
 * Turso's `RemoteTransport.buildWhereSQL`.
 *
 * The conformance table (`FILTER_LOGIC_CASES` in `@objectstack/spec/data`) is
 * where these cases ultimately belong so all four backends are held to them at
 * once — filed as #5239, because driver-mongodb needs its own identity reduction
 * to pass them (it passes an empty `$and`/`$or` straight to MongoDB, which
 * ERRORS) and the two must land together.
 *
 * One neighbouring shape is deliberately NOT ruled on here: `{ field: {} }`, a
 * field constrained by zero operators, which this driver compiles to no SQL
 * inside a combinator while `matchesFilter` and `driver-memory` both answer
 * FALSE and this driver's own top-level path refuses it. Three answers to one
 * filter — filed as #5240. The reduction classifies any node carrying a field
 * key as `'clause'`, so that shape compiles exactly as it did before this fix.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import type { FilterCondition } from '@objectstack/spec/data';

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

describe('[#5134] SqlDriver compiles empty $and/$or/$not to their boolean identity', () => {
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

  // The cast is deliberate: several `where`s below are shapes the schema permits
  // but no sane author writes, fed in to prove the compiler answers them the way
  // boolean algebra says rather than by accident of what Knex renders.
  const ids = async (where: unknown): Promise<string[]> => {
    const rows = await driver.find('deal', {
      fields: ['id'],
      where: where as FilterCondition,
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

  // ── The three identities, in one batch ────────────────────────────────────

  describe('the identity batch', () => {
    it('empty $and is TRUE — every row (deliberate, not an accident of dropping)', async () => {
      expect(await ids({ $and: [] })).toEqual(ALL);
    });

    it('empty $or is FALSE — ZERO rows, not the whole table', async () => {
      expect(await ids({ $or: [] })).toEqual([]);
    });

    it('empty $not is FALSE — NOT TRUE ≡ FALSE, so zero rows', async () => {
      expect(await ids({ $not: {} })).toEqual([]);
    });
  });

  // ── The regression these identities exist to prevent ──────────────────────

  it('an RLS read scope whose disjunct list came out empty hides every row', async () => {
    // The exact production shape: a scope builder looped over zero grants and
    // handed the driver `{$or: []}`. Answering it with the full table is the
    // filter bypass #5134 reports.
    expect(await ids({ $or: [] })).not.toEqual(ALL);
    expect(await ids({ $or: [] })).toHaveLength(0);
  });

  it('a scope that AND-s a real predicate with an empty $or still hides every row', async () => {
    expect(await ids({ owner: 'u1', $or: [] })).toEqual([]);
  });

  // ── `{}` is a TRUE operand wherever it appears ────────────────────────────

  it('an empty branch makes the whole $or TRUE (it is a TRUE disjunct)', async () => {
    expect(await ids({ $or: [{ stage: 'won' }, {}] })).toEqual(ALL);
  });

  it('an empty branch inside $and is the AND identity — siblings still apply', async () => {
    expect(await ids({ $and: [{ stage: 'won' }, {}] })).toEqual(['1']);
  });

  it('an empty $or branch is dropped as the OR identity, siblings survive', async () => {
    expect(await ids({ $or: [{ stage: 'won' }, { $or: [] }] })).toEqual(['1']);
  });

  // ── The identities compose through nesting ────────────────────────────────

  it('a FALSE branch makes the enclosing $and FALSE', async () => {
    expect(await ids({ $and: [{ stage: 'won' }, { $or: [] }] })).toEqual([]);
  });

  it('$not of a FALSE group is TRUE', async () => {
    expect(await ids({ $not: { $or: [] } })).toEqual(ALL);
  });

  it('$not of a TRUE group is FALSE', async () => {
    expect(await ids({ $not: { $and: [] } })).toEqual([]);
  });

  it('a nested empty $not still collapses to FALSE under $and', async () => {
    expect(await ids({ $and: [{ stage: 'won' }, { $not: {} }] })).toEqual([]);
  });

  it('an empty $not as a $or branch is dropped, not promoted', async () => {
    expect(await ids({ $or: [{ stage: 'won' }, { $not: {} }] })).toEqual(['1']);
  });

  // ── Shape rejection: an empty compile must have exactly ONE cause ─────────

  describe('non-filter-node operands are refused loudly, never reduced', () => {
    const cases: Array<[string, unknown, string]> = [
      ['null element', { $or: [null] }, 'filter.$or[0]'],
      ['string element', { $or: ['x'] }, 'filter.$or[0]'],
      ['array element', { $or: [[{ stage: 'won' }]] }, 'filter.$or[0]'],
      ['Date element', { $or: [new Date()] }, 'filter.$or[0]'],
      ['number element in $and', { $and: [42] }, 'filter.$and[0]'],
      ['non-node deeper in the list', { $or: [{ stage: 'won' }, null] }, 'filter.$or[1]'],
      ['nested under a good branch', { $and: [{ $or: [null] }] }, 'filter.$and[0].$or[0]'],
      ['$not operand is an array', { $not: [] }, 'filter.$not'],
      ['$not operand is null', { $not: null }, 'filter.$not'],
      ['$not operand is a string', { $not: 'x' }, 'filter.$not'],
      ['$or is not an array at all', { $or: 'x' }, 'filter.$or'],
      ['$and is not an array at all', { $and: { stage: 'won' } }, 'filter.$and'],
    ];

    for (const [name, where, position] of cases) {
      it(`${name} → 400 INVALID_FILTER naming ${position}`, async () => {
        const err = await refusalOf(where);
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain(position);
        // #3867 — driver-internal wording never reaches the wire.
        expect(err.message).not.toContain('[sql-driver]');
      });
    }

    it('garbage is NOT upgraded to match-all by the identity reduction', async () => {
      // The regression the rejection exists to prevent: before identity
      // reduction `{$or:[null]}` silently returned every row via the dropped
      // group; a naive identity would have made it match-all *on purpose*.
      await expect(ids({ $or: [null] })).rejects.toThrow();
      await expect(ids({ $or: [new Date()] })).rejects.toThrow();
    });

    it('a class instance is not a filter node either', async () => {
      // `Object.entries(new Foo())` can be empty, which would reduce to TRUE and
      // hand back the whole table. Prototype identity is what separates a filter
      // node from an arbitrary object.
      class NotAFilter {
        stage = 'won';
      }
      const err = await refusalOf({ $or: [new NotAFilter()] });
      expect(err.code).toBe('INVALID_FILTER');
    });
  });

  // ── Nothing that worked before changes ────────────────────────────────────

  describe('existing compilation is untouched', () => {
    it('a plain $or still ORs its branches', async () => {
      expect(await ids({ $or: [{ stage: 'won' }, { stage: 'lost' }] })).toEqual(['1', '2']);
    });

    it('a $or branch still ANDs its own keys (#3774)', async () => {
      expect(await ids({ $or: [{ stage: 'won', owner: 'u1' }, { stage: 'nope' }] })).toEqual(['1']);
    });

    it('a non-empty $not still negates', async () => {
      expect(await ids({ $not: { stage: 'won' } })).toEqual(['2', '3']);
    });

    it('$not still ANDs with its sibling keys', async () => {
      expect(await ids({ $not: { stage: 'won' }, owner: 'u1' })).toEqual(['3']);
    });

    it('a nested $and still intersects', async () => {
      expect(await ids({ $and: [{ owner: 'u1' }, { stage: 'open' }] })).toEqual(['3']);
    });

    it('an absent filter is not a failed filter', async () => {
      expect(await ids({})).toEqual(ALL);
      expect(await ids(undefined)).toEqual(ALL);
    });

    it('operators inside a branch still compile', async () => {
      expect(await ids({ $or: [{ amount: { $gte: 25 } }, { stage: 'lost' }] })).toEqual(['2', '3']);
    });
  });
});
