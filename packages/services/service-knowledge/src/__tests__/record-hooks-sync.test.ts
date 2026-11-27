// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record sync on a kernel with no `realtime` service: the data engine's
 * after-write hooks are the trigger (`KnowledgeRecordHooks`), driven here
 * through a REAL `ObjectQL` engine — its hook dispatch, its per-row dispatch
 * of a predicate write and its units of work — over an in-test driver.
 *
 * What is pinned:
 *
 * - a create and an update of an indexed object are searchable without a
 *   rebuild, and a user delete de-indexes the row;
 * - the embed is not on the write's response path (a held embedder);
 * - inside a unit of work the sync starts once the unit commits, and never
 *   when it rolls back;
 * - a predicate write is synced row by row;
 * - with a `realtime` service composed, each write is synced exactly once.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import type {
  IKnowledgeAdapter,
  IRealtimeService,
  RealtimeEventHandler,
  RealtimeEventPayload,
} from '@objectstack/spec/contracts';
import type { KnowledgeDocument, KnowledgeHit, KnowledgeSource } from '@objectstack/spec/ai';
import { KnowledgeServicePlugin } from '../knowledge-service-plugin.js';
import type { KnowledgeService } from '../knowledge-service.js';
import type { KnowledgeRecordHooks } from '../knowledge-record-hooks.js';

type Row = Record<string, unknown>;

/**
 * A driver over in-memory maps, with transactions (a snapshot per handle,
 * restored on rollback) and the predicate verbs. `where` is scalar equality
 * and `$and`; any other operator is refused by a throw, so a query this
 * double does not understand turns the suite red instead of answering wrongly.
 */
function makeDriver() {
  let stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string) => stores.get(o) ?? (stores.set(o, new Map()), stores.get(o)!);
  const matches = (row: Row, where: unknown): boolean => {
    if (where === undefined || where === null) return true;
    for (const [key, value] of Object.entries(where as Row)) {
      if (key === '$and') {
        if (!(value as unknown[]).every((clause) => matches(row, clause))) return false;
        continue;
      }
      if (key.startsWith('$') || (value !== null && typeof value === 'object')) {
        throw new Error(`driver double: '${key}' is not implemented`);
      }
      if (row[key] !== value) return false;
    }
    return true;
  };
  const snapshots = new Map<unknown, typeof stores>();
  let n = 0;
  const driver: any = {
    name: 'primary',
    version: '0.0.0',
    supports: { transactions: true },
    rowsOf: (o: string) => Array.from(storeFor(o).values()),
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: any) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      return page.map((r) => ({ ...r }));
    },
    async findOne(o: string, ast: any) { return (await this.find(o, ast))[0] ?? null; },
    async create(o: string, data: Row) {
      const row = { ...data, id: (data.id as string) ?? `${o}_${++n}` };
      storeFor(o).set(String(row.id), row);
      return { ...row };
    },
    async update(o: string, id: string, data: Row) {
      const row = { ...storeFor(o).get(String(id)), ...data, id };
      storeFor(o).set(String(id), row);
      return { ...row };
    },
    async updateMany(o: string, ast: any, data: Row) {
      const hit = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      for (const r of hit) storeFor(o).set(String(r.id), { ...r, ...data });
      return hit.length;
    },
    async delete(o: string, id: string) { return storeFor(o).delete(String(id)); },
    async deleteMany(o: string, ast: any) {
      const hit = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      for (const r of hit) storeFor(o).delete(String(r.id));
      return hit.length;
    },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Row[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() {
      const handle = { trx: snapshots.size + 1 };
      snapshots.set(handle, new Map(Array.from(stores, ([o, s]) => [o, new Map(Array.from(s, ([k, v]) => [k, { ...v }]))])));
      return handle;
    },
    async commit(h: unknown) { snapshots.delete(h); },
    async rollback(h: unknown) { stores = snapshots.get(h) ?? stores; snapshots.delete(h); },
  };
  return driver;
}

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

async function makeEngine() {
  const engine = new ObjectQL({ logger: quiet } as any);
  const driver = makeDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const name of ['kb_article', 'faq']) {
    engine.registry.registerObject({
      name,
      label: name,
      fields: {
        id: { name: 'id', type: 'text', primaryKey: true },
        title: { name: 'title', type: 'text' },
        body: { name: 'body', type: 'text' },
        status: { name: 'status', type: 'text' },
      },
    } as any, '__test__');
  }
  return { engine, driver };
}

/**
 * An embedder whose calls wait until released: `hold()` arms it, the returned
 * function releases every call made since. Unheld, it answers at once.
 */
function makeEmbedder() {
  let gate: Promise<void> | undefined;
  const calls: string[][] = [];
  return {
    calls,
    async embed(texts: string[]): Promise<number[][]> {
      calls.push(texts);
      if (gate) await gate;
      return texts.map(() => [1]);
    },
    hold(): () => void {
      let release!: () => void;
      gate = new Promise<void>((resolve) => { release = resolve; });
      return () => { gate = undefined; release(); };
    },
  };
}

/** An adapter that embeds what it indexes, keeps documents by id and answers a search by substring. */
function makeAdapter(embedder: ReturnType<typeof makeEmbedder>) {
  const docs = new Map<string, KnowledgeDocument>();
  const adapter: IKnowledgeAdapter = {
    id: 'memory',
    upsert: vi.fn(async (batch: KnowledgeDocument[]) => {
      await embedder.embed(batch.map((doc) => doc.content));
      for (const doc of batch) docs.set(doc.id, doc);
    }),
    delete: vi.fn(async (ids: string[]) => {
      for (const id of ids) docs.delete(id);
    }),
    search: vi.fn(async (query: string): Promise<KnowledgeHit[]> =>
      [...docs.values()]
        .filter((doc) => doc.content.includes(query))
        .map((doc) => ({
          chunkId: doc.id,
          documentId: doc.id,
          sourceId: doc.sourceId,
          sourceRecordId: doc.sourceRecordId,
          score: 1,
          snippet: doc.content,
        }))),
  };
  return { adapter, docs };
}

/** A `realtime` service that awaits each subscriber in turn, as the in-memory adapter does. */
function makeRealtime(): IRealtimeService {
  const handlers = new Map<string, RealtimeEventHandler>();
  let n = 0;
  return {
    async publish(event: RealtimeEventPayload) {
      for (const handler of handlers.values()) await handler(event);
    },
    async subscribe(_channel: string, handler: RealtimeEventHandler) {
      const id = `sub-${++n}`;
      handlers.set(id, handler);
      return id;
    },
    async unsubscribe(id: string) {
      handlers.delete(id);
    },
  } as unknown as IRealtimeService;
}

function source(object = 'kb_article', name = 'kb'): KnowledgeSource {
  return {
    name,
    label: name,
    adapter: 'memory',
    source: { kind: 'object', object, content: ['title', 'body'] },
  };
}

const SYSTEM = { executionContext: { positions: [], permissions: [], systemPermissions: [], isSystem: true } };

async function boot(opts: { realtime?: boolean } = {}) {
  const { engine, driver } = await makeEngine();
  const realtime = opts.realtime ? makeRealtime() : undefined;
  if (realtime) engine.setRealtimeService(realtime);
  const hooks = new Map<string, Array<() => unknown>>();
  let service: KnowledgeService | undefined;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx: any = {
    logger,
    hook: (name: string, fn: () => unknown) => {
      hooks.set(name, [...(hooks.get(name) ?? []), fn]);
    },
    registerService: (_name: string, svc: KnowledgeService) => { service = svc; },
    getService: (name: string) => {
      if (name === 'objectql') return engine;
      if (name === 'realtime' && realtime) return realtime;
      throw new Error(`[Kernel] Service '${name}' not found`);
    },
  };
  const plugin = new KnowledgeServicePlugin({ sources: [source()], buildAtBoot: false });
  await plugin.init(ctx);
  await plugin.start(ctx);
  for (const fn of hooks.get('kernel:ready') ?? []) await fn();
  const embedder = makeEmbedder();
  const memory = makeAdapter(embedder);
  service!.registerAdapter('memory', memory.adapter);
  const recordHooks = (plugin as unknown as { recordHooks?: KnowledgeRecordHooks }).recordHooks;
  /** Every sync the hooks started so far has finished (a no-op where the realtime path syncs inline). */
  const settled = async () => { await recordHooks?.settled(); };
  return { engine, driver, plugin, service: service!, embedder, ...memory, logger, recordHooks, settled };
}

async function found(service: KnowledgeService, text: string): Promise<string[]> {
  const hits = await service.search(text, SYSTEM);
  return hits.map((hit) => String(hit.sourceRecordId));
}

describe('record sync without a realtime service: the after-write hooks', () => {
  it('starts on the hooks, and says so once at boot naming the objects', async () => {
    const t = await boot();
    expect(t.recordHooks?.objects()).toEqual(['kb_article']);
    const lines = t.logger.info.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("after-write hooks for [kb_article]"))).toBe(true);
    expect(t.logger.warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes('event sync disabled'))).toBe(false);
  });

  it('a create and an update are searchable without a rebuild', async () => {
    const t = await boot();
    const row = await t.engine.insert('kb_article', { title: 'Leave policy', body: 'Twenty days of paid leave' });
    await t.settled();
    expect(await found(t.service, 'paid leave')).toEqual([String(row.id)]);

    await t.engine.update('kb_article', { body: 'Thirty days of annual leave' }, { where: { id: row.id } } as any);
    await t.settled();
    expect(await found(t.service, 'annual leave')).toEqual([String(row.id)]);
    expect(await found(t.service, 'paid leave')).toEqual([]);
  });

  it('a user delete of an indexed record de-indexes it', async () => {
    const t = await boot();
    const row = await t.engine.insert('kb_article', { title: 'Leave policy', body: 'Twenty days of paid leave' });
    await t.settled();
    expect(t.docs.size).toBe(1);

    await t.engine.delete('kb_article', { where: { id: row.id } } as any);
    await t.settled();
    expect(t.docs.size).toBe(0);
    expect(await found(t.service, 'paid leave')).toEqual([]);
  });

  it("a slow embedder does not delay the write's response", async () => {
    const t = await boot();
    const release = t.embedder.hold();
    const write = t.engine.insert('kb_article', { title: 'Leave policy', body: 'Twenty days of paid leave' });
    const outcome = await Promise.race([
      write.then(() => 'returned' as const),
      new Promise<'held'>((resolve) => setTimeout(() => resolve('held'), 2000)),
    ]);
    expect(outcome).toBe('returned');
    // The embed is under way, and nothing is indexed until it answers.
    await vi.waitFor(() => expect(t.embedder.calls).toHaveLength(1));
    expect(t.docs.size).toBe(0);

    release();
    await t.settled();
    expect(await found(t.service, 'paid leave')).toHaveLength(1);
  });

  it('inside a unit of work the sync starts once the unit commits', async () => {
    const t = await boot();
    const upsert = vi.spyOn(t.service, 'handleRecordUpsert');
    let insideCalls = -1;
    await t.engine.transaction(async () => {
      await t.engine.insert('kb_article', { title: 'Leave policy', body: 'Twenty days of paid leave' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      insideCalls = upsert.mock.calls.length;
    });
    expect(insideCalls).toBe(0);
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    await t.settled();
    expect(await found(t.service, 'paid leave')).toHaveLength(1);
  });

  it('a write whose unit rolls back is never synced', async () => {
    const t = await boot();
    const upsert = vi.spyOn(t.service, 'handleRecordUpsert');
    await expect(t.engine.transaction(async () => {
      await t.engine.insert('kb_article', { title: 'Leave policy', body: 'Twenty days of paid leave' });
      throw new Error('the caller gives up');
    })).rejects.toThrow('the caller gives up');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await t.settled();
    expect(t.driver.rowsOf('kb_article')).toEqual([]);
    expect(upsert).not.toHaveBeenCalled();
    expect(t.docs.size).toBe(0);
  });

  it('a predicate write is synced row by row', async () => {
    const t = await boot();
    const a = await t.engine.insert('kb_article', { title: 'A', body: 'old wording', status: 'live' });
    const b = await t.engine.insert('kb_article', { title: 'B', body: 'old wording', status: 'live' });
    await t.settled();

    await t.engine.update('kb_article', { body: 'new wording' }, { where: { status: 'live' }, multi: true } as any);
    await t.settled();
    expect((await found(t.service, 'new wording')).sort()).toEqual([String(a.id), String(b.id)].sort());
    expect(await found(t.service, 'old wording')).toEqual([]);

    await t.engine.delete('kb_article', { where: { status: 'live' }, multi: true } as any);
    await t.settled();
    expect(t.docs.size).toBe(0);
  });

  it('a source added after boot gets its object hooked', async () => {
    const t = await boot();
    t.service.registerSource(source('faq', 'faq'));
    expect(t.recordHooks?.objects().sort()).toEqual(['faq', 'kb_article']);
    const row = await t.engine.insert('faq', { title: 'Parking', body: 'Visitors park on level two' });
    await t.settled();
    expect(await found(t.service, 'level two')).toEqual([String(row.id)]);
  });

  it('teardown removes the hooks: a later write is not synced', async () => {
    const t = await boot();
    const upsert = vi.spyOn(t.service, 'handleRecordUpsert');
    await t.plugin.destroy();
    await t.engine.insert('kb_article', { title: 'Leave policy', body: 'Twenty days of paid leave' });
    await t.settled();
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('record sync with a realtime service: one trigger, each write synced once', () => {
  it.each([
    ['with a realtime service', true],
    ['without one', false],
  ])('%s, a create, an update and a delete each reach the service once', async (_label, realtime) => {
    const t = await boot({ realtime });
    expect(t.recordHooks === undefined).toBe(realtime);
    const upsert = vi.spyOn(t.service, 'handleRecordUpsert');
    const del = vi.spyOn(t.service, 'handleRecordDelete');

    const row = await t.engine.insert('kb_article', { title: 'Leave policy', body: 'Twenty days of paid leave' });
    await t.settled();
    expect(upsert).toHaveBeenCalledTimes(1);

    await t.engine.update('kb_article', { body: 'Thirty days of annual leave' }, { where: { id: row.id } } as any);
    await t.settled();
    expect(upsert).toHaveBeenCalledTimes(2);

    await t.engine.delete('kb_article', { where: { id: row.id } } as any);
    await t.settled();
    expect(del).toHaveBeenCalledTimes(1);
    expect(t.docs.size).toBe(0);
  });
});
