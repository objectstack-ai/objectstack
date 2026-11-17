// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A sandboxed data call reaches the engine with every filter key it was
 * written with, so the engine's refusal of an absent comparand applies inside
 * the sandbox too.
 *
 * The engine's door (`judgeLiteralComparand`, `@objectstack/spec/data`) refuses
 * an `undefined` comparand with `INVALID_FILTER` / 400 before any driver runs;
 * the engine-side pins live in `@objectstack/objectql`'s
 * `engine-comparand-type-door.test.ts`. This file pins the same refusal for a
 * body's `ctx.api.object(name)` call, measured in composition: a real
 * `QuickJSScriptRunner`, a real `ObjectQL`, a real SQLite driver, and a
 * system-context api (the elevation a job body runs under), so nothing behind
 * the engine narrows the rows. The refusal asserted is the ENGINE's — its
 * envelope, never a second copy of its wording.
 *
 * The controls pin what does not move: a defined value still filters, a data
 * payload crosses as it did, and every value outside a filter crosses as it
 * did.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { QuickJSScriptRunner } from './quickjs-runner.js';
import type { ScriptContext, ScriptOrigin } from './script-runner.js';
import type { EngineQueryOptions } from '@objectstack/spec/data';

const DEAL = {
  name: 'filter_key_deal',
  fields: {
    stage: { type: 'text', name: 'stage' },
    amount: { type: 'number', name: 'amount' },
    owner_id: { type: 'text', name: 'owner_id' },
  },
};

const SYSTEM = { context: { isSystem: true } } as const;
const JOB: ScriptOrigin = { kind: 'job', name: 'nightly_sweep' };
const runner = new QuickJSScriptRunner({ actionTimeoutMs: 10_000, jobTimeoutMs: 10_000 });

type Outcome = { ok: true; value: unknown } | { ok: false; error: { code?: unknown; status?: unknown; message?: string } };

describe('a sandboxed data call reaches the engine with every filter key it was written with', () => {
  let engine: ObjectQL;
  let driver: SqlDriver;
  let dir: string;
  let driverCalls: string[];

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-filter-keys-'));
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    await driver.initObjects([DEAL]);
    engine = new ObjectQL();
    engine.registerDriver(driver as any, true);
    await engine.init();
    engine.registry.registerObject(DEAL as any);
    await engine.insert('filter_key_deal', { stage: 'won', amount: 10, owner_id: 'u1' }, SYSTEM as any);
    await engine.insert('filter_key_deal', { stage: 'lost', amount: 20, owner_id: 'u2' }, SYSTEM as any);
    // Counted from here on: every driver verb a refused call could have reached.
    driverCalls = [];
    for (const verb of ['find', 'findOne', 'count', 'aggregate', 'update', 'updateMany', 'delete', 'deleteMany'] as const) {
      const original = (driver as any)[verb];
      if (typeof original !== 'function') continue;
      vi.spyOn(driver as any, verb).mockImplementation(function (this: unknown, ...a: unknown[]) {
        driverCalls.push(verb);
        return original.apply(this, a);
      });
    }
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try { await engine.destroy(); } catch { /* noop */ }
    rmSync(dir, { recursive: true, force: true });
  });

  /** Run `source` as a job body against the engine's system-context api. */
  async function run(source: string, ctx: Partial<ScriptContext> = {}): Promise<Outcome> {
    try {
      const r = await runner.run(
        { language: 'js', source, capabilities: ['api.read', 'api.write'] },
        { input: {}, api: engine.createContext({ isSystem: true } as any), ...ctx } as ScriptContext,
        { origin: JOB },
      );
      return { ok: true, value: r.value };
    } catch (e) {
      return { ok: false, error: e as { code?: unknown; status?: unknown; message?: string } };
    }
  }

  async function rows(): Promise<Array<{ owner_id: string; stage: string }>> {
    const byOwner: EngineQueryOptions = { ...SYSTEM, orderBy: [{ field: 'owner_id', order: 'asc' }] };
    const all = (await engine.find('filter_key_deal', byOwner)) as any[];
    return all.map((r) => ({ owner_id: r.owner_id, stage: r.stage }));
  }

  const ORIGINAL = [
    { owner_id: 'u1', stage: 'won' },
    { owner_id: 'u2', stage: 'lost' },
  ];

  /** The engine's envelope for a refused filter, and proof no driver verb ran. */
  function expectEngineRefusal(outcome: Outcome) {
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    expect(driverCalls).toEqual([]);
  }

  describe('a read whose comparand is undefined is refused by the engine and reads no row', () => {
    it.each([
      ['find, written undefined', `return await ctx.api.object('filter_key_deal').find({ where: { owner_id: undefined } });`, {}],
      ['find, an absent session value', `return await ctx.api.object('filter_key_deal').find({ where: { owner_id: ctx.session?.userId } });`, {}],
      ['find, an empty session', `return await ctx.api.object('filter_key_deal').find({ where: { owner_id: ctx.session.userId } });`, { session: {} }],
      ['find, a missing input key', `return await ctx.api.object('filter_key_deal').find({ where: { owner_id: ctx.input.owner_id } });`, {}],
      ['findOne', `return await ctx.api.object('filter_key_deal').findOne({ where: { owner_id: undefined } });`, {}],
      ['count', `return await ctx.api.object('filter_key_deal').count({ where: { owner_id: undefined } });`, {}],
      ['the engine-folded filter spelling', `return await ctx.api.object('filter_key_deal').find({ filter: { owner_id: undefined } });`, {}],
      ['aggregate where', `return await ctx.api.object('filter_key_deal').aggregate({ where: { owner_id: undefined }, groupBy: ['stage'], aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }] });`, {}],
      ['aggregate having', `return await ctx.api.object('filter_key_deal').aggregate({ groupBy: ['stage'], aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }], having: { total: undefined } });`, {}],
      ['an aggregation’s own filter', `return await ctx.api.object('filter_key_deal').aggregate({ groupBy: ['stage'], aggregations: [{ function: 'sum', field: 'amount', alias: 'total', filter: { owner_id: undefined } }] });`, {}],
    ])('%s', async (_label, source, ctx) => {
      expectEngineRefusal(await run(source, ctx as Partial<ScriptContext>));
    });
  });

  describe('nested filter forms keep the undefined comparand to the engine', () => {
    it.each([
      ['$and', `{ $and: [{ stage: 'won' }, { owner_id: undefined }] }`],
      ['$or', `{ $or: [{ owner_id: 'u1' }, { owner_id: undefined }] }`],
      ['$not', `{ $not: { owner_id: undefined } }`],
      ['an $in member', `{ owner_id: { $in: ['u1', undefined] } }`],
      ['$and inside $or', `{ $or: [{ $and: [{ owner_id: undefined }] }] }`],
    ])('%s', async (_label, where) => {
      expectEngineRefusal(await run(`return await ctx.api.object('filter_key_deal').find({ where: ${where} });`));
    });

    it('the operator form stays refused', async () => {
      expectEngineRefusal(await run(`return await ctx.api.object('filter_key_deal').find({ where: { owner_id: { $eq: undefined } } });`));
    });
  });

  describe('a bulk write whose comparand is undefined is refused and touches no row', () => {
    it('bulk update', async () => {
      const outcome = await run(
        `return await ctx.api.object('filter_key_deal').update({ stage: 'swept' }, { where: { owner_id: ctx.session?.userId }, multi: true });`,
      );
      expectEngineRefusal(outcome);
      expect(await rows()).toEqual(ORIGINAL);
    });

    it('bulk delete', async () => {
      const outcome = await run(
        `return await ctx.api.object('filter_key_deal').delete({ where: { owner_id: ctx.input.owner_id }, multi: true });`,
      );
      expectEngineRefusal(outcome);
      expect(await rows()).toEqual(ORIGINAL);
    });

    it('a refusal the body catches still wrote nothing', async () => {
      const outcome = await run(
        `try { await ctx.api.object('filter_key_deal').update({ stage: 'swept' }, { where: { $and: [{ owner_id: undefined }] }, multi: true }); }
         catch (e) { return { code: e.code, status: e.status }; }
         return { code: null };`,
      );
      expect(outcome).toEqual({ ok: true, value: { code: 'INVALID_FILTER', status: 400 } });
      expect(await rows()).toEqual(ORIGINAL);
    });
  });

  describe('CONTROLS — what does not move', () => {
    it('a defined value still filters, on a read and on both bulk writes', async () => {
      const read = await run(`const r = await ctx.api.object('filter_key_deal').find({ where: { owner_id: ctx.input.owner_id } }); return r.map((x) => x.owner_id);`, { input: { owner_id: 'u1' } });
      expect(read).toEqual({ ok: true, value: ['u1'] });

      const updated = await run(`return await ctx.api.object('filter_key_deal').update({ stage: 'swept' }, { where: { owner_id: 'u2' }, multi: true });`);
      expect(updated.ok).toBe(true);
      expect(await rows()).toEqual([{ owner_id: 'u1', stage: 'won' }, { owner_id: 'u2', stage: 'swept' }]);

      const deleted = await run(`return await ctx.api.object('filter_key_deal').delete({ where: { owner_id: 'u1' }, multi: true });`);
      expect(deleted.ok).toBe(true);
      expect(await rows()).toEqual([{ owner_id: 'u2', stage: 'swept' }]);
    });

    it('a data payload crosses as before: the write lands and a field it does not set keeps its value', async () => {
      const ownedByU1: EngineQueryOptions = { ...SYSTEM, where: { owner_id: 'u1' } };
      const [first] = (await engine.find('filter_key_deal', ownedByU1)) as any[];
      const outcome = await run(
        `return await ctx.api.object('filter_key_deal').update({ id: ctx.input.id, stage: ctx.input.missing, amount: 11 });`,
        { input: { id: first.id } },
      );
      expect(outcome.ok).toBe(true);
      const byId: EngineQueryOptions = { ...SYSTEM, where: { id: first.id } };
      const after = (await engine.findOne('filter_key_deal', byId)) as any;
      expect(after).toMatchObject({ stage: 'won', amount: 11 });
    });
  });
});

describe('what the host receives for a data call’s arguments', () => {
  /**
   * A `ctx.api` that records each call's arguments and answers nothing: the
   * two verbs these cases call, `update` opening with the engine's own
   * dispatch check so the double accepts no call the engine would not.
   */
  function recordingApi(seen: unknown[][]) {
    return {
      object: () => ({
        find: async (...args: unknown[]) => { seen.push(args); return []; },
        update: async (data: Record<string, unknown>, options?: Record<string, unknown>) => {
          assertEngineUpdateDispatch(data, options);
          seen.push([data, options]);
          return 0;
        },
      }),
    } as any;
  }

  async function received(source: string): Promise<unknown[][]> {
    const seen: unknown[][] = [];
    await runner.run(
      { language: 'js', source, capabilities: ['api.read', 'api.write'] },
      { input: {}, api: recordingApi(seen) } as ScriptContext,
      { origin: JOB },
    );
    return seen;
  }

  const own = (o: unknown, k: string) => Object.prototype.hasOwnProperty.call(o, k);

  it('a filter key whose value is undefined arrives as an own key holding undefined, at every depth', async () => {
    const [[query]] = await received(
      `await ctx.api.object('x').find({ where: { a: undefined, $and: [{ b: undefined }], c: { $in: [1, undefined] } }, expand: { account: { where: { d: undefined } } } });`,
    ) as any;
    expect(own(query.where, 'a') && query.where.a === undefined).toBe(true);
    expect(own(query.where.$and[0], 'b') && query.where.$and[0].b === undefined).toBe(true);
    expect(query.where.c.$in).toHaveLength(2);
    expect(query.where.c.$in[1]).toBeUndefined();
    expect(own(query.expand.account.where, 'd') && query.expand.account.where.d === undefined).toBe(true);
  });

  it('the bulk update’s options carry the filter; its data payload crosses as before', async () => {
    const [[data, options]] = await received(
      `await ctx.api.object('x').update({ stage: 'y', note: undefined }, { where: { owner_id: undefined }, multi: true });`,
    ) as any;
    expect(data).toEqual({ stage: 'y' });
    expect(own(data, 'note')).toBe(false);
    expect(own(options.where, 'owner_id') && options.where.owner_id === undefined).toBe(true);
  });

  it('every value outside a filter crosses as before', async () => {
    const [[query], [data, options]] = await received(
      `await ctx.api.object('x').find({ where: { a: 1 }, orderBy: [{ field: 'a', extra: undefined }], fields: ['a', undefined], limit: undefined });
       await ctx.api.object('x').update({ a: 1, b: undefined, list: [undefined] }, { where: { a: 1 }, multi: true, returning: undefined });`,
    ) as any;
    expect(query).toEqual({ where: { a: 1 }, orderBy: [{ field: 'a' }], fields: ['a', null] });
    expect(own(query.orderBy[0], 'extra')).toBe(false);
    expect(own(query, 'limit')).toBe(false);
    expect(data).toEqual({ a: 1, list: [null] });
    expect(own(data, 'b')).toBe(false);
    expect(options).toEqual({ where: { a: 1 }, multi: true });
    expect(own(options, 'returning')).toBe(false);
  });

  it('a query argument with no undefined value arrives exactly as written', async () => {
    const [[query]] = await received(
      `await ctx.api.object('x').find({ where: { a: 'v', n: null, $or: [{ b: 2 }] }, orderBy: [{ field: 'a', order: 'desc' }], limit: 5 });`,
    ) as any;
    expect(query).toEqual({ where: { a: 'v', n: null, $or: [{ b: 2 }] }, orderBy: [{ field: 'a', order: 'desc' }], limit: 5 });
  });
});
