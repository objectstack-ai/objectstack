// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0053 D-D1, amended 2026-09-30 — #5930] The engine's placement of the
 * shared `FilterCondition → FilterCondition` lowering (`lowerFilterCondition`,
 * `@objectstack/spec/data`): once per filter position, AFTER the comparand doors
 * and AFTER filter-token resolution (the amendment's item 3), on every verb that
 * takes a filter — `find`, `findOne`, `count`, `update`, `delete`, and
 * `aggregate`'s three positions (`where`, `aggregations[i].filter`, `having`).
 *
 * The witness is what leaves the engine: the recording driver's `where` for the
 * verbs a driver compiles, and the operation context a middleware reads for the
 * two positions the engine evaluates itself. Row answers are the faces' suites'
 * business; these pins say WHERE the rule runs, so reverting any one seam call
 * turns its pin red.
 *
 * Fixture: `closed_at` is the declared `datetime` the whole-day rule is for,
 * `due_on` a `date` the typed seam must leave byte-identical (item 7).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineAggregateOptions, EngineQueryOptions, FilterCondition } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

const OBJECT = 'lowering_probe';

const SCHEMA = {
  name: OBJECT,
  label: 'Lowering probe',
  fields: {
    id: { name: 'id', type: 'text' },
    stage: { name: 'stage', type: 'text' },
    amount: { name: 'amount', type: 'number' },
    closed_at: { name: 'closed_at', type: 'datetime' },
    due_on: { name: 'due_on', type: 'date' },
  },
};

interface Seen { verb: string; ast: any }

function makeRecordingDriver() {
  const seen: Seen[] = [];
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string, ast: any) { seen.push({ verb: 'find', ast }); return []; },
    async findOne(_o: string, ast: any) { seen.push({ verb: 'findOne', ast }); return null; },
    async count(_o: string, ast: any) { seen.push({ verb: 'count', ast }); return 0; },
    async create(_o: string, data: Record<string, unknown>) { return { ...data, id: 'r1' }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { return { ...data, id }; },
    async updateMany(_o: string, ast: any) { seen.push({ verb: 'updateMany', ast }); return 0; },
    async delete() { return true; },
    async deleteMany(_o: string, ast: any) { seen.push({ verb: 'deleteMany', ast }); return 0; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, seen };
}

/** A bare-day upper bound on the datetime column, and what the lowering makes of it. */
const WHOLE_DAY_IN = { closed_at: { $lte: '2026-07-28' } };
const WHOLE_DAY_OUT = { closed_at: { $lt: '2026-07-29' } };
/** A negative-polarity leaf, and its NULL escape. */
const NEGATIVE_IN = { stage: { $ne: 'won' } };
const NEGATIVE_OUT = { $and: [{ $or: [{ stage: { $null: true } }, { stage: { $ne: 'won' } }] }] };

describe('[ADR-0053 D-D1 amended — #5930] the engine runs the shared lowering once per filter position', () => {
  let engine: ObjectQL;
  let seen: Seen[];

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    seen = rec.seen;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(SCHEMA as any, 'test');
    seen.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const lastWhere = (verb: string) => [...seen].reverse().find((s) => s.verb === verb)?.ast?.where;

  it('find: the driver receives the lowered where — whole-day bound and NULL escape', async () => {
    await engine.find(OBJECT, { where: WHOLE_DAY_IN });
    expect(lastWhere('find')).toEqual(WHOLE_DAY_OUT);
    await engine.find(OBJECT, { where: NEGATIVE_IN });
    expect(lastWhere('find')).toEqual(NEGATIVE_OUT);
  });

  it('findOne: the driver receives the lowered where', async () => {
    await engine.findOne(OBJECT, { where: WHOLE_DAY_IN });
    expect(lastWhere('findOne') ?? lastWhere('find')).toEqual(WHOLE_DAY_OUT);
  });

  it('count: the driver receives the lowered where', async () => {
    await engine.count(OBJECT, { where: NEGATIVE_IN });
    expect(lastWhere('count')).toEqual(NEGATIVE_OUT);
  });

  it('update (multi): the driver receives the lowered where', async () => {
    await engine.update(OBJECT, { stage: 'x' }, { where: WHOLE_DAY_IN, multi: true } as any);
    expect(lastWhere('updateMany')).toEqual(WHOLE_DAY_OUT);
  });

  it('delete (multi): the driver receives the lowered where', async () => {
    await engine.delete(OBJECT, { where: NEGATIVE_IN, multi: true } as any);
    expect(lastWhere('deleteMany')).toEqual(NEGATIVE_OUT);
  });

  it('aggregate: `where`, `aggregations[i].filter` and `having` are each lowered, before the middleware chain', async () => {
    let atMiddleware: any;
    engine.registerMiddleware(async (opCtx: any, next: any) => {
      if (opCtx.operation === 'aggregate') atMiddleware = structuredClone(opCtx.ast);
      return next();
    });
    await engine.aggregate(OBJECT, {
      where: WHOLE_DAY_IN,
      groupBy: ['stage'],
      aggregations: [
        { function: 'count', alias: 'n' },
        { function: 'count', alias: 'open_n', filter: NEGATIVE_IN },
        { function: 'max', field: 'closed_at', alias: 'last_closed' },
      ],
      having: { last_closed: { $between: ['2026-07-01', '2026-07-28'] } },
    } as EngineAggregateOptions);
    expect(atMiddleware.where).toEqual(WHOLE_DAY_OUT);
    expect(atMiddleware.aggregations[0].filter).toBeUndefined();
    expect(atMiddleware.aggregations[1].filter).toEqual(NEGATIVE_OUT);
    // `max(closed_at)` is a `datetime` column of the aggregated row, so the
    // whole-day rule reaches it; the aggregated row's type is what `having` reads.
    expect(atMiddleware.having).toEqual({ last_closed: { $gte: '2026-07-01', $lt: '2026-07-29' } });
    // The rows path asks the driver for rows with the lowered `where` too.
    expect(lastWhere('find')).toEqual(WHOLE_DAY_OUT);
  });

  it('item 3: the lowering runs AFTER token resolution — `{today}` resolves to the day, then widens', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-10T12:00:00.000Z'));
    await engine.find(OBJECT, { where: { closed_at: { $lte: '{today}' } } } as EngineQueryOptions);
    expect(lastWhere('find')).toEqual({ closed_at: { $lt: '2026-03-11' } });
    await engine.update(OBJECT, { stage: 'x' }, { where: { closed_at: { $lte: '{today}' } }, multi: true } as any);
    expect(lastWhere('updateMany')).toEqual({ closed_at: { $lt: '2026-03-11' } });
  });

  it('item 7: a typed seam leaves a `date` column, and a `$between` on a number, byte-identical', async () => {
    const where = { due_on: { $lte: '2026-07-28' }, amount: { $between: [5, 25] } };
    await engine.find(OBJECT, { where });
    expect(lastWhere('find')).toBe(where);
  });

  it('the last supported day: `$lte` keeps only { $null: false }', async () => {
    await engine.find(OBJECT, { where: { closed_at: { $lte: '9999-12-31' } } });
    expect(lastWhere('find')).toEqual({ closed_at: { $null: false } });
  });

  it('copy-on-write: the caller\'s filter object is never edited', async () => {
    const where: FilterCondition = { closed_at: { $lte: '2026-07-28' }, stage: { $ne: 'won' } };
    const asWritten = JSON.stringify(where);
    await engine.find(OBJECT, { where });
    await engine.update(OBJECT, { stage: 'x' }, { where, multi: true } as any);
    expect(JSON.stringify(where)).toBe(asWritten);
  });

  it('the judge runs the same stage and gains no verdict from it', () => {
    expect(engine.judgeFilter(OBJECT, { closed_at: { $between: ['2026-07-01', '2026-07-28'] } })).toEqual({ ok: true });
    expect(engine.judgeFilter(OBJECT, { $not: { stage: { $ne: 'won' } } })).toEqual({ ok: true });
  });
});
