// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5659] The shared identity reduction, proven against the same table its
 * consumers are proven against.
 *
 * The first suite is the load-bearing one: {@link FILTER_LOGIC_CASES} is the
 * standard every filter backend answers, and a verdict is a CLAIM about that
 * answer — `'true'` claims the filter matches every fixture row, `'false'`
 * claims it matches none. Checking the claim against the table's own `expected`
 * is what makes this function provable rather than merely tested, and it is why
 * the module lives beside the table: a case added to the table judges the
 * reduction on the same commit.
 *
 * The implication is asserted one way only. `'true'` ⇒ every row and `'false'`
 * ⇒ no row are facts about what the verdict MEANS; the converse ("a case that
 * matches every row must reduce to TRUE") is not — `{ c: 'z' }` matches all
 * four rows and is a real predicate. Asserting the converse would forbid a
 * future case for being data-dependent, so the four identity cases are pinned
 * by NAME instead, which catches an identity that regresses to `'clause'`
 * without constraining anything else the table may grow.
 */

import { describe, expect, it } from 'vitest';

import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS } from './filter-logic-conformance';
import {
  reduceFilterKeyVerdict,
  reduceFilterVerdict,
  type FilterVerdict,
  type FilterVerdictHooks,
} from './filter-verdict';

const ALL_ROW_IDS = FILTER_LOGIC_ROWS.map((row) => row.id);

/** The four identity cases of the shared table, by the names it gives them. */
const IDENTITY_CASE_VERDICTS: Record<string, FilterVerdict> = {
  'empty $and is TRUE — the AND identity': 'true',
  'empty $or is FALSE — the OR identity': 'false',
  'a {} branch is a TRUE disjunct and absorbs its $or': 'true',
  '$not of {} is FALSE — NOT TRUE': 'false',
};

describe('reduceFilterVerdict against FILTER_LOGIC_CASES', () => {
  for (const c of FILTER_LOGIC_CASES) {
    it(`agrees with the table on: ${c.name}`, () => {
      const verdict = reduceFilterVerdict(c.filter as Record<string, unknown>);
      if (verdict === 'true') {
        expect(c.expected, `${c.name} reduced to TRUE, so it must match every row`).toEqual(
          ALL_ROW_IDS,
        );
      } else if (verdict === 'false') {
        expect(c.expected, `${c.name} reduced to FALSE, so it must match no row`).toEqual([]);
      }
    });
  }

  it('pins the four identity cases by name', () => {
    const pinned = FILTER_LOGIC_CASES.filter((c) => c.name in IDENTITY_CASE_VERDICTS);
    // Guards against the pin silently emptying if a case is renamed.
    expect(pinned).toHaveLength(Object.keys(IDENTITY_CASE_VERDICTS).length);
    for (const c of pinned) {
      expect(reduceFilterVerdict(c.filter as Record<string, unknown>), c.name).toBe(
        IDENTITY_CASE_VERDICTS[c.name],
      );
    }
  });

  it('answers clause for every case that carries a real predicate', () => {
    const identityNames = new Set(Object.keys(IDENTITY_CASE_VERDICTS));
    for (const c of FILTER_LOGIC_CASES) {
      if (identityNames.has(c.name)) continue;
      expect(reduceFilterVerdict(c.filter as Record<string, unknown>), c.name).toBe('clause');
    }
  });
});

describe('reduceFilterVerdict — the boolean algebra', () => {
  it('reads an empty node as the empty conjunction', () => {
    expect(reduceFilterVerdict({})).toBe('true');
  });

  it('lets FALSE dominate the AND of a node', () => {
    expect(reduceFilterVerdict({ a: 'x', $or: [] })).toBe('false');
  });

  it('lets a clause survive a TRUE sibling', () => {
    expect(reduceFilterVerdict({ a: 'x', $and: [] })).toBe('clause');
  });

  it('absorbs a $or whose disjunct is TRUE, at depth', () => {
    expect(reduceFilterVerdict({ $or: [{ a: 'x' }, { $and: [] }] })).toBe('true');
  });

  it('reduces $and of a FALSE member to FALSE', () => {
    expect(reduceFilterVerdict({ $and: [{ a: 'x' }, { $or: [] }] })).toBe('false');
  });

  it('negates a resolved inner node and passes a clause through', () => {
    expect(reduceFilterVerdict({ $not: { $or: [] } })).toBe('true');
    expect(reduceFilterVerdict({ $not: { a: 'x' } })).toBe('clause');
  });

  it('is insensitive to key order', () => {
    expect(reduceFilterVerdict({ $and: [], $or: [] })).toBe('false');
    expect(reduceFilterVerdict({ $or: [], $and: [] })).toBe('false');
  });
});

describe('reduceFilterVerdict — hookless defaults are conservative', () => {
  // Every shape here is refused by the drivers' hooks. With no hooks the answer
  // must be `'clause'` — "carries a predicate", i.e. the caller learns nothing
  // — and never `'true'`, which would promote an unreducible shape to match-all.
  it.each([
    ['a non-array $and', { $and: 'x' }],
    ['a non-array $or', { $or: { a: 'x' } }],
    ['a non-node $and element', { $and: [new Date()] }],
    ['a non-node $or element', { $or: [42] }],
    ['a null $not operand', { $not: null }],
    ['a Date $not operand', { $not: new Date() }],
    ['a class-instance element that enumerates to nothing', { $or: [new Map()] }],
  ])('answers clause for %s', (_label, filter) => {
    expect(reduceFilterVerdict(filter as Record<string, unknown>)).toBe('clause');
  });

  it('reads a field key as a predicate', () => {
    expect(reduceFilterVerdict({ status: 'active' })).toBe('clause');
    // Including one the schema would reject: the linter runs on metadata that
    // has not been accepted yet, and "unreducible" is not "matches nothing".
    expect(reduceFilterVerdict({ status: {} })).toBe('clause');
  });
});

describe('reduceFilterVerdict — hooks', () => {
  const calls: string[] = [];
  const recording: FilterVerdictHooks = {
    assertNodeList: (_value, key, path) => void calls.push(`list:${key}@${path}`),
    assertNode: (_value, path) => void calls.push(`node:@${path}`),
    classifyKey: (key, _value, path) => {
      calls.push(`key:${key}@${path}`);
      return 'clause';
    },
  };

  it('reports the path of every position it walks', () => {
    calls.length = 0;
    reduceFilterVerdict({ $or: [{ a: 'x' }, { $not: { b: 'y' } }] }, { ...recording, path: 'filter' });
    expect(calls).toEqual([
      'list:$or@filter.$or',
      'node:@filter.$or[0]',
      'key:a@filter.$or[0].a',
      'node:@filter.$or[1]',
      'node:@filter.$or[1].$not',
      'key:b@filter.$or[1].$not.b',
    ]);
  });

  it('does not short-circuit — a resolved sibling still reaches later nodes', () => {
    // The reason the drivers' refusals live on this walk: `$or: []` resolves the
    // whole key, and an emitter-side gate would then judge the malformed node
    // after it depending on ITS SIBLINGS.
    const seen: string[] = [];
    reduceFilterVerdict(
      { $or: [], $and: [{ a: 'x' }, { b: 'y' }] },
      { classifyKey: (key) => (seen.push(key), 'clause') },
    );
    expect(seen).toEqual(['a', 'b']);
  });

  it('propagates a hook refusal instead of answering', () => {
    const refusing: FilterVerdictHooks = {
      assertNode: (value, path) => {
        if (value instanceof Date) throw new Error(`refused at ${path}`);
      },
    };
    expect(() => reduceFilterVerdict({ $or: [{ a: 'x' }, new Date()] }, refusing)).toThrow(
      'refused at $or[1]',
    );
  });

  it('lets classifyKey resolve a key that carries no predicate', () => {
    // `driver-mongodb`'s query-level keys: the emitter skips them, so the
    // verdict must too or the two disagree about what the node is worth.
    const hooks: FilterVerdictHooks = {
      classifyKey: (key) => (key === 'limit' ? 'true' : 'clause'),
    };
    expect(reduceFilterVerdict({ limit: 10 }, hooks)).toBe('true');
    expect(reduceFilterVerdict({ limit: 10, a: 'x' }, hooks)).toBe('clause');
  });
});

describe('reduceFilterKeyVerdict', () => {
  it('answers for one key without rebuilding a node', () => {
    expect(reduceFilterKeyVerdict('$and', [])).toBe('true');
    expect(reduceFilterKeyVerdict('$or', [])).toBe('false');
    expect(reduceFilterKeyVerdict('$not', {})).toBe('false');
    expect(reduceFilterKeyVerdict('a', 'x')).toBe('clause');
  });

  it('agrees with the node reduction on a single-key node', () => {
    for (const [key, value] of [
      ['$and', [{ a: 'x' }]],
      ['$or', [{}, { a: 'x' }]],
      ['$not', { $or: [] }],
      ['status', 'active'],
    ] as const) {
      expect(reduceFilterKeyVerdict(key, value)).toBe(reduceFilterVerdict({ [key]: value }));
    }
  });
});
