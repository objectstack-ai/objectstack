// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The engine-internal relation group request (`relation-group-join.ts`): an
 * aggregate grouped by a related record's attribute is handed to a SQL driver
 * as ONE statement whose related half is the related object's own aggregate,
 * PLANNED as the caller — never an id list — and declined, with nothing read,
 * wherever the engine cannot prove that.
 *
 * A recording driver stands in for the SQL family: it answers to a driver
 * name the engine names (or not), records every call, and answers
 * `aggregate` with the rows a test sets. What `driver-sql` compiles the joins
 * to is pinned in that package and end to end in `service-analytics`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { isComposedReadableIds, RLS_DENY_FILTER } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import {
  RELATION_GROUP_BY,
  RELATION_GROUP_JOINS,
  type DriverRelationGroupJoin,
  type RelationGroupByRequest,
} from './relation-group-join.js';

const LINE = 'rgj_line';
const OPP = 'rgj_opp';

const OPP_OBJECT = {
  name: OPP,
  label: 'Opportunity',
  fields: {
    stage: { name: 'stage', type: 'text' },
    owner: { name: 'owner', type: 'text' },
    score: { name: 'score', type: 'formula', expression: '1', returnType: 'number' },
  },
};
const LINE_OBJECT = {
  name: LINE,
  label: 'Line',
  fields: {
    amount: { name: 'amount', type: 'number' },
    region: { name: 'region', type: 'text' },
    opportunity: { name: 'opportunity', type: 'lookup', reference: OPP },
    opportunities: { name: 'opportunities', type: 'lookup', reference: OPP, multiple: true },
  },
};

interface SeenCall { verb: string; object: string; ast: any }

/**
 * `supports` defaults to the `DriverCapabilities.readableIdsLeaf` bit every
 * SQL face and `driver-memory` declare ([#33876]); MongoDB and OData declare
 * nothing.
 */
function makeRecordingDriver(name: string, supports: Record<string, unknown> = { readableIdsLeaf: true }) {
  const calls: SeenCall[] = [];
  let answer: Array<Record<string, unknown>> = [];
  const driver: any = {
    name, version: '0.0.0', supports,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(o: string, ast: any) { calls.push({ verb: 'find', object: o, ast }); return []; },
    async findOne(o: string, ast: any) { calls.push({ verb: 'findOne', object: o, ast }); return null; },
    async count(o: string, ast: any) { calls.push({ verb: 'count', object: o, ast }); return 0; },
    async aggregate(o: string, ast: any) { calls.push({ verb: 'aggregate', object: o, ast }); return answer; },
    async create(_o: string, data: Record<string, unknown>) { return { ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { return { ...data, id }; },
    async delete() { return true; },
    async beginTransaction() { return {}; },
    async commit() {}, async rollback() {},
  };
  return { driver, calls, answer: (rows: Array<Record<string, unknown>>) => { answer = rows; } };
}

type Thrown = (Error & { code?: string; status?: number }) | null;
const refusalOf = async (p: Promise<unknown>): Promise<Thrown> => p.then(() => null, (e: any) => e);

const request = (over: Partial<RelationGroupByRequest['relations'][number]> = {}): RelationGroupByRequest => ({
  relations: [{
    field: 'opportunity',
    object: OPP,
    attrs: [{ attr: 'stage', alias: '__rg0_a0' }],
    resolvedAlias: '__rg0_resolved',
    ...over,
  }],
});

const BASE_QUERY = { groupBy: ['region'], aggregations: [{ function: 'sum' as const, field: 'amount', alias: 'total' }] };

async function makeEngine(driverName: string, supports?: Record<string, unknown>) {
  const rec = makeRecordingDriver(driverName, supports);
  const engine = new ObjectQL();
  engine.registerDriver(rec.driver, true);
  await engine.init();
  engine.registry.registerObject(OPP_OBJECT as any, 'test');
  engine.registry.registerObject(LINE_OBJECT as any, 'test');
  return { engine, rec };
}

describe('relation group join — served as one driver statement whose related half is the planned related read', () => {
  let engine: ObjectQL;
  let rec: ReturnType<typeof makeRecordingDriver>;

  beforeEach(async () => {
    ({ engine, rec } = await makeEngine('com.objectstack.driver.sql'));
  });

  it('one driver call: the base aggregate carries the join, its parent the related read\'s planned where — the request\'s condition AND what the related read\'s middleware injected', async () => {
    // A read middleware on the related object's read, as row-level security
    // injects one: it runs on the PLANNED read, so its condition is in the
    // join's scope.
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (op.object === OPP) op.ast.where = op.ast.where ? { $and: [op.ast.where, { owner: 'u_me' }] } : { owner: 'u_me' };
      await next();
    });
    rec.answer([{ region: 'emea', __rg0_a0: 'won', __rg0_resolved: 1, total: 10 }]);
    const req = request({ where: { stage: { $ne: 'lost' } } });
    const rows = await engine.aggregate(LINE, BASE_QUERY, { [RELATION_GROUP_BY]: req } as never);

    expect(req.outcome).toEqual({ kind: 'joined' });
    expect(rows).toEqual([{ region: 'emea', __rg0_a0: 'won', __rg0_resolved: 1, total: 10 }]);
    // No read of the related object reached the driver: it was planned.
    expect(rec.calls.map((c) => `${c.verb}:${c.object}`)).toEqual([`aggregate:${LINE}`]);
    const ast = rec.calls[0]!.ast;
    expect(ast.groupBy).toEqual(['region']);
    const joins = ast[RELATION_GROUP_JOINS] as DriverRelationGroupJoin[];
    expect(joins).toHaveLength(1);
    expect(joins[0]!.field).toBe('opportunity');
    expect(joins[0]!.attrs).toEqual([{ attr: 'stage', alias: '__rg0_a0' }]);
    expect(joins[0]!.resolvedAlias).toBe('__rg0_resolved');
    expect(isComposedReadableIds(joins[0]!.parent)).toBe(true);
    expect(joins[0]!.parent!.object).toBe(OPP);
    // The request's condition as the related read's own doors lowered it
    // (`$ne` is null-safe), AND the middleware's.
    expect(joins[0]!.parent!.scope).toEqual({
      $and: [{ $and: [{ $or: [{ stage: { $null: true } }, { stage: { $ne: 'lost' } }] }] }, { owner: 'u_me' }],
    });
  });

  it('the base read is grouped by the relation field for every middleware, and only the driver\'s statement drops it', async () => {
    // What the base read's chain sees, as a group-key guard reads it.
    const seen: unknown[] = [];
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (op.object === LINE) seen.push(op.ast.groupBy);
      await next();
    });
    rec.answer([{ region: 'emea', __rg0_a0: 'won', __rg0_resolved: 1, total: 10 }]);
    const cases: Array<[unknown, unknown, unknown]> = [
      // [the request's groupBy, what the chain sees, what the driver is handed]
      [['region'], ['region', 'opportunity'], ['region']],
      [undefined, ['opportunity'], undefined],
      // A base dimension naming the FK column itself keeps its one entry.
      [['opportunity'], ['opportunity'], ['opportunity']],
    ];
    for (const [groupBy, chain, statement] of cases) {
      seen.length = 0;
      rec.calls.length = 0;
      const req = request();
      await engine.aggregate(LINE, { ...BASE_QUERY, groupBy } as never, { [RELATION_GROUP_BY]: req } as never);
      expect(req.outcome).toEqual({ kind: 'joined' });
      expect(seen).toEqual([chain]);
      expect(rec.calls.map((c) => c.ast.groupBy)).toEqual([statement]);
    }
  });

  it('a related read whose planned scope is the deny sentinel hands a null parent: nothing of the related object is readable', async () => {
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (op.object === OPP) op.ast.where = RLS_DENY_FILTER;
      await next();
    });
    rec.answer([{ region: 'emea', __rg0_a0: null, __rg0_resolved: 0, total: 10 }]);
    const req = request();
    await engine.aggregate(LINE, BASE_QUERY, { [RELATION_GROUP_BY]: req } as never);
    expect(req.outcome).toEqual({ kind: 'joined' });
    expect((rec.calls[0]!.ast[RELATION_GROUP_JOINS] as DriverRelationGroupJoin[])[0]!.parent).toBeNull();
  });

  it('a refusal of the related read propagates — a virtual attribute is refused by the related object\'s own group-by door, and no driver is asked', async () => {
    const req = request({ attrs: [{ attr: 'score', alias: '__rg0_a0' }] });
    const err = await refusalOf(engine.aggregate(LINE, BASE_QUERY, { [RELATION_GROUP_BY]: req } as never));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_FIELD', status: 400 });
    expect(rec.calls).toEqual([]);
  });

  it('a driver that answers without the resolved column did not compile the join: INTERNAL_ERROR / 500, the rows discarded', async () => {
    rec.answer([{ region: 'emea', total: 10 }]);
    const err = await refusalOf(engine.aggregate(LINE, BASE_QUERY, { [RELATION_GROUP_BY]: request() } as never));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INTERNAL_ERROR', status: 500 });
  });

  it('a request that names a column the row already has is a server fault, judged before anything is read', async () => {
    const err = await refusalOf(engine.aggregate(LINE, BASE_QUERY, {
      [RELATION_GROUP_BY]: request({ attrs: [{ attr: 'stage', alias: 'total' }] }),
    } as never));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INTERNAL_ERROR', status: 500 });
    expect(rec.calls).toEqual([]);
  });

  it('without the request, the aggregate is the one it always was: no join on the AST', async () => {
    rec.answer([{ region: 'emea', total: 10 }]);
    await engine.aggregate(LINE, BASE_QUERY);
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]!.ast[RELATION_GROUP_JOINS]).toBeUndefined();
  });
});

describe('relation group join — DECLINED, with nothing read, wherever it is not provably the FK-expand\'s read', () => {
  for (const name of ['com.objectstack.driver.memory', 'com.objectstack.driver.turso']) {
    it(`a driver that compiles no join but declares readableIdsLeaf (${name}): declined, no driver call — the caller's own path serves it`, async () => {
      const { engine, rec } = await makeEngine(name);
      const req = request();
      const rows = await engine.aggregate(LINE, BASE_QUERY, { [RELATION_GROUP_BY]: req } as never);
      expect(rows).toEqual([]);
      expect(req.outcome?.kind).toBe('declined');
      expect(rec.calls).toEqual([]);
    });
  }

  // [#33876] The dimension half (the scope note on #33876, 6917475155, under
  // Prime Directive 5): a driver without the bit is REFUSED, not declined — the outcome carries
  // the error the caller throws instead of serving its FK-expand.
  for (const name of ['com.objectstack.driver.mongodb', 'com.objectstack.driver.odata', 'com.objectstack.driver.sql']) {
    it(`[#33876] a driver without readableIdsLeaf (${name}): refused, INVALID_QUERY / 400 on the outcome, no driver call`, async () => {
      const { engine, rec } = await makeEngine(name, {});
      const req = request();
      const rows = await engine.aggregate(LINE, BASE_QUERY, { [RELATION_GROUP_BY]: req } as never);
      expect(rows).toEqual([]);
      expect(req.outcome?.kind).toBe('refused');
      const err = (req.outcome as { error?: Error & { code?: string; status?: number } }).error;
      expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_QUERY', status: 400 });
      expect(err?.message).toContain(`'${name}'`);
      expect(rec.calls).toEqual([]);
    });
  }

  it('a multi-valued relation: declined', async () => {
    const { engine, rec } = await makeEngine('com.objectstack.driver.sql');
    const req = request({ field: 'opportunities' });
    await engine.aggregate(LINE, BASE_QUERY, { [RELATION_GROUP_BY]: req } as never);
    expect(req.outcome?.kind).toBe('declined');
    expect(rec.calls).toEqual([]);
  });

  it('a relation the request reads as another object than it references: declined', async () => {
    const { engine, rec } = await makeEngine('com.objectstack.driver.sql');
    const req = request({ object: LINE });
    await engine.aggregate(LINE, BASE_QUERY, { [RELATION_GROUP_BY]: req } as never);
    expect(req.outcome?.kind).toBe('declined');
    expect(rec.calls).toEqual([]);
  });

  it('a middleware that answers the related read without its driver: the related read is not one planned statement, declined', async () => {
    const { engine, rec } = await makeEngine('com.objectstack.driver.sql');
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (op.object === OPP) { op.result = [{ id: 'x' }]; return; }
      await next();
    });
    const req = request();
    await engine.aggregate(LINE, BASE_QUERY, { [RELATION_GROUP_BY]: req } as never);
    expect(req.outcome?.kind).toBe('declined');
    expect(rec.calls).toEqual([]);
  });

  it('an aggregate the driver does not answer natively (a non-UTC date bucket): declined, no driver call', async () => {
    const { engine, rec } = await makeEngine('com.objectstack.driver.sql');
    engine.registry.registerObject({
      ...LINE_OBJECT, fields: { ...LINE_OBJECT.fields, closed_on: { name: 'closed_on', type: 'date' } },
    } as any, 'test');
    const req = request();
    await engine.aggregate(LINE, {
      groupBy: [{ field: 'closed_on', dateGranularity: 'month' }],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
      timezone: 'Asia/Shanghai',
    } as never, { [RELATION_GROUP_BY]: req } as never);
    expect(req.outcome?.kind).toBe('declined');
    expect(rec.calls).toEqual([]);
  });
});
