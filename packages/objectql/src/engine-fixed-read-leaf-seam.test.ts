// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 D1, D4] The engine's executor seam for the fixed-read leaves
 * (`fixed-read-leaf-position.ts`, `fixed-read-leaf-seam.ts`), on a real
 * `ObjectQL`: the door admits the brand, and the seam checks position, verb,
 * recipient, the two classes and the driver's declaration, then hands the leaf
 * to the driver by reference, or refuses before any driver is asked with
 * `INTERNAL_ERROR` / 500.
 *
 * The step-1 conformance cases (`SHARED_RECORD_IDS_CASE_SET.seam`) run here
 * against the seam itself. A case whose filter holds a composed `ReadableIds`
 * scope is driven the only way such a scope reaches a driver: the caller
 * writes `ReadableIds.of(P)` and the security service answers `P`'s read
 * filter with the scope, which the engine composes at its boundary.
 *
 * No driver in this repository declares `fixedReadLeaves` yet (the compile
 * lands per driver, ADR-0155 plan steps 3 and 4), so the pass-through is
 * witnessed on a recording driver that declares the brand.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReadableIds,
  SHARED_RECORD_IDS_CASE_SET,
  SharedRecordIds,
  isComposedReadableIds,
  isFixedReadLeaf,
  type EngineAggregateOptions,
  type FilterCondition,
  type FixedReadLeafSeamCase,
} from '@objectstack/spec/data';
import { ObjectQL, SECURITY_SERVICE_SOURCE_SLOT } from './engine.js';
import { driverEvaluatesFixedReadLeaf, fixedReadLeafClassOfEngine } from './index.js';

interface SeenCall { verb: string; object: string; ast: any }

const DECLARES = { readableIdsLeaf: true, fixedReadLeaves: ['SharedRecordIds'] };

function makeRecordingDriver(name: string, supports: Record<string, unknown>) {
  const calls: SeenCall[] = [];
  const driver: any = {
    name, version: '0.0.0', supports,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) { calls.push({ verb: 'find', object, ast }); return []; },
    async findOne(object: string, ast: any) { calls.push({ verb: 'findOne', object, ast }); return null; },
    async count(object: string, ast: any) { calls.push({ verb: 'count', object, ast }); return 0; },
    async aggregate(object: string, ast: any) { calls.push({ verb: 'aggregate', object, ast }); return []; },
    async create(object: string, data: Record<string, unknown>) { calls.push({ verb: 'create', object, ast: data }); return data; },
    async update(object: string, _id: string, data: Record<string, unknown>) { calls.push({ verb: 'update', object, ast: data }); return data; },
    async updateMany(object: string, ast: any) { calls.push({ verb: 'updateMany', object, ast }); return 0; },
    async delete(object: string) { calls.push({ verb: 'delete', object, ast: null }); return true; },
    async deleteMany(object: string, ast: any) { calls.push({ verb: 'deleteMany', object, ast }); return 0; },
  };
  return { driver, calls };
}

function capturingLogger() {
  const lines: Array<{ level: string; msg: string }> = [];
  const push = (level: string) => (msg: string) => void lines.push({ level, msg: String(msg) });
  const logger: any = {
    lines,
    trace() {}, fatal() {},
    debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error'),
    child() { return logger; },
  };
  return logger;
}

const text = (name: string) => ({ name, type: 'text' });
const OBJECTS = [
  { name: 'srid_doc', fields: { owner: text('owner'), label: text('label') } },
  { name: 'srid_note', fields: { record_id: text('record_id') } },
  { name: 'srid_other', fields: { title: text('title') } },
  { name: 'srid_far', datasource: 'far', fields: { owner: text('owner') } },
  {
    name: 'sys_record_share',
    fields: {
      object_name: text('object_name'), recipient_type: text('recipient_type'),
      recipient_id: text('recipient_id'), record_id: text('record_id'), access_level: text('access_level'),
    },
  },
];

type Thrown = (Error & { code?: string; status?: number; httpStatus?: number }) | null;
const refusalOf = async (p: Promise<unknown>): Promise<Thrown> => p.then(() => null, (e: any) => e);
const envelopeOf = (err: Thrown) => ({ code: err?.code, status: err?.status });
const REFUSED = { code: 'INTERNAL_ERROR', status: 500 };
const ASKER = { userId: 'u1' };

/** Every fixed-read leaf in `node`, composed scopes included, by identity. */
function leavesIn(node: unknown, out: unknown[] = []): unknown[] {
  if (isFixedReadLeaf(node)) out.push(node);
  else if (isComposedReadableIds(node)) leavesIn(node.scope, out);
  else if (node !== null && typeof node === 'object') for (const v of Object.values(node)) leavesIn(v, out);
  return out;
}

/**
 * The filter a caller writes for a case "as the seam sees it": each composed
 * scope becomes `ReadableIds.of(P)`, and `scopes` holds the read filter the
 * security service answers for `P`. Every fixed-read leaf is kept by reference.
 */
function asCallerWrites(node: unknown, scopes: Map<string, unknown>): unknown {
  if (isFixedReadLeaf(node)) return node;
  if (isComposedReadableIds(node)) {
    scopes.set(node.object, asCallerWrites(node.scope, scopes));
    return ReadableIds.of(node.object);
  }
  if (Array.isArray(node)) return node.map((v) => asCallerWrites(v, scopes));
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, asCallerWrites(v, scopes)]));
  }
  return node;
}

async function bootEngine(opts: { supports?: Record<string, unknown> } = {}) {
  const logger = capturingLogger();
  const engine = new ObjectQL({ logger });
  const rec = makeRecordingDriver('recording', opts.supports ?? DECLARES);
  const far = makeRecordingDriver('far', DECLARES);
  engine.registerDriver(rec.driver, true);
  engine.registerDriver(far.driver);
  await engine.init();
  for (const def of OBJECTS) engine.registry.registerObject(def as any, 'test');
  return { engine, logger, calls: rec.calls, farCalls: far.calls, driver: rec.driver };
}

/** Put a security service in the engine's slot, answering `scopes` as each parent's read filter. */
function wireSecurity(engine: ObjectQL, scopes: Map<string, unknown>): void {
  const svc = {
    async canReadObject() { return true; },
    async getReadFilter(object: string) { return scopes.get(object); },
    async explain() { return { allowed: false }; },
  };
  (engine as unknown as Record<symbol, unknown>)[SECURITY_SERVICE_SOURCE_SLOT] = () => svc;
}

/** Run one operation the way a case names it. */
function run(engine: ObjectQL, c: Pick<FixedReadLeafSeamCase, 'operation' | 'object' | 'clause' | 'context'>, filter: unknown) {
  const context = c.context as any;
  const where = c.clause === 'where' ? (filter as FilterCondition) : undefined;
  switch (c.operation) {
    case 'find': return engine.find(c.object, { where }, { context });
    case 'findOne': return engine.findOne(c.object, { where }, { context });
    case 'count': return engine.count(c.object, { where }, { context });
    case 'aggregate': {
      const query: EngineAggregateOptions = {
        ...(where !== undefined ? { where } : {}),
        ...(c.clause === 'having' ? { having: filter as FilterCondition, groupBy: ['owner'] } : {}),
        aggregations: [{ function: 'count', alias: 'n' }],
      };
      return engine.aggregate(c.object, query, { context });
    }
    case 'update': return engine.update(c.object, { label: 'z' }, { where, multi: true, context } as any);
    case 'delete': return engine.delete(c.object, { where, multi: true, context } as any);
  }
}

describe('[ADR-0155 D1, D4] the step-1 seam cases, against the engine\'s seam', () => {
  let booted: Awaited<ReturnType<typeof bootEngine>>;
  beforeEach(async () => { booted = await bootEngine(); });

  for (const c of SHARED_RECORD_IDS_CASE_SET.seam) {
    it(`${c.verdict}: ${c.name}`, async () => {
      const scopes = new Map<string, unknown>();
      const built = c.filter();
      const filter = asCallerWrites(built, scopes);
      wireSecurity(booted.engine, scopes);
      const err = await refusalOf(Promise.resolve(run(booted.engine, c, filter)));
      if (c.verdict === 'refuses') {
        expect(envelopeOf(err), err?.message).toEqual(REFUSED);
        expect(booted.calls, 'no driver was asked').toEqual([]);
        return;
      }
      expect(err).toBeNull();
      expect(booted.calls.length).toBeGreaterThan(0);
      // Every leaf the case wrote reached the driver, the same object: by reference, brand intact.
      const wrote = leavesIn(built);
      for (const call of booted.calls) {
        const reached = leavesIn(call.ast?.where);
        expect(reached.length, call.verb).toBe(wrote.length);
        for (const leaf of reached) expect(wrote.includes(leaf), call.verb).toBe(true);
      }
    });
  }
});

describe('[ADR-0155 D4] the recipient rule compares, never replaces', () => {
  it('a context with no user and no system flag is refused: absence is never system', async () => {
    const { engine, calls } = await bootEngine();
    const err = await refusalOf(engine.find('srid_doc', { where: { id: { $in: SharedRecordIds.read('srid_doc', 'u1') } } }));
    expect(envelopeOf(err)).toEqual(REFUSED);
    expect(calls).toEqual([]);
  });

  it('an admitted leaf keeps its recipient: the delegator\'s leaf reaches the driver as the delegator\'s', async () => {
    const { engine, calls } = await bootEngine();
    const leaf = SharedRecordIds.read('srid_doc', 'u1');
    await engine.find('srid_doc', { where: { id: { $in: leaf } } }, { context: { userId: 'agent_1', onBehalfOf: { userId: 'u1' } } as any });
    expect(calls[0].ast.where.id.$in).toBe(leaf);
    expect((calls[0].ast.where.id.$in as SharedRecordIds).recipient).toBe('u1');
  });
});

describe('[ADR-0155 D4, Q2 as ruled] the driver declaration', () => {
  const where = () => ({ id: { $in: SharedRecordIds.read('srid_doc', 'u1') } });

  it('a driver that declares nothing is never handed the leaf: INTERNAL_ERROR / 500, naming the driver and the leaf', async () => {
    const { engine, calls } = await bootEngine({ supports: {} });
    const err = await refusalOf(engine.find('srid_doc', { where: where() }, { context: ASKER as any }));
    expect(envelopeOf(err)).toEqual(REFUSED);
    expect(err?.httpStatus).toBe(500);
    expect(err?.message).toContain("'recording'");
    expect(err?.message).toContain('SharedRecordIds');
    expect(calls).toEqual([]);
  });

  it('an empty list and the readableIdsLeaf bit alone declare no fixed-read leaf', async () => {
    for (const supports of [{ fixedReadLeaves: [] }, { readableIdsLeaf: true }]) {
      const { engine, calls } = await bootEngine({ supports });
      expect(envelopeOf(await refusalOf(engine.count('srid_doc', { where: where() }, { context: ASKER as any })))).toEqual(REFUSED);
      expect(calls).toEqual([]);
    }
  });

  it('the refusal is logged at error once per driver, and answered every time', async () => {
    const { engine, logger } = await bootEngine({ supports: {} });
    for (let i = 0; i < 3; i++) {
      expect(envelopeOf(await refusalOf(engine.find('srid_doc', { where: where() }, { context: ASKER as any })))).toEqual(REFUSED);
    }
    const lines = logger.lines.filter((l: { msg: string }) => l.msg.includes('fixed read of'));
    expect(lines.map((l: { level: string }) => l.level)).toEqual(['error']);
  });
});

describe('[ADR-0155 D4, ② as ruled] the two classes the seam recognises', () => {
  const where = (object = 'srid_doc') => ({ id: { $in: SharedRecordIds.read(object, 'u1') } });

  it('an object bound to another datasource than sys_record_share is refused, its driver\'s declaration notwithstanding', async () => {
    const { engine, farCalls } = await bootEngine();
    const err = await refusalOf(engine.find('srid_far', { where: where('srid_far') }, { context: ASKER as any }));
    expect(envelopeOf(err)).toEqual(REFUSED);
    expect(err?.message).toContain("'far'");
    expect(farCalls).toEqual([]);
  });

  it('an object-scoped middleware registered for sys_record_share by name is refused', async () => {
    const { engine, calls } = await bootEngine();
    engine.registerMiddleware(async (_ctx, next) => next(), { object: 'sys_record_share' });
    expect(envelopeOf(await refusalOf(engine.find('srid_doc', { where: where() }, { context: ASKER as any })))).toEqual(REFUSED);
    expect(calls).toEqual([]);
  });

  for (const event of ['beforeFind', 'afterFind']) {
    for (const object of ['sys_record_share', ['srid_other', 'sys_record_share']]) {
      it(`a ${event} hook naming sys_record_share (${JSON.stringify(object)}) is refused`, async () => {
        const { engine, calls } = await bootEngine();
        engine.registerHook(event, () => {}, { object });
        expect(envelopeOf(await refusalOf(engine.find('srid_doc', { where: where() }, { context: ASKER as any })))).toEqual(REFUSED);
        expect(calls).toEqual([]);
      });
    }
  }

  it('a registration that names no object, or \'*\', is outside the class: the leaf passes through', async () => {
    const { engine, calls } = await bootEngine();
    engine.registerMiddleware(async (_ctx, next) => next());
    engine.registerMiddleware(async (_ctx, next) => next(), { object: '*' });
    engine.registerHook('beforeFind', () => {});
    engine.registerHook('afterFind', () => {}, { object: '*' });
    engine.registerHook('beforeFind', () => {}, { object: 'srid_other' });
    const leaf = SharedRecordIds.read('srid_doc', 'u1');
    await engine.find('srid_doc', { where: { id: { $in: leaf } } }, { context: ASKER as any });
    expect(calls.map((c) => c.verb)).toEqual(['find']);
    expect(calls[0].ast.where.id.$in).toBe(leaf);
  });

  it('a hook that names sys_record_share and excludes it is not dispatched for it, so it is outside the class', async () => {
    const { engine, calls } = await bootEngine();
    engine.registerHook('beforeFind', () => {}, { object: ['sys_record_share', 'srid_other'], excludeObjects: 'sys_record_share' });
    await engine.find('srid_doc', { where: where() }, { context: ASKER as any });
    expect(calls.map((c) => c.verb)).toEqual(['find']);
  });
});

describe('[ADR-0155 D4] a leaf the pipeline wrote meets the same seam at the boundary', () => {
  it('a middleware-written read form passes through on each read verb; the door never saw it', async () => {
    const { engine, calls } = await bootEngine();
    const leaf = SharedRecordIds.read('srid_doc', 'u1');
    engine.registerMiddleware(async (ctx, next) => {
      if (ctx.ast && ['find', 'findOne', 'count', 'aggregate'].includes(ctx.operation)) {
        ctx.ast.where = { $and: [ctx.ast.where ?? {}, { $or: [{ owner: 'u1' }, { id: { $in: leaf } }] }] };
      }
      await next();
    }, { object: 'srid_doc' });
    const where = { label: 'keep' };
    await engine.find('srid_doc', { where }, { context: ASKER as any });
    await engine.findOne('srid_doc', { where }, { context: ASKER as any });
    await engine.count('srid_doc', { where }, { context: ASKER as any });
    await engine.aggregate('srid_doc', { where, aggregations: [{ function: 'count', alias: 'n' }] }, { context: ASKER as any });
    expect(calls.map((c) => c.verb)).toEqual(['find', 'findOne', 'count', 'aggregate']);
    for (const call of calls) expect(leavesIn(call.ast.where), call.verb).toEqual([leaf]);
  });

  it('a middleware-written write form passes through a predicate update, to its write', async () => {
    const { engine, calls } = await bootEngine();
    const leaf = SharedRecordIds.write('srid_doc', 'u1', ['edit']);
    engine.registerMiddleware(async (ctx, next) => {
      if (ctx.ast && ctx.operation === 'update') ctx.ast.where = { $and: [ctx.ast.where ?? {}, { id: { $in: leaf } }] };
      await next();
    }, { object: 'srid_doc' });
    await engine.update('srid_doc', { label: 'z' }, { where: { label: 'keep' }, multi: true, context: ASKER } as any);
    const writes = calls.filter((c) => c.verb === 'updateMany');
    expect(writes).toHaveLength(1);
    expect(leavesIn(writes[0].ast.where)).toEqual([leaf]);
  });

  it('a beforeFind hook that writes the leaf out of position is refused at the boundary, logged once for the engine', async () => {
    const { engine, calls, logger } = await bootEngine();
    engine.registerHook('beforeFind', (ctx: any) => {
      ctx.input.ast.where = { id: SharedRecordIds.read('srid_doc', 'u1') };
    }, { object: 'srid_doc' });
    for (let i = 0; i < 2; i++) {
      expect(envelopeOf(await refusalOf(engine.find('srid_doc', { where: { label: 'keep' } }, { context: ASKER as any })))).toEqual(REFUSED);
    }
    expect(calls).toEqual([]);
    expect(logger.lines.filter((l: { msg: string }) => l.msg.includes('fixed read of')).map((l: { level: string }) => l.level)).toEqual(['error']);
  });

  it('a middleware-written leaf on delete is refused before the pre-image read', async () => {
    const { engine, calls } = await bootEngine();
    engine.registerMiddleware(async (ctx, next) => {
      if (ctx.ast && ctx.operation === 'delete') ctx.ast.where = { id: { $in: SharedRecordIds.write('srid_doc', 'u1', ['edit']) } };
      await next();
    }, { object: 'srid_doc' });
    const err = await refusalOf(engine.delete('srid_doc', { where: { label: 'keep' }, multi: true, context: ASKER } as any));
    expect(envelopeOf(err)).toEqual(REFUSED);
    expect(calls).toEqual([]);
  });
});

describe('[ADR-0155 D1] the comparand door', () => {
  it('an unbranded copy stays a non-list comparand: INVALID_FILTER / 400, as before', async () => {
    const { engine, calls } = await bootEngine();
    const copy = JSON.parse(JSON.stringify(SharedRecordIds.read('srid_doc', 'u1')));
    const err = await refusalOf(engine.find('srid_doc', { where: { id: { $in: copy } } }, { context: ASKER as any }));
    expect(envelopeOf(err)).toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(calls).toEqual([]);
  });

  it('a leaf an array-form where lowers by reference into another position is refused by name, not as a value', async () => {
    const { engine, calls } = await bootEngine();
    const where = [['id', '=', SharedRecordIds.read('srid_doc', 'u1')]] as unknown as FilterCondition;
    const err = await refusalOf(engine.find('srid_doc', { where }, { context: ASKER as any }));
    expect(envelopeOf(err)).toEqual(REFUSED);
    expect(calls).toEqual([]);
  });

  it('a leaf in an aggregation\'s own filter is refused', async () => {
    const { engine, calls } = await bootEngine();
    const filter = { id: { $in: SharedRecordIds.read('srid_doc', 'u1') } } as unknown as FilterCondition;
    const err = await refusalOf(engine.aggregate('srid_doc', {
      aggregations: [{ function: 'count', alias: 'n', filter }],
    }, { context: ASKER as any }));
    expect(envelopeOf(err)).toEqual(REFUSED);
    expect(calls).toEqual([]);
  });
});

describe('[ADR-0155 D4] a refusal at the door is logged on the boundary\'s flag, once per engine', () => {
  const misplaced = () => ({ id: { $nin: SharedRecordIds.read('srid_doc', 'u1') } });
  const errorsIn = (logger: { lines: Array<{ level: string; msg: string }> }) =>
    logger.lines.filter((l) => l.msg.includes('fixed read of')).map((l) => l.level);

  it('a misplaced leaf in a caller\'s where is refused at the door, 500, and two refusals log once at error', async () => {
    const { engine, calls, logger } = await bootEngine();
    for (let i = 0; i < 2; i++) {
      expect(envelopeOf(await refusalOf(engine.find('srid_doc', { where: misplaced() as unknown as FilterCondition }, { context: ASKER as any })))).toEqual(REFUSED);
    }
    expect(calls).toEqual([]);
    expect(errorsIn(logger)).toEqual(['error']);
  });

  it('a refusal at the door and one at the boundary share one log, in either order', async () => {
    const otherRecipient = () => ({ id: { $in: SharedRecordIds.read('srid_doc', 'someone_else') } });
    const door = (engine: ObjectQL) => engine.find('srid_doc', { where: misplaced() as unknown as FilterCondition }, { context: ASKER as any });
    const boundary = (engine: ObjectQL) => engine.find('srid_doc', { where: otherRecipient() as unknown as FilterCondition }, { context: ASKER as any });
    for (const order of [[door, boundary], [boundary, door]]) {
      const { engine, logger } = await bootEngine();
      for (const call of order) expect(envelopeOf(await refusalOf(call(engine)))).toEqual(REFUSED);
      expect(errorsIn(logger)).toEqual(['error']);
    }
  });

  // Every verb's door calls: the lowering of `where` (both branches), and the
  // aggregate's `having` and per-aggregation `filter` doors.
  const DOOR_SITES: Array<[string, (engine: ObjectQL) => Promise<unknown>]> = [
    ['find', (e) => e.find('srid_doc', { where: misplaced() as unknown as FilterCondition }, { context: ASKER as any })],
    ['find, array form', (e) => e.find('srid_doc', { where: [['id', '=', SharedRecordIds.read('srid_doc', 'u1')]] as unknown as FilterCondition }, { context: ASKER as any })],
    ['findOne', (e) => e.findOne('srid_doc', { where: misplaced() as unknown as FilterCondition }, { context: ASKER as any })],
    ['count', (e) => e.count('srid_doc', { where: misplaced() as unknown as FilterCondition }, { context: ASKER as any })],
    ['aggregate where', (e) => e.aggregate('srid_doc', { where: misplaced() as unknown as FilterCondition, aggregations: [{ function: 'count', alias: 'n' }] }, { context: ASKER as any })],
    ['aggregate having', (e) => e.aggregate('srid_doc', { groupBy: ['owner'], having: misplaced() as unknown as FilterCondition, aggregations: [{ function: 'count', alias: 'n' }] }, { context: ASKER as any })],
    ['aggregate filter', (e) => e.aggregate('srid_doc', { aggregations: [{ function: 'count', alias: 'n', filter: misplaced() as unknown as FilterCondition }] }, { context: ASKER as any })],
    ['update', (e) => e.update('srid_doc', { label: 'z' }, { where: misplaced(), multi: true, context: ASKER } as any)],
    ['delete', (e) => e.delete('srid_doc', { where: misplaced(), multi: true, context: ASKER } as any)],
  ];
  for (const [site, call] of DOOR_SITES) {
    it(`the door refusal on ${site} is logged at error once`, async () => {
      const { engine, calls, logger } = await bootEngine();
      for (let i = 0; i < 2; i++) expect(envelopeOf(await refusalOf(call(engine))), site).toEqual(REFUSED);
      expect(calls).toEqual([]);
      expect(errorsIn(logger)).toEqual(['error']);
    });
  }

  it('an unbranded copy stays INVALID_FILTER / 400 and is not logged by this device, nor spends its flag', async () => {
    const { engine, logger } = await bootEngine();
    const copy = JSON.parse(JSON.stringify(SharedRecordIds.read('srid_doc', 'u1')));
    for (let i = 0; i < 2; i++) {
      expect(envelopeOf(await refusalOf(engine.find('srid_doc', { where: { id: { $in: copy } } }, { context: ASKER as any })))).toEqual({ code: 'INVALID_FILTER', status: 400 });
    }
    expect(errorsIn(logger)).toEqual([]);
    expect(logger.lines.filter((l: { level: string }) => l.level === 'error')).toEqual([]);
    expect(envelopeOf(await refusalOf(engine.find('srid_doc', { where: misplaced() as unknown as FilterCondition }, { context: ASKER as any })))).toEqual(REFUSED);
    expect(errorsIn(logger)).toEqual(['error']);
  });
});

describe('[ADR-0155 plan step 5] the seam\'s public face: the recognition an evaluator asks before it compiles', () => {
  it('answers the seam\'s own class, or undefined, reading the engine and calling no driver', async () => {
    const { engine, calls, farCalls } = await bootEngine();
    expect(fixedReadLeafClassOfEngine(engine, SharedRecordIds.read('srid_doc', 'u1'))).toBeUndefined();
    expect(fixedReadLeafClassOfEngine(engine, SharedRecordIds.read('srid_far', 'u1'))).toMatchObject({
      class: 'other-datasource', object: 'srid_far', table: 'sys_record_share',
    });
    engine.registerHook('afterFind', () => {}, { object: 'sys_record_share' });
    expect(fixedReadLeafClassOfEngine(engine, SharedRecordIds.read('srid_doc', 'u1'))).toMatchObject({
      class: 'registration-by-name', table: 'sys_record_share',
    });
    expect(calls).toEqual([]);
    expect(farCalls).toEqual([]);
  });

  it('driverEvaluatesFixedReadLeaf reads the declaration and nothing else', () => {
    expect(driverEvaluatesFixedReadLeaf({ supports: DECLARES }, 'SharedRecordIds')).toBe(true);
    expect(driverEvaluatesFixedReadLeaf({ supports: { readableIdsLeaf: true } }, 'SharedRecordIds')).toBe(false);
    expect(driverEvaluatesFixedReadLeaf(undefined, 'SharedRecordIds')).toBe(false);
  });
});

describe('[ADR-0155 plan step 5, the array-form in / nin decision] D4\'s envelope, never INVALID_FILTER', () => {
  for (const op of ['in', 'nin']) {
    it(`an array-form ${op} carrying the leaf is refused INTERNAL_ERROR / 500, naming no recipient`, async () => {
      const { engine, calls } = await bootEngine();
      const where = [['id', op, SharedRecordIds.read('srid_doc', 'u-secret')]] as unknown as FilterCondition;
      const err = await refusalOf(engine.find('srid_doc', { where }, { context: ASKER as any }));
      expect(envelopeOf(err)).toEqual(REFUSED);
      expect(err?.message).toContain("holds a SharedRecordIds leaf, a fixed read of 'sys_record_share'");
      expect(err?.message).not.toContain('u-secret');
      expect(calls).toEqual([]);
      expect(engine.judgeFilter('srid_doc', where)).toMatchObject({ ok: false, ...REFUSED });
    });
  }
});
