// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13524] A field operator whose lowering reuses another operator's key —
 * enumerated over the declared vocabulary, asserted in BOTH key orders.
 *
 * ## The defect, visible in the emitted document
 *
 * `translateFieldOperators` wrote every lowered key into ONE object literal.
 * Several authorable operators do not translate to a key of their own name, so
 * two constraints landed on one key and the second assignment won. This driver
 * shows the loss a layer earlier than `driver-memory` does — no server needed:
 *
 * ```
 * translateFilter({name: {$null: false, $ne: 'b'}})  ->  {name: {$ne: 'b'}}
 * translateFilter({name: {$ne: 'b', $null: false}})  ->  {name: {$ne: null}}
 * ```
 *
 * One predicate, two documents, neither carrying both constraints — and which
 * constraint survived was decided by the author's key order.
 *
 * ## What enumerating (rather than exampling) changed
 *
 * The card named `$null`, `$between` and `$notContains`. Probing every declared
 * operator one at a time and intersecting the key sets moved that list twice:
 *
 * - **`$lte` on a bare calendar day is a fourth member** — #4042's whole-day
 *   rewrite compiles it half-open, onto `$lt`.
 * - **The whole `$regex` family is a fifth, and it is THIS DRIVER'S ALONE.**
 *   `$contains` / `$startsWith` / `$endsWith` / `$icontains` all write
 *   `$regex`; `driver-memory` has promoted its string family to `$and`
 *   branches for years (`_multiRegex`) and this face never did. Measured:
 *   `{name: {$startsWith: 'a', $endsWith: 'z'}}` emitted `{name: {$regex:
 *   'z$'}}` and its key-swapped twin `{name: {$regex: '^a'}}` — one anchor
 *   silently gone in each direction.
 * - **`$notContains` is NOT reachable.** Nothing else writes `$not`, so it is
 *   covered by construction rather than curatively.
 *
 * {@link LOWERED_KEYS} below is that enumeration, executable: it is asserted
 * against what the translator actually emits, so a new operator or a changed
 * lowering cannot join the vocabulary without this file being told.
 */

import { describe, it, expect } from 'vitest';

import { FILTER_OPERATORS } from '@objectstack/spec/data';

import { translateFilter } from './mongodb-filter.js';

const doc = (where: unknown): Record<string, unknown> =>
  translateFilter(where as never) as Record<string, unknown>;

/** Both key orders of one two-operator field constraint. */
function bothOrders(
  field: string,
  a: readonly [string, unknown],
  b: readonly [string, unknown],
): [Record<string, unknown>, Record<string, unknown>] {
  return [
    { [field]: { [a[0]]: a[1], [b[0]]: b[1] } },
    { [field]: { [b[0]]: b[1], [a[0]]: a[1] } },
  ];
}

/**
 * Every `field -> operator -> comparand` leaf an emitted document carries,
 * `$and` branches included. A constraint that was clobbered is simply absent
 * from this set — which is what makes "nothing was dropped" assertable without
 * a running server.
 */
function constraintsOf(node: unknown, into = new Set<string>()): Set<string> {
  if (!node || typeof node !== 'object') return into;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '$and' || key === '$or' || key === '$nor') {
      for (const branch of value as unknown[]) constraintsOf(branch, into);
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      for (const [op, comparand] of Object.entries(value as Record<string, unknown>)) {
        into.add(`${key}|${op}|${JSON.stringify(comparand)}`);
      }
      continue;
    }
    into.add(`${key}|$eq|${JSON.stringify(value)}`);
  }
  return into;
}

const setOf = (where: unknown): string[] => [...constraintsOf(doc(where))].sort();

describe('[#13524] the ENUMERATION — which lowered key each declared operator writes', () => {
  /**
   * Measured, one operator at a time. An operator with a comparand-dependent
   * lowering is probed with BOTH comparands, because that dependence is where
   * two of the five contested keys come from.
   */
  const LOWERED_KEYS: ReadonlyArray<readonly [string, unknown, readonly string[]]> = [
    ['$eq', 'x', ['$eq']],
    ['$ne', 'x', ['$ne']],
    ['$gt', 1, ['$gt']],
    ['$gte', 1, ['$gte']],
    ['$lt', 1, ['$lt']],
    ['$lte', 1, ['$lte']],
    ['$lte', '2026-07-28', ['$lt']],                  // BARE CALENDAR DAY (#4042)
    ['$in', ['x'], ['$in']],
    ['$nin', ['x'], ['$nin']],
    ['$between', [1, 2], ['$gte', '$lte']],
    ['$between', ['2026-01-01', '2026-07-28'], ['$gte', '$lt']],
    ['$contains', 'x', ['$regex']],
    ['$notContains', 'x', ['$not']],
    ['$startsWith', 'x', ['$regex']],
    ['$endsWith', 'x', ['$regex']],
    ['$icontains', 'x', ['$regex']],
    ['$null', true, ['$eq']],
    ['$null', false, ['$ne']],
    ['$exists', true, ['$ne']],
    ['$exists', false, ['$eq']],
  ];

  it('the probe table covers the declared vocabulary exactly', () => {
    // Only an enumeration while this holds. A seventeenth operator fails HERE
    // rather than being skipped in silence.
    expect([...new Set(LOWERED_KEYS.map(([op]) => op))].sort()).toEqual([...FILTER_OPERATORS].sort());
  });

  it.each(LOWERED_KEYS)('`%s` with %j lowers onto %j', (op, comparand, keys) => {
    const emitted = doc({ f: { [op]: comparand } });
    expect(Object.keys(emitted.f as Record<string, unknown>).sort()).toEqual([...keys].sort());
  });

  it('the contested keys are exactly these five', () => {
    const byKey = new Map<string, Set<string>>();
    for (const [op, , keys] of LOWERED_KEYS) {
      for (const key of keys) {
        const seen = byKey.get(key) ?? new Set<string>();
        seen.add(op);
        byKey.set(key, seen);
      }
    }
    const contested = Object.fromEntries(
      [...byKey.entries()]
        .filter(([, ops]) => ops.size > 1)
        .map(([key, ops]) => [key, [...ops].sort()]),
    );
    expect(contested).toEqual({
      $eq: ['$eq', '$exists', '$null'],
      $ne: ['$exists', '$ne', '$null'],
      $gte: ['$between', '$gte'],
      $lt: ['$between', '$lt', '$lte'],
      $lte: ['$between', '$lte'],
      $regex: ['$contains', '$endsWith', '$icontains', '$startsWith'],
    });
    // `$not` is written by `$notContains` and by nothing else — the card's
    // third named member, measured NOT reachable.
    expect([...(byKey.get('$not') ?? [])]).toEqual(['$notContains']);
  });

  it('`$like` / `$ilike` are declared but not translated here — the boundary, unmoved', () => {
    expect(() => doc({ f: { $like: 'x%' } })).toThrowError(/Unsupported filter operator/);
    expect(() => doc({ f: { $ilike: 'x%' } })).toThrowError(/Unsupported filter operator/);
  });
});

describe('[#13524] the emitted document carries BOTH constraints, in either key order', () => {
  it('`$null` + `$ne` — the card`s cell, one layer earlier than the row set', () => {
    const [ab, ba] = bothOrders('name', ['$null', false], ['$ne', 'b']);
    // Was {name:{$ne:'b'}} and {name:{$ne:null}} — one constraint each.
    const expected = { $and: [{ name: { $ne: 'b' } }, { name: { $ne: null } }] };
    expect(doc(ab)).toEqual(expected);
    expect(doc(ba)).toEqual(expected);
  });

  it('`$between` + `$gte` — the range`s contested lower bound', () => {
    const [ab, ba] = bothOrders('score', ['$between', [1, 5]], ['$gte', 9]);
    const expected = { $and: [{ score: { $gte: 9, $lte: 5 } }, { score: { $gte: 1 } }] };
    expect(doc(ab)).toEqual(expected);
    expect(doc(ba)).toEqual(expected);
  });

  it('THE FOURTH MEMBER — `$lte` on a bare calendar day contests `$lt`', () => {
    const [ab, ba] = bothOrders('d', ['$lte', '2026-07-28'], ['$lt', '2026-07-02']);
    // Was {d:{$lt:'2026-07-02'}} and {d:{$lt:'2026-07-29'}} — a whole-day
    // upper bound silently replacing the author's own strict bound, or the
    // reverse, depending on which was typed second.
    const expected = { $and: [{ d: { $lt: '2026-07-02' } }, { d: { $lt: '2026-07-29' } }] };
    expect(doc(ab)).toEqual(expected);
    expect(doc(ba)).toEqual(expected);
  });

  it('THE FIFTH MEMBER, THIS DRIVER`S ALONE — two string operators both write `$regex`', () => {
    const [ab, ba] = bothOrders('name', ['$startsWith', 'a'], ['$endsWith', 'z']);
    // Was {name:{$regex:'z$'}} and {name:{$regex:'^a'}} — the other anchor gone
    // with no trace. `driver-memory` answered this pair correctly throughout.
    const expected = { $and: [{ name: { $regex: '^a' } }, { name: { $regex: 'z$' } }] };
    expect(doc(ab)).toEqual(expected);
    expect(doc(ba)).toEqual(expected);
  });

  it('`$contains` + `$icontains` — the same family, the fold preserved on both', () => {
    const [ab, ba] = bothOrders('name', ['$contains', 'a'], ['$icontains', 'z']);
    const expected = { $and: [{ name: { $regex: 'a' } }, { name: { $regex: '[Zz]' } }] };
    expect(doc(ab)).toEqual(expected);
    expect(doc(ba)).toEqual(expected);
  });

  it('`$exists` + `$ne` — #13195`s cell, emitted exactly as its guard emitted it', () => {
    const [ab, ba] = bothOrders('name', ['$exists', true], ['$ne', 'b']);
    const expected = { $and: [{ name: { $ne: 'b' } }, { name: { $ne: null } }] };
    expect(doc(ab)).toEqual(expected);
    expect(doc(ba)).toEqual(expected);
  });

  it('an UNCONTESTED pair emits exactly what it emitted before — no promotion', () => {
    // The repair must not reshape documents it has no business reshaping.
    expect(doc({ name: { $ne: 'b', $notContains: 'q' } })).toEqual({
      name: { $ne: 'b', $not: { $regex: 'q' } },
    });
    expect(doc({ name: { $contains: 'a' } })).toEqual({ name: { $regex: 'a' } });
  });
});

describe('[#13524] the sweep — every declared pair, both orders, nothing dropped', () => {
  const COMPARANDS: Readonly<Record<string, unknown>> = Object.freeze({
    $eq: '2026-07-15',
    $ne: '2026-07-15',
    $gt: '2026-07-01',
    $gte: '2026-07-15',
    $lt: '2026-07-28',
    $lte: '2026-07-15',            // bare calendar day, on purpose
    $in: ['2026-07-15'],
    $nin: ['2026-07-01'],
    $between: ['2026-07-01', '2026-07-15'],
    $contains: '07-15',
    $notContains: '07-01',
    $startsWith: '2026-07',
    $endsWith: '-15',
    $icontains: '07-15',
    $null: false,
    $exists: true,
  });

  it('the comparand table covers the declared vocabulary exactly', () => {
    expect(Object.keys(COMPARANDS).sort()).toEqual([...FILTER_OPERATORS].sort());
  });

  it('every pair keeps both constraints and answers the same in either order', () => {
    const ops = [...FILTER_OPERATORS];
    const alone = new Map<string, string[]>();
    for (const op of ops) alone.set(op, setOf({ v: { [op]: COMPARANDS[op] } }));

    const failures: string[] = [];
    for (const a of ops) {
      for (const b of ops) {
        if (a === b) continue;
        const [ab, ba] = bothOrders('v', [a, COMPARANDS[a]], [b, COMPARANDS[b]]);
        const gotAb = setOf(ab);
        const gotBa = setOf(ba);
        if (JSON.stringify(gotAb) !== JSON.stringify(gotBa)) {
          failures.push(`${a}+${b}: key order changes the document — ${JSON.stringify(gotAb)} vs ${JSON.stringify(gotBa)}`);
        }
        // Nothing dropped: the pair carries every leaf either operator emits
        // alone. A superset is correct — `$between` and `$gte` legitimately
        // contribute two `$gte` leaves.
        for (const want of [...alone.get(a)!, ...alone.get(b)!]) {
          if (!gotAb.includes(want)) failures.push(`${a}+${b}: dropped ${want}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
