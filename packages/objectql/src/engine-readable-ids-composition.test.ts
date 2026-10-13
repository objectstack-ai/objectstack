// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D2, D5] The engine composes a `ReadableIds` leaf at its executor
 * boundary — on the FINAL AST, after the comparand doors, the middleware chain
 * and the before-hooks, immediately before each read verb's driver call.
 *
 * What the driver receives, per parent object `P`:
 *
 * - `canReadObject(P)` false or a throw, a security service that is absent or
 *   cannot be asked, or `getReadFilter(P)` answering the deny sentinel or
 *   throwing ⇒ `$in: []` (no row of `P`, on every driver);
 * - otherwise the composed leaf `{ object: P, scope }`, the scope being
 *   `getReadFilter(P)`'s answer by reference, marked `'policy'`.
 *
 * Refused by name, `INTERNAL_ERROR` / 500, before any driver is asked: a write
 * verb, `having`, an aggregation's filter, any position but a `$in`
 * comparand, a composed leaf the engine did not compose, and D5's three
 * classes (a delegated caller, a middleware-gated parent, a federated parent).
 *
 * The recording driver is this package's witness shape (the in-memory
 * driver's test consumers are a closed census); evaluating the composed leaf
 * is the drivers' (ADR-0139 D3, E3/E4).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ReadableIds,
  RLS_DENY_FILTER,
  isComposedReadableIds,
  filterSubtreeProvenanceOf,
} from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

interface SeenCall { verb: string; object: string; ast: any }

function makeRecordingDriver(name = 'recording', opts: { aggregate?: boolean } = {}) {
  const calls: SeenCall[] = [];
  const driver: any = {
    name, version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) { calls.push({ verb: 'find', object, ast }); return []; },
    async findOne(object: string, ast: any) { calls.push({ verb: 'findOne', object, ast }); return null; },
    async count(object: string, ast: any) { calls.push({ verb: 'count', object, ast }); return 0; },
    async create(object: string, data: Record<string, unknown>) { calls.push({ verb: 'create', object, ast: data }); return data; },
    async update(object: string, _id: string, data: Record<string, unknown>) { calls.push({ verb: 'update', object, ast: data }); return data; },
    async updateMany(object: string, ast: any) { calls.push({ verb: 'updateMany', object, ast }); return 0; },
    async delete(object: string) { calls.push({ verb: 'delete', object, ast: null }); return true; },
    async deleteMany(object: string, ast: any) { calls.push({ verb: 'deleteMany', object, ast }); return 0; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  if (opts.aggregate !== false) {
    driver.aggregate = async (object: string, ast: any) => { calls.push({ verb: 'aggregate', object, ast }); return []; };
  }
  return { driver, calls };
}

const CHILD = {
  name: 'rid_child',
  label: 'ReadableIds child',
  fields: {
    object_name: { name: 'object_name', type: 'text' },
    record_id: { name: 'record_id', type: 'text' },
    owner: { name: 'owner', type: 'text' },
    note: { name: 'note', type: 'text' },
    amount: { name: 'amount', type: 'number' },
  },
};
const PARENT = { name: 'rid_parent', label: 'Parent', fields: { title: { name: 'title', type: 'text' } } };
const OTHER = { name: 'rid_other', label: 'Other parent', fields: { title: { name: 'title', type: 'text' } } };
const GATED = { name: 'rid_gated', label: 'Middleware-gated parent', fields: { title: { name: 'title', type: 'text' } } };
const FAR = { name: 'rid_far', label: 'Federated parent', datasource: 'far', fields: { title: { name: 'title', type: 'text' } } };

type Thrown = (Error & { code?: string; status?: number }) | null;
const refusalOf = async (p: Promise<unknown>): Promise<Thrown> => p.then(() => null, (e: any) => e);
const envelopeOf = (err: Thrown) => ({ code: err?.code, status: err?.status });
const REFUSED = { code: 'INTERNAL_ERROR', status: 500 };

const leafOf = (object = 'rid_parent') => ReadableIds.of(object);
const branch = (object = 'rid_parent') => ({ object_name: object, record_id: { $in: leafOf(object) } });
const COUNT_AGG = [{ function: 'count', alias: 'n' }];

/** A security service double that records which half it was asked, per object. */
function makeSecurity(opts: {
  canRead?: (object: string) => boolean | Promise<boolean>;
  scope?: (object: string) => unknown;
} = {}) {
  const asked: string[] = [];
  const svc: any = {
    async canReadObject(object: string) { asked.push(`canReadObject:${object}`); return opts.canRead ? opts.canRead(object) : true; },
    async getReadFilter(object: string) { asked.push(`getReadFilter:${object}`); return opts.scope ? opts.scope(object) : undefined; },
    async explain() { asked.push('explain'); return { allowed: false }; },
  };
  return { svc, asked };
}

/** The `$in` comparand the driver received at `where.record_id`, under any `$and` the chain wrapped around it. */
function inComparandOf(where: any): unknown {
  if (where?.record_id) return where.record_id.$in;
  for (const arm of where?.$and ?? []) {
    const found = inComparandOf(arm);
    if (found !== undefined) return found;
  }
  return undefined;
}

describe('[ADR-0139 D2] the executor boundary composes the ReadableIds leaf', () => {
  let engine: ObjectQL;
  let calls: SeenCall[];

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    const farRec = makeRecordingDriver('far');
    calls = rec.calls;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    engine.registerDriver(farRec.driver);
    await engine.init();
    for (const def of [CHILD, PARENT, OTHER, GATED, FAR]) engine.registry.registerObject(def as any, 'test');
    engine.registerMiddleware(async (_ctx, next) => next(), { object: 'rid_gated' });
    calls.length = 0;
  });

  const readVerbs = (where: Record<string, unknown>) => [
    ['find', () => engine.find('rid_child', { where })],
    ['findOne', () => engine.findOne('rid_child', { where })],
    ['count', () => engine.count('rid_child', { where })],
    ['aggregate', () => engine.aggregate('rid_child', { where, aggregations: COUNT_AGG as any })],
  ] as const;

  it('each read verb hands its driver the composed leaf — scope by reference, marked policy', async () => {
    const scope = { owner: 'u1' };
    const { svc } = makeSecurity({ scope: () => scope });
    engine.registerSecurityServiceSource(() => svc);
    for (const [verb, run] of readVerbs(branch())) {
      calls.length = 0;
      await run();
      expect(calls.map((c) => c.verb), verb).toEqual([verb]);
      const composed = inComparandOf(calls[0].ast.where) as any;
      expect(isComposedReadableIds(composed), verb).toBe(true);
      expect(composed.object, verb).toBe('rid_parent');
      expect(composed.scope, verb).toBe(scope);
    }
    expect(filterSubtreeProvenanceOf(scope)).toBe('policy');
  });

  it("aggregate's rows path (a driver with no aggregate) receives the same composed where", async () => {
    const rows = makeRecordingDriver('rows_only', { aggregate: false });
    const e = new ObjectQL();
    e.registerDriver(rows.driver, true);
    await e.init();
    e.registry.registerObject(CHILD as any, 'test');
    e.registry.registerObject(PARENT as any, 'test');
    const { svc } = makeSecurity({ scope: () => ({ owner: 'u1' }) });
    e.registerSecurityServiceSource(() => svc);
    rows.calls.length = 0;
    await e.aggregate('rid_child', { where: branch(), aggregations: COUNT_AGG as any });
    expect(rows.calls.map((c) => c.verb)).toEqual(['find']);
    expect(isComposedReadableIds(inComparandOf(rows.calls[0].ast.where))).toBe(true);
  });

  it('a leaf written by an object-scoped middleware is composed on find, findOne, count and aggregate', async () => {
    const { svc } = makeSecurity();
    engine.registerSecurityServiceSource(() => svc);
    engine.registerMiddleware(async (ctx, next) => {
      if (ctx.ast && ['find', 'findOne', 'count', 'aggregate'].includes(ctx.operation)) {
        ctx.ast.where = ctx.ast.where ? { $and: [ctx.ast.where, branch()] } : branch();
      }
      await next();
    }, { object: 'rid_child' });
    for (const [verb, run] of readVerbs({ note: 'x' })) {
      calls.length = 0;
      await run();
      const composed = inComparandOf(calls[0].ast.where) as any;
      expect(isComposedReadableIds(composed), verb).toBe(true);
      expect(composed.scope, `${verb}: getReadFilter answered undefined — no row restriction`).toBeUndefined();
    }
  });

  it('a leaf written by a beforeFind hook is composed on find and findOne', async () => {
    const { svc } = makeSecurity();
    engine.registerSecurityServiceSource(() => svc);
    engine.registerHook('beforeFind', (ctx: any) => {
      ctx.input.ast.where = { $and: [ctx.input.ast.where ?? {}, branch()] };
    }, { object: 'rid_child' });
    await engine.find('rid_child', { where: { note: 'x' } });
    await engine.findOne('rid_child', { where: { note: 'x' } });
    expect(calls.map((c) => c.verb)).toEqual(['find', 'findOne']);
    for (const call of calls) expect(isComposedReadableIds(inComparandOf(call.ast.where)), call.verb).toBe(true);
  });

  it('canReadObject false ⇒ $in: [] — no row of the parent, and getReadFilter is not asked', async () => {
    const { svc, asked } = makeSecurity({ canRead: () => false, scope: () => ({ owner: 'u1' }) });
    engine.registerSecurityServiceSource(() => svc);
    await engine.find('rid_child', { where: branch() });
    expect(inComparandOf(calls[0].ast.where)).toEqual([]);
    expect(asked).toEqual(['canReadObject:rid_parent']);
  });

  it('a parent the registry does not hold ⇒ $in: [] — no security call, no D5 verdict', async () => {
    const { svc, asked } = makeSecurity();
    engine.registerSecurityServiceSource(() => svc);
    await engine.find('rid_child', { where: branch('rid_unregistered') });
    expect(inComparandOf(calls[0].ast.where)).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('the deny sentinel, by identity ⇒ $in: [] — no row of the parent', async () => {
    const { svc } = makeSecurity({ scope: () => RLS_DENY_FILTER });
    engine.registerSecurityServiceSource(() => svc);
    for (const [verb, run] of readVerbs(branch())) {
      calls.length = 0;
      await run();
      expect(inComparandOf(calls[0].ast.where), verb).toEqual([]);
    }
  });

  it('a throw from either half ⇒ $in: [] (fail closed)', async () => {
    for (const fault of ['canReadObject', 'getReadFilter'] as const) {
      const { svc } = makeSecurity({ scope: () => ({ owner: 'u1' }) });
      svc[fault] = async () => { throw new Error(`${fault} is down`); };
      engine.registerSecurityServiceSource(() => svc);
      calls.length = 0;
      await engine.find('rid_child', { where: branch() });
      expect(inComparandOf(calls[0].ast.where), fault).toEqual([]);
    }
  });

  it("a service without canReadObject is asked explain's allowed instead", async () => {
    for (const allowed of [false, true]) {
      const svc = { getReadFilter: vi.fn(async () => undefined), explain: vi.fn(async () => ({ allowed })) };
      engine.registerSecurityServiceSource(() => svc);
      calls.length = 0;
      await engine.find('rid_child', { where: branch() });
      const comparand = inComparandOf(calls[0].ast.where);
      if (allowed) expect(isComposedReadableIds(comparand)).toBe(true);
      else expect(comparand).toEqual([]);
      expect(svc.explain).toHaveBeenCalledWith({ object: 'rid_parent', operation: 'read' }, undefined);
    }
  });

  it('no usable security service ⇒ $in: [] — unregistered, answering nothing, throwing, or unable to answer', async () => {
    const sources: ReadonlyArray<readonly [string, (() => unknown) | undefined]> = [
      ['no source registered', undefined],
      ['the source answers nothing', () => undefined],
      ['the source throws (a kernel with no security service)', () => { throw new Error('service not found'); }],
      ['no getReadFilter', () => ({ canReadObject: async () => true, explain: async () => ({ allowed: true }) })],
      ['neither canReadObject nor explain', () => ({ getReadFilter: async () => undefined })],
    ];
    for (const [label, source] of sources) {
      const rec = makeRecordingDriver();
      const e = new ObjectQL();
      e.registerDriver(rec.driver, true);
      await e.init();
      e.registry.registerObject(CHILD as any, 'test');
      e.registry.registerObject(PARENT as any, 'test');
      if (source) e.registerSecurityServiceSource(source);
      rec.calls.length = 0;
      await e.find('rid_child', { where: branch() });
      expect(inComparandOf(rec.calls[0].ast.where), label).toEqual([]);
    }
  });

  it('the security service is read AT USE: one registered after the source answers the next read', async () => {
    let registered: unknown;
    engine.registerSecurityServiceSource(() => {
      if (!registered) throw new Error('service not found');
      return registered;
    });
    await engine.find('rid_child', { where: branch() });
    expect(inComparandOf(calls[0].ast.where), 'before the service exists').toEqual([]);
    registered = makeSecurity().svc;
    await engine.find('rid_child', { where: branch() });
    expect(isComposedReadableIds(inComparandOf(calls[1].ast.where)), 'after it registered').toBe(true);
  });

  it('each parent is asked once per read: two leaves over one parent and one over another', async () => {
    const { svc, asked } = makeSecurity();
    engine.registerSecurityServiceSource(() => svc);
    await engine.find('rid_child', {
      where: { $or: [branch('rid_parent'), branch('rid_other'), { $and: [{ note: 'x' }, branch('rid_parent')] }] },
    });
    expect(asked).toEqual([
      'canReadObject:rid_parent', 'getReadFilter:rid_parent',
      'canReadObject:rid_other', 'getReadFilter:rid_other',
    ]);
    const arms = calls[0].ast.where.$or;
    expect((inComparandOf(arms[0]) as any).object).toBe('rid_parent');
    expect((inComparandOf(arms[1]) as any).object).toBe('rid_other');
    expect(isComposedReadableIds(inComparandOf(arms[2]))).toBe(true);
  });

  it('a leaf beside a resolved placeholder arrives branded and is composed', async () => {
    const { svc } = makeSecurity();
    engine.registerSecurityServiceSource(() => svc);
    await engine.find('rid_child', {
      where: { owner: '{current_user_id}', record_id: { $in: leafOf() } },
      context: { userId: 'usr_1' } as any,
    });
    expect(calls[0].ast.where.owner).toBe('usr_1');
    expect(isComposedReadableIds(calls[0].ast.where.record_id.$in)).toBe(true);
  });

  it("a deny ANDed with another layer is composed, and its scope keeps the sentinel's arm by identity (fail-safe)", async () => {
    const composite = { $and: [RLS_DENY_FILTER, { owner: 'u1' }] };
    const { svc } = makeSecurity({ scope: () => composite });
    engine.registerSecurityServiceSource(() => svc);
    await engine.find('rid_child', { where: branch() });
    const composed = inComparandOf(calls[0].ast.where) as any;
    expect(isComposedReadableIds(composed)).toBe(true);
    // The subquery's scope requires `id` to equal a value no record carries,
    // so it matches no row of the parent on any driver that evaluates it.
    expect(composed.scope.$and[0]).toBe(RLS_DENY_FILTER);
  });

  it('LIT CONTROL — a read without a leaf reaches the driver as written, and the security source is never read', async () => {
    const source = vi.fn(() => makeSecurity().svc);
    engine.registerSecurityServiceSource(source);
    await engine.find('rid_child', { where: { record_id: { $in: ['p1', 'p2'] } } });
    expect(calls[0].ast.where).toEqual({ record_id: { $in: ['p1', 'p2'] } });
    expect(source).not.toHaveBeenCalled();
  });
});

describe('[ADR-0139 D1, D5] what the engine never composes is refused by name — no driver call', () => {
  let engine: ObjectQL;
  let calls: SeenCall[];
  let asked: string[];

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    const farRec = makeRecordingDriver('far');
    calls = rec.calls;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    engine.registerDriver(farRec.driver);
    await engine.init();
    for (const def of [CHILD, PARENT, GATED, FAR]) engine.registry.registerObject(def as any, 'test');
    engine.registerMiddleware(async (_ctx, next) => next(), { object: 'rid_gated' });
    const security = makeSecurity();
    asked = security.asked;
    engine.registerSecurityServiceSource(() => security.svc);
    calls.length = 0;
  });

  it('D5 — a delegated (on-behalf-of) caller', async () => {
    const err = await refusalOf(engine.find('rid_child', {
      where: branch(),
      context: { userId: 'usr_agent', onBehalfOf: { userId: 'usr_owner' } } as any,
    }));
    expect(envelopeOf(err)).toEqual(REFUSED);
    expect(err!.message).toContain('on-behalf-of');
    expect(calls).toHaveLength(0);
    expect(asked, 'D5 is decided before the security service is asked').toEqual([]);
  });

  it('D5 — a parent an object-scoped read middleware narrows', async () => {
    const err = await refusalOf(engine.count('rid_child', { where: branch('rid_gated') }));
    expect(envelopeOf(err)).toEqual(REFUSED);
    expect(err!.message).toContain("'rid_gated', whose rows an object-scoped read middleware narrows");
    expect(calls).toHaveLength(0);
    expect(asked).toEqual([]);
  });

  it('D5 — a parent bound to another datasource (federated)', async () => {
    const err = await refusalOf(engine.aggregate('rid_child', { where: branch('rid_far'), aggregations: COUNT_AGG as any }));
    expect(envelopeOf(err)).toEqual(REFUSED);
    expect(err!.message).toContain("'rid_far', which is bound to datasource 'far'");
    expect(calls).toHaveLength(0);
    expect(asked).toEqual([]);
  });

  it('a write verb — the caller\'s leaf at the door, a middleware\'s at the executor entry', async () => {
    const writes = [
      () => engine.update('rid_child', { note: 'y' }, { where: { record_id: { $in: leafOf() } }, multi: true }),
      () => engine.delete('rid_child', { where: { record_id: { $in: leafOf() } }, multi: true }),
    ];
    for (const run of writes) expect(envelopeOf(await refusalOf(run()))).toEqual(REFUSED);
    engine.registerMiddleware(async (ctx, next) => {
      if (ctx.ast && (ctx.operation === 'update' || ctx.operation === 'delete')) {
        ctx.ast.where = { $and: [ctx.ast.where ?? {}, branch()] };
      }
      await next();
    }, { object: 'rid_child' });
    const viaChain = [
      () => engine.update('rid_child', { note: 'y' }, { where: { note: 'x' }, multi: true }),
      () => engine.delete('rid_child', { where: { note: 'x' }, multi: true }),
    ];
    for (const run of viaChain) {
      const err = await refusalOf(run());
      expect(envelopeOf(err)).toEqual(REFUSED);
      expect(err!.message).toContain('where.$and[1].record_id.$in holds a ReadableIds leaf');
    }
    expect(calls, 'no write and no prior-row read reached the driver').toHaveLength(0);
  });

  it('having and an aggregation\'s own filter — written by the caller or by a middleware', async () => {
    const callerWritten = [
      ['having', () => engine.aggregate('rid_child', {
        groupBy: ['record_id'], aggregations: COUNT_AGG as any, having: { record_id: { $in: leafOf() } },
      })],
      ['aggregations[0].filter', () => engine.aggregate('rid_child', {
        aggregations: [{ function: 'count', alias: 'n', filter: { record_id: { $in: leafOf() } } }] as any,
      })],
    ] as const;
    for (const [at, run] of callerWritten) {
      const err = await refusalOf(run());
      expect(envelopeOf(err), at).toEqual(REFUSED);
      expect(err!.message, at).toContain(`${at}.record_id.$in holds a ReadableIds leaf`);
    }
    engine.registerMiddleware(async (ctx, next) => {
      if (ctx.operation === 'aggregate' && ctx.ast) ctx.ast.having = { record_id: { $in: leafOf() } };
      await next();
    }, { object: 'rid_child' });
    const err = await refusalOf(engine.aggregate('rid_child', { groupBy: ['record_id'], aggregations: COUNT_AGG as any }));
    expect(envelopeOf(err)).toEqual(REFUSED);
    expect(err!.message).toContain('having.record_id.$in holds a ReadableIds leaf');
    expect(calls).toHaveLength(0);
  });

  it('any position but a $in comparand — written by the caller or by a middleware', async () => {
    const positions: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
      [{ record_id: leafOf() }, 'where.record_id'],
      [{ record_id: { $in: ['p1', leafOf()] } }, 'where.record_id.$in[1]'],
      [{ amount: { $between: [1, leafOf()] } }, 'where.amount.$between[1]'],
    ];
    for (const [where, at] of positions) {
      const err = await refusalOf(engine.find('rid_child', { where }));
      expect(envelopeOf(err), at).toEqual(REFUSED);
      expect(err!.message, at).toContain(`${at} holds a ReadableIds leaf`);
    }
    engine.registerMiddleware(async (ctx, next) => {
      if (ctx.ast) ctx.ast.where = { $and: [ctx.ast.where ?? {}, { record_id: { $nin: leafOf() } }] };
      await next();
    }, { object: 'rid_child' });
    const err = await refusalOf(engine.find('rid_child', { where: { note: 'x' } }));
    expect(envelopeOf(err)).toEqual(REFUSED);
    expect(err!.message).toContain('where.$and[1].record_id.$nin holds a ReadableIds leaf');
    expect(calls).toHaveLength(0);
  });

  it('the array branch meets the same rule: a leaf it lowers into another position is refused by name', async () => {
    const err = await refusalOf(engine.find('rid_child', { where: [['record_id', '=', leafOf()]] as any }));
    expect(envelopeOf(err)).toEqual(REFUSED);
    expect(err!.message).toContain('where.record_id holds a ReadableIds leaf');
    // Its `in` spelling stays the lowering's own refusal: the array sugar is
    // request input and never admits the leaf as a `$in` comparand.
    const sugar = await refusalOf(engine.find('rid_child', { where: [['record_id', 'in', leafOf()]] as any }));
    expect(envelopeOf(sugar)).toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(calls).toHaveLength(0);
  });

  it('a composed leaf the engine did not compose is never trusted as a scope', async () => {
    engine.registerMiddleware(async (ctx, next) => {
      if (ctx.ast) ctx.ast.where = { record_id: { $in: ReadableIds.compose(leafOf(), undefined) } };
      await next();
    }, { object: 'rid_child' });
    const err = await refusalOf(engine.find('rid_child', { where: { note: 'x' } }));
    expect(envelopeOf(err)).toEqual(REFUSED);
    expect(err!.message).toContain('where.record_id.$in holds a COMPOSED ReadableIds leaf');
    // The caller's own is a plain object in a list slot to the comparand door,
    // which admits the uncomposed leaf only.
    const callers = await refusalOf(engine.find('rid_child', {
      where: { record_id: { $in: ReadableIds.compose(leafOf(), undefined) } },
    }));
    expect(envelopeOf(callers)).toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(calls).toHaveLength(0);
  });
});
