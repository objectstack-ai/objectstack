// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Each knowledge source's sync state, one durable record per source
 * (`knowledge-sync-state.ts`, `sys_knowledge_sync_state`), on REAL kernels:
 * `ObjectQLPlugin` over a real SQL driver (`SqlDriver`, better-sqlite3 on a
 * file), the platform's `QueueServicePlugin` (its database adapter over
 * `sys_job_queue`) and `KnowledgeServicePlugin`. "Two nodes" are two kernels
 * over the one database file, sharing one store (one adapter object) the way
 * two replicas share pgvector.
 *
 * What is pinned:
 *
 * - a rebuild started through node A is reported identically by
 *   `index_status` on node B while it runs and after it ends, including a
 *   rebuild of an index that was already current; after both restart, the
 *   last build is still reported;
 * - a build whose node stopped mid-walk reads `running` until the next boot
 *   or the next lease holder, then `interrupted`; a boot leaves a build whose
 *   lease another node holds alone;
 * - a dead-lettered record sync raises the source's failure count by one,
 *   with the platform's sentence and both times; a retried sync that
 *   succeeds raises nothing; no row holds a field value, even when the
 *   provider's error text quotes the record;
 * - a completed reconcile clears the failures that preceded it and removes
 *   their dead letters; a failure recorded during its walk survives;
 * - the first failure asks for one reconcile; a hundred ask for one;
 * - every registered source has a row, removing a source removes it, and the
 *   object and its Setup entry are the platform administrator's, written by
 *   the service alone.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { QueueServicePlugin, type DbQueueAdapter } from '@objectstack/service-queue';
import { SysKnowledgeSyncState } from '@objectstack/platform-objects/system';
import { resolveCrudAffordances, resolveEffectiveApiMethods } from '@objectstack/spec/data';
import type { AdapterContext, AdapterIndexStatus, IKnowledgeAdapter } from '@objectstack/spec/contracts';
import type { KnowledgeDocument, KnowledgeHit, KnowledgeSource } from '@objectstack/spec/ai';
import {
  KnowledgeServicePlugin,
  knowledgeSyncStateNavItem,
  type KnowledgeServicePluginOptions,
} from '../knowledge-service-plugin.js';
import type { KnowledgeService } from '../knowledge-service.js';
import { KNOWLEDGE_RECORD_SYNC_QUEUE } from '../knowledge-record-sync-queue.js';
import { KNOWLEDGE_SYNC_STATE_OBJECT } from '../knowledge-sync-state.js';
import { buildLockKey, type KnowledgeBuildLock, type KnowledgeBuildLockHandle } from '../knowledge-build.js';
import {
  knowledgeIndexStatusActionHandler,
  knowledgeRebuildActionHandler,
  type KnowledgeIndexStatusEntry,
} from '../knowledge-build-actions.js';

type Row = Record<string, unknown>;

const SYSTEM = { isSystem: true, positions: [], permissions: [], systemPermissions: [] } as never;

/** A short retry budget, so a test sees a dead letter in milliseconds. */
const FAST_RETRY = { maxAttempts: 2, backoffMs: 10, maxBackoffMs: 20 };

const KB_ARTICLE = {
  name: 'kb_article',
  label: 'KB article',
  fields: {
    title: { name: 'title', type: 'text', label: 'Title' },
    body: { name: 'body', type: 'textarea', label: 'Body' },
    status: { name: 'status', type: 'text', label: 'Status' },
  },
};

function source(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    name: 'kb',
    label: 'kb',
    adapter: 'memory',
    source: { kind: 'object', object: 'kb_article', content: ['title', 'body'], where: { status: 'published' } },
    ...overrides,
  } as KnowledgeSource;
}

/** A held gate: `wait()` blocks until `release()`. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => { release = resolve; });
  return { wait: () => opened, release };
}

/**
 * One store shared by every node of a test: it keeps documents, a generation
 * (fingerprint and recipe hash, recorded by `completeBuild`), and lists its
 * documents. `holdBegin()` holds the next build at `beginBuild`; `failUpserts`
 * makes every write fail with a provider message that QUOTES the document it
 * was handed; `failDeletesOf` fails the removal of the named records.
 */
function makeStore() {
  const docs = new Map<string, KnowledgeDocument>();
  const held: { fingerprint?: string; recipeHash?: string } = {};
  const state = { failUpserts: false, failDeletesOf: new Set<string>(), begin: undefined as ReturnType<typeof gate> | undefined, begins: 0 };
  const adapter: IKnowledgeAdapter = {
    id: 'memory',
    embedding: { model: 'model-a', dimensions: 3 },
    async upsert(batch: KnowledgeDocument[], ctx: AdapterContext) {
      if (state.failUpserts) {
        throw new Error(`the embedding provider refused the input: "${batch[0]?.content ?? ''}" is not allowed`);
      }
      for (const doc of batch) docs.set(doc.id, doc);
      if (held.fingerprint === undefined && ctx.index) held.fingerprint = ctx.index.fingerprint;
    },
    async delete(ids: string[]) {
      for (const id of ids) {
        const recordId = id.split(':').pop()!;
        if (state.failDeletesOf.has(recordId)) throw Object.assign(new Error(`the store refused to remove ${id}`), { status: 503 });
      }
      for (const id of ids) docs.delete(id);
    },
    async search(query: string): Promise<KnowledgeHit[]> {
      return [...docs.values()]
        .filter((doc) => doc.content.includes(query))
        .map((doc) => ({ chunkId: doc.id, documentId: doc.id, sourceId: doc.sourceId, sourceRecordId: doc.sourceRecordId, score: 1, snippet: doc.content }));
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
      state.begins += 1;
      const hold = state.begin;
      state.begin = undefined;
      if (hold) await hold.wait();
      if (held.fingerprint !== ctx.index!.fingerprint) {
        docs.clear();
        held.fingerprint = ctx.index!.fingerprint;
        delete held.recipeHash;
      }
    },
    async completeBuild(ctx: AdapterContext) {
      held.fingerprint = ctx.index!.fingerprint;
      held.recipeHash = ctx.index!.recipeHash;
    },
  };
  return {
    adapter,
    docs,
    state,
    /** Hold the next build at its `beginBuild`; answers the release. */
    holdBegin(): () => void {
      const g = gate();
      state.begin = g;
      return g.release;
    },
  };
}

/** A cluster lock shared by the nodes of a test; `expire(key)` is a lease that ran out (its holder died). */
function makeSharedLock() {
  const held = new Map<string, symbol>();
  const lock: KnowledgeBuildLock = {
    async acquire(key: string): Promise<KnowledgeBuildLockHandle | null> {
      if (held.has(key)) return null;
      const token = Symbol(key);
      held.set(key, token);
      const mine = () => held.get(key) === token;
      return {
        async release() { if (mine()) held.delete(key); },
        async renew() { if (!mine()) throw new Error('lease lost'); },
        isHeld: mine,
      };
    },
  };
  return { lock, held, expire: (key: string) => held.delete(key) };
}

function hostPlugin(file: string, adapter: IKnowledgeAdapter, cluster?: KnowledgeBuildLock): Plugin {
  return {
    name: 'test.knowledge-sync-state-host',
    version: '1.0.0',
    type: 'standard',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
      await driver.connect();
      ctx.registerService('driver.default', driver);
      ctx.getService<ObjectQL>('objectql').registry.registerObject(KB_ARTICLE as never, 'test.knowledge-sync-state-host');
      if (cluster) ctx.registerService('cluster', { lock: cluster });
    },
    async start(ctx: PluginContext) {
      ctx.getService<KnowledgeService>('knowledge').registerAdapter('memory', adapter);
    },
  } as unknown as Plugin;
}

/** A `single` install's Default Organization, seeded through the driver (the NOT NULL tenant column of `kb_article`). */
async function installDefaultOrganization(ql: ObjectQL): Promise<void> {
  if (!ql.getSchema('sys_organization')) {
    ql.registry.registerObject(
      { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } } as never,
      'test.knowledge-sync-state-host',
    );
  }
  await ql.syncSchemas();
  const driver = ql.getDriverForObject('sys_organization') as unknown as {
    create(o: string, d: Row): Promise<unknown>;
    findOne(o: string, q: unknown): Promise<unknown>;
  };
  if (await driver.findOne('sys_organization', { where: { id: 'org_default' } })) return;
  await driver.create('sys_organization', { id: 'org_default', name: 'Default' });
}

const kernels: ObjectKernel[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const k of kernels.splice(0)) {
    try { await k.shutdown(); } catch { /* noop */ }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function freshFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-knowledge-sync-state-'));
  dirs.push(dir);
  return join(dir, 'data.db');
}

interface NodeOptions {
  file: string;
  store: ReturnType<typeof makeStore>;
  cluster?: KnowledgeBuildLock;
  knowledge?: KnowledgeServicePluginOptions;
}

/** One node: a kernel over the shared file and the shared store. */
async function bootNode(opts: NodeOptions) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child() { return logger; } };
  const kernel = new ObjectKernel({ logger: { level: 'fatal' }, gracefulShutdown: false } as never);
  kernels.push(kernel);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(hostPlugin(opts.file, opts.store.adapter, opts.cluster));
  await kernel.use(new QueueServicePlugin({ adapter: 'db', db: { pollIntervalMs: 10, maxIdleIntervalMs: 20 } }));
  const knowledge = new KnowledgeServicePlugin({
    sources: [source()],
    buildAtBoot: false,
    reconcile: false,
    recordSyncRetry: FAST_RETRY,
    ...opts.knowledge,
  });
  const plugin = knowledge as unknown as { init(ctx: PluginContext): Promise<void>; start(ctx: PluginContext): Promise<void> };
  const init = plugin.init.bind(knowledge);
  const start = plugin.start.bind(knowledge);
  const withLogger = (ctx: PluginContext): PluginContext =>
    new Proxy(ctx, { get: (target, key) => (key === 'logger' ? logger : Reflect.get(target, key)) });
  plugin.init = (ctx) => init(withLogger(ctx));
  plugin.start = (ctx) => start(withLogger(ctx));
  await kernel.use(knowledge);
  await kernel.bootstrap();

  const ql = kernel.getService<ObjectQL>('objectql');
  await installDefaultOrganization(ql);
  const service = kernel.getService<KnowledgeService>('knowledge');
  const queue = kernel.getService<DbQueueAdapter>('queue');
  const statusHandler = knowledgeIndexStatusActionHandler(service);
  const rebuildHandler = knowledgeRebuildActionHandler(service);
  const call = (handler: typeof statusHandler, payload: unknown) =>
    handler({ namespace: 'knowledge', actionId: 'x', values: {}, payload, ctx: {} } as never);
  const status = async (): Promise<KnowledgeIndexStatusEntry> => {
    const answer = await call(statusHandler, { source: 'kb' });
    expect(answer.ok, answer.message).toBe(true);
    return (answer.details as { sources: KnowledgeIndexStatusEntry[] }).sources[0]!;
  };
  const rebuild = (): ReturnType<typeof rebuildHandler> => call(rebuildHandler, { source: 'kb' });
  /** The stored rows of the sync-state object, read as the system. */
  const stateRows = async (): Promise<Row[]> =>
    (await ql.find(KNOWLEDGE_SYNC_STATE_OBJECT, { context: SYSTEM } as never)) as Row[];
  const queueRows = async (): Promise<Row[]> =>
    (await ql.find('sys_job_queue', { where: { queue: KNOWLEDGE_RECORD_SYNC_QUEUE }, context: SYSTEM } as never)) as Row[];
  const drained = async (rows = 1): Promise<void> => {
    await vi.waitFor(async () => {
      const stored = await queueRows();
      if (stored.length < rows) throw new Error(`${stored.length} of ${rows} record-sync message(s) published`);
      const open = stored.filter((r) => r.status === 'pending' || r.status === 'running');
      if (open.length > 0) throw new Error(`${open.length} record-sync message(s) still open`);
    }, { timeout: 5000, interval: 10 });
  };
  const insert = (data: Row): Promise<Row> => ql.insert('kb_article', data, { context: SYSTEM } as never) as Promise<Row>;
  return { kernel, ql, service, queue, logger, knowledge, status, rebuild, stateRows, queueRows, drained, insert };
}

type Node = Awaited<ReturnType<typeof bootNode>>;

async function stop(node: Node): Promise<void> {
  kernels.splice(kernels.indexOf(node.kernel), 1);
  await node.kernel.shutdown();
}

/** Seed three published articles through node `n` and wait for their syncs. */
async function seedArticles(n: Node): Promise<Row[]> {
  const rows = [
    await n.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' }),
    await n.insert({ title: 'Travel policy', body: 'Economy class under six hours', status: 'published' }),
    await n.insert({ title: 'Expense policy', body: 'Receipts within thirty days', status: 'published' }),
  ];
  await n.drained(3);
  return rows;
}

describe('one record per source, the same on every node', () => {
  it('a rebuild through node A reads identically on node B while it runs and after it ends — an index already current included — and after both restart', async () => {
    const file = freshFile();
    const store = makeStore();
    const a = await bootNode({ file, store });
    const b = await bootNode({ file, store });
    await seedArticles(a);

    // A first rebuild: the index holds the synced documents and no generation.
    let release = store.holdBegin();
    const started = await a.rebuild();
    expect(started).toMatchObject({ ok: true, details: { build: { status: 'running', trigger: 'operator' } } });
    const startedAt = (started.details as { build: { startedAt: string } }).build.startedAt;
    const whileRunning = await b.status();
    expect(whileRunning.build).toMatchObject({ status: 'running', trigger: 'operator', startedAt });
    expect((await a.status()).build).toEqual(whileRunning.build);
    release();
    await vi.waitFor(async () => expect((await b.status()).build?.status).toBe('done'), { timeout: 5000, interval: 20 });
    const ended = await b.status();
    expect(ended.build).toMatchObject({ startedAt, counts: { discovered: 3, failed: 0 } });
    expect(ended.build!.counts.indexed + ended.build!.counts.skipped).toBe(3);
    expect(ended.index.state).toBe('current');
    expect((await b.status()).index.state).toBe('current');
    expect((await a.status()).build).toEqual(ended.build);

    // A rebuild of the index that is already current: every node still sees it.
    release = store.holdBegin();
    const again = await a.rebuild();
    const againAt = (again.details as { build: { startedAt: string } }).build.startedAt;
    expect(againAt).not.toBe(startedAt);
    expect((await b.status()).build).toMatchObject({ status: 'running', startedAt: againAt });
    release();
    await vi.waitFor(async () => expect((await b.status()).build?.status).toBe('done'), { timeout: 5000, interval: 20 });
    const current = (await b.status()).build;
    expect(current).toMatchObject({ startedAt: againAt, counts: { discovered: 3, indexed: 0, skipped: 3 } });
    expect((await a.status()).build).toEqual(current);

    // Both nodes restart: the last build is still reported, by each.
    await stop(a);
    await stop(b);
    const a2 = await bootNode({ file, store });
    const b2 = await bootNode({ file, store });
    expect((await a2.status()).build).toEqual(current);
    expect((await b2.status()).build).toEqual(current);
    expect(await a2.stateRows()).toHaveLength(1);
  });

  it('a build whose node stopped mid-walk reads running until the next boot, then interrupted', async () => {
    const file = freshFile();
    const store = makeStore();
    const a = await bootNode({ file, store });
    await seedArticles(a);
    store.holdBegin(); // never released: the node stops with its build inside the walk
    await a.rebuild();
    expect((await a.status()).build?.status).toBe('running');
    await stop(a);

    const b = await bootNode({ file, store });
    const after = await b.status();
    expect(after.build).toMatchObject({ status: 'interrupted', trigger: 'operator' });
    expect(after.build?.finishedAt).toBeDefined();
    expect(after.build?.message).toContain('stopped before it ended');
  });

  it("over a cluster lock: a boot leaves a build whose lease another node holds; once its lease runs out the next boot or the next lease holder closes it interrupted", async () => {
    const file = freshFile();
    const store = makeStore();
    const cluster = makeSharedLock();
    const a = await bootNode({ file, store, cluster: cluster.lock });
    await seedArticles(a);
    store.holdBegin(); // node A's build never ends
    await a.rebuild();
    const { startedAt } = (await a.status()).build!;

    // A booting node meets the lease held: the build may be live, it is left alone.
    const b = await bootNode({ file, store, cluster: cluster.lock });
    expect((await b.status()).build).toMatchObject({ status: 'running', startedAt });

    // Node A dies: its lease runs out. The next boot takes it and closes the build.
    cluster.expire(buildLockKey('kb'));
    const c = await bootNode({ file, store, cluster: cluster.lock });
    expect((await c.status()).build).toMatchObject({ status: 'interrupted', startedAt });
    expect((await b.status()).build).toMatchObject({ status: 'interrupted', startedAt });
    expect(cluster.held.size).toBe(0);
  });

  it('the next lease holder closes the build a stopped node left running before it starts its own', async () => {
    const file = freshFile();
    const store = makeStore();
    const cluster = makeSharedLock();
    const a = await bootNode({ file, store, cluster: cluster.lock });
    const b = await bootNode({ file, store, cluster: cluster.lock });
    await seedArticles(a);
    store.holdBegin(); // node A's build never ends
    await a.rebuild();
    const stale = (await b.status()).build!;
    expect(stale.status).toBe('running');

    // Node B asks while A holds the lease: refused, and the record keeps A's build.
    const refused = await b.rebuild();
    expect(refused).toMatchObject({ ok: false, severity: 'warning' });
    expect(refused.message).toContain('another node holds the build');
    expect((await b.status()).build).toEqual(stale);

    cluster.expire(buildLockKey('kb'));
    const release = store.holdBegin();
    const taken = await b.rebuild();
    expect(taken).toMatchObject({ ok: true });
    const infos = b.logger.info.mock.calls.map((c) => String(c[0]));
    expect(infos.some((l) => l.includes(`build started ${stale.startedAt}`) && l.includes('closed as interrupted'))).toBe(true);
    const takenAt = (taken.details as { build: { startedAt: string } }).build.startedAt;
    expect((await a.status()).build).toMatchObject({ status: 'running', startedAt: takenAt });
    release();
    await vi.waitFor(async () => expect((await a.status()).build?.status).toBe('done'), { timeout: 5000, interval: 20 });
  });
});

describe('sync failures: one per dead letter, cleared by the reconcile that repairs them', () => {
  it('a dead-lettered sync counts one failure with both times and the platform sentence; no row holds a field value', async () => {
    const store = makeStore();
    const n = await bootNode({ file: freshFile(), store });
    store.state.failUpserts = true;
    const row = await n.insert({ title: 'Salary bands', body: 'Band four starts at ninety thousand', status: 'published' });
    await n.drained();
    expect(await n.queue.listFailed(KNOWLEDGE_RECORD_SYNC_QUEUE)).toHaveLength(1);

    const entry = await n.status();
    expect(entry.failures).toMatchObject({ count: 1 });
    expect(entry.failures?.firstFailedAt).toBeDefined();
    expect(entry.failures?.lastFailedAt).toBe(entry.failures?.firstFailedAt);
    expect(entry.failures?.lastError).toContain(`record '${String(row.id)}'`);
    expect(entry.failures?.lastError).toContain(`(${FAST_RETRY.maxAttempts} of ${FAST_RETRY.maxAttempts})`);

    // The provider's text quoted the record; the stored row does not.
    const errors = n.logger.error.mock.calls.map((c) => String(c[0]));
    expect(errors.some((l) => l.includes('ninety thousand')), 'the provider text did quote the record').toBe(true);
    const rows = await n.stateRows();
    expect(rows).toHaveLength(1);
    const stored = JSON.stringify(rows[0]);
    for (const value of ['Salary bands', 'ninety thousand', 'Band four', 'not allowed', 'published']) {
      expect(stored, value).not.toContain(value);
    }
  });

  it('a retried sync that succeeds counts nothing', async () => {
    const store = makeStore();
    const n = await bootNode({ file: freshFile(), store });
    let failures = 1;
    const upsert = store.adapter.upsert.bind(store.adapter);
    store.adapter.upsert = async (batch, ctx) => {
      if (failures-- > 0) throw new Error('the embedding provider answered 503');
      return upsert(batch, ctx);
    };
    await n.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
    await n.drained();
    expect((await n.queueRows()).map((r) => r.status)).toEqual(['completed']);
    expect((await n.status()).failures).toEqual({ count: 0 });
  });

  it('a completed reconcile clears the failures before it and removes their dead letters; one recorded during its walk survives', async () => {
    const store = makeStore();
    const n = await bootNode({ file: freshFile(), store });
    store.state.failUpserts = true;
    await n.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
    await n.insert({ title: 'Travel policy', body: 'Economy class under six hours', status: 'published' });
    await n.drained(2);
    expect((await n.status()).failures?.count).toBe(2);
    store.state.failUpserts = false;

    // The reconcile's walk is held at its start; meanwhile one more sync dead-letters.
    const release = store.holdBegin();
    const pass = n.service.reconcileSources();
    await vi.waitFor(() => expect(store.state.begins).toBe(1), { timeout: 3000, interval: 10 });
    const draft = await n.insert({ title: 'Draft', body: 'Not yet', status: 'draft' });
    store.state.failDeletesOf.add(String(draft.id));
    await n.drained(3);
    expect((await n.status()).failures?.count).toBe(3);
    release();
    const report = await pass;
    expect(report.sources[0]?.record?.status).toBe('done');

    const after = await n.status();
    expect(after.failures?.count).toBe(1);
    expect(after.failures?.lastError).toContain(`record '${String(draft.id)}'`);
    const letters = await n.queue.listFailed(KNOWLEDGE_RECORD_SYNC_QUEUE);
    expect(letters.map((l) => (l.data as { recordId: string }).recordId)).toEqual([String(draft.id)]);
    // The walk repaired the two: both are indexed now.
    expect(store.docs.size).toBe(2);
  });

  it('the first failure asks for one reconcile of the source; a hundred ask for one', async () => {
    const store = makeStore();
    const n = await bootNode({ file: freshFile(), store });
    const arm = vi.spyOn(n.service as unknown as { armReconcile(key: string, now: number): void }, 'armReconcile');
    for (let i = 0; i < 100; i++) {
      await n.service.recordSyncFailure(
        { source: 'kb', object: 'kb_article', recordId: `r${i}`, reason: 'event' },
        new Error('the embedding provider answered 503'),
        { attempt: 2, maxAttempts: 2 },
      );
    }
    expect((await n.status()).failures?.count).toBe(100);
    expect(arm).toHaveBeenCalledTimes(1);
    expect(arm.mock.calls[0]![0]).toBe('kb');
    expect((n.service as unknown as { pendingReconciles: Map<string, unknown> }).pendingReconciles.size).toBe(1);
  });

  it('index_status adds the record syncs waiting on the queue', async () => {
    const store = makeStore();
    const n = await bootNode({ file: freshFile(), store });
    await n.queue.stop();
    await n.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
    await vi.waitFor(async () => expect(await n.queueRows()).toHaveLength(1), { timeout: 3000, interval: 10 });
    const answer = await knowledgeIndexStatusActionHandler(n.service)({ namespace: 'knowledge', actionId: 'x', values: {}, payload: {}, ctx: {} } as never);
    expect(answer.details).toMatchObject({ queue: { queue: KNOWLEDGE_RECORD_SYNC_QUEUE, pending: 1 } });
    n.queue.start();
  });
});

describe('the rows: one per source, removed with it, the service the only writer', () => {
  it('every registered source has a row at boot, built or not, and the row goes when the source is removed', async () => {
    const store = makeStore();
    const n = await bootNode({ file: freshFile(), store });
    const rows = await n.stateRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'kb', source: 'kb', adapter: 'memory', object: 'kb_article', failure_count: 0 });
    expect((await n.status()).build).toBeNull();

    // A source authored in the environment (the metadata door) gets its row
    // when it registers; removing it removes the row, the code source's stays.
    const notes = n.service.registerMetadataSource(source({ name: 'notes', label: 'notes' }));
    await vi.waitFor(async () => expect((await n.stateRows()).map((r) => r.source).sort()).toEqual(['kb', 'notes']), { timeout: 3000, interval: 10 });
    await n.service.dropMetadataSource(notes.key);
    expect((await n.stateRows()).map((r) => r.source)).toEqual(['kb']);
  });

  it('the object is the platform administrator\'s and engine-owned: no data door writes a row, and Setup lists it behind the same capability', () => {
    expect(SysKnowledgeSyncState.name).toBe(KNOWLEDGE_SYNC_STATE_OBJECT);
    expect(SysKnowledgeSyncState.requiredPermissions).toEqual(['manage_platform_settings']);
    // The engine-owned write guard refuses a write whose resolved affordances grant none.
    expect(resolveCrudAffordances(SysKnowledgeSyncState)).toMatchObject({ create: false, edit: false, delete: false, import: false });
    // The data API offers reads only.
    expect([...resolveEffectiveApiMethods(SysKnowledgeSyncState.enable).primitives].sort()).toEqual(['get', 'list']);
    expect(knowledgeSyncStateNavItem()).toMatchObject({
      type: 'object',
      objectName: KNOWLEDGE_SYNC_STATE_OBJECT,
      requiresObject: KNOWLEDGE_SYNC_STATE_OBJECT,
      requiredPermissions: ['manage_platform_settings'],
    });
  });
});
