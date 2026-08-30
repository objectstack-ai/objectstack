// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13524] A field operator whose lowering reuses another operator's key —
 * measured over the WHOLE declared vocabulary, in BOTH key orders.
 *
 * ## The defect
 *
 * `normalizeFieldOperators` translated a field constraint by writing into ONE
 * object literal, keyed by the name mingo understands. Several authorable
 * operators do not lower to a key of their own name, so two constraints landed
 * on one key and the second assignment won: one constraint disappeared with no
 * error, no warning and no trace in the emitted document — and WHICH one
 * disappeared was decided by the author's key order, since that is the order
 * `Object.keys` walks.
 *
 * Measured on the fixture below, on `origin/main` at `50cf2940b9`, before the
 * repair:
 *
 * | filter | live path | reference matcher |
 * |---|---|---|
 * | `{name: {$null: false, $ne: 'b'}}` | `['1','3']` | `['1']` |
 * | `{name: {$ne: 'b', $null: false}}` | `['1','2']` | `['1']` |
 *
 * One predicate, written two ways that differ only in key order, returned two
 * different row sets — and neither was the answer. That is the card's own
 * table, reproduced rather than trusted.
 *
 * ## The oracle
 *
 * `memory-matcher.ts`'s `match()` loops the operators and therefore CANNOT
 * express this defect, and it is the face #5962 aligned. Every cell below is
 * scored against it.
 *
 * ⚠️ With ONE measured exception, kept deliberately and NOT repaired here:
 * `$between` ALONE already disagrees with the reference matcher on a row whose
 * value is `null` (live `['1','2']`, matcher `['1','2','4']` on the enumeration
 * fixture). That is the reference matcher's own `$between` defect — a
 * separately queued card — so the sweep below scores the live path against
 * ITSELF (the composition law) rather than against the matcher, and the
 * matcher is the oracle for the named cells, where the two agree operator by
 * operator.
 *
 * ## Why the sweep ranges over the vocabulary and not over three operators
 *
 * The card named `$null`, `$between` and `$notContains`. Enumerating instead of
 * exampling changed that list in both directions:
 *
 * - **`$lte` on a bare calendar day is a FOURTH member.** `#4042`'s whole-day
 *   rewrite compiles `$lte: '2026-07-28'` half-open, onto `$lt` — a key an
 *   author writes too.
 * - **`$notContains` is NOT reachable.** It lowers onto `$not`, and nothing
 *   else in the declared vocabulary writes `$not` (`$not` is a LOGICAL
 *   operator, absent from `SUPPORTED_FIELD_OPERATORS`, so it cannot be
 *   authored beside it on one field). It is covered by construction, not
 *   curatively — which is the point of a rule for the class.
 *
 * The sweep is written against `SUPPORTED_FIELD_OPERATORS` rather than a
 * hand-list so a nineteenth operator cannot join the vocabulary without either
 * being covered here or failing {@link comparand coverage} loudly.
 *
 * ## Both key orders, always
 *
 * Every cell is asserted in both orders. A one-direction test is exactly why
 * this survived: on the broken code it passes half the time.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { InMemoryDriver } from './memory-driver.js';
import { match } from './memory-matcher.js';
import { MemoryAnalyticsService } from './memory-analytics.js';
import { SUPPORTED_FIELD_OPERATORS } from './filter-refusal.js';

/** The card's fixture, widened with the two columns its extra cells need. */
const ROWS: Array<Record<string, unknown>> = [
  { id: '1', name: 'a', score: 1, d: '2026-07-01' },
  { id: '2', name: 'b', score: 5, d: '2026-07-28' },
  { id: '3', name: null, score: 9, d: '2026-08-15' },
];

/**
 * The sweep's fixture — one string column so every declared operator applies,
 * and both readings of "no value" (`null` and an ABSENT key), because the two
 * reach different mingo rules.
 */
const SWEEP_ROWS: Array<Record<string, unknown>> = [
  { id: '1', v: '2026-07-01' },
  { id: '2', v: '2026-07-15' },
  { id: '3', v: '2026-07-28' },
  { id: '4', v: null },
  { id: '5' },
];

const sorted = (ids: string[]): string[] => [...ids].sort();

let driver: InMemoryDriver;
let sweepDriver: InMemoryDriver;

beforeAll(async () => {
  driver = new InMemoryDriver({ persistence: false });
  await driver.connect();
  for (const row of ROWS) await driver.create('t', { ...row });

  sweepDriver = new InMemoryDriver({ persistence: false });
  await sweepDriver.connect();
  for (const row of SWEEP_ROWS) await sweepDriver.create('t', { ...row });
});

afterAll(async () => {
  await driver.disconnect();
  await sweepDriver.disconnect();
});

/** The LIVE query path: `find()` → `normalizeFilterCondition` → mingo. */
async function liveIds(where: unknown): Promise<string[]> {
  const out = await driver.find('t', { where } as never);
  return sorted((out as Array<Record<string, unknown>>).map((r) => String(r.id)));
}

async function sweepIds(where: unknown): Promise<string[]> {
  const out = await sweepDriver.find('t', { where } as never);
  return sorted((out as Array<Record<string, unknown>>).map((r) => String(r.id)));
}

/** The ORACLE: the reference matcher, which loops the operators. */
const matcherIds = (where: unknown): string[] =>
  sorted(ROWS.filter((r) => match(r, where)).map((r) => String(r.id)));

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

describe('[#13524] the card`s measured table, reproduced and repaired', () => {
  it('`$null` + `$ne` — the cell the card demonstrates', async () => {
    const [ab, ba] = bothOrders('name', ['$null', false], ['$ne', 'b']);
    // Was ['1','3'] / ['1','2'] — two row sets for one predicate, neither the
    // answer. '3' has no value (the `$null: false` it violates was dropped);
    // '2' is the row `$ne: 'b'` excludes (that constraint was dropped instead).
    expect(await liveIds(ab)).toEqual(['1']);
    expect(await liveIds(ba)).toEqual(['1']);
    expect(matcherIds(ab)).toEqual(['1']);
    expect(matcherIds(ba)).toEqual(['1']);
  });

  it('`$null` + `$eq` — the other half of the same contested key pair', async () => {
    const [ab, ba] = bothOrders('name', ['$null', true], ['$eq', 'a']);
    // Was ['1'] / ['3']. "is null AND equals 'a'" is a contradiction: no row.
    expect(await liveIds(ab)).toEqual([]);
    expect(await liveIds(ba)).toEqual([]);
    expect(matcherIds(ab)).toEqual([]);
    expect(matcherIds(ba)).toEqual([]);
  });

  it('`$between` + `$gte` — the range`s lower bound, contested', async () => {
    const [ab, ba] = bothOrders('score', ['$between', [1, 5]], ['$gte', 9]);
    // Was [] / ['1','2']: one order kept `$gte: 9` (empty, correct by
    // accident), the other dropped it and returned the whole range.
    expect(await liveIds(ab)).toEqual([]);
    expect(await liveIds(ba)).toEqual([]);
    expect(matcherIds(ab)).toEqual([]);
    expect(matcherIds(ba)).toEqual([]);
  });

  it('`$between` + `$lte` — the range`s upper bound, contested', async () => {
    const [ab, ba] = bothOrders('score', ['$between', [1, 5]], ['$lte', 9]);
    // Was ['1','2','3'] / ['1','2'] — the first WIDENED past the range.
    expect(await liveIds(ab)).toEqual(['1', '2']);
    expect(await liveIds(ba)).toEqual(['1', '2']);
    expect(matcherIds(ab)).toEqual(['1', '2']);
    expect(matcherIds(ba)).toEqual(['1', '2']);
  });

  it('THE FOURTH MEMBER — `$lte` on a bare calendar day lowers onto `$lt`', async () => {
    const [ab, ba] = bothOrders('d', ['$lte', '2026-07-28'], ['$lt', '2026-07-02']);
    // Was ['1'] / ['1','2']. #4042 compiles a bare `YYYY-MM-DD` upper bound
    // half-open — onto `$lt`, which the author is also writing here. No card
    // had named this cell; the vocabulary sweep below is what found it.
    expect(await liveIds(ab)).toEqual(['1']);
    expect(await liveIds(ba)).toEqual(['1']);
    expect(matcherIds(ab)).toEqual(['1']);
    expect(matcherIds(ba)).toEqual(['1']);
  });

  it('`$between` with a bare-day max contests `$lt` for the same reason', async () => {
    const [ab, ba] = bothOrders('d', ['$between', ['2026-07-01', '2026-07-28']], ['$lt', '2026-07-02']);
    // Was ['1'] / ['1','2'].
    expect(await liveIds(ab)).toEqual(['1']);
    expect(await liveIds(ba)).toEqual(['1']);
    expect(matcherIds(ab)).toEqual(['1']);
    expect(matcherIds(ba)).toEqual(['1']);
  });

  it('`$exists` + `$ne` — #13195`s cell, unmoved by the generalisation', async () => {
    const [ab, ba] = bothOrders('name', ['$exists', true], ['$ne', 'b']);
    expect(await liveIds(ab)).toEqual(['1']);
    expect(await liveIds(ba)).toEqual(['1']);
    expect(matcherIds(ab)).toEqual(['1']);
    expect(matcherIds(ba)).toEqual(['1']);
  });

  it('`$notContains` is covered by construction — nothing else writes `$not`', () => {
    // The enumeration's negative result, pinned so it cannot rot silently: a
    // future operator lowering onto `$not` makes this list grow, and the sweep
    // below is what would then catch the clobber.
    expect(SUPPORTED_FIELD_OPERATORS.has('$not')).toBe(false);
  });
});

/**
 * The comparand for each declared operator. Chosen so every one selects a
 * NON-TRIVIAL subset of the sweep fixture — an operator that matched all rows
 * or none would make its pairs pass without discriminating.
 *
 * `$lte`'s comparand is a bare calendar day on purpose: that is the arm whose
 * lowering moves to `$lt`.
 */
const SWEEP_COMPARANDS: Readonly<Record<string, unknown>> = Object.freeze({
  $eq: '2026-07-15',
  $ne: '2026-07-15',
  $gt: '2026-07-01',
  $gte: '2026-07-15',
  $lt: '2026-07-28',
  $lte: '2026-07-15',
  $in: ['2026-07-15', '2026-07-28'],
  $nin: ['2026-07-01'],
  $between: ['2026-07-01', '2026-07-15'],
  $contains: '07-15',
  $notContains: '07-01',
  $startsWith: '2026-07',
  $endsWith: '-15',
  $icontains: '07-15',
  $like: '%07-15',
  $ilike: '%07-15',
  $null: false,
  $exists: true,
});

describe('[#13524] the ENUMERATION — every declared operator, every pair, both orders', () => {
  it('the comparand table covers the declared vocabulary exactly', () => {
    // The sweep is only an enumeration while this holds. A nineteenth operator
    // fails HERE, loudly, instead of being skipped silently.
    expect(Object.keys(SWEEP_COMPARANDS).sort()).toEqual([...SUPPORTED_FIELD_OPERATORS].sort());
  });

  it('no pair loses a constraint, and no pair depends on key order', async () => {
    const ops = [...SUPPORTED_FIELD_OPERATORS];
    const alone = new Map<string, string[]>();
    for (const op of ops) alone.set(op, await sweepIds({ v: { [op]: SWEEP_COMPARANDS[op] } }));

    const failures: string[] = [];
    for (const a of ops) {
      for (const b of ops) {
        if (a === b) continue;
        const [ab, ba] = bothOrders('v', [a, SWEEP_COMPARANDS[a]], [b, SWEEP_COMPARANDS[b]]);
        const gotAb = await sweepIds(ab);
        const gotBa = await sweepIds(ba);
        // The COMPOSITION LAW, scored on the live path against itself: two
        // constraints on one field select exactly the rows both select alone.
        // A clobber breaks it in one direction; scoring the live path against
        // itself keeps the sweep independent of `$between`'s separate
        // reference-matcher divergence (see the file docblock).
        const expected = alone.get(a)!.filter((id) => alone.get(b)!.includes(id));
        if (JSON.stringify(gotAb) !== JSON.stringify(expected)) {
          failures.push(`${a}+${b} (a first): ${JSON.stringify(gotAb)} != ${JSON.stringify(expected)}`);
        }
        if (JSON.stringify(gotBa) !== JSON.stringify(expected)) {
          failures.push(`${b}+${a} (b first): ${JSON.stringify(gotBa)} != ${JSON.stringify(expected)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

const CUBE = {
  name: 'deals',
  title: 'Deals',
  sql: 't',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: 'id' } },
  dimensions: {
    id: { name: 'id', label: 'Id', type: 'string', sql: 'id' },
    name: { name: 'name', label: 'Name', type: 'string', sql: 'name' },
  },
  public: true,
} as never;

async function analytics(where: unknown): Promise<{ executed: string[]; sql: string }> {
  const service = new MemoryAnalyticsService({ driver, cubes: [CUBE] } as never);
  const query = { cube: 'deals', measures: ['total'], dimensions: ['id'], where } as never;
  const executed = sorted(
    ((await service.query(query)).rows as Array<Record<string, unknown>>).map((r) => String(r.id)),
  );
  const { sql } = await service.generateSql(query);
  return { executed, sql: sql.replace(/\s+/g, ' ') };
}

/**
 * The THIRD instance the card names, and the widest: `query()` keyed its
 * `$match` by FIELD PATH, so a second predicate on a member replaced the first
 * ENTIRELY — for every operator pair, not only the ones sharing a lowered key.
 */
describe('[#13524] the analytics face — a WHOLESALE clobber, one level up', () => {
  it('two operators on one member, neither sharing a lowered key', async () => {
    const [ab, ba] = bothOrders('name', ['$contains', 'a'], ['$ne', 'b']);
    // `$contains` lowers to `$regex` and `$ne` to `$ne` — no contested key at
    // all, and the translators never lost this one. The analytics face did:
    // was ['1','3'] / ['1'].
    expect((await analytics(ab)).executed).toEqual(['1']);
    expect((await analytics(ba)).executed).toEqual(['1']);
    expect(matcherIds(ab)).toEqual(['1']);
    expect(matcherIds(ba)).toEqual(['1']);
  });

  it('`$and`-folded nodes on one member clobbered too — that is the common shape', async () => {
    // `flattenFilterCondition` folds `$and` into the same flat list, so this is
    // the SAME defect written the way a dashboard actually authors it.
    const ab = { $and: [{ name: { $contains: 'a' } }, { name: { $ne: 'b' } }] };
    const ba = { $and: [{ name: { $ne: 'b' } }, { name: { $contains: 'a' } }] };
    expect((await analytics(ab)).executed).toEqual(['1']);
    expect((await analytics(ba)).executed).toEqual(['1']);
  });

  it('the echoed SQL always carried both — it was `query()` that disagreed with it', async () => {
    // `generateSql` pushes into a LIST and so never clobbered. Before the
    // repair the echo and the executed answer described different filters,
    // which is the shape that makes a widened chart unfalsifiable.
    const { sql } = await analytics({ name: { $contains: 'a', $ne: 'b' } });
    expect(sql).toContain('name');
    expect(sql.match(/AND/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});
