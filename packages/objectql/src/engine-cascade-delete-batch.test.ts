// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A cascade deletes a relation's children as a BATCH (ruling 6893661036,
 * option F1): one predicate delete per chunk of children, so the chunk runs
 * every child's `beforeDelete`, then ONE set delete, then the `afterDelete`s.
 *
 * Pinned here, on a real {@link ObjectQL} engine over a driver that rolls back
 * for real (a snapshot per transaction) and logs every write it is handed:
 *
 *   - the order (before x N, one `deleteMany` over `id IN (...)`, after x N)
 *     and the per-row context shape: `dispatch.mode` `'per-row'` with its own
 *     `index`, `input.options.multi`, `input.id` and `previous` the child's
 *     own row, and the declared `referentialCascadeDelete` marker on EVERY
 *     per-row context, both phases, grandchildren included;
 *   - chunks of 500 (REFERENCE_PROBE_BATCH);
 *   - realtime keeps one `data.record.deleted` per child (ruling 6893104201
 *     point 1), never the bulk event;
 *   - a refusal anywhere in the batch rolls the whole cascade back (point 2);
 *   - a chunk whose caller-scoped read misses a child it asked for falls back
 *     to today's by-id deletes: today's shape (`'record'`, no `multi`), today's
 *     refusal envelope and rollback, and no batch hook ran first. One cascade
 *     can show both shapes;
 *   - so does a chunk the caller's READ door does not return whole: the read
 *     scope a by-id child delete enforces through its re-read (plugin-security
 *     step 2.7) is not on a nested predicate delete's write scope;
 *   - a driver with no `deleteMany` keeps the by-id path, and so does a cascade
 *     into the organization object, which is deleted by id or not at all.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IRealtimeService, RealtimeEventPayload } from '@objectstack/spec/contracts';
import { ObjectQL } from './engine.js';

type Row = Record<string, unknown>;

function matches(row: Row, where: any): boolean {
  if (!where || typeof where !== 'object') return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === '$and') return (v as any[]).every((w) => matches(row, w));
    if (k === '$or') return (v as any[]).some((w) => matches(row, w));
    if (k.startsWith('$')) return true;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const ops = v as Record<string, unknown>;
      if ('$in' in ops) return (ops.$in as unknown[]).map(String).includes(String(row[k]));
      if ('$nin' in ops) return !(ops.$nin as unknown[]).map(String).includes(String(row[k]));
      if ('$eq' in ops) return String(row[k]) === String(ops.$eq);
      return true;
    }
    return row[k] === v || (row[k] != null && v != null && String(row[k]) === String(v));
  });
}

function makeDriver(opts: { deleteMany?: boolean } = {}) {
  let stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string) => stores.get(o) ?? (stores.set(o, new Map()), stores.get(o)!);
  const snapshots = new Map<unknown, typeof stores>();
  const writes: string[] = [];
  const rolledBack: unknown[] = [];
  let n = 0;
  const driver: any = {
    name: 'primary', version: '0.0.0', supports: {}, writes, rolledBack,
    rowsOf: (o: string) => Array.from(storeFor(o).values()),
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: any) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(o: string, ast: any) { return (await this.find(o, ast))[0] ?? null; },
    async create(o: string, data: Row) {
      const row = { ...data, id: (data.id as string) ?? `${o}_${++n}` };
      storeFor(o).set(String(row.id), row);
      return row;
    },
    async update(o: string, id: string, data: Row) {
      const row = { ...storeFor(o).get(String(id)), ...data, id };
      storeFor(o).set(String(id), row);
      return row;
    },
    async delete(o: string, id: string) {
      writes.push(`delete ${o} ${id}`);
      return storeFor(o).delete(String(id));
    },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Row[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() {
      const handle = { trx: snapshots.size + 1 };
      snapshots.set(handle, new Map(Array.from(stores, ([o, s]) => [o, new Map(Array.from(s, ([k, v]) => [k, { ...v }]))])));
      return handle;
    },
    async commit(h: unknown) { snapshots.delete(h); },
    async rollback(h: unknown) { stores = snapshots.get(h) ?? stores; rolledBack.push(h); },
  };
  if (opts.deleteMany !== false) {
    driver.deleteMany = async (o: string, ast: any) => {
      const doomed = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      writes.push(`deleteMany ${o} ${doomed.map((r) => r.id).join(',')}`);
      for (const r of doomed) storeFor(o).delete(String(r.id));
      return doomed.length;
    };
  }
  return driver;
}

const text = (name: string) => ({ name, type: 'text' });

async function makeEngine(opts: { deleteMany?: boolean; lines?: number; parentLookup?: boolean } = {}) {
  const log = () => {};
  const engine = new ObjectQL({ logger: { debug: log, info: log, warn: log, error: log } } as any);
  const driver = makeDriver(opts);
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: 'acct', label: 'acct',
    fields: {
      id: { ...text('id'), primaryKey: true }, name: text('name'),
      // A `set_null` relation into `acct` on `acct` itself, so the walk meets
      // it before `line`.
      ...(opts.parentLookup ? { parent: { name: 'parent', type: 'lookup', reference: 'acct', deleteBehavior: 'set_null' } } : {}),
    },
  } as any, '__test__');
  engine.registry.registerObject({
    name: 'line', label: 'line',
    fields: {
      id: { ...text('id'), primaryKey: true }, name: text('name'),
      acct: { name: 'acct', type: 'master_detail', reference: 'acct' },
    },
  } as any, '__test__');
  engine.registry.registerObject({
    name: 'line_note', label: 'line_note',
    fields: {
      id: { ...text('id'), primaryKey: true }, body: text('body'),
      line: { name: 'line', type: 'master_detail', reference: 'line' },
    },
  } as any, '__test__');
  engine.registry.registerObject({
    name: 'memo', label: 'memo',
    fields: {
      id: { ...text('id'), primaryKey: true }, body: text('body'),
      acct: { name: 'acct', type: 'master_detail', reference: 'acct' },
    },
  } as any, '__test__');
  await engine.insert('acct', { id: 'a1', name: 'A' });
  const count = opts.lines ?? 3;
  for (let i = 1; i <= count; i++) await engine.insert('line', { id: `l${i}`, name: `L${i}`, acct: 'a1' });
  driver.writes.length = 0;
  return { engine, driver };
}

type Seen = {
  object: string; event: string; id: unknown; mode: unknown; index: unknown; multi: unknown;
  marker: unknown; previousId: unknown;
};
function listen(engine: ObjectQL, seen: Seen[], object: string, events = ['beforeDelete', 'afterDelete']) {
  for (const event of events) {
    engine.on(event, object, (ctx: any) => {
      seen.push({
        object: ctx.object, event: ctx.event, id: ctx.input?.id,
        mode: ctx.dispatch?.mode, index: ctx.dispatch?.index,
        multi: ctx.input?.options?.multi,
        marker: ctx.referentialCascadeDelete,
        previousId: ctx.previous?.id,
      });
    });
  }
}

const ids = (rows: Row[]) => rows.map((r) => r.id).sort();
const CALLER = { userId: 'u1', isSystem: true };

describe('[F1] a cascade deletes a relation\'s children as one batch per chunk', () => {
  it('runs every child\'s beforeDelete, then ONE set delete, then the afterDeletes, on the per-row shape, all marked', async () => {
    const { engine, driver } = await makeEngine();
    const seen: Seen[] = [];
    listen(engine, seen, 'line');
    const order: string[] = [];
    engine.on('beforeDelete', 'line', (ctx: any) => { order.push(`before ${ctx.input.id} writes=${driver.writes.length}`); });
    engine.on('afterDelete', 'line', (ctx: any) => { order.push(`after ${ctx.input.id} writes=${driver.writes.length}`); });

    await engine.delete('acct', { where: { id: 'a1' }, context: { ...CALLER } });

    // Every before ran with nothing written; ONE set delete; then every after.
    expect(order).toEqual([
      'before l1 writes=0', 'before l2 writes=0', 'before l3 writes=0',
      'after l1 writes=1', 'after l2 writes=1', 'after l3 writes=1',
    ]);
    expect(driver.writes).toEqual(['deleteMany line l1,l2,l3', 'delete acct a1']);

    expect(seen.map((s) => `${s.event} ${String(s.id)}`)).toEqual([
      'beforeDelete l1', 'beforeDelete l2', 'beforeDelete l3',
      'afterDelete l1', 'afterDelete l2', 'afterDelete l3',
    ]);
    for (const s of seen) {
      expect(s.mode, 'a cascaded child is one of N dispatches of one write').toBe('per-row');
      expect(s.multi, 'and its options say so').toBe(true);
      expect(s.marker, 'the declared cascade marker on every per-row context').toBe(true);
      expect(s.previousId, 'previous is the child\'s own row').toBe(s.id);
    }
    expect(seen.filter((s) => s.event === 'beforeDelete').map((s) => s.index)).toEqual([0, 1, 2]);
    expect(seen.filter((s) => s.event === 'afterDelete').map((s) => s.index)).toEqual([0, 1, 2]);
    expect(ids(driver.rowsOf('line'))).toEqual([]);
    expect(ids(driver.rowsOf('acct'))).toEqual([]);
  });

  it('dispatch.scope is one object for every child of the chunk, both phases; each phase is a fresh context', async () => {
    const probe = async (deleteMany: boolean) => {
      const { engine } = await makeEngine({ deleteMany });
      const scopes: Array<{ event: string; id: string; scope: unknown; stashed: unknown; keyed: unknown }> = [];
      engine.on('beforeDelete', 'line', (ctx: any) => {
        ctx.stashedOnCtx = ctx.input.id;
        ctx.dispatch.scope[`seen:${String(ctx.input.id)}`] = 'before';
        scopes.push({ event: 'before', id: String(ctx.input.id), scope: ctx.dispatch.scope, stashed: undefined, keyed: undefined });
      });
      engine.on('afterDelete', 'line', (ctx: any) => {
        scopes.push({
          event: 'after', id: String(ctx.input.id), scope: ctx.dispatch.scope,
          stashed: ctx.stashedOnCtx, keyed: ctx.dispatch.scope[`seen:${String(ctx.input.id)}`],
        });
      });
      await engine.delete('acct', { where: { id: 'a1' }, context: { ...CALLER } });
      return scopes;
    };

    // Batched: ONE scope object across the chunk's six dispatches; a value
    // left on ctx in beforeDelete does not reach that child's afterDelete,
    // and the remedy (keep it in dispatch.scope keyed by input.id) does.
    const batched = await probe(true);
    expect(batched).toHaveLength(6);
    expect(new Set(batched.map((s) => s.scope)).size).toBe(1);
    for (const s of batched.filter((x) => x.event === 'after')) {
      expect(s.stashed, `${s.id}: a ctx stash does not cross phases on a per-row dispatch`).toBeUndefined();
      expect(s.keyed, `${s.id}: dispatch.scope keyed by input.id does`).toBe('before');
    }

    // Control, today's by-id shape: one scope per child, the same context in
    // both phases, so the ctx stash arrives.
    const byId = await probe(false);
    expect(new Set(byId.map((s) => s.scope)).size).toBe(3);
    for (const s of byId.filter((x) => x.event === 'after')) {
      expect(s.stashed).toBe(s.id);
      expect(s.scope).toBe(byId.find((x) => x.event === 'before' && x.id === s.id)!.scope);
    }
  });

  it('a before-delete hook counting remaining siblings now sees them all present', async () => {
    const { engine } = await makeEngine();
    const remaining: number[] = [];
    engine.on('beforeDelete', 'line', async () => {
      remaining.push((await engine.find('line', { where: { acct: 'a1' } })).length);
    });
    await engine.delete('acct', { where: { id: 'a1' }, context: { ...CALLER } });
    // The per-child walk saw 3, 2, 1: the one real behaviour flip the ruling names.
    expect(remaining).toEqual([3, 3, 3]);
  });

  it('grandchildren are batched too, inside the child batch\'s own walk, and marked', async () => {
    const { engine, driver } = await makeEngine();
    await engine.insert('line_note', { id: 'n1', body: 'x', line: 'l1' });
    await engine.insert('line_note', { id: 'n2', body: 'y', line: 'l2' });
    driver.writes.length = 0;
    const seen: Seen[] = [];
    listen(engine, seen, 'line_note');

    await engine.delete('acct', { where: { id: 'a1' }, context: { ...CALLER } });

    expect(driver.writes).toEqual(['deleteMany line_note n1,n2', 'deleteMany line l1,l2,l3', 'delete acct a1']);
    expect(seen.map((s) => `${s.event} ${String(s.id)} ${String(s.mode)} ${String(s.marker)}`)).toEqual([
      'beforeDelete n1 per-row true', 'beforeDelete n2 per-row true',
      'afterDelete n1 per-row true', 'afterDelete n2 per-row true',
    ]);
  });

  it('chunks of 500: 501 children are two set deletes', async () => {
    const { engine, driver } = await makeEngine({ lines: 501 });
    await engine.delete('acct', { where: { id: 'a1' }, context: { ...CALLER } });
    const sets = driver.writes.filter((w: string) => w.startsWith('deleteMany line'));
    expect(sets.map((w: string) => w.split(' ')[2].split(',').length)).toEqual([500, 1]);
    expect(driver.rowsOf('line')).toEqual([]);
  });

  it('realtime keeps one data.record.deleted per child, never the bulk event', async () => {
    const { engine } = await makeEngine();
    const published: RealtimeEventPayload[] = [];
    const realtime: IRealtimeService = {
      publish: vi.fn(async (event: RealtimeEventPayload) => { published.push(event); }),
      subscribe: vi.fn(async () => 'sub-1'),
      unsubscribe: vi.fn(async () => undefined),
    } as any;
    engine.setRealtimeService(realtime);

    await engine.delete('acct', { where: { id: 'a1' }, context: { ...CALLER } });

    const lines = published.filter((e) => e.object === 'line');
    expect(lines.map((e) => e.type)).toEqual(['data.record.deleted', 'data.record.deleted', 'data.record.deleted']);
    expect(lines.map((e) => (e.payload as any).recordId)).toEqual(['l1', 'l2', 'l3']);
    expect(published.some((e) => e.type === 'data.records.deleted')).toBe(false);
  });

  it('a refusal in the batch\'s before phase rolls the whole cascade back, the caller meets it unchanged', async () => {
    const { engine, driver } = await makeEngine();
    engine.on('beforeDelete', 'line', (ctx: any) => {
      if (ctx.input.id === 'l2') throw Object.assign(new Error('l2 is frozen'), { code: 'PERMISSION_DENIED', status: 403 });
    });
    const err: any = await engine.delete('acct', { where: { id: 'a1' }, context: { ...CALLER } }).then(() => null, (e: unknown) => e);
    expect(err?.code).toBe('PERMISSION_DENIED');
    expect(err?.status).toBe(403);
    expect(driver.writes).toEqual([]);
    expect(ids(driver.rowsOf('line'))).toEqual(['l1', 'l2', 'l3']);
    expect(ids(driver.rowsOf('acct'))).toEqual(['a1']);
  });

  it('a refusal in the batch\'s after phase rolls the set delete back too', async () => {
    const { engine, driver } = await makeEngine();
    engine.on('afterDelete', 'line', (ctx: any) => {
      if (ctx.input.id === 'l3') throw Object.assign(new Error('l3 refused after'), { code: 'PERMISSION_DENIED', status: 403 });
    });
    const err: any = await engine.delete('acct', { where: { id: 'a1' }, context: { ...CALLER } }).then(() => null, (e: unknown) => e);
    expect(err?.code).toBe('PERMISSION_DENIED');
    expect(err?.status).toBe(403);
    expect(driver.rolledBack.length).toBeGreaterThan(0);
    expect(ids(driver.rowsOf('line'))).toEqual(['l1', 'l2', 'l3']);
    expect(ids(driver.rowsOf('acct'))).toEqual(['a1']);
  });
});

/**
 * A scope that NARROWS a predicate delete and REFUSES the by-id delete of the
 * same row, the shape the sharing middleware gives an out-of-scope row.
 */
function narrowAndRefuse(engine: ObjectQL, object: string, hidden: string) {
  const byIdAttempts: unknown[] = [];
  engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    if (opCtx.operation === 'delete' && opCtx.object === object) {
      const id = opCtx.options?.where?.id;
      if (id === hidden) {
        byIdAttempts.push(id);
        throw Object.assign(new Error(`no delete access to ${object}/${hidden}`), { code: 'PERMISSION_DENIED', status: 403 });
      }
      if (opCtx.ast && (id === undefined || typeof id === 'object')) {
        opCtx.ast = { ...opCtx.ast, where: { $and: [opCtx.ast.where ?? {}, { id: { $nin: [hidden] } }] } };
      }
    }
    await next();
  });
  return byIdAttempts;
}

describe('[F1] a chunk the caller\'s scope narrows falls back to today\'s by-id deletes', () => {
  it('today\'s refusal envelope, nothing deleted, and no batch hook ran before the by-id walk', async () => {
    const { engine, driver } = await makeEngine();
    const seen: Seen[] = [];
    listen(engine, seen, 'line');
    const byIdAttempts = narrowAndRefuse(engine, 'line', 'l2');

    const err: any = await engine.delete('acct', { where: { id: 'a1' }, context: { ...CALLER } }).then(() => null, (e: unknown) => e);

    expect(err?.code).toBe('PERMISSION_DENIED');
    expect(err?.status).toBe(403);
    expect(byIdAttempts).toEqual(['l2']);
    // Only by-id dispatches ran: the batch was handed back before its hooks.
    expect(seen.map((s) => `${s.event} ${String(s.id)} ${String(s.mode)}`)).toEqual([
      'beforeDelete l1 record', 'afterDelete l1 record',
    ]);
    expect(ids(driver.rowsOf('line'))).toEqual(['l1', 'l2', 'l3']);
    expect(ids(driver.rowsOf('acct'))).toEqual(['a1']);
  });

  it('a fallback that is allowed keeps today\'s shape, and one cascade shows both shapes', async () => {
    const { engine, driver } = await makeEngine();
    await engine.insert('memo', { id: 'm1', body: 'a', acct: 'a1' });
    await engine.insert('memo', { id: 'm2', body: 'b', acct: 'a1' });
    driver.writes.length = 0;
    // Narrowed for the predicate, ALLOWED by id: the memos fall back.
    engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      if (opCtx.operation === 'delete' && opCtx.object === 'memo' && opCtx.ast) {
        opCtx.ast = { ...opCtx.ast, where: { $and: [opCtx.ast.where ?? {}, { id: { $nin: ['m2'] } }] } };
      }
      await next();
    });
    const seen: Seen[] = [];
    listen(engine, seen, 'line', ['beforeDelete']);
    listen(engine, seen, 'memo', ['beforeDelete']);

    await engine.delete('acct', { where: { id: 'a1' }, context: { ...CALLER } });

    const shapes = seen.map((s) => `${s.object} ${String(s.id)} ${String(s.mode)} multi=${String(s.multi)} marker=${String(s.marker)}`);
    expect(shapes.filter((s) => s.startsWith('line'))).toEqual([
      'line l1 per-row multi=true marker=true', 'line l2 per-row multi=true marker=true', 'line l3 per-row multi=true marker=true',
    ]);
    expect(shapes.filter((s) => s.startsWith('memo'))).toEqual([
      'memo m1 record multi=undefined marker=true', 'memo m2 record multi=undefined marker=true',
    ]);
    expect(driver.writes.filter((w: string) => w.includes('memo'))).toEqual(['delete memo m1', 'delete memo m2']);
    expect(driver.rowsOf('memo')).toEqual([]);
  });

  it('a driver with no deleteMany keeps the by-id path', async () => {
    const { engine, driver } = await makeEngine({ deleteMany: false });
    const seen: Seen[] = [];
    listen(engine, seen, 'line', ['beforeDelete']);
    await engine.delete('acct', { where: { id: 'a1' }, context: { ...CALLER } });
    expect(seen.map((s) => s.mode)).toEqual(['record', 'record', 'record']);
    expect(driver.writes).toEqual(['delete line l1', 'delete line l2', 'delete line l3', 'delete acct a1']);
  });
});

/**
 * A scope that hides a row from the caller's READ door and refuses the by-id
 * delete of it, the shape plugin-security's step 2.7 gives a child a
 * select-class policy hides (its re-read through the read door comes back
 * empty). The write scope of a nested predicate delete does not carry the read
 * scope, so the walk asks the read door before it batches.
 */
function hideFromReadsAndRefuse(engine: ObjectQL, object: string, hidden: string, refuseById: boolean) {
  const byIdAttempts: unknown[] = [];
  engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    if (opCtx.object === object && !opCtx.context?.isSystem) {
      if (opCtx.operation === 'find' && opCtx.ast) {
        opCtx.ast = { ...opCtx.ast, where: { $and: [opCtx.ast.where ?? {}, { id: { $nin: [hidden] } }] } };
      }
      if (opCtx.operation === 'delete' && opCtx.options?.where?.id === hidden) {
        byIdAttempts.push(hidden);
        if (refuseById) {
          throw Object.assign(new Error(`no access to ${object}/${hidden}`), { code: 'PERMISSION_DENIED', status: 403 });
        }
      }
    }
    await next();
  });
  return byIdAttempts;
}

const MEMBER = { userId: 'u1' };

describe('[F1] a chunk the caller\'s READ door narrows falls back to today\'s by-id deletes', () => {
  it('a child the read door hides and the by-id delete refuses: today\'s 403, nothing deleted, no batch hook ran', async () => {
    const { engine, driver } = await makeEngine();
    const seen: Seen[] = [];
    listen(engine, seen, 'line');
    const byIdAttempts = hideFromReadsAndRefuse(engine, 'line', 'l2', true);

    const err: any = await engine.delete('acct', { where: { id: 'a1' }, context: { ...MEMBER } }).then(() => null, (e: unknown) => e);

    expect(err?.code).toBe('PERMISSION_DENIED');
    expect(err?.status).toBe(403);
    expect(byIdAttempts).toEqual(['l2']);
    expect(seen.map((s) => `${s.event} ${String(s.id)} ${String(s.mode)}`)).toEqual([
      'beforeDelete l1 record', 'afterDelete l1 record',
    ]);
    expect(driver.writes.some((w: string) => w.startsWith('deleteMany'))).toBe(false);
    expect(ids(driver.rowsOf('line'))).toEqual(['l1', 'l2', 'l3']);
    expect(ids(driver.rowsOf('acct'))).toEqual(['a1']);
  });

  it('a child the read door hides and the by-id delete allows: deleted by id, today\'s shape', async () => {
    const { engine, driver } = await makeEngine();
    const seen: Seen[] = [];
    listen(engine, seen, 'line', ['beforeDelete']);
    hideFromReadsAndRefuse(engine, 'line', 'l2', false);

    await engine.delete('acct', { where: { id: 'a1' }, context: { ...MEMBER } });

    expect(seen.map((s) => `${String(s.id)} ${String(s.mode)}`)).toEqual(['l1 record', 'l2 record', 'l3 record']);
    expect(driver.writes).toEqual(['delete line l1', 'delete line l2', 'delete line l3', 'delete acct a1']);
  });

  it('every child the read door returns: batched (control)', async () => {
    const { engine, driver } = await makeEngine();
    hideFromReadsAndRefuse(engine, 'line', 'l_nowhere', true);
    await engine.delete('acct', { where: { id: 'a1' }, context: { ...MEMBER } });
    expect(driver.writes).toEqual(['deleteMany line l1,l2,l3', 'delete acct a1']);
  });
});

describe('[F1] a cascade into the organization object keeps today\'s by-id deletes', () => {
  it('an organization cascaded from its parent is deleted by id, not refused as a predicate delete', async () => {
    const { engine, driver } = await makeEngine();
    engine.registry.registerObject({
      name: 'sys_organization', label: 'Organization',
      fields: {
        id: { ...text('id'), primaryKey: true }, name: text('name'),
        holder: { name: 'holder', type: 'lookup', reference: 'acct', deleteBehavior: 'cascade' },
      },
    } as any, '__test__');
    await driver.create('sys_organization', { id: 'o1', name: 'O1', holder: 'a1' });
    driver.writes.length = 0;
    const seen: Seen[] = [];
    listen(engine, seen, 'sys_organization', ['beforeDelete']);

    await engine.delete('acct', { where: { id: 'a1' }, context: { ...CALLER } });

    expect(seen.map((s) => `${String(s.id)} ${String(s.mode)} marker=${String(s.marker)}`)).toEqual(['o1 record marker=true']);
    expect(driver.writes).toContain('delete sys_organization o1');
    expect(driver.writes.some((w: string) => w.startsWith('deleteMany sys_organization'))).toBe(false);
    expect(driver.rowsOf('sys_organization')).toEqual([]);
  });
});

/**
 * [ruling 6893104201 c1] The deleting walk asks the collection walk's own
 * dependents probe again: same relation, same ids, same system-identity read.
 * Nothing writes between the two, so the walk takes the collection's answer
 * instead of reading again, and only until its own first write: a cascaded
 * child's delete or a `set_null` clear runs hooks, and a hook may write a row
 * the next probe must see.
 *
 * Read off the driver: every read the delete hands it, in order.
 */
describe('[c1] the walk takes the collection\'s probe until its first write', () => {
  /** Every driver read of the delete, as `object where`, in the order it ran. */
  function recordReads(driver: any): string[] {
    const reads: string[] = [];
    const find = driver.find;
    driver.find = async function (o: string, ast: any, ...rest: unknown[]) {
      reads.push(`${o} ${JSON.stringify(ast?.where ?? null)}`);
      return find.call(this, o, ast, ...rest);
    };
    return reads;
  }

  it('reads the first relation\'s dependents once, every other read unchanged', async () => {
    const { engine, driver } = await makeEngine();
    await engine.insert('memo', { id: 'm1', body: 'x', acct: 'a1' });
    driver.writes.length = 0;
    const reads = recordReads(driver);

    await engine.delete('acct', { where: { id: 'a1' }, context: { ...CALLER } });

    // `line` is the first relation into `acct`: probed by the collection
    // walk, then taken by the deleting walk, which goes straight to the line
    // batch's reads. `memo` comes after the line batch wrote, so the walk
    // reads it again, as before. Before c1 a second `line {"acct":"a1"}`
    // stood between the collection's reads and the batch's.
    expect(reads).toEqual([
      'acct {"id":"a1"}',
      // the collection walk
      'line {"acct":"a1"}',
      'memo {"acct":"a1"}',
      'line_note {"line":{"$in":["l1","l2","l3"]}}',
      // the deleting walk: the line batch (no probe of its own)
      'line {"id":{"$in":["l1","l2","l3"]}}',
      'line {"id":{"$in":["l1","l2","l3"]}}',
      'line {"id":{"$in":["l1","l2","l3"]}}',
      'line_note {"line":{"$in":["l1","l2","l3"]}}',
      // after its first write: the memo relation read again, then its batch
      'memo {"acct":"a1"}',
      'memo {"id":{"$in":["m1"]}}',
      'memo {"id":{"$in":["m1"]}}',
    ]);
    expect(reads.filter((r) => r === 'line {"acct":"a1"}')).toHaveLength(1);
    expect(driver.writes).toEqual(['deleteMany line l1,l2,l3', 'deleteMany memo m1', 'delete acct a1']);
  });

  it('a row a child\'s hook writes after the collection is still found by the next relation\'s probe', async () => {
    const { engine, driver } = await makeEngine();
    // The line batch runs before the memo relation is walked; its hook adds a
    // memo the collection walk never saw.
    engine.on('beforeDelete', 'line', async (ctx: any) => {
      if (ctx.input?.id === 'l1') await driver.create('memo', { id: 'm9', body: 'late', acct: 'a1' });
    });

    await engine.delete('acct', { where: { id: 'a1' }, context: { ...CALLER } });

    expect(driver.rowsOf('memo')).toEqual([]);
    expect(driver.writes).toEqual(['deleteMany line l1,l2,l3', 'delete memo m9', 'delete acct a1']);
  });

  it('a row a set_null clear\'s hook writes is still found by the next cascading relation\'s probe', async () => {
    const { engine, driver } = await makeEngine({ parentLookup: true });
    await engine.insert('acct', { id: 'a2', name: 'B', parent: 'a1' });
    // The walk clears `a2.parent` before it reaches `line`, whose probe the
    // collection walk already read; the clear's hook adds a line it never saw.
    engine.on('afterUpdate', 'acct', async (ctx: any) => {
      if (ctx.input?.id === 'a2') await driver.create('line', { id: 'l9', name: 'late', acct: 'a1' });
    });
    driver.writes.length = 0;

    await engine.delete('acct', { where: { id: 'a1' }, context: { ...CALLER } });

    expect(driver.rowsOf('acct')).toEqual([expect.objectContaining({ id: 'a2', parent: null })]);
    expect(driver.rowsOf('line')).toEqual([]);
    // l9 is outside the collected set, so it goes by id, as m9 does above.
    expect(driver.writes).toEqual(['deleteMany line l1,l2,l3', 'delete line l9', 'delete acct a1']);
  });
});
