// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The first build of a source and the operator's rebuild (ADR-0161 K7, "What
 * starts a rebuild"; `knowledge-build.ts`, `knowledge-build-actions.ts`).
 *
 * - `readIndexState` reads each state of K7's table from what the adapter
 *   holds, against the fingerprint and recipe hash the service computes.
 * - `buildSourcesAtBoot` builds a never-built source, so a search finds its
 *   rows with no manual step; leaves a built one alone; and two nodes sharing
 *   a cluster lock build it once.
 * - The `rebuild` and `index_status` settings actions start a build and
 *   report its progress and result.
 * - `KnowledgeServicePlugin` runs the boot pass at `kernel:bootstrapped`, in
 *   the background, unless `buildAtBoot: false`.
 * - `reconcileSources` walks every source whose store lists its documents
 *   (trigger `reconcile`), one node per source; the plugin schedules it as a
 *   daily job and asks for it after a predicate write, once the quiet period
 *   passes (ADR-0161 K1).
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import type {
  AdapterContext,
  AdapterEmbeddingDescriptor,
  AdapterIndexStatus,
  IDataEngine,
  IKnowledgeAdapter,
} from '@objectstack/spec/contracts';
import type { KnowledgeDocument, KnowledgeHit, KnowledgeSource } from '@objectstack/spec/ai';
import { KnowledgeService } from '../knowledge-service.js';
import { KnowledgeServicePlugin, reconcileJobOutcome } from '../knowledge-service-plugin.js';
import {
  buildLockKey,
  RECONCILE_DEFAULT_CRON,
  RECONCILE_JOB,
  RECONCILE_MAX_WAIT_MS,
  RECONCILE_QUIET_MS,
  type KnowledgeBuildLock,
  type KnowledgeBuildLockHandle,
} from '../knowledge-build.js';
import { knowledgeIndexStatusActionHandler, knowledgeRebuildActionHandler } from '../knowledge-build-actions.js';
import type { KnowledgeIndexStatusEntry } from '../knowledge-build-actions.js';

type Row = Record<string, unknown>;

const SYSTEM = { executionContext: { positions: [], permissions: [], systemPermissions: [], isSystem: true } };

/** Rows of one object; `find` applies scalar equality, `$and` and `id: { $gt }`, ordered by id. */
function makeEngine(initial: Row[]) {
  const rows = new Map<string, Row>(initial.map((r) => [String(r.id), { ...r }]));
  const matches = (row: Row, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    for (const [key, value] of Object.entries(where)) {
      if (key === '$and') {
        if (!(value as Array<Record<string, unknown>>).every((c) => matches(row, c))) return false;
        continue;
      }
      if (value !== null && typeof value === 'object') {
        const gt = (value as { $gt?: unknown }).$gt;
        if (gt === undefined) throw new Error(`engine double: condition on '${key}' is not implemented`);
        if (!(String(row[key]) > String(gt))) return false;
        continue;
      }
      if (row[key] !== value) return false;
    }
    return true;
  };
  const select = (where?: Record<string, unknown>) =>
    [...rows.values()].filter((r) => matches(r, where)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const find = vi.fn(async (_object: string, query?: { where?: Record<string, unknown>; limit?: number }) => {
    const all = select(query?.where);
    return (typeof query?.limit === 'number' ? all.slice(0, query.limit) : all).map((r) => ({ ...r }));
  });
  const count = vi.fn(async (_object: string, query?: { where?: Record<string, unknown> }) => select(query?.where).length);
  return { rows, find, engine: { find, count } as unknown as IDataEngine };
}

/**
 * An adapter that keeps one generation per source, the way K7 describes: it
 * holds nothing until a write or `beginBuild`, and `completeBuild` records the
 * fingerprint and recipe hash. `members` drops the optional members a case
 * wants absent.
 */
function makeAdapter(opts: { embedding?: AdapterEmbeddingDescriptor; omit?: Array<'indexStatus' | 'listDocuments' | 'completeBuild' | 'beginBuild'> } = {}) {
  const docs = new Map<string, KnowledgeDocument>();
  const held: { fingerprint?: string; recipeHash?: string } = {};
  const calls = { beginBuild: 0, completeBuild: 0, upserted: 0 };
  const adapter: IKnowledgeAdapter = {
    id: 'memory',
    embedding: opts.embedding ?? { model: 'model-a', dimensions: 3 },
    async upsert(batch: KnowledgeDocument[], ctx: AdapterContext) {
      for (const doc of batch) docs.set(doc.id, doc);
      calls.upserted += batch.length;
      if (held.fingerprint === undefined && ctx.index) held.fingerprint = ctx.index.fingerprint;
    },
    async delete(ids: string[]) {
      for (const id of ids) docs.delete(id);
    },
    async search(query: string): Promise<KnowledgeHit[]> {
      return [...docs.values()]
        .filter((doc) => doc.content.includes(query))
        .map((doc) => ({
          chunkId: doc.id,
          documentId: doc.id,
          sourceId: doc.sourceId,
          sourceRecordId: doc.sourceRecordId,
          score: 1,
          snippet: doc.content,
        }));
    },
    async listDocuments(_ctx: AdapterContext, page: { cursor?: string; limit: number }) {
      const all = [...docs.values()].map((d) => ({ documentId: d.id, ...(d.docHash ? { docHash: d.docHash } : {}) }));
      const start = page.cursor === undefined ? 0 : Number(page.cursor);
      const slice = all.slice(start, start + page.limit);
      return { documents: slice, ...(start + page.limit < all.length ? { nextCursor: String(start + page.limit) } : {}) };
    },
    async indexStatus(): Promise<AdapterIndexStatus> {
      return { ...held };
    },
    async beginBuild(ctx: AdapterContext) {
      calls.beginBuild += 1;
      if (held.fingerprint !== ctx.index!.fingerprint) {
        docs.clear();
        held.fingerprint = ctx.index!.fingerprint;
        delete held.recipeHash;
      }
    },
    async completeBuild(ctx: AdapterContext) {
      calls.completeBuild += 1;
      held.fingerprint = ctx.index!.fingerprint;
      held.recipeHash = ctx.index!.recipeHash;
    },
  };
  for (const member of opts.omit ?? []) delete (adapter as unknown as Record<string, unknown>)[member];
  return { adapter, docs, held, calls };
}

function source(overrides: Partial<KnowledgeSource> = {}, where?: Record<string, unknown>): KnowledgeSource {
  return {
    name: 'kb',
    label: 'Knowledge base',
    adapter: 'memory',
    source: { kind: 'object', object: 'kb_article', content: ['title', 'body'], ...(where ? { where } : {}) },
    ...overrides,
  };
}

const ROWS: Row[] = [
  { id: 'a1', title: 'Leave policy', body: 'Twenty days of paid leave' },
  { id: 'a2', title: 'Travel policy', body: 'Economy class under six hours' },
  { id: 'a3', title: 'Expense policy', body: 'Receipts within thirty days' },
];

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeService(engine: IDataEngine | undefined, adapter: IKnowledgeAdapter, extra: { lock?: KnowledgeBuildLock; logger?: ReturnType<typeof makeLogger> } = {}) {
  const logger = extra.logger ?? makeLogger();
  const service = new KnowledgeService({
    dataEngine: engine,
    logger,
    ...(extra.lock ? { resolveBuildLock: () => extra.lock } : {}),
  });
  service.registerAdapter('memory', adapter);
  return { service, logger };
}

/** A cluster lock shared by every "node" of a test: one holder per key, no wait. */
function makeSharedLock() {
  const held = new Set<string>();
  const asked: string[] = [];
  const lock: KnowledgeBuildLock = {
    async acquire(key: string): Promise<KnowledgeBuildLockHandle | null> {
      asked.push(key);
      if (held.has(key)) return null;
      held.add(key);
      let mine = true;
      return {
        async release() { if (mine) { mine = false; held.delete(key); } },
        async renew() { if (!mine) throw new Error('lease lost'); },
        isHeld: () => mine,
      };
    },
  };
  return { lock, held, asked };
}

describe('readIndexState — the states of ADR-0161 K7 "What starts a rebuild"', () => {
  it('a source the adapter holds nothing for is due, and current once built', async () => {
    const db = makeEngine(ROWS);
    const { adapter } = makeAdapter();
    const { service } = makeService(db.engine, adapter);
    service.registerSource(source());

    const before = await service.readIndexState('kb');
    expect(before).toMatchObject({ sourceId: 'kb', state: 'nothing', due: true });

    const record = await service.rebuildSource('kb', { trigger: 'operator' });
    expect(record.status).toBe('done');

    expect(await service.readIndexState('kb')).toMatchObject({ state: 'current', due: false });
  });

  it('another embedding model is a new fingerprint, and is due', async () => {
    const db = makeEngine(ROWS);
    const embedding: AdapterEmbeddingDescriptor = { model: 'model-a', dimensions: 3 };
    const { adapter } = makeAdapter({ embedding });
    const { service } = makeService(db.engine, adapter);
    service.registerSource(source());
    await service.rebuildSource('kb', { trigger: 'operator' });

    embedding.model = 'model-b';
    expect(await service.readIndexState('kb')).toMatchObject({ state: 'new-fingerprint', due: true });
  });

  it("a changed recipe (the source's where) under the same fingerprint is due", async () => {
    const db = makeEngine(ROWS);
    const { adapter } = makeAdapter();
    const { service } = makeService(db.engine, adapter);
    service.registerSource(source());
    await service.rebuildSource('kb', { trigger: 'operator' });

    service.registerSource(source({}, { title: 'Leave policy' }));
    expect(await service.readIndexState('kb')).toMatchObject({ state: 'recipe-changed', due: true });
  });

  it('no recorded recipe hash is due when the adapter can record one, and is not when it cannot', async () => {
    const db = makeEngine(ROWS);
    const withComplete = makeAdapter();
    const a = makeService(db.engine, withComplete.adapter);
    a.service.registerSource(source());
    await a.service.reindexSource('kb', { limit: 1 }); // a partial walk: writes, records nothing
    expect(withComplete.held.recipeHash).toBeUndefined();
    expect(await a.service.readIndexState('kb')).toMatchObject({ state: 'no-recipe-hash', due: true });

    const without = makeAdapter({ omit: ['completeBuild'] });
    const b = makeService(db.engine, without.adapter);
    b.service.registerSource(source());
    await b.service.reindexSource('kb', { limit: 1 });
    const reading = await b.service.readIndexState('kb');
    expect(reading).toMatchObject({ state: 'no-recipe-hash', due: false });
  });

  it('without indexStatus, an empty listing is due and a non-empty one is not', async () => {
    const db = makeEngine(ROWS);
    const { adapter } = makeAdapter({ omit: ['indexStatus'] });
    const { service } = makeService(db.engine, adapter);
    service.registerSource(source());
    expect(await service.readIndexState('kb')).toMatchObject({ state: 'listed-empty', due: true });
    await service.rebuildSource('kb', { trigger: 'operator' });
    expect(await service.readIndexState('kb')).toMatchObject({ state: 'listed-documents', due: false });
  });

  it('with neither indexStatus nor listDocuments nothing is due, and the operator rebuild is named', async () => {
    const db = makeEngine(ROWS);
    const { adapter } = makeAdapter({ omit: ['indexStatus', 'listDocuments'] });
    const { service } = makeService(db.engine, adapter);
    service.registerSource(source());
    const reading = await service.readIndexState('kb');
    expect(reading).toMatchObject({ state: 'unknown', due: false });
    expect(reading.detail).toContain('os knowledge rebuild');
  });

  it('a failed read is unreadable and not due', async () => {
    const db = makeEngine(ROWS);
    const { adapter } = makeAdapter();
    adapter.indexStatus = async () => { throw new Error('store offline'); };
    const { service } = makeService(db.engine, adapter);
    service.registerSource(source());

    const reading = await service.readIndexState('kb');
    expect(reading).toMatchObject({ state: 'unreadable', due: false });
    expect(reading.detail).toContain('store offline');
  });

  it('a first build that opened a generation and never completed it reads as nothing built, not another fingerprint', async () => {
    const db = makeEngine(ROWS);
    const { adapter } = makeAdapter();
    // What a store answers after a builder crashed inside its first build:
    // a generation under construction, and no active one.
    adapter.indexStatus = async () => ({ building: true });
    const { service } = makeService(db.engine, adapter);
    service.registerSource(source());

    expect(await service.readIndexState('kb')).toMatchObject({ state: 'nothing', due: true, held: { building: true } });
  });
});

describe('buildSourcesAtBoot — the first build', () => {
  it('resolves, and says so at warn, when the sources cannot even be listed', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter();
    const { service, logger } = makeService(db.engine, adapter);
    service.registerSource(source());
    vi.spyOn((service as unknown as { registry: { entries(): unknown[] } }).registry, 'entries').mockImplementation(() => { throw new Error('registry torn down'); });

    await expect(service.buildSourcesAtBoot()).resolves.toBeUndefined();
    expect(calls.upserted).toBe(0);
    expect(logger.warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes('registry torn down'))).toBe(true);
  });

  it('a fresh deployment with one source and existing rows: after the boot pass, search finds them', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter();
    const { service, logger } = makeService(db.engine, adapter);
    service.registerSource(source());

    expect(await service.search('Twenty days', SYSTEM)).toHaveLength(0);
    await service.buildSourcesAtBoot();

    const hits = await service.search('Twenty days', SYSTEM);
    expect(hits.map((h) => h.sourceRecordId)).toEqual(['a1']);
    expect(calls).toMatchObject({ beginBuild: 1, completeBuild: 1, upserted: 3 });
    expect(service.buildRecord('kb')).toMatchObject({
      trigger: 'boot',
      status: 'done',
      progress: { discovered: 3, indexed: 3, skipped: 0, failed: 0 },
      result: { ok: true, discovered: 3, indexed: 3 },
    });
    // The start line states the cost.
    const lines = logger.info.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("build of source 'kb' (boot) started") && l.includes('embedding provider'))).toBe(true);
    expect(lines.some((l) => l.includes("build of source 'kb' (boot) finished"))).toBe(true);
  });

  it('a source already built is not rebuilt at the next boot', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter();
    const first = makeService(db.engine, adapter);
    first.service.registerSource(source());
    await first.service.buildSourcesAtBoot();
    expect(calls.beginBuild).toBe(1);

    // The next boot: a new service over the same store.
    const second = makeService(db.engine, adapter);
    second.service.registerSource(source());
    await second.service.buildSourcesAtBoot();
    expect(calls).toMatchObject({ beginBuild: 1, completeBuild: 1, upserted: 3 });
    expect(second.service.buildRecord('kb')).toBeUndefined();
  });

  it('two nodes booting together over one store and one cluster lock build the source once', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter();
    const shared = makeSharedLock();
    const nodeA = makeService(db.engine, adapter, { lock: shared.lock });
    const nodeB = makeService(db.engine, adapter, { lock: shared.lock });
    nodeA.service.registerSource(source());
    nodeB.service.registerSource(source());

    await Promise.all([nodeA.service.buildSourcesAtBoot(), nodeB.service.buildSourcesAtBoot()]);

    expect(calls).toMatchObject({ beginBuild: 1, completeBuild: 1, upserted: 3 });
    const statuses = [nodeA.service.buildRecord('kb')?.status, nodeB.service.buildRecord('kb')?.status].sort();
    expect(statuses).toEqual(['done', 'not-run']);
    expect(shared.asked.every((k) => k === buildLockKey('kb'))).toBe(true);
    expect(shared.held.size).toBe(0); // released
  });

  it('a node that takes the lock after another finished re-reads the store and builds nothing', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter();
    const shared = makeSharedLock();
    const nodeA = makeService(db.engine, adapter, { lock: shared.lock });
    const nodeB = makeService(db.engine, adapter, { lock: shared.lock });
    nodeA.service.registerSource(source());
    nodeB.service.registerSource(source());

    await nodeA.service.rebuildSource('kb', { trigger: 'boot' });
    const late = await nodeB.service.rebuildSource('kb', { trigger: 'boot' });
    expect(late).toMatchObject({ status: 'not-run' });
    expect(late.message).toContain('nothing to build');
    expect(calls.beginBuild).toBe(1);
  });

  it('a cluster lock that does not answer starts no build, and says so', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter();
    const lock: KnowledgeBuildLock = { acquire: async () => { throw new Error('redis unreachable'); } };
    const { service, logger } = makeService(db.engine, adapter, { lock });
    service.registerSource(source());

    await service.buildSourcesAtBoot();
    expect(calls.upserted).toBe(0);
    expect(service.buildRecord('kb')).toMatchObject({ status: 'not-run' });
    expect(logger.warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes('redis unreachable'))).toBe(true);
  });

  it('a source naming an unmounted adapter gets exactly one boot log line: the reading, at error', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter();
    const { service, logger } = makeService(db.engine, adapter);
    service.registerSource(source());
    service.registerSource(source({ name: 'docs', adapter: 'pgvector' }));

    // What the plugin does at kernel:bootstrapped: the first-build pass and the reading.
    await service.buildSourcesAtBoot();
    service.reportUnmountedAdapters();

    const lines = (['debug', 'info', 'warn', 'error'] as const).flatMap((level) =>
      logger[level].mock.calls.map((c) => [level, String(c[0])] as const),
    );
    // Registration's own line names the adapter; past it, one line says the source is unservable.
    const boot = lines.filter(([, m]) => m.includes("'docs'"));
    expect(boot).toHaveLength(1);
    expect(boot[0]?.[0]).toBe('error');
    expect(boot[0]?.[1]).toContain("source 'docs' names adapter 'pgvector', which is not mounted");
    // The mounted source is still built by the same pass.
    expect(calls.upserted).toBeGreaterThan(0);
    expect(service.buildRecord('kb')).toMatchObject({ status: 'done' });
  });

  it('[ADR-0161 K4] a source that names no adapter is built at boot on the one it is placed on; one that cannot be placed is left to the reading', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter();
    const { service } = makeService(db.engine, adapter);
    const { adapter: other } = makeAdapter();
    const { adapter: unnamed } = makeAdapter();
    service.registerSource(source({ adapter: undefined }));

    await service.buildSourcesAtBoot();
    expect(service.adapterIdFor(service.describeSources()[0]!.source)).toBe('memory');
    expect(service.buildRecord('kb')).toMatchObject({ trigger: 'boot', status: 'done', result: { ok: true, indexed: 3 } });
    expect(calls.upserted).toBe(3);

    // A second node where two adapters arrived after the source and none is the deployment's:
    // the pass builds nothing for it, and the reading names it.
    const second = makeService(db.engine, other);
    second.service.registerSource(source({ adapter: undefined }));
    second.service.registerAdapter('app_store', unnamed);
    await second.service.buildSourcesAtBoot();
    expect(second.service.buildRecord('kb')).toBeUndefined();
    expect(second.service.reportUnmountedAdapters()).toEqual(['kb']);
  });

  it('a source with refresh.onRecordChange: false is left to its external indexer', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter();
    const { service } = makeService(db.engine, adapter);
    service.registerSource(source({ refresh: { onRecordChange: false } }));
    await service.buildSourcesAtBoot();
    expect(calls.upserted).toBe(0);
    expect(service.buildRecord('kb')).toBeUndefined();
  });

  it('a build that does not finish is failed, logged at warn, and leaves the source due', async () => {
    const db = makeEngine(ROWS);
    const { adapter } = makeAdapter();
    adapter.upsert = async () => { throw new Error('provider quota exceeded'); };
    const { service, logger } = makeService(db.engine, adapter);
    service.registerSource(source());

    await service.buildSourcesAtBoot();
    expect(service.buildRecord('kb')).toMatchObject({ status: 'failed', result: { ok: false } });
    expect(logger.warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes('did not finish') && l.includes('provider quota exceeded'))).toBe(true);
    expect(await service.readIndexState('kb')).toMatchObject({ due: true });
  });
});

describe('the rebuild and index_status settings actions', () => {
  const run = (handler: ReturnType<typeof knowledgeRebuildActionHandler>, payload: unknown) =>
    handler({ namespace: 'knowledge', actionId: 'x', values: {}, payload, ctx: {} });

  it('rebuild starts a build of the named source; index_status reports its progress and result', async () => {
    const db = makeEngine(ROWS);
    const { adapter } = makeAdapter();
    const { service } = makeService(db.engine, adapter);
    service.registerSource(source());
    const rebuild = knowledgeRebuildActionHandler(service);
    const status = knowledgeIndexStatusActionHandler(service);

    const before = await run(status, {});
    const beforeEntry = (before.details as { sources: KnowledgeIndexStatusEntry[] }).sources[0];
    expect(beforeEntry).toMatchObject({ id: 'kb', index: { state: 'nothing', due: true }, build: null });

    const started = await run(rebuild, { source: 'kb' });
    expect(started).toMatchObject({ ok: true, details: { source: 'kb', build: { trigger: 'operator', status: 'running' } } });
    expect(started.message).toContain('embedding provider');

    await vi.waitFor(() => expect(service.buildRecord('kb')?.status).toBe('done'));
    const after = await run(status, { source: 'kb' });
    const entry = (after.details as { sources: KnowledgeIndexStatusEntry[] }).sources[0];
    expect(entry).toMatchObject({
      index: { state: 'current', due: false },
      build: { status: 'done', trigger: 'operator', counts: { discovered: 3, indexed: 3, skipped: 0, failed: 0 } },
      failures: { count: 0 },
    });
  });

  it('an operator rebuild walks a current source again, and skips what is unchanged', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter();
    const { service } = makeService(db.engine, adapter);
    service.registerSource(source());
    await service.rebuildSource('kb', { trigger: 'operator' });
    const again = await service.rebuildSource('kb', { trigger: 'operator' });
    expect(again).toMatchObject({ status: 'done', result: { discovered: 3, indexed: 0, skipped: 3 } });
    expect(calls.beginBuild).toBe(2);
  });

  it('a build already running on this node is refused, not doubled', async () => {
    const db = makeEngine(ROWS);
    const { adapter } = makeAdapter();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const upsert = adapter.upsert.bind(adapter);
    adapter.upsert = async (docs, ctx) => { await gate; return upsert(docs, ctx); };
    const { service } = makeService(db.engine, adapter);
    service.registerSource(source());
    const rebuild = knowledgeRebuildActionHandler(service);

    expect(await run(rebuild, { source: 'kb' })).toMatchObject({ ok: true });
    const second = await run(rebuild, { source: 'kb' });
    expect(second).toMatchObject({ ok: false, severity: 'warning' });
    expect(second.message).toContain('already running');
    release();
    await vi.waitFor(() => expect(service.buildRecord('kb')?.status).toBe('done'));
  });

  it('refuses a payload key other than source, a missing source and an unknown one', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter();
    const { service } = makeService(db.engine, adapter);
    service.registerSource(source());
    const rebuild = knowledgeRebuildActionHandler(service);
    const status = knowledgeIndexStatusActionHandler(service);

    const misspelt = await run(rebuild, { sources: 'kb' });
    expect(misspelt).toMatchObject({ ok: false });
    expect(misspelt.message).toContain('sources');
    expect(await run(status, { sourceId: 'kb' })).toMatchObject({ ok: false });
    expect(await run(rebuild, {})).toMatchObject({ ok: false });
    expect(await run(rebuild, { source: 'nope' })).toMatchObject({ ok: false });
    expect(await run(status, { source: 'nope' })).toMatchObject({ ok: false });
    expect(calls.upserted).toBe(0);
  });
});

describe('KnowledgeServicePlugin — the boot pass', () => {
  function makeCtx(engine: IDataEngine, adapter: IKnowledgeAdapter) {
    const hooks = new Map<string, Array<() => Promise<void>>>();
    let service: KnowledgeService | undefined;
    const ctx: any = {
      logger: makeLogger(),
      hook: (name: string, fn: () => Promise<void>) => {
        hooks.set(name, [...(hooks.get(name) ?? []), fn]);
      },
      registerService: (name: string, svc: unknown) => {
        if (name === 'knowledge') service = svc as KnowledgeService;
      },
      getService: (name: string) => {
        if (name === 'objectql') return engine;
        if (name === 'embedder') return { id: 'test-embedder' };
        throw new Error(`[Kernel] Service '${name}' not found`);
      },
    };
    return {
      ctx,
      async boot(plugin: KnowledgeServicePlugin) {
        await plugin.init(ctx);
        service!.registerAdapter('memory', adapter);
        await plugin.start(ctx);
        for (const fn of hooks.get('kernel:ready') ?? []) await fn();
        for (const fn of hooks.get('kernel:bootstrapped') ?? []) await fn();
        return service!;
      },
    };
  }

  it('builds a never-built source after kernel:bootstrapped, without holding the boot', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter();
    const harness = makeCtx(db.engine, adapter);
    const service = await harness.boot(new KnowledgeServicePlugin({ sources: [source()], enableEventSync: false }));
    await vi.waitFor(() => expect(service.buildRecord('kb')?.status).toBe('done'));
    expect(calls.upserted).toBe(3);
    expect((await service.search('Receipts', SYSTEM)).map((h) => h.sourceRecordId)).toEqual(['a3']);
  });

  it('buildAtBoot: false builds nothing', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter();
    const harness = makeCtx(db.engine, adapter);
    const service = await harness.boot(new KnowledgeServicePlugin({ sources: [source()], enableEventSync: false, buildAtBoot: false }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.upserted).toBe(0);
    expect(service.buildRecord('kb')).toBeUndefined();
  });
});

describe('reconcileSources — which sources the reconcile walks (ADR-0161 K1)', () => {
  it('walks a current source again: unchanged documents are skipped, stale ones purged, under trigger reconcile', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls, docs } = makeAdapter();
    const { service } = makeService(db.engine, adapter);
    service.registerSource(source());
    await service.rebuildSource('kb', { trigger: 'boot' });
    expect(await service.readIndexState('kb')).toMatchObject({ state: 'current', due: false });
    db.rows.delete('a2');

    const report = await service.reconcileSources();
    expect(report.sources).toEqual([
      expect.objectContaining({ sourceId: 'kb', record: expect.objectContaining({ trigger: 'reconcile', status: 'done' }) }),
    ]);
    expect(service.buildRecord('kb')).toMatchObject({ trigger: 'reconcile', result: { indexed: 0, skipped: 2, purged: 1 } });
    expect([...docs.keys()].sort()).toEqual(['kb:a1', 'kb:a3']);
    expect(calls.beginBuild).toBe(2);
  });

  it('leaves a source whose adapter does not list its documents, said once at warn naming the operator rebuild', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter({ omit: ['listDocuments'] });
    const { service, logger } = makeService(db.engine, adapter);
    service.registerSource(source());

    const first = await service.reconcileSources();
    await service.reconcileSources();
    expect(first.sources[0]).toMatchObject({ sourceId: 'kb', left: expect.stringContaining('no listDocuments') });
    expect(first.sources[0]?.record).toBeUndefined();
    expect(calls).toMatchObject({ beginBuild: 0, upserted: 0 });
    const said = logger.warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("source 'kb' is not reconciled"));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('os knowledge rebuild');
  });

  it('[ADR-0161 K4] reads the store a source that names no adapter is placed on: one that lists no documents is left, one that does is walked', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter({ omit: ['listDocuments'] });
    const { service } = makeService(db.engine, adapter);
    service.registerSource(source({ adapter: undefined }));
    const report = await service.reconcileSources();
    expect(report.sources[0]).toMatchObject({ sourceId: 'kb', left: expect.stringContaining('no listDocuments') });
    expect(calls).toMatchObject({ beginBuild: 0, upserted: 0 });

    const listing = makeAdapter();
    const walked = makeService(db.engine, listing.adapter);
    walked.service.registerSource(source({ adapter: undefined }));
    await walked.service.reconcileSources();
    expect(walked.service.buildRecord('kb')).toMatchObject({ trigger: 'reconcile', status: 'done' });
    expect(listing.calls.upserted).toBe(3);
  });

  it('leaves a source with refresh.onRecordChange: false to its external indexer', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter();
    const { service, logger } = makeService(db.engine, adapter);
    service.registerSource(source({ refresh: { onRecordChange: false } }));

    const report = await service.reconcileSources();
    expect(report.sources[0]).toMatchObject({ sourceId: 'kb', left: expect.stringContaining('external indexer') });
    expect(calls).toMatchObject({ beginBuild: 0, upserted: 0 });
    expect(service.buildRecord('kb')).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('two nodes over one store and one cluster lock: one reconcile walks, the other records not-run', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter();
    const shared = makeSharedLock();
    const nodeA = makeService(db.engine, adapter, { lock: shared.lock });
    const nodeB = makeService(db.engine, adapter, { lock: shared.lock });
    nodeA.service.registerSource(source());
    nodeB.service.registerSource(source());

    const [a, b] = await Promise.all([nodeA.service.reconcileSources(), nodeB.service.reconcileSources()]);
    const statuses = [a.sources[0]?.record?.status, b.sources[0]?.record?.status].sort();
    expect(statuses).toEqual(['done', 'not-run']);
    expect(calls.beginBuild).toBe(1);
    expect(a.unfinished).toEqual([]);
    expect(b.unfinished).toEqual([]);
    expect(shared.held.size).toBe(0);
  });

  it('a reconcile that loses its lease stops before its next page, and the report names it', async () => {
    const db = makeEngine(ROWS);
    const { adapter, calls } = makeAdapter();
    let held = true;
    const handle: KnowledgeBuildLockHandle = { async release() { held = false; }, async renew() {}, isHeld: () => held };
    const lock: KnowledgeBuildLock = { acquire: async () => handle };
    const upsert = adapter.upsert.bind(adapter);
    adapter.upsert = async (batch, ctx) => {
      await upsert(batch, ctx);
      held = false; // the lease lapses while the first page is written
    };
    const { service } = makeService(db.engine, adapter, { lock });
    service.registerSource(source());

    const report = await service.reconcileSources();
    expect(report.sources[0]?.record).toMatchObject({ trigger: 'reconcile', status: 'lease-lost', result: { ok: false, purged: null } });
    expect(calls.completeBuild).toBe(0);
    expect(report.unfinished).toEqual([expect.objectContaining({ sourceId: 'kb', status: 'lease-lost' })]);
    expect(reconcileJobOutcome(report)).toMatchObject({ outcome: 'degraded', reason: expect.stringContaining('kb (lease-lost') });
  });
});

describe('KnowledgeServicePlugin — the reconcile job and the predicate-write reconcile', () => {
  type Handler = (event: { type: string; object?: string; payload?: unknown; timestamp?: string }) => Promise<void>;

  function makeJobs() {
    const scheduled: Array<{ name: string; schedule: unknown; handler: () => Promise<unknown> }> = [];
    const cancelled: string[] = [];
    const jobs = {
      schedule: vi.fn(async (name: string, schedule: unknown, handler: () => Promise<unknown>) => {
        scheduled.push({ name, schedule, handler });
      }),
      cancel: vi.fn(async (name: string) => { cancelled.push(name); }),
      trigger: vi.fn(async () => undefined),
    };
    return { jobs, scheduled, cancelled };
  }

  function makeCtx(engine: IDataEngine, adapter: IKnowledgeAdapter, extra: { jobs?: unknown } = {}) {
    const hooks = new Map<string, Array<() => Promise<void>>>();
    let service: KnowledgeService | undefined;
    let handler: Handler | undefined;
    const ctx: any = {
      logger: makeLogger(),
      hook: (name: string, fn: () => Promise<void>) => {
        hooks.set(name, [...(hooks.get(name) ?? []), fn]);
      },
      registerService: (name: string, svc: unknown) => {
        if (name === 'knowledge') service = svc as KnowledgeService;
      },
      getService: (name: string) => {
        if (name === 'objectql') return engine;
        if (name === 'embedder') return { id: 'test-embedder' };
        if (name === 'job' && extra.jobs) return extra.jobs;
        if (name === 'realtime') {
          return {
            subscribe: async (_channel: string, h: Handler) => { handler = h; return 'sub-1'; },
            unsubscribe: async () => undefined,
          };
        }
        throw new Error(`[Kernel] Service '${name}' not found`);
      },
    };
    return {
      ctx,
      bulk: (object: string, matched = 10) =>
        handler!({ type: 'data.records.updated', object, payload: { type: 'data.records.updated', object, matched } }),
      async boot(plugin: KnowledgeServicePlugin) {
        await plugin.init(ctx);
        service!.registerAdapter('memory', adapter);
        await plugin.start(ctx);
        for (const fn of hooks.get('kernel:ready') ?? []) await fn();
        for (const fn of hooks.get('kernel:bootstrapped') ?? []) await fn();
        return service!;
      },
    };
  }

  const warned = (ctx: { logger: ReturnType<typeof makeLogger> }) => ctx.logger.warn.mock.calls.map((c) => String(c[0]));

  it('schedules one cron job, daily at 03:00 UTC by default; its run answers completed, and degraded naming a source whose walk failed', async () => {
    const db = makeEngine(ROWS);
    const { adapter } = makeAdapter();
    const { jobs, scheduled, cancelled } = makeJobs();
    const harness = makeCtx(db.engine, adapter, { jobs });
    const plugin = new KnowledgeServicePlugin({ sources: [source()], buildAtBoot: false, enableEventSync: false });
    const service = await harness.boot(plugin);

    expect(scheduled).toEqual([
      { name: RECONCILE_JOB, schedule: { type: 'cron', expression: RECONCILE_DEFAULT_CRON, timezone: 'UTC' }, handler: expect.any(Function) },
    ]);
    expect(RECONCILE_DEFAULT_CRON).toBe('0 3 * * *');
    expect(await scheduled[0]!.handler()).toEqual({ outcome: 'completed' });
    expect(service.buildRecord('kb')).toMatchObject({ trigger: 'reconcile', status: 'done' });

    adapter.upsert = async () => { throw new Error('provider quota exceeded'); };
    db.rows.set('a9', { id: 'a9', title: 'New', body: 'Written without an event' });
    const degraded = (await scheduled[0]!.handler()) as { outcome: string; reason?: string };
    expect(degraded.outcome).toBe('degraded');
    expect(degraded.reason).toContain('kb (failed');
    expect(degraded.reason).toContain('provider quota exceeded');

    await plugin.destroy();
    expect(cancelled).toEqual([RECONCILE_JOB]);
  });

  it('moves the job to the cron and time zone the option names', async () => {
    const db = makeEngine(ROWS);
    const { adapter } = makeAdapter();
    const { jobs, scheduled } = makeJobs();
    const harness = makeCtx(db.engine, adapter, { jobs });
    await harness.boot(new KnowledgeServicePlugin({ buildAtBoot: false, enableEventSync: false, reconcile: { cron: '30 1 * * 0', timezone: 'Asia/Shanghai' } }));
    expect(scheduled.map((s) => s.schedule)).toEqual([{ type: 'cron', expression: '30 1 * * 0', timezone: 'Asia/Shanghai' }]);
  });

  it('reconcile: false schedules nothing', async () => {
    const db = makeEngine(ROWS);
    const { adapter } = makeAdapter();
    const { jobs } = makeJobs();
    const harness = makeCtx(db.engine, adapter, { jobs });
    await harness.boot(new KnowledgeServicePlugin({ buildAtBoot: false, enableEventSync: false, reconcile: false }));
    expect(jobs.schedule).not.toHaveBeenCalled();
    expect(warned(harness.ctx).some((l) => l.includes('job service'))).toBe(false);
  });

  it('no job service is said once at boot, naming the operator rebuild', async () => {
    const db = makeEngine(ROWS);
    const { adapter } = makeAdapter();
    const harness = makeCtx(db.engine, adapter);
    await harness.boot(new KnowledgeServicePlugin({ sources: [source()], buildAtBoot: false, enableEventSync: false }));
    const said = warned(harness.ctx).filter((l) => l.includes('no job service is composed'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('os knowledge rebuild');
  });

  describe('after a predicate write', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function bootBuilt(opts: { reconcile?: false } = {}) {
      const db = makeEngine(ROWS);
      const made = makeAdapter();
      const harness = makeCtx(db.engine, made.adapter);
      const service = await harness.boot(new KnowledgeServicePlugin({ sources: [source()], buildAtBoot: false, ...opts }));
      await service.rebuildSource('kb', { trigger: 'operator' });
      vi.useFakeTimers();
      // A pass queued after every pending one: awaiting it waits for them.
      const settle = async () => { await service.reconcileSources({ sources: [] }); };
      return { db, ...made, harness, service, settle };
    }

    it('ten predicate writes in a row start one reconcile of the source, once the quiet period passes', async () => {
      const { db, calls, docs, harness, service, settle } = await bootBuilt();
      db.rows.delete('a1');
      for (let i = 0; i < 10; i++) {
        await harness.bulk('kb_article');
        await vi.advanceTimersByTimeAsync(10_000);
      }
      // The quiet period counts from the last write: not yet.
      await vi.advanceTimersByTimeAsync(RECONCILE_QUIET_MS - 10_001);
      await settle();
      expect(calls.beginBuild).toBe(1);

      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(calls.beginBuild).toBe(2);
      expect(service.buildRecord('kb')).toMatchObject({ trigger: 'reconcile', status: 'done', result: { purged: 1 } });
      expect(docs.has('kb:a1')).toBe(false);

      await vi.advanceTimersByTimeAsync(RECONCILE_MAX_WAIT_MS);
      await settle();
      expect(calls.beginBuild).toBe(2);

      const said = warned(harness.ctx).filter((l) => l.includes("'kb_article' had a predicate write"));
      expect(said).toHaveLength(10);
      expect(said[0]).toContain('source(s) kb');
      expect(said[0]).toContain('2 minute(s)');
      expect(said[0]).not.toContain('cannot be repaired from the event stream. Retention');
    });

    it('predicate writes that keep arriving start the reconcile at the latest ten minutes after the first', async () => {
      const { calls, harness, settle } = await bootBuilt();
      for (let t = 0; t < RECONCILE_MAX_WAIT_MS; t += 60_000) {
        await harness.bulk('kb_article');
        await vi.advanceTimersByTimeAsync(60_000 - (t + 60_000 >= RECONCILE_MAX_WAIT_MS ? 1 : 0));
      }
      await settle();
      expect(calls.beginBuild).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(calls.beginBuild).toBe(2);
    });

    it('a predicate write on an object no source indexes asks for nothing', async () => {
      const { calls, harness, settle } = await bootBuilt();
      await harness.bulk('invoice');
      await vi.advanceTimersByTimeAsync(RECONCILE_MAX_WAIT_MS);
      await settle();
      expect(calls.beginBuild).toBe(1);
      expect(warned(harness.ctx).some((l) => l.includes("'invoice'"))).toBe(false);
    });

    it('reconcile: false asks for no reconcile and keeps the stale-index warning', async () => {
      const { calls, harness, settle } = await bootBuilt({ reconcile: false });
      await harness.bulk('kb_article');
      await vi.advanceTimersByTimeAsync(RECONCILE_MAX_WAIT_MS);
      await settle();
      expect(calls.beginBuild).toBe(1);
      const said = warned(harness.ctx).filter((l) => l.includes("'kb_article' had a predicate write"));
      expect(said).toHaveLength(1);
      expect(said[0]).toContain('cannot be repaired from the event stream');
    });
  });
});
