// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5347] `$null` takes a boolean. A non-boolean is refused on BOTH faces.
 *
 * # What was measured
 *
 * `FieldOperatorsSchema` declares `$null: z.boolean()`, and nothing between an
 * authored `where` and a driver validates against it. Given one row with
 * `stage: 'won'` (id 1) and one with `stage: null` (id 2), the filter
 * `{ stage: { $null: 'yes' } }` produced THREE answers:
 *
 * | face | compiled to | rows |
 * |---|---|---|
 * | `driver-sql` / `driver-sqlite-wasm` / Turso local | `IS NULL` (anything but `false`) | `["2"]` |
 * | this driver's live path (mingo), `driver-mongodb` | `IS NOT NULL` (anything but `true`) | `["1"]` |
 * | this driver's reference matcher | nothing at all | `["1","2"]` |
 *
 * The third row is the one #5347 could not see. It measured a fixture with no
 * null-valued row, where "matches every row" and "IS NOT NULL" are the same
 * answer; adding id 2 separates them. The matcher's arm is two conditionals —
 * `target === true && …` and `target === false && …` — and a third value
 * satisfies neither, so the constraint silently stopped constraining. That is
 * the widening direction, which on an RLS read scope is a permission bypass and
 * not a degraded filter (#3948) — and it is precisely the divergence #5324/#5328
 * built the single shape gate to make impossible.
 *
 * # Why these tests assert through BOTH faces
 *
 * The rule lives in exactly one function (`assertFilterConditionShape`) and both
 * faces call it. A regression that re-forks them fails HERE rather than being
 * discovered by a conformance table that only exercises one — the same reason
 * `memory-filter-vocabulary-refusal.test.ts` doubles every case.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';

import { InMemoryDriver } from './memory-driver.js';
import { match } from './memory-matcher.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const ROWS = [
  { id: '1', stage: 'won', score: 10 },
  // The null-valued row that separates "IS NOT NULL" from "no constraint".
  { id: '2', stage: null, score: 20 },
];

/**
 * The exact leading sentence `driver-sql` produces for this condition, copied
 * from `sql-driver.ts`. A literal rather than an import: driver-memory does not
 * depend on driver-sql (and must not), so the twin invariant #4436 established
 * is held by pinning the other side's wording here.
 */
const DRIVER_SQL_LEADING_SENTENCE = (field: string) =>
  `Operator "$null" on field "${field}" requires a boolean comparand (true or false).`;

describe('[#5347] $null requires a boolean comparand, on both filter faces', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.syncSchema('deal', {
      fields: {
        id: { type: 'text', name: 'id' },
        stage: { type: 'text', name: 'stage' },
        score: { type: 'number', name: 'score' },
      },
    } as any);
    for (const row of ROWS) await driver.create('deal', row);
  });

  const findIds = async (where: unknown): Promise<string[]> => {
    const rows = await driver.find('deal', {
      fields: ['id'],
      where: where as FilterCondition,
    });
    return (rows as any[]).map((r) => String(r.id)).sort();
  };

  const matchIds = (where: unknown): string[] =>
    ROWS.filter((row) => match(row, where as any)).map((r) => r.id).sort();

  const refusalOfFind = async (where: unknown): Promise<WireBearingError> => {
    try {
      await findIds(where);
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error('expected the live query path to refuse this filter, but it resolved');
  };

  const refusalOfMatch = (where: unknown): WireBearingError => {
    try {
      matchIds(where);
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error('expected the reference matcher to refuse this filter, but it answered');
  };

  const NON_BOOLEAN: Array<[label: string, value: unknown]> = [
    ["the string 'yes'", 'yes'],
    ['the number 1', 1],
    ['the number 0', 0],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
    // The trap: `"false"` is truthy, so it compiled to the OPPOSITE of what its
    // author meant on driver-sql — and to the opposite of THAT here.
    ["the STRING 'false'", 'false'],
  ];

  for (const [label, value] of NON_BOOLEAN) {
    it(`the live query path refuses ${label}`, async () => {
      const err = await refusalOfFind({ stage: { $null: value } });
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain(DRIVER_SQL_LEADING_SENTENCE('stage'));
      expect(err.message).toContain('filter.stage.$null');
    });

    it(`the reference matcher refuses ${label}, identically`, () => {
      const err = refusalOfMatch({ stage: { $null: value } });
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain(DRIVER_SQL_LEADING_SENTENCE('stage'));
      expect(err.message).toContain('filter.stage.$null');
    });
  }

  it('both faces refuse it inside a combinator, at the position that names it', async () => {
    for (const [where, path] of [
      [{ $and: [{ stage: { $null: 'yes' } }] }, 'filter.$and[0].stage.$null'],
      [{ $or: [{ stage: 'won' }, { stage: { $null: 1 } }] }, 'filter.$or[1].stage.$null'],
      [{ $not: { stage: { $null: 'yes' } } }, 'filter.$not.stage.$null'],
    ] as Array<[unknown, string]>) {
      const findErr = await refusalOfFind(where);
      expect(findErr.code).toBe('INVALID_FILTER');
      expect(findErr.message).toContain(path);
      const matchErr = refusalOfMatch(where);
      expect(matchErr.message).toBe(findErr.message);
    }
  });

  it('a satisfiable sibling does not let the malformed one through', async () => {
    // The gate is a walk, not an evaluation: `{ stage: 'won' }` matches, and
    // `{}` is the TRUE identity, yet neither short-circuits the refusal.
    for (const where of [
      { $or: [{ stage: 'won' }, { stage: { $null: 'x' } }] },
      { $or: [{}, { stage: { $null: 'x' } }] },
    ]) {
      expect((await refusalOfFind(where)).code).toBe('INVALID_FILTER');
      expect(refusalOfMatch(where).code).toBe('INVALID_FILTER');
    }
  });

  it('true and false are unchanged on both faces, line by line', async () => {
    expect(await findIds({ stage: { $null: true } })).toEqual(['2']);
    expect(matchIds({ stage: { $null: true } })).toEqual(['2']);
    expect(await findIds({ stage: { $null: false } })).toEqual(['1']);
    expect(matchIds({ stage: { $null: false } })).toEqual(['1']);
  });

  it('the ordinary vocabulary is untouched on both faces', async () => {
    expect(await findIds({ stage: 'won' })).toEqual(['1']);
    expect(matchIds({ stage: 'won' })).toEqual(['1']);
    expect(await findIds({ score: { $between: [5, 15] } })).toEqual(['1']);
    expect(matchIds({ score: { $between: [5, 15] } })).toEqual(['1']);
    expect(await findIds({ $or: [{ stage: 'won' }, { score: 20 }] })).toEqual(['1', '2']);
    expect(matchIds({ $or: [{ stage: 'won' }, { score: 20 }] })).toEqual(['1', '2']);
    expect(await findIds({})).toEqual(['1', '2']);
  });

  it('$exists is deliberately NOT tightened here', () => {
    // #5347 ruled on `$null` alone. `$exists` diverges on its own axis (#5299
    // holds the open question of what "exists" means for a null-valued key), so
    // it keeps today's answers rather than being settled as a rider.
    expect(matchIds({ stage: { $exists: 'yes' } })).toEqual(['1']);
  });
});
