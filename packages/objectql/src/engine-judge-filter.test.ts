// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20157] `ObjectQL.judgeFilter`, the engine's judge-only filter admission
 * (`IObjectQLEngine.judgeFilter`, #19995 ruling C).
 *
 * What each block pins:
 *
 * - **Per class.** For each class #19995 lists (a text operator over a
 *   non-text field, an uninterpretable temporal comparand, an unknown filter
 *   placeholder, a filter on a virtual field, a dotted path through a lookup),
 *   the judge returns the door's diagnostic, AND execution raises the same one.
 *   Same `code`, `status` and `message`, on every verb that takes a `where`,
 *   with `operation` naming the verb.
 * - **Ok.** A runnable filter returns `{ ok: true }`.
 * - **Nothing executes.** A driver spy sees no call, no driver is resolved,
 *   and no hook or middleware runs. Each has a positive control: execution
 *   drives the same spy.
 * - **Order.** A filter with two defects gets the diagnostic execution gives.
 *   The door stage runs before the placeholder stage, and the doors inside it
 *   keep their order.
 * - **Placeholders.** They resolve against the supplied context. One the
 *   context cannot answer is refused, never resolved to `null`.
 *
 * Every refusal assertion reads `code` and `status` (the ADR-0112 envelope),
 * never a bare `toThrow()`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { EngineFilterJudgement, EngineFilterJudgementOptions } from '@objectstack/spec/contracts';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { ObjectQL } from './engine.js';

/** The `where` type every verb (and the judge) accepts. */
type Where = EngineQueryOptions['where'];

const DEAL = 'judge_deal';
const ACCOUNT = 'judge_account';

const ACCOUNT_SCHEMA = {
  name: ACCOUNT,
  label: 'Judge account',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
  },
};

const DEAL_SCHEMA = {
  name: DEAL,
  label: 'Judge deal',
  fields: {
    id: { name: 'id', type: 'text' },
    title: { name: 'title', type: 'text' },
    owner_id: { name: 'owner_id', type: 'text' },
    amount: { name: 'amount', type: 'number' },
    closes_on: { name: 'closes_on', type: 'date' },
    // A virtual field: no driver materialises a column for it.
    is_open: { name: 'is_open', type: 'formula', expression: '1', returnType: 'boolean' },
    account: { name: 'account', type: 'lookup', reference: ACCOUNT },
  },
};

type Verb = NonNullable<EngineFilterJudgementOptions['operation']>;
const VERBS: readonly Verb[] = ['find', 'findOne', 'count', 'aggregate', 'update', 'delete'];

/** Run `where` through one verb's EXECUTION on `object`. */
function execute(engine: ObjectQL, verb: Verb, object: string, where: Where, context?: ExecutionContext) {
  switch (verb) {
    case 'find': return engine.find(object, { where }, { context });
    case 'findOne': return engine.findOne(object, { where }, { context });
    case 'count': return engine.count(object, { where }, { context });
    case 'aggregate':
      return engine.aggregate(object, { where, aggregations: [{ function: 'count', alias: 'n' }] }, { context });
    case 'update': return engine.update(object, { title: 'x' }, { where, multi: true, context });
    case 'delete': return engine.delete(object, { where, multi: true, context });
  }
}

type Thrown = Error & { code?: string; status?: number };

async function refusalOf(p: Promise<unknown>): Promise<Thrown | null> {
  return p.then(() => null, (e: unknown) => e as Thrown);
}

/** A recording driver: every method call lands in `calls`, by method name. */
function makeRecordingDriver() {
  const calls: string[] = [];
  const reads: Array<{ method: string; ast: any }> = [];
  const record = <A extends unknown[], R>(method: string, impl: (...args: A) => R) =>
    (...args: A): R => { calls.push(method); return impl(...args); };
  const driver: any = {
    name: 'judge-recording', version: '0.0.0', supports: {},
    connect: record('connect', async () => {}),
    disconnect: record('disconnect', async () => {}),
    checkHealth: record('checkHealth', async () => true),
    execute: record('execute', async () => null),
    find: record('find', async (_o: string, ast: any) => { reads.push({ method: 'find', ast }); return []; }),
    findOne: record('findOne', async (_o: string, ast: any) => { reads.push({ method: 'findOne', ast }); return null; }),
    count: record('count', async (_o: string, ast: any) => { reads.push({ method: 'count', ast }); return 0; }),
    aggregate: record('aggregate', async (_o: string, ast: any) => { reads.push({ method: 'aggregate', ast }); return []; }),
    create: record('create', async (_o: string, d: any) => d),
    update: record('update', async (_o: string, id: any, d: any) => ({ id, ...d })),
    updateMany: record('updateMany', async () => 0),
    delete: record('delete', async () => true),
    deleteMany: record('deleteMany', async () => 0),
    bulkCreate: record('bulkCreate', async (_o: string, rows: any[]) => rows),
    beginTransaction: record('beginTransaction', async () => ({})),
    commit: record('commit', async () => {}),
    rollback: record('rollback', async () => {}),
  };
  return { driver, calls, reads };
}

/**
 * The five classes the ruling names, each with the envelope its door raises.
 * `where` is a factory so no case can edit a filter another case judges.
 */
const CLASSES: ReadonlyArray<{ name: string; where: () => Where; code: string; status: number; mentions: string }> = [
  {
    name: 'a text operator over a non-text field',
    where: () => ({ amount: { $contains: '5' } }),
    code: 'INVALID_FILTER', status: 400, mentions: "'amount'",
  },
  {
    name: 'an uninterpretable temporal comparand',
    where: () => ({ closes_on: { $gt: 'not-a-date' } }),
    code: 'INVALID_FILTER', status: 400, mentions: "'closes_on'",
  },
  {
    name: 'an unknown filter placeholder',
    where: () => ({ owner_id: '{bogus_token}' }),
    code: 'FILTER_TOKEN_UNKNOWN', status: 400, mentions: '{bogus_token}',
  },
  {
    name: 'a filter on a virtual field',
    where: () => ({ is_open: true }),
    code: 'INVALID_FIELD', status: 400, mentions: "'is_open'",
  },
  {
    name: 'a dotted path through a lookup',
    where: () => ({ 'account.name': 'Acme' }),
    code: 'INVALID_FIELD', status: 400, mentions: "'account.name'",
  },
];

function refused(verdict: EngineFilterJudgement): Extract<EngineFilterJudgement, { ok: false }> {
  if (verdict.ok) throw new Error(`expected a refusal, the judge answered ok`);
  return verdict;
}

describe('[#20157] ObjectQL.judgeFilter: judge a where without executing it', () => {
  let engine: ObjectQL;
  let calls: string[];
  let reads: Array<{ method: string; ast: any }>;

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    calls = rec.calls;
    reads = rec.reads;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(ACCOUNT_SCHEMA as any, 'test');
    engine.registry.registerObject(DEAL_SCHEMA as any, 'test');
    // Boot traffic (connect, schema sync) is not the judge's; start clean.
    calls.length = 0;
    reads.length = 0;
  });

  describe('per class: the judge returns the diagnostic execution raises', () => {
    for (const c of CLASSES) {
      for (const verb of VERBS) {
        it(`${c.name}, on ${verb}`, async () => {
          const verdict = refused(engine.judgeFilter(DEAL, c.where(), { operation: verb }));
          expect(calls).toEqual([]);

          const thrown = await refusalOf(execute(engine, verb, DEAL, c.where()));
          expect(thrown).not.toBeNull();
          // The envelope, on both sides.
          expect({ code: thrown!.code, status: thrown!.status }).toEqual({ code: c.code, status: c.status });
          expect({ code: verdict.code, status: verdict.status }).toEqual({ code: c.code, status: c.status });
          // The same diagnostic, byte for byte, including the verb prefix.
          expect(verdict.message).toBe(thrown!.message);
          expect(verdict.message).toContain(c.mentions);
        });
      }
    }

    it('the default operation is find', () => {
      const bare = refused(engine.judgeFilter(DEAL, { amount: { $contains: '5' } }));
      const asFind = refused(engine.judgeFilter(DEAL, { amount: { $contains: '5' } }, { operation: 'find' }));
      expect(bare).toEqual(asFind);
      expect(bare.message.startsWith(`find('${DEAL}')`)).toBe(true);
    });

    it('the filter-array sugar is judged through the same lowering execution runs', async () => {
      // Input-only sugar: off the `where` type on purpose, as a caller holding
      // a `FilterArray` passes it.
      const where = [['amount', 'contains', '5']] as unknown as Where;
      const verdict = refused(engine.judgeFilter(DEAL, where));
      const thrown = await refusalOf(engine.find(DEAL, { where }));
      expect({ code: verdict.code, status: verdict.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect({ code: thrown!.code, status: thrown!.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(verdict.message).toBe(thrown!.message);
    });

    it('a where that is not a filter object gets the shape gate\'s diagnostic', async () => {
      // Off-contract on purpose: the shape gate is what refuses it.
      const where = 'status = open' as unknown as Where;
      const verdict = refused(engine.judgeFilter(DEAL, where));
      const thrown = await refusalOf(engine.find(DEAL, { where }));
      expect({ code: verdict.code, status: verdict.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(verdict.message).toBe(thrown!.message);
    });
  });

  describe('a runnable filter', () => {
    it('returns ok, and execution admits it and reaches the driver', async () => {
      const where = { title: 'Acme', amount: { $gt: 5 }, closes_on: { $gte: '{30_days_ago}' } };
      expect(engine.judgeFilter(DEAL, where)).toEqual({ ok: true });
      expect(calls).toEqual([]);

      // Positive control: the same filter executes, so the spy is live.
      await engine.find(DEAL, { where });
      expect(calls).toContain('find');
    });

    it('an absent, null or empty where is ok', () => {
      expect(engine.judgeFilter(DEAL, undefined)).toEqual({ ok: true });
      expect(engine.judgeFilter(DEAL, null as unknown as Where)).toEqual({ ok: true });
      expect(engine.judgeFilter(DEAL, {})).toEqual({ ok: true });
      expect(engine.judgeFilter(DEAL, [] as unknown as Where)).toEqual({ ok: true });
    });

    it('leaves the caller\'s filter untouched', () => {
      const where = { owner_id: '{current_user_id}', closes_on: { $gte: '{30_days_ago}' } };
      const before = JSON.stringify(where);
      expect(engine.judgeFilter(DEAL, where, { context: { userId: 'u_1' } })).toEqual({ ok: true });
      expect(JSON.stringify(where)).toBe(before);
    });
  });

  describe('nothing executes', () => {
    it('no driver method is called and no driver is resolved, for a refusal or an ok', async () => {
      const getDriver = vi.spyOn(engine as any, 'getDriver');
      for (const c of CLASSES) engine.judgeFilter(DEAL, c.where());
      engine.judgeFilter(DEAL, { title: 'Acme' });
      expect(calls).toEqual([]);
      expect(getDriver).not.toHaveBeenCalled();

      // Positive control: execution resolves the driver through the same spy.
      await engine.find(DEAL, { where: { title: 'Acme' } });
      expect(getDriver).toHaveBeenCalled();
    });

    it('no hook and no middleware runs', async () => {
      const hook = vi.fn();
      const middleware = vi.fn(async (_opCtx: unknown, next: () => Promise<void>) => { await next(); });
      engine.registerHook('beforeFind', hook, { object: DEAL });
      engine.registerMiddleware(middleware);

      engine.judgeFilter(DEAL, { title: 'Acme' });
      engine.judgeFilter(DEAL, { is_open: true });
      expect(hook).not.toHaveBeenCalled();
      expect(middleware).not.toHaveBeenCalled();

      // Positive control: execution runs both.
      await engine.find(DEAL, { where: { title: 'Acme' } });
      expect(hook).toHaveBeenCalled();
      expect(middleware).toHaveBeenCalled();
    });
  });

  describe('order: the diagnostic execution gives when a filter has two defects', () => {
    it('the door stage runs before the placeholder stage', async () => {
      const where = (): Where => ({ owner_id: '{bogus_token}', amount: { $contains: '5' } });
      const verdict = refused(engine.judgeFilter(DEAL, where()));
      const thrown = await refusalOf(engine.find(DEAL, { where: where() }));
      expect(verdict.code).toBe('INVALID_FILTER');
      expect({ code: thrown!.code, status: thrown!.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(verdict.message).toBe(thrown!.message);
    });

    it('inside the door stage, the materializable door answers before the text-operator door', async () => {
      const where = (): Where => ({ amount: { $contains: '5' }, is_open: true });
      const verdict = refused(engine.judgeFilter(DEAL, where()));
      const thrown = await refusalOf(engine.find(DEAL, { where: where() }));
      expect(verdict.code).toBe('INVALID_FIELD');
      expect({ code: thrown!.code, status: thrown!.status }).toEqual({ code: 'INVALID_FIELD', status: 400 });
      expect(verdict.message).toBe(thrown!.message);
    });
  });

  describe('placeholders resolve against the supplied context, never to null', () => {
    it('a context placeholder with no context is refused, as execution refuses it', async () => {
      const where = { owner_id: '{current_user_id}' };
      const verdict = refused(engine.judgeFilter(DEAL, where));
      const thrown = await refusalOf(engine.find(DEAL, { where }));
      expect({ code: verdict.code, status: verdict.status }).toEqual({ code: 'FILTER_TOKEN_UNRESOLVED', status: 400 });
      expect({ code: thrown!.code, status: thrown!.status }).toEqual({ code: 'FILTER_TOKEN_UNRESOLVED', status: 400 });
      expect(verdict.message).toBe(thrown!.message);
    });

    it('the same placeholder with the context execution would get is ok, and execution sends the resolved value', async () => {
      const where = { owner_id: '{current_user_id}' };
      expect(engine.judgeFilter(DEAL, where, { context: { userId: 'u_1' } })).toEqual({ ok: true });
      await engine.find(DEAL, { where }, { context: { userId: 'u_1' } });
      expect(reads.at(-1)?.ast.where).toEqual({ owner_id: 'u_1' });
    });
  });

  describe('an object the registry does not know', () => {
    it('the field-map doors answer nothing and the schema-free doors still judge the filter', () => {
      // A virtual-field verdict needs the field map; with none, it is ok.
      expect(engine.judgeFilter('judge_unregistered', { is_open: true })).toEqual({ ok: true });
      // The list-comparand shape gate needs no field map.
      const verdict = refused(engine.judgeFilter('judge_unregistered', { status: { $in: 'open' } }));
      expect({ code: verdict.code, status: verdict.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
    });

    it('[#21516] execution refuses the OBJECT before admission — an answer about the object, not the filter', async () => {
      // The contract: execution refuses an object the registry does not know
      // (`OBJECT_NOT_FOUND`, 404) before any `where` door runs, and that
      // refusal is not the judge's verdict. So the same filter the judge
      // refuses as INVALID_FILTER is answered OBJECT_NOT_FOUND at execution.
      const thrown = await refusalOf(engine.find('judge_unregistered', { where: { status: { $in: 'open' } } }));
      expect({ code: thrown!.code, status: thrown!.status }).toEqual({ code: 'OBJECT_NOT_FOUND', status: 404 });
    });
  });
});
