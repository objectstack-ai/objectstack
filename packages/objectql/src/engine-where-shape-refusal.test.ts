// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20121 — a `where` that is neither absent, a filter object nor a filter array
 * is refused at the engine's one filter seam, before any driver call.
 *
 * Measured on the base, through the real engine, on `driver-memory` and
 * `SqlDriver` (better-sqlite3), four rows seeded:
 *
 *   find('order',   { where: 'amount > 100' })              -> 4 rows (all)
 *   update('order', {...}, { where: 42, multi: true })       -> 4 of 4 rows rewritten
 *   delete('order', { where: new Map(), multi: true })       -> 4 of 4 rows deleted
 *   find('order',   { where: [1, 2, 3] })                    -> refused, code/status undefined
 *
 * A string, number or `Map` has no keys for the seam's doors to walk, so every
 * door stepped around it and the driver ignored it — and on a write that is a
 * whole-table rewrite or delete. The same value also stepped past the
 * unscoped-write guard, which reads only an absent or `null` `where` as
 * unscoped.
 *
 * These cases assert what the ENGINE refuses and that the driver is never
 * asked: a refusal the driver produces after the fact would already have read,
 * and on a SQL driver the damage is done by the time anything answers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  EngineAggregateOptions,
  EngineCountOptions,
  EngineDeleteOptions,
  EngineQueryOptions,
  EngineUpdateOptions,
} from '@objectstack/spec/data';
import type { DriverQuery, IDataDriver } from '@objectstack/spec/contracts';
import { ObjectQL } from './engine.js';

const deal = {
  name: 'deal',
  label: 'Deal',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    stage: { name: 'stage', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
  },
};

/** A verb the pin does not reach, present only because `IDataDriver` requires it. */
const unexercised = (verb: string): never => {
  throw new Error(`counting driver: ${verb}() is not exercised by this pin (#20121)`);
};

/**
 * A driver double that COUNTS every call and executes only the filter-object
 * form. A `where` it cannot read throws here rather than matching everything —
 * so a refusal that is missing from the engine turns a case red here instead of
 * passing on a double that quietly agreed with the dropped filter.
 */
function makeCountingDriver() {
  const rows = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  const matches = (row: Record<string, unknown>, where: unknown): boolean => {
    if (where == null) return true;
    if (typeof where !== 'object' || Array.isArray(where)) {
      throw new Error(`counting driver: received a non-object 'where' (${String(where)})`);
    }
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const ops = v as Record<string, unknown>;
        if ('$gt' in ops && !((row[k] as number) > (ops.$gt as number))) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  };
  const run = (ast: DriverQuery | undefined) => [...rows.values()].filter((r) => matches(r, ast?.where));
  const driver: IDataDriver = {
    name: 'counting', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string, ast: DriverQuery) { calls.push('find'); return run(ast); },
    async findOne(_o: string, ast: DriverQuery) { calls.push('findOne'); return run(ast)[0] ?? null; },
    async count(_o: string, ast: DriverQuery) { calls.push('count'); return run(ast).length; },
    async aggregate(_o: string, ast: DriverQuery) { calls.push('aggregate'); return [{ n: run(ast).length }]; },
    async create(_o: string, data: Record<string, unknown>) {
      calls.push('create');
      const row = { ...data, id: data.id as string };
      rows.set(row.id, row);
      return row;
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      calls.push('update');
      const up = { ...rows.get(id), ...data, id };
      rows.set(id, up);
      return up;
    },
    async updateMany(_o: string, ast: DriverQuery, data: Record<string, unknown>) {
      calls.push('updateMany');
      const hit = run(ast);
      for (const r of hit) rows.set(r.id as string, { ...r, ...data });
      return hit.length;
    },
    async delete(_o: string, id: string) { calls.push('delete'); return rows.delete(id); },
    async deleteMany(_o: string, ast: DriverQuery) {
      calls.push('deleteMany');
      const hit = run(ast);
      for (const r of hit) rows.delete(r.id as string);
      return hit.length;
    },
    async bulkCreate() { return unexercised('bulkCreate'); },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
    async upsert() { return unexercised('upsert'); },
    async bulkUpdate() { return unexercised('bulkUpdate'); },
    async bulkDelete() { return unexercised('bulkDelete'); },
    async syncSchema() { return unexercised('syncSchema'); },
    async dropTable() { return unexercised('dropTable'); },
  };
  return { driver, rows, calls };
}

/**
 * The six verbs that cross the seam, each driven with the caller's `where`.
 * The writes carry `multi: true` — the predicate path, where a dropped `where`
 * is a whole-table write. `where` is typed `unknown` and cast at the call:
 * every bad shape here is type-illegal on purpose, and the cast names the
 * contract being bypassed.
 */
const VERBS: ReadonlyArray<readonly [string, (engine: ObjectQL, where: unknown) => Promise<unknown>]> = [
  ['find', (e, where) => e.find('deal', { where } as unknown as EngineQueryOptions)],
  ['findOne', (e, where) => e.findOne('deal', { where } as unknown as EngineQueryOptions)],
  ['count', (e, where) => e.count('deal', { where } as unknown as EngineCountOptions)],
  ['aggregate', (e, where) => e.aggregate('deal', {
    where,
    groupBy: ['stage'],
    aggregations: [{ function: 'count', field: 'id', alias: 'n' }],
  } as unknown as EngineAggregateOptions)],
  ['update', (e, where) => e.update('deal', { stage: 'archived' }, { where, multi: true } as unknown as EngineUpdateOptions)],
  ['delete', (e, where) => e.delete('deal', { where, multi: true } as unknown as EngineDeleteOptions)],
];

/** The four shapes the card names — each was dropped or refused without an envelope. */
const BAD_SHAPES: ReadonlyArray<readonly [string, () => unknown]> = [
  ['a string', () => 'amount > 100'],
  ['a number', () => 42],
  ['a Map', () => new Map([['amount', { $gt: 15 }]])],
  ['a non-filter array', () => [1, 2, 3]],
];

/** The two shapes that answer correctly — the controls. Both select d2 and d3. */
const GOOD_SHAPES: ReadonlyArray<readonly [string, () => unknown]> = [
  ['a filter object', () => ({ amount: { $gt: 15 } })],
  ['a filter array', () => [['amount', '>', 15]]],
];

interface Refusal { code?: unknown; status?: unknown; message?: unknown }

async function refusalOf(run: () => Promise<unknown>): Promise<Refusal> {
  try {
    await run();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error('expected the engine to refuse, and it answered');
}

describe('an engine `where` that is not a filter is refused at the seam, before any driver call (#20121)', () => {
  let engine: ObjectQL;
  let rows: Map<string, Record<string, unknown>>;
  let calls: string[];

  beforeEach(async () => {
    const counting = makeCountingDriver();
    rows = counting.rows;
    calls = counting.calls;
    engine = new ObjectQL();
    engine.registerDriver(counting.driver, true);
    await engine.init();
    engine.registry.registerObject(deal);
    await engine.insert('deal', { id: 'd1', stage: 'open', amount: 10 });
    await engine.insert('deal', { id: 'd2', stage: 'open', amount: 20 });
    await engine.insert('deal', { id: 'd3', stage: 'won', amount: 30 });
    calls.length = 0;
  });

  for (const [verb, run] of VERBS) {
    for (const [label, shape] of BAD_SHAPES) {
      it(`${verb}: ${label} is INVALID_FILTER / 400, and the driver is never called`, async () => {
        const err = await refusalOf(() => run(engine, shape()));

        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(String(err.message).startsWith(`${verb}('deal')`)).toBe(true);
        expect(calls).toEqual([]);
        // Nothing was written either — read past the engine, off the double.
        expect([...rows.values()].map((r) => `${r.id}:${r.stage}`).sort())
          .toEqual(['d1:open', 'd2:open', 'd3:won']);
      });
    }

    for (const [label, shape] of GOOD_SHAPES) {
      it(`${verb}: ${label} still reaches the driver and selects exactly d2 and d3 (control)`, async () => {
        const answer = await run(engine, shape());

        expect(calls.length).toBeGreaterThan(0);
        switch (verb) {
          case 'find':
            expect((answer as Array<{ id: string }>).map((r) => r.id).sort()).toEqual(['d2', 'd3']);
            break;
          case 'findOne':
            expect(['d2', 'd3']).toContain((answer as { id: string }).id);
            break;
          case 'count':
            expect(answer).toBe(2);
            break;
          case 'aggregate':
            expect(answer).toEqual([{ n: 2 }]);
            break;
          case 'update':
            expect([...rows.values()].filter((r) => r.stage === 'archived').map((r) => r.id).sort())
              .toEqual(['d2', 'd3']);
            break;
          case 'delete':
            expect([...rows.keys()]).toEqual(['d1']);
            break;
        }
      });
    }
  }

  // ── a door that forwards to the seam: the scoped repository ───────────────

  it('createContext().object(): find and delete(multi) forward to the seam and are refused the same way', async () => {
    const repo = engine.createContext({ isSystem: true }).object('deal');

    const read = await refusalOf(() => repo.find({ where: 'amount > 15' }));
    const write = await refusalOf(() => repo.delete({ where: 42, multi: true }));

    expect([read.code, read.status, write.code, write.status]).toEqual(['INVALID_FILTER', 400, 'INVALID_FILTER', 400]);
    expect(calls).toEqual([]);
    expect(rows.size).toBe(3);
  });

  // ── the accept set's edges: nothing that answered correctly is refused ────

  it.each<[string, () => unknown, number]>([
    ['null (no filter)', () => null, 3],
    ['{} (match-all)', () => ({}), 3],
    ['[] (no filter)', () => [], 3],
    ['Object.create(null) carrying the filter', () => Object.assign(Object.create(null), { amount: { $gt: 15 } }), 2],
    ['a class instance carrying the filter on its own keys', () => new (class Criteria { amount = { $gt: 15 }; })(), 2],
  ])('find: %s is accepted and answers %i rows', async (_label, shape, expected) => {
    const answer = await engine.find('deal', { where: shape() } as unknown as EngineQueryOptions);
    expect(answer).toHaveLength(expected);
  });

  it.each<[string, () => unknown]>([
    ['a Date', () => new Date(0)],
    ['a Set', () => new Set(['open'])],
    ['a boolean', () => true],
    ['an empty string', () => ''],
    ['an un-awaited Promise', () => Promise.resolve({ stage: 'open' })],
  ])('delete(multi): %s is refused the same way — it too was a whole-table delete', async (_label, shape) => {
    const err = await refusalOf(() =>
      engine.delete('deal', { where: shape(), multi: true } as unknown as EngineDeleteOptions));

    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(calls).toEqual([]);
    expect(rows.size).toBe(3);
  });
});
