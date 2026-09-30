// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5345] The analytics (cube) face refuses the filters it cannot compile.
 *
 * `memory-analytics.ts` lowers `AnalyticsQuery.where` into a flat cube-style
 * `{member, operator, values}` list. Two `continue`s in that lowering used to
 * discard whatever did not fit:
 *
 * 1. `if (key === '$or' || key === '$not') continue;` — a whole branch of the
 *    filter, gone;
 * 2. `if (!cubeOp) continue;` — the five declared operators with no row in the
 *    mongo→cube table (`$between`, `$startsWith`, `$endsWith`, `$null`,
 *    `$regex`), gone one predicate at a time.
 *
 * The direction is what makes it a defect and not a limitation: a dropped
 * predicate is FEWER constraints, therefore MORE rows. A widget filtered to two
 * stages aggregated the whole table and rendered as a working widget — the
 * amplifying failure #3948 outlawed, and the same call ADR-0078 / #4286 made for
 * `objectql`'s `having`. `$not` is worse still: `cel-to-filter.ts` compiles a CEL
 * `!expr` RLS read scope into `{$not: {...}}`, so dropping it is an
 * over-permissive read, not a wrong number.
 *
 * Both public entry points are covered here — `query()` and `generateSql()` —
 * because both call `normalizeFilters` and a refusal on one only would leave the
 * other silently answering the old way.
 *
 * [ADR-0053 D-D1, amended 2026-09-30 — #5930 step 3] Three of those shapes are
 * no longer refusals: the face now COMPILES `$or` and `$null` (the shared
 * lowering emits both), and a `$between` reaches its vocabulary gate as the two
 * bounds the lowering splits it into. Each is pinned below as answered with the
 * rows the live query path gives it — the invariant this file has always held,
 * refuse-or-agree, never a different row set. `$not`, `$startsWith` and
 * `$endsWith` stay refused.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';
import { AnalyticsQuerySchema } from '@objectstack/spec/data';
import type { AnalyticsQuery, Cube, FilterCondition } from '@objectstack/spec/data';

const asQuery = (input: AnalyticsQuery): AnalyticsQuery => AnalyticsQuerySchema.parse(input);

/** Five rows over two stages, so a dropped predicate shows up as a bigger count. */
const DEALS = [
  { id: 1, stage: 'won', amount: 100, owner: 'u1', name: 'alpha', closed_at: null },
  { id: 2, stage: 'won', amount: 200, owner: 'u1', name: 'beta', closed_at: '2026-01-02' },
  { id: 3, stage: 'lost', amount: 300, owner: 'u2', name: 'gamma', closed_at: '2026-02-03' },
  { id: 4, stage: 'open', amount: 400, owner: 'u2', name: 'delta', closed_at: null },
  { id: 5, stage: 'open', amount: 500, owner: 'u3', name: 'epsilon', closed_at: '2026-03-04' },
];

const CUBE: Cube = {
  name: 'deals',
  title: 'Deals',
  sql: 'deals',
  measures: {
    count: { label: 'Deal Count', type: 'count', sql: 'id' },
    totalAmount: { label: 'Total', type: 'sum', sql: 'amount' },
  },
  dimensions: {
    stage: { label: 'Stage', type: 'string', sql: 'stage' },
    owner: { label: 'Owner', type: 'string', sql: 'owner' },
    name: { label: 'Name', type: 'string', sql: 'name' },
    amount: { label: 'Amount', type: 'number', sql: 'amount' },
    closedAt: { label: 'Closed At', type: 'time', sql: 'closed_at' },
  },
  public: true,
};

/**
 * The refusal envelope, asserted as a whole. ADR-0112: `INVALID_FILTER` / 400,
 * the same envelope every sibling refusal in this package speaks — a coded
 * refusal on one face and a bare `{error}` on another is exactly the divergence
 * #5240 closed.
 */
const expectRefusal = async (run: () => Promise<unknown>, ...mustMention: string[]): Promise<Error> => {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'the filter was accepted instead of refused').toBeInstanceOf(Error);
  const err = caught as Error & { code?: string; status?: number };
  expect(err.code).toBe('INVALID_FILTER');
  expect(err.status).toBe(400);
  // A dashboard author has to be able to tell WHICH predicate was rejected.
  for (const needle of mustMention) expect(err.message).toContain(needle);
  return err;
};

describe('[#5345] MemoryAnalyticsService — filters it cannot compile are refused, not dropped', () => {
  let driver: InMemoryDriver;
  let service: MemoryAnalyticsService;

  beforeEach(async () => {
    driver = new InMemoryDriver({ initialData: { deals: [...DEALS] } });
    await driver.connect();
    service = new MemoryAnalyticsService({ driver, cubes: [CUBE] });
  });

  const count = async (where?: FilterCondition): Promise<number> => {
    const result = await service.query(asQuery({ cube: 'deals', measures: ['deals.count'], where }));
    return Number((result.rows[0] as Record<string, unknown> | undefined)?.['deals.count'] ?? 0);
  };

  it('the fixture is five rows, so an inflated aggregate is visible', async () => {
    expect(await count()).toBe(5);
  });

  // ── The combinators (`continue` #1) ────────────────────────────────────────

  // [#5930 step 3] `$or` is compiled now, so the regression this section was
  // written against — three rows asked for, five returned — is pinned as its
  // answer: the rows the live query path returns, never the whole table.
  const findCount = async (where: FilterCondition): Promise<number> => (await driver.find('deals', { where })).length;

  it('compiles $or instead of aggregating the whole table', async () => {
    const where: FilterCondition = { $or: [{ stage: 'won' }, { stage: 'lost' }] };
    expect(await count(where)).toBe(3);
    expect(await count(where)).toBe(await findCount(where));
  });

  it('compiles a $or nested inside a $and', async () => {
    const where: FilterCondition = { $and: [{ owner: 'u1' }, { $or: [{ stage: 'won' }, { stage: 'open' }] }] };
    expect(await count(where)).toBe(2);
    expect(await count(where)).toBe(await findCount(where));
  });

  it('compiles a $or that sits beside a sibling key, ANDed with it', async () => {
    // The sharpest shape when `$or` was dropped: the sibling `owner` lowered
    // fine, so the query ran and returned a plausible-looking number computed
    // without the $or at all. Compiled, it narrows.
    const where: FilterCondition = { owner: 'u1', $or: [{ stage: 'won' }, { stage: 'lost' }] };
    expect(await count(where)).toBe(2);
    expect(await count(where)).toBe(await findCount(where));
  });

  it('refuses $not — the shape an RLS read scope compiles to', async () => {
    const where: FilterCondition = { $not: { stage: 'lost' } };
    const err = await expectRefusal(() => count(where), '$not', 'where.$not');
    expect(err.message).toContain('over-permissive read');
  });

  it('names the combinators it CAN compile, so the refusal is actionable', async () => {
    const err = await expectRefusal(() => count({ $not: { stage: 'won' } }));
    expect(err.message).toContain('Supported combinators on this surface: $and, $or');
  });

  // ── The unmapped operators (`continue` #2) ─────────────────────────────────

  const UNCOMPILABLE: Array<{ op: string; where: FilterCondition }> = [
    { op: '$startsWith', where: { name: { $startsWith: 'al' } } },
    { op: '$endsWith', where: { name: { $endsWith: 'ta' } } },
  ];

  // [#5930 step 3] Answered, not refused: `$null` joined this face's table, and
  // a `$between` reaches it as its two bounds. Each agrees with the live path.
  const NOW_COMPILED: Array<{ op: string; where: FilterCondition; rows: number }> = [
    { op: '$between', where: { amount: { $between: [100, 200] } }, rows: 2 },
    { op: '$null', where: { closed_at: { $null: true } }, rows: 2 },
  ];

  for (const { op, where, rows } of NOW_COMPILED) {
    it(`compiles ${op}, with the rows the live query path returns`, async () => {
      expect(await count(where)).toBe(rows);
      expect(await findCount(where)).toBe(rows);
    });
  }

  for (const { op, where } of UNCOMPILABLE) {
    it(`refuses ${op} — declared by the Filter Protocol, not compilable by this face`, async () => {
      const err = await expectRefusal(() => count(where), op);
      // Not "you made a typo": the operator is real, this surface cannot run it.
      expect(err.message).toContain('declared by the Filter Protocol');
      expect(err.message).toContain('Supported operators on this surface');
    });
  }

  /**
   * [#5702] `$regex` was the sixth row of the table above until this change, and
   * it was in the WRONG table: its assertion read "declared by the Filter
   * Protocol, not compilable by this face", and `$regex` was never declared by
   * the Filter Protocol at all — it was an undeclared spelling this package
   * evaluated. #4706 retired it outright, so it is no longer a
   * declared-but-uncompilable operator on this face; it is a refused one on
   * every face, with a prescription attached.
   *
   * Kept as its own case rather than deleted, because the analytics face is a
   * SECOND door into the same walk and "the query path refuses it" is not
   * evidence that this one does — the two faces answering one filter differently
   * is the divergence class this whole file exists over (#5345).
   */
  for (const op of ['$regex', '$options'] as const) {
    it(`refuses the retired ${op} on the analytics face too, naming $icontains`, async () => {
      const err = await expectRefusal(() => count({ name: { [op]: '^al' } } as FilterCondition), op);
      expect(err.message).toContain('RETIRED');
      expect(err.message).toContain('$icontains');
      // NOT the uncompilable-on-this-face sentence. Asserted against that
      // message's own distinctive phrase rather than against "declared by the
      // Filter Protocol", which the spec's prescription also contains — in the
      // NEGATED form ("was never declared by the Filter Protocol"), so a
      // substring test on it passes for both messages and pins nothing.
      expect(err.message).not.toContain('Supported operators on this surface');
    });
  }

  it('refuses an unmapped operator reached through the nested-relation branch', async () => {
    // `{profile: {verified: …}}` is re-entered as a synthesised `{'profile.verified': …}`
    // node the up-front gate never walked — the one path where the lowering's own
    // refusal is load-bearing rather than defence in depth.
    await expectRefusal(() => count({ profile: { verified: { $between: [1, 2] } } } as FilterCondition), '$between');
  });

  it('still refuses an operator the protocol does not declare at all, with the OTHER message', async () => {
    const err = await expectRefusal(
      () => count({ name: { $sounds_like: 'alpha' } } as unknown as FilterCondition),
      '$sounds_like',
    );
    expect(err.message).toContain('Unsupported filter operator');
    expect(err.message).not.toContain('declared by the Filter Protocol');
  });

  // ── What must NOT have changed ─────────────────────────────────────────────

  it('every compilable operator still aggregates exactly as before', async () => {
    expect(await count({ stage: 'won' })).toBe(2);
    expect(await count({ stage: { $eq: 'won' } })).toBe(2);
    expect(await count({ stage: { $ne: 'won' } })).toBe(3);
    expect(await count({ stage: { $in: ['won', 'lost'] } })).toBe(3);
    expect(await count({ stage: { $nin: ['won'] } })).toBe(3);
    expect(await count({ amount: { $gt: 200 } })).toBe(3);
    expect(await count({ amount: { $gte: 200 } })).toBe(4);
    expect(await count({ amount: { $lt: 300 } })).toBe(2);
    expect(await count({ name: { $contains: 'et' } })).toBe(1);
    expect(await count({ name: { $contains: 'a' } })).toBe(4);
    expect(await count({ stage: 'won', owner: 'u1' })).toBe(2);
    expect(await count({ $and: [{ stage: 'open' }, { owner: 'u2' }] })).toBe(1);
    expect(await count({})).toBe(5);
  });

  // ── The second public entry point ──────────────────────────────────────────

  it('generateSql() refuses the same filters — a WHERE that lost a branch is the same bug', async () => {
    await expectRefusal(
      () => service.generateSql(asQuery({
        cube: 'deals',
        measures: ['deals.count'],
        where: { $not: { stage: 'lost' } },
      })),
      '$not',
    );
    await expectRefusal(
      () => service.generateSql(asQuery({
        cube: 'deals',
        measures: ['deals.count'],
        where: { name: { $startsWith: 'al' } },
      })),
      '$startsWith',
    );
    const ok = await service.generateSql(asQuery({
      cube: 'deals',
      measures: ['deals.count'],
      where: { stage: 'won' },
    }));
    expect(ok.sql).toContain("stage = 'won'");
  });
});
