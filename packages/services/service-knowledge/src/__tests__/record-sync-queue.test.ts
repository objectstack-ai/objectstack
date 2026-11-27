// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record sync through the queue service (ADR-0161 K1), on a REAL kernel:
 * `ObjectQLPlugin` over a real SQL driver (`SqlDriver`, better-sqlite3 on a
 * file), the platform's `QueueServicePlugin` (its database adapter over
 * `sys_job_queue`) and `KnowledgeServicePlugin` — each trigger, the realtime
 * subscription and the after-write hooks, driven by real writes.
 *
 * What is pinned:
 *
 * - a save publishes a message and returns; it does not wait for the embedder,
 *   and the document appears once the embedder answers, with no further event;
 * - a message carries identifiers only (the stored queue row is read);
 * - a failed sync is retried, and once its attempts are spent the message is a
 *   dead letter the queue lists, naming the source and the record;
 * - nothing is published before the write's unit of work commits — the write's
 *   own unit and a caller's `transaction()` — and nothing for a write that
 *   rolls back: after the rollback the index equals the committed database;
 * - two saves of one record leave the last committed version; a save after a
 *   completed sync is synced (no completed message suppresses it); one save
 *   costs one queue row per source;
 * - a delete leaves the index once processed, and no search answers the
 *   record in between;
 * - messages published before a restart are processed after it;
 * - a source unregistered before its message is processed: completed, no
 *   write, no retry;
 * - the freshness repair publishes a `freshness` message;
 * - with only the kernel's fallback queue: one boot line at `warn`, and the
 *   sync runs inline as before;
 * - `enableEventSync: false` and `refresh.onRecordChange: false` publish
 *   nothing.
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
import type {
  IKnowledgeAdapter,
  IRealtimeService,
  RealtimeEventHandler,
  RealtimeEventPayload,
} from '@objectstack/spec/contracts';
import type { KnowledgeDocument, KnowledgeHit, KnowledgeSource } from '@objectstack/spec/ai';
import { KnowledgeServicePlugin, type KnowledgeServicePluginOptions } from '../knowledge-service-plugin.js';
import type { KnowledgeService } from '../knowledge-service.js';
import { KNOWLEDGE_RECORD_SYNC_QUEUE } from '../knowledge-record-sync-queue.js';

type Row = Record<string, unknown>;

const SYSTEM = { isSystem: true, positions: [], permissions: [], systemPermissions: [] } as never;
const SEARCH = { executionContext: { positions: [], permissions: [], systemPermissions: [], isSystem: true } };

/** A short retry budget, so a test sees a retry and a dead letter in milliseconds. */
const FAST_RETRY = { maxAttempts: 3, backoffMs: 20, maxBackoffMs: 40 };

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

/**
 * An adapter that keeps documents by id and answers a search by substring. Its
 * embedding step can be held (`hold()` → release) or made to fail the next
 * `failures` calls (`failNext(n)`), or every call (`failNext(Infinity)`).
 */
function makeAdapter() {
  const docs = new Map<string, KnowledgeDocument>();
  let gate: Promise<void> | undefined;
  let failures = 0;
  const embedCalls: string[] = [];
  const adapter: IKnowledgeAdapter = {
    id: 'memory',
    upsert: vi.fn(async (batch: KnowledgeDocument[]) => {
      embedCalls.push(...batch.map((doc) => doc.content));
      if (gate) await gate;
      if (failures > 0) {
        failures--;
        throw new Error('the embedding provider answered 503');
      }
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
          ...(doc.docHash !== undefined ? { docHash: doc.docHash } : {}),
        }))),
  };
  return {
    adapter,
    docs,
    embedCalls,
    hold(): () => void {
      let release!: () => void;
      gate = new Promise<void>((resolve) => { release = resolve; });
      return () => { gate = undefined; release(); };
    },
    failNext(n: number): void { failures = n; },
  };
}

/** A `realtime` service that awaits each subscriber in turn, as the in-memory adapter does. */
function makeRealtime() {
  const handlers = new Map<string, RealtimeEventHandler>();
  let n = 0;
  const service = {
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
  };
  return service as unknown as IRealtimeService & typeof service;
}

/** Registers the SQL driver, the test object and, when asked, a realtime service, in init(). */
function hostPlugin(file: string, realtime: IRealtimeService | undefined): Plugin {
  return {
    name: 'test.knowledge-queue-host',
    version: '1.0.0',
    type: 'standard',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
      await driver.connect();
      ctx.registerService('driver.default', driver);
      ctx.getService<ObjectQL>('objectql').registry.registerObject(KB_ARTICLE as never, 'test.knowledge-queue-host');
      if (realtime) ctx.registerService('realtime', realtime);
    },
    async start() {},
  } as unknown as Plugin;
}

/**
 * A `single` install's Default Organization, as a real boot seeds it: a system
 * write of a fresh object derives it (ADR-0131 D9), and the NOT NULL tenant
 * column requires one. Seeded through the driver, so no write under test sees it.
 */
async function installDefaultOrganization(ql: ObjectQL): Promise<void> {
  if (!ql.getSchema('sys_organization')) {
    ql.registry.registerObject(
      { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } } as never,
      'test.knowledge-queue-host',
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
let dir: string | undefined;

afterEach(async () => {
  for (const k of kernels.splice(0)) {
    try { await k.shutdown(); } catch { /* noop */ }
  }
  if (dir) { rmSync(dir, { recursive: true, force: true }); dir = undefined; }
});

function freshFile(): string {
  dir = mkdtempSync(join(tmpdir(), 'os-knowledge-queue-'));
  return join(dir, 'data.db');
}

interface BootOptions {
  file?: string;
  realtime?: boolean;
  queue?: boolean;
  knowledge?: KnowledgeServicePluginOptions;
}

async function boot(opts: BootOptions = {}) {
  const file = opts.file ?? freshFile();
  const realtime = opts.realtime ? makeRealtime() : undefined;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child() { return logger; } };
  const kernel = new ObjectKernel({ logger: { level: 'fatal' }, gracefulShutdown: false } as never);
  kernels.push(kernel);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(hostPlugin(file, realtime));
  if (opts.queue !== false) {
    await kernel.use(new QueueServicePlugin({ adapter: 'db', db: { pollIntervalMs: 10, maxIdleIntervalMs: 20 } }));
  }
  const knowledge = new KnowledgeServicePlugin({
    sources: [source()],
    buildAtBoot: false,
    reconcile: false,
    recordSyncRetry: FAST_RETRY,
    ...opts.knowledge,
  });
  // The plugin's own log lines, captured: the kernel's logger is silenced.
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
  const memory = makeAdapter();
  service.registerAdapter('memory', memory.adapter);
  const queue = kernel.getService<DbQueueAdapter>('queue');

  /** The stored rows of the record-sync queue. */
  const queueRows = async (): Promise<Row[]> =>
    (await ql.find('sys_job_queue', { where: { queue: KNOWLEDGE_RECORD_SYNC_QUEUE }, context: SYSTEM } as never)) as Row[];
  /** Resolves once every record-sync message is completed or a dead letter. */
  const drained = async (): Promise<void> => {
    await vi.waitFor(async () => {
      const open = (await queueRows()).filter((r) => r.status === 'pending' || r.status === 'running');
      if (open.length > 0) throw new Error(`${open.length} record-sync message(s) still open`);
    }, { timeout: 5000, interval: 10 });
  };
  const found = async (text: string): Promise<string[]> =>
    (await service.search(text, SEARCH)).map((hit) => String(hit.sourceRecordId));
  const insert = (data: Row): Promise<Row> => ql.insert('kb_article', data, { context: SYSTEM } as never) as Promise<Row>;
  const update = (id: unknown, data: Row): Promise<unknown> =>
    ql.update('kb_article', data, { where: { id }, context: SYSTEM } as never);
  const remove = (id: unknown): Promise<unknown> => ql.delete('kb_article', { where: { id }, context: SYSTEM } as never);

  return { kernel, ql, service, queue, realtime, logger, knowledge, ...memory, queueRows, drained, found, insert, update, remove };
}

const TRIGGERS = [
  ['the realtime subscription', true],
  ['the after-write hooks', false],
] as const;

describe.each(TRIGGERS)('record sync through the queue — %s', (_label, realtime) => {
  it('a save returns while the embedder does not answer; the document appears once it does, with no further event', async () => {
    const t = await boot({ realtime });
    expect(t.logger.info.mock.calls.map((c) => String(c[0])).some((l) => l.includes(`through queue '${KNOWLEDGE_RECORD_SYNC_QUEUE}'`))).toBe(true);
    const release = t.hold();
    const row = await t.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
    // The save resolved; the worker is held inside the embedding call.
    await vi.waitFor(() => expect(t.embedCalls).toHaveLength(1), { timeout: 3000, interval: 10 });
    expect(t.docs.size).toBe(0);
    release();
    await t.drained();
    expect(await t.found('paid leave')).toEqual([String(row.id)]);
  });

  it('a message carries identifiers only: the stored queue row holds no field value', async () => {
    const t = await boot({ realtime });
    const row = await t.insert({ title: 'Salary bands', body: 'Band four starts at ninety thousand', status: 'published' });
    await t.drained();
    const rows = await t.queueRows();
    expect(rows).toHaveLength(1);
    const stored = rows[0]!;
    expect(JSON.parse(String(stored.payload_json))).toEqual({
      source: 'kb',
      object: 'kb_article',
      recordId: String(row.id),
      reason: 'event',
    });
    const text = JSON.stringify(stored);
    expect(text).not.toContain('Salary bands');
    expect(text).not.toContain('ninety thousand');
    expect(text).not.toContain('published');
    expect(stored.idempotency_key ?? null).toBeNull();
  });

  it('a sync that fails is retried, and indexed by the retry', async () => {
    const t = await boot({ realtime });
    t.failNext(2);
    const row = await t.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
    await t.drained();
    expect(await t.found('paid leave')).toEqual([String(row.id)]);
    const [stored] = await t.queueRows();
    expect(stored!.status).toBe('completed');
    expect(Number(stored!.attempts)).toBe(3);
  });

  it('a sync that keeps failing is a dead letter naming its source and record; the save never failed', async () => {
    const t = await boot({ realtime });
    t.failNext(Infinity);
    const row = await t.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
    expect(row.id).toBeDefined();
    await t.drained();
    const failed = await t.queue.listFailed(KNOWLEDGE_RECORD_SYNC_QUEUE);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.attempts).toBe(FAST_RETRY.maxAttempts);
    expect(failed[0]!.metadata).toMatchObject({ source: 'kb', object: 'kb_article', recordId: String(row.id) });
    expect(JSON.stringify(failed[0])).not.toContain('paid leave');
    const errors = t.logger.error.mock.calls.map((c) => String(c[0]));
    expect(errors.filter((l) => l.includes('is now a dead letter'))).toHaveLength(1);
  });

  it("nothing is published inside a caller's transaction, and the committed write is synced once it commits", async () => {
    const t = await boot({ realtime });
    let insideRows = -1;
    await t.ql.transaction(async () => {
      await t.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      insideRows = t.embedCalls.length + t.docs.size;
    });
    expect(insideRows).toBe(0);
    await vi.waitFor(async () => expect(await t.queueRows()).toHaveLength(1), { timeout: 3000, interval: 10 });
    await t.drained();
    expect(await t.found('paid leave')).toHaveLength(1);
  });

  it('a rolled-back insert that matched leaves no document, and publishes nothing', async () => {
    const t = await boot({ realtime });
    await expect(t.ql.transaction(async () => {
      await t.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
      throw new Error('the caller gives up');
    })).rejects.toThrow('the caller gives up');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await t.ql.find('kb_article', { context: SYSTEM } as never)).toEqual([]);
    expect(await t.queueRows()).toEqual([]);
    expect(t.docs.size).toBe(0);
    expect(t.embedCalls).toEqual([]);
  });

  it('a rolled-back update that stopped matching leaves the committed row indexed', async () => {
    const t = await boot({ realtime });
    const row = await t.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
    await t.drained();
    expect(await t.found('paid leave')).toEqual([String(row.id)]);

    await expect(t.ql.transaction(async () => {
      await t.update(row.id, { status: 'draft' });
      throw new Error('the caller gives up');
    })).rejects.toThrow('the caller gives up');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await t.drained();
    const committed = (await t.ql.find('kb_article', { context: SYSTEM } as never)) as Row[];
    expect(committed.map((r) => r.status)).toEqual(['published']);
    expect(await t.queueRows()).toHaveLength(1);
    expect(await t.found('paid leave')).toEqual([String(row.id)]);
  });

  it('two saves in quick succession leave the last committed version; one save costs one queue row', async () => {
    const t = await boot({ realtime });
    const row = await t.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
    await t.update(row.id, { body: 'Thirty days of annual leave' });
    await t.update(row.id, { body: 'Forty days of sabbatical leave' });
    await t.drained();
    expect(await t.queueRows()).toHaveLength(3);
    expect(await t.found('sabbatical')).toEqual([String(row.id)]);
    expect(await t.found('paid leave')).toEqual([]);
    expect(await t.found('annual leave')).toEqual([]);
  });

  it('a save after a completed sync is synced: a completed message suppresses nothing', async () => {
    const t = await boot({ realtime });
    const row = await t.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
    await t.drained();
    expect((await t.queueRows()).map((r) => r.status)).toEqual(['completed']);
    await t.update(row.id, { body: 'Thirty days of annual leave' });
    await t.drained();
    expect(await t.found('annual leave')).toEqual([String(row.id)]);
    expect((await t.queueRows()).map((r) => r.status)).toEqual(['completed', 'completed']);
  });

  it('a delete leaves the index once processed, and no search answers the record in between', async () => {
    const t = await boot({ realtime });
    const row = await t.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
    await t.drained();
    expect(t.docs.size).toBe(1);

    await t.queue.stop();
    await t.remove(row.id);
    // The worker is stopped: the document is still in the index, and the
    // search's freshness check keeps it out of the answer.
    expect(t.docs.size).toBe(1);
    expect(await t.found('paid leave')).toEqual([]);

    t.queue.start();
    await t.drained();
    expect(t.docs.size).toBe(0);
  });

  it('a source unregistered before its message is processed: completed, no write, no retry', async () => {
    const t = await boot({ realtime });
    await t.queue.stop();
    await t.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
    await vi.waitFor(async () => expect(await t.queueRows()).toHaveLength(1), { timeout: 3000, interval: 10 });
    t.service.unregisterSource('kb');
    t.queue.start();
    await t.drained();
    const [stored] = await t.queueRows();
    expect(stored!.status).toBe('completed');
    expect(Number(stored!.attempts)).toBe(1);
    expect(t.adapter.upsert).not.toHaveBeenCalled();
    expect(t.adapter.delete).not.toHaveBeenCalled();
  });
});

describe('record sync through the queue — the write, the restart and the freshness repair', () => {
  it("nothing is published before the write's own unit of work commits", async () => {
    const t = await boot({ realtime: true });
    // A blocking `afterInsert` metadata hook makes the write open its own unit
    // (`opensAfterAbortUnit`); a second realtime subscriber holds the write
    // open after the knowledge subscription has run, so the unit is open
    // while the message would be published.
    t.ql.registerHook('afterInsert', async () => undefined, {
      object: 'kb_article',
      meta: { name: 'audit_probe', events: ['afterInsert'] },
    } as never);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let reached = false;
    await t.realtime!.subscribe('test.hold', async () => {
      reached = true;
      await held;
    });
    const write = t.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
    await vi.waitFor(() => expect(reached).toBe(true), { timeout: 3000, interval: 5 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(t.embedCalls).toEqual([]);
    expect(await t.queueRows()).toEqual([]);
    release();
    await write;
    await vi.waitFor(async () => expect(await t.queueRows()).toHaveLength(1), { timeout: 3000, interval: 10 });
    await t.drained();
    expect(await t.found('paid leave')).toHaveLength(1);
  });

  it("an afterInsert hook that aborts the write's own unit after the knowledge hook ran publishes nothing", async () => {
    const t = await boot({ realtime: false });
    t.ql.registerHook('afterInsert', async () => {
      throw new Error('the probe refuses this write');
    }, {
      object: 'kb_article',
      priority: 1000,
      meta: { name: 'refusing_probe', events: ['afterInsert'] },
    } as never);
    await expect(t.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' }))
      .rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await t.ql.find('kb_article', { context: SYSTEM } as never)).toEqual([]);
    expect(await t.queueRows()).toEqual([]);
    expect(t.docs.size).toBe(0);
  });

  it('messages published before a restart are processed after it', async () => {
    const file = freshFile();
    const first = await boot({ file });
    await first.queue.stop();
    const row = await first.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
    await vi.waitFor(async () => expect(await first.queueRows()).toHaveLength(1), { timeout: 3000, interval: 10 });
    expect(first.docs.size).toBe(0);
    await first.kernel.shutdown();
    kernels.splice(kernels.indexOf(first.kernel), 1);

    const second = await boot({ file });
    await second.drained();
    expect(await second.found('paid leave')).toEqual([String(row.id)]);
  });

  it('a search that finds a document stale publishes a freshness message, and the worker repairs it', async () => {
    const t = await boot({ realtime: true });
    const row = await t.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
    await t.drained();
    // The row changes behind the engine's back: no event, no hook.
    const driver = t.ql.getDriverForObject('kb_article') as unknown as { update(o: string, id: unknown, d: Row): Promise<unknown> };
    await driver.update('kb_article', row.id, { body: 'Twenty days of unpaid leave' });
    expect(await t.found('paid leave')).toEqual([]);
    await vi.waitFor(async () => expect(await t.queueRows()).toHaveLength(2), { timeout: 3000, interval: 10 });
    const freshness = (await t.queueRows()).map((r) => JSON.parse(String(r.payload_json)).reason);
    expect(freshness.sort()).toEqual(['event', 'freshness']);
    await t.drained();
    expect(await t.found('unpaid leave')).toEqual([String(row.id)]);
  });
});

describe('record sync without a durable queue, and the switches', () => {
  it.each(TRIGGERS)("with only the kernel's fallback queue (%s): one boot line at warn, and the sync runs inline", async (_label, realtime) => {
    const t = await boot({ realtime, queue: false });
    const inline = t.logger.warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('record changes are synced inline'));
    expect(inline).toHaveLength(1);
    expect(t.service.recordSyncQueued).toBe(false);
    const row = await t.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
    await vi.waitFor(async () => expect(await t.found('paid leave')).toEqual([String(row.id)]), { timeout: 3000, interval: 10 });
  });

  it.each(TRIGGERS)('enableEventSync: false publishes nothing and subscribes nothing (%s)', async (_label, realtime) => {
    const t = await boot({ realtime, knowledge: { enableEventSync: false } });
    expect(t.service.recordSyncQueued).toBe(false);
    await t.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await t.queueRows()).toEqual([]);
    expect(t.docs.size).toBe(0);
  });

  it.each(TRIGGERS)('a source with refresh.onRecordChange: false is never enqueued (%s)', async (_label, realtime) => {
    const t = await boot({
      realtime,
      knowledge: { sources: [source({ refresh: { onRecordChange: false } } as Partial<KnowledgeSource>)] },
    });
    await t.insert({ title: 'Leave policy', body: 'Twenty days of paid leave', status: 'published' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await t.queueRows()).toEqual([]);
    expect(t.docs.size).toBe(0);
  });

  it('destroy() leaves the queue subscription: a message published later waits for the next start', async () => {
    const t = await boot({ realtime: true });
    await (t.knowledge as unknown as { destroy(): Promise<void> }).destroy();
    const publish = await t.queue.publish(KNOWLEDGE_RECORD_SYNC_QUEUE, { source: 'kb', object: 'kb_article', recordId: 'y', reason: 'event' });
    expect(publish).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const stored = (await t.queueRows()).find((r) => JSON.parse(String(r.payload_json)).recordId === 'y');
    expect(stored?.status).toBe('pending');
  });
});
