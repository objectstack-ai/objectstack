// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5041] A `{ $field }` cross-field comparison is REFUSED by this driver, in
 * the ADR-0112 envelope — never as a bare `TypeError`, never as zero rows.
 *
 * `FieldReferenceSchema` (`packages/spec/src/data/filter.zod.ts`) is declared,
 * and it is genuinely PRODUCED: `compileCelToFilter` emits `{ $field: path }`
 * whenever a CEL permission/RLS rule compares one field to another. The only
 * implementation in the repo is the in-memory evaluator
 * (`packages/formula/src/matches-filter.ts` — `resolveValue`). Pushed down to
 * SQL, the reference object was handed to Knex as a BIND VALUE:
 *
 * ```
 * { amount: { $gt: { $field: 'budget' } } }
 * → select `id` from `deal` where `amount` > {"$field":"budget"}
 * → TypeError: SQLite3 can only bind numbers, strings, bigints, buffers, and null
 * ```
 *
 * That error carried no `code` and no `status`, so it landed outside the
 * envelope every sibling filter refusal in this driver already speaks (#4436 /
 * ADR-0112) and reached the client as an opaque server error. The maintainer's
 * adjudication on #5041 is the minimum path: refuse loudly here, keep the spec
 * declaration, and track column-to-column compilation as its own capability.
 *
 * These tests assert the FULL envelope — `code`, `status`, and the message
 * content a caller needs to act — not merely that something was thrown.
 *
 * **Negative control** for the other half of the contract (the memory path
 * still RESOLVES `$field` and matches correctly) lives with that implementation
 * and is unchanged by this fix: `packages/formula/src/matches-filter.test.ts`
 * ("$field reference (field-to-field)"). Nothing in this change touches the
 * evaluator or the `cel-to-filter` producer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { parseFilterAST, type FilterCondition } from '@objectstack/spec/data';

/** The shape `mapDataError` / `sendError` read off a thrown driver error. */
interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

async function refusalOf(run: () => Promise<unknown>): Promise<WireBearingError> {
  try {
    await run();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the driver to refuse this filter, but it resolved');
}

describe('[#5041] SqlDriver refuses `$field` cross-field comparison in the ADR-0112 envelope', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: 'deal',
        fields: {
          id: { type: 'text', name: 'id' },
          stage: { type: 'text', name: 'stage' },
          amount: { type: 'number', name: 'amount' },
          budget: { type: 'number', name: 'budget' },
        },
      } as any,
    ]);
    // `amount > budget` is TRUE for this row, so a driver that silently dropped
    // the predicate would return it — the failure mode is visible, not implied.
    await driver.create('deal', { id: '1', stage: 'won', amount: 10, budget: 5 });
  });

  const find = (where: unknown) =>
    driver.find('deal', { fields: ['id'], where: where as FilterCondition });

  it('the issue repro — `{ amount: { $gt: { $field: "budget" } } }` — carries the full envelope', async () => {
    const err = await refusalOf(() => find({ amount: { $gt: { $field: 'budget' } } }));

    // ADR-0112 wire identity: the catalogued code and a client-error status.
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);

    // NOT the pre-fix failure: a bare TypeError with neither.
    expect(err).not.toBeInstanceOf(TypeError);
    expect(err.message).not.toContain('can only bind');

    // #3867 — driver-internal wording never ships to a client.
    expect(err.message).not.toContain('[sql-driver]');

    // The actionable half: which field, which operator, which reference, and
    // the reason — cross-field comparison is memory-path-only today.
    expect(err.message).toContain('amount');
    expect(err.message).toContain('$gt');
    expect(err.message).toContain('budget');
    expect(err.message).toContain('$field');
    expect(err.message).toContain('in-memory');
    expect(err.message).toContain('matchesFilter');
  });

  // One condition — "this comparison references another field" — gets one
  // answer however the caller spelled it. Each of these bound the reference
  // object as a VALUE before the fix.
  const spellings: Array<[string, unknown]> = [
    ['$eq', { amount: { $eq: { $field: 'budget' } } }],
    ['$ne', { amount: { $ne: { $field: 'budget' } } }],
    ['$gte', { amount: { $gte: { $field: 'budget' } } }],
    ['$lt', { amount: { $lt: { $field: 'budget' } } }],
    ['$lte', { amount: { $lte: { $field: 'budget' } } }],
    ['nested under $and', { $and: [{ amount: { $gt: { $field: 'budget' } } }] }],
    ['nested under $or', { $or: [{ amount: { $gt: { $field: 'budget' } } }] }],
    ['nested under $not', { $not: { amount: { $gt: { $field: 'budget' } } } }],
    ['array triple, symbolic op', [['amount', '>', { $field: 'budget' }]]],
    ['array triple, word op', [['amount', 'gt', { $field: 'budget' }]]],
    ['LIKE family (would have stringified to `[object Object]`)',
      { stage: { $startsWith: { $field: 'budget' } } }],
  ];

  for (const [name, where] of spellings) {
    it(`${name} → 400 INVALID_FILTER naming the reference`, async () => {
      const err = await refusalOf(() => find(where));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err).not.toBeInstanceOf(TypeError);
      expect(err.message).toContain('$field');
      expect(err.message).toContain('budget');
    });
  }

  // A `$field` inside a LIST did not even crash before the fix: it compiled and
  // returned ZERO ROWS. A silent wrong answer on a permission-scoped read is
  // the failure #3948 / #4209 exist to prevent, so it gets the same refusal.
  const listCases: Array<[string, unknown]> = [
    ['$in', { amount: { $in: [{ $field: 'budget' }, 1] } }],
    ['$nin', { amount: { $nin: [{ $field: 'budget' }] } }],
    ['$between lower bound', { amount: { $between: [{ $field: 'budget' }, 100] } }],
    ['$between upper bound', { amount: { $between: [0, { $field: 'budget' }] } }],
  ];

  for (const [name, where] of listCases) {
    it(`${name} with a $field member → refused, not silently zero rows`, async () => {
      const err = await refusalOf(() => find(where));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('$field');
      // The member's position is named, so a long list is still actionable.
      expect(err.message).toMatch(/index \d+/);
    });
  }

  // The general arm the issue reported as missing: a KNOWN operator whose value
  // shape cannot be bound. Measured pre-fix, every one of these was the same
  // bare `TypeError` as the `$field` case.
  const uncompilable: Array<[string, unknown]> = [
    ['$gt with a plain object', { amount: { $gt: { foo: 1 } } }],
    ['$eq with a plain object', { amount: { $eq: { foo: 1 } } }],
    ['$ne with a plain object', { amount: { $ne: { foo: 1 } } }],
    ['$gt with an array', { amount: { $gt: [1, 2] } }],
    ['$eq with an array', { amount: { $eq: [1, 2] } }],
    ['implicit `=` with a plain object', { amount: { } }],
  ];

  for (const [name, where] of uncompilable) {
    it(`${name} → 400 INVALID_FILTER instead of a bare TypeError`, async () => {
      const err = await refusalOf(() => find(where));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err).not.toBeInstanceOf(TypeError);
      expect(err.message).not.toContain('can only bind');
      expect(err.message).not.toContain('[sql-driver]');
      expect(err.message).toContain('amount');
    });
  }

  // The guard must not narrow what already compiled. These are the shapes it
  // sits directly in front of.
  describe('comparands that legitimately compile are untouched', () => {
    it('a scalar equality still matches', async () => {
      const rows = await find({ stage: 'won' });
      expect(rows.map((r: any) => r.id)).toEqual(['1']);
    });

    it('$in with a real value list still matches', async () => {
      const rows = await find({ amount: { $in: [10, 20] } });
      expect(rows.map((r: any) => r.id)).toEqual(['1']);
    });

    it('$nin with a real value list still matches', async () => {
      const rows = await find({ amount: { $nin: [99] } });
      expect(rows.map((r: any) => r.id)).toEqual(['1']);
    });

    it('$between with a real range still matches', async () => {
      const rows = await find({ amount: { $between: [0, 100] } });
      expect(rows.map((r: any) => r.id)).toEqual(['1']);
    });

    it('a Date comparand still binds', async () => {
      await expect(find({ amount: { $gt: new Date(0) } })).resolves.toBeDefined();
    });

    it('a null comparand is still a null predicate, not a refusal', async () => {
      const rows = await find({ budget: { $ne: null } });
      expect(rows.map((r: any) => r.id)).toEqual(['1']);
    });

    it('an authored array triple with a scalar still matches, once lowered (#5158)', async () => {
      const rows = await find(parseFilterAST([['amount', '>', 1]]));
      expect(rows.map((r: any) => r.id)).toEqual(['1']);
    });

    it('the malformed-$between refusal keeps its own descriptive message', async () => {
      const err = await refusalOf(() => find({ amount: { $between: 5 } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('[min, max]');
    });
  });
});
