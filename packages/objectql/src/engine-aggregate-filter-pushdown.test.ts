// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33698] `engine.aggregate` sends an aggregate whose measures carry a
 * `filter` to `driver.aggregate` only when the driver declares
 * `supports.aggregationFilter: true` AND has the method. Every other driver
 * keeps the path it had: `find()` for the rows, then `applyInMemoryAggregation`.
 *
 * The bit is read strictly (`=== true`): a driver that inherits `aggregate()`
 * without compiling the key (its face refuses it 501), or whose transport
 * cannot run the compile (TursoDriver's remote mode), sends nothing down.
 * The other forks that force the rows path — a non-UTC reference timezone
 * with date bucketing, a granularity the driver does not advertise — still
 * win over the bit.
 *
 * Stand-in drivers, for the reason `engine-aggregate-rows-ast.test.ts` gives;
 * the real compile and its answers are pinned in driver-sql
 * (`sql-driver-aggregation-filter.test.ts`) and end to end, with the security
 * layer, in rest (`aggregate-measure-filter-pushdown.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import type { EngineAggregateOptions } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

type Row = Record<string, unknown>;

const ROWS: Row[] = [
  { id: 'r1', stage: 'won', amount: 10, owner: 'u1', created_at: '2026-01-01T03:00:00.000Z' },
  { id: 'r2', stage: 'won', amount: 20, owner: 'u2', created_at: '2026-01-02T03:00:00.000Z' },
  { id: 'r3', stage: 'open', amount: 40, owner: 'u1', created_at: '2026-01-02T03:00:00.000Z' },
];

interface Seen { findAsts: any[]; aggregateAsts: any[] }

function standIn(seen: Seen, supports: Record<string, unknown>, opts: { withAggregate?: boolean } = {}) {
  const driver: Record<string, unknown> = {
    name: 'stand-in',
    version: '0.0.0',
    supports,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(_object: string, query: any) {
      seen.findAsts.push(structuredClone(query));
      return ROWS.map((r) => ({ ...r }));
    },
    async findOne() { return ROWS[0]; },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async count() { return ROWS.length; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
  };
  if (opts.withAggregate !== false) {
    driver.aggregate = async (_object: string, ast: any) => {
      seen.aggregateAsts.push(structuredClone(ast));
      return [{ pushed_down: true }];
    };
  }
  return driver;
}

async function engineOver(driver: any) {
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  (engine.registry as any).registerObject({
    name: 'deal',
    fields: {
      stage: { type: 'text' }, amount: { type: 'number' }, owner: { type: 'text' }, created_at: { type: 'datetime' },
    },
  });
  return engine;
}

const FILTERED: EngineAggregateOptions = {
  aggregations: [
    { function: 'sum', field: 'amount', alias: 'won', filter: { stage: 'won' } },
    { function: 'count', alias: 'n' },
  ],
};

describe('[#33698] engine.aggregate pushes a filtered measure down only on the aggregationFilter bit', () => {
  it('bit true + aggregate(): the driver gets the call, the filter on the measure, and find() is not asked', async () => {
    const seen: Seen = { findAsts: [], aggregateAsts: [] };
    const engine = await engineOver(standIn(seen, { aggregationFilter: true }));
    const rows = await engine.aggregate('deal', FILTERED);
    expect(rows).toEqual([{ pushed_down: true }]);
    expect(seen.findAsts).toHaveLength(0);
    expect(seen.aggregateAsts).toHaveLength(1);
    expect(seen.aggregateAsts[0].aggregations).toEqual([
      { function: 'sum', field: 'amount', alias: 'won', filter: { stage: 'won' } },
      { function: 'count', alias: 'n' },
    ]);
  });

  it('the filter the driver gets is the RESOLVED one: a {current_user_id} token is the caller\'s id, not its own text', async () => {
    const seen: Seen = { findAsts: [], aggregateAsts: [] };
    const engine = await engineOver(standIn(seen, { aggregationFilter: true }));
    await engine.aggregate('deal', {
      aggregations: [{ function: 'count', alias: 'mine', filter: { owner: '{current_user_id}' } }],
      context: { userId: 'u1', isSystem: true },
    } as EngineAggregateOptions);
    expect(seen.aggregateAsts).toHaveLength(1);
    expect(seen.aggregateAsts[0].aggregations[0].filter).toEqual({ owner: 'u1' });
  });

  for (const [label, supports] of [
    ['no bit (a driver that declares nothing)', {}],
    ['bit false (TursoDriver remote mode)', { aggregationFilter: false }],
    ['a truthy non-boolean is not the bit', { aggregationFilter: 'yes' }],
  ] as const) {
    it(`${label}: find() + in-memory, the filtered number, aggregate() never called`, async () => {
      const seen: Seen = { findAsts: [], aggregateAsts: [] };
      const engine = await engineOver(standIn(seen, supports as Record<string, unknown>));
      const rows = await engine.aggregate('deal', FILTERED);
      expect(rows).toEqual([{ won: 30, n: 3 }]);
      expect(seen.aggregateAsts).toHaveLength(0);
      expect(seen.findAsts).toHaveLength(1);
      expect(seen.findAsts[0]).not.toHaveProperty('aggregations');
    });
  }

  it('bit true but no aggregate() method: find() + in-memory (the bit is ANDed with presence)', async () => {
    const seen: Seen = { findAsts: [], aggregateAsts: [] };
    const engine = await engineOver(standIn(seen, { aggregationFilter: true }, { withAggregate: false }));
    expect(await engine.aggregate('deal', FILTERED)).toEqual([{ won: 30, n: 3 }]);
    expect(seen.findAsts).toHaveLength(1);
  });

  it('the other forks still win: a non-UTC timezone with a date bucket keeps the rows path', async () => {
    const seen: Seen = { findAsts: [], aggregateAsts: [] };
    const engine = await engineOver(standIn(seen, { aggregationFilter: true, queryDateGranularity: { day: true } }));
    await engine.aggregate('deal', {
      groupBy: [{ field: 'created_at', dateGranularity: 'day' }],
      aggregations: [{ function: 'count', alias: 'won', filter: { stage: 'won' } }],
      timezone: 'Asia/Shanghai',
    } as EngineAggregateOptions);
    expect(seen.aggregateAsts).toHaveLength(0);
    expect(seen.findAsts).toHaveLength(1);
  });

  it('control: with no filtered measure, the bit changes nothing — pushdown as before', async () => {
    for (const supports of [{}, { aggregationFilter: true }]) {
      const seen: Seen = { findAsts: [], aggregateAsts: [] };
      const engine = await engineOver(standIn(seen, supports));
      await engine.aggregate('deal', { aggregations: [{ function: 'count', alias: 'n', filter: {} }] });
      expect(seen.aggregateAsts).toHaveLength(1);
      expect(seen.findAsts).toHaveLength(0);
    }
  });
});
