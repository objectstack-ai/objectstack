// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The reconcile's purge on a LIVE PostgreSQL with pgvector (ADR-0161 K1: "a
 * reconcile pass keeps it correct"; `KnowledgeService.reconcileSources`).
 *
 * A real `ObjectQL` over a real `SqlDriver` is the data engine and this store
 * the adapter. Rows leave the source behind the index's back — a predicate
 * (`multi: true`) delete and a predicate update that moves rows out of
 * `where`, neither of which names a record — and one reconcile removes
 * exactly their documents from the store's active generation, keeps the
 * others without embedding them again, and a second reconcile writes and
 * embeds nothing.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { KnowledgeService } from '@objectstack/service-knowledge';
import type { KnowledgeSource } from '@objectstack/spec/ai';
import type { AdapterContext } from '@objectstack/spec/contracts';
import { FakeEmbedder, PG_URL, liveStore, requireLiveCell } from './live-pg.testkit.js';

requireLiveCell('knowledge-pgvector reconcile purge');

const store = liveStore('kpg_reconcile');

const OBJECT = 'kpg_policy';
const POLICY = {
  name: OBJECT,
  label: 'Policy',
  fields: {
    body: { name: 'body', type: 'textarea' },
    status: { name: 'status', type: 'text' },
    topic: { name: 'topic', type: 'text' },
  },
};

describe.skipIf(!PG_URL)('knowledge-pgvector — the reconcile purges what predicate writes left stale, on a LIVE PostgreSQL', { timeout: 60_000 }, () => {
  const objectSchema = store.schema();
  let engine: ObjectQL;
  let svc: KnowledgeService;
  let embedder: FakeEmbedder;
  let adapter: ReturnType<typeof store.adapter>;
  const source = {
    name: 'policies',
    label: 'Policies',
    adapter: 'pgvector',
    source: { kind: 'object', object: OBJECT, content: ['body'], where: { status: 'published' } },
  } as KnowledgeSource;

  const listed = async (): Promise<string[]> => {
    const page = await adapter.listDocuments!({ source, reason: 'reindex' } as AdapterContext, { limit: 1000 });
    return page.documents.map((d) => d.documentId.slice(`${source.name}:`.length)).sort();
  };

  beforeAll(async () => {
    await store.pool().query(`DROP SCHEMA IF EXISTS "${objectSchema}" CASCADE`);
    await store.pool().query(`CREATE SCHEMA "${objectSchema}"`);
    const driver = new SqlDriver({ client: 'pg', connection: PG_URL, searchPath: [objectSchema] } as never);
    await driver.initObjects([POLICY] as never);
    const seed: Array<[string, string]> = [['p1', 'leave'], ['p2', 'leave'], ['p3', 'expense'], ['p4', 'expense'], ['p5', 'travel'], ['p6', 'travel']];
    for (const [id, topic] of seed) {
      await driver.create(OBJECT, { id, body: `policy ${id} on ${topic} granite`, status: 'published', topic });
    }
    engine = new ObjectQL();
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject(POLICY as never, 'com.objectstack.test.knowledge-pgvector');

    embedder = new FakeEmbedder();
    adapter = store.adapter({ id: 'pgvector', embedder });
    svc = new KnowledgeService({ dataEngine: engine as never });
    svc.registerAdapter('pgvector', adapter);
    svc.registerSource(source);
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    await store.dropAll();
  });

  it('the first reconcile builds the never-built source', async () => {
    const report = await svc.reconcileSources();
    expect(report.unfinished).toEqual([]);
    expect(report.sources[0]?.record).toMatchObject({ trigger: 'reconcile', status: 'done', result: { indexed: 6, purged: 0 } });
    expect(await listed()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  });

  it('after a predicate delete and a predicate update out of where, one reconcile purges exactly those documents', async () => {
    await engine.delete(OBJECT, { where: { topic: 'expense' }, multi: true } as never);
    await engine.update(OBJECT, { status: 'archived' }, { where: { topic: 'travel' }, multi: true } as never);
    const embedsBefore = embedder.calls;

    const report = await svc.reconcileSources();
    expect(report.unfinished).toEqual([]);
    expect(report.sources[0]?.record).toMatchObject({
      trigger: 'reconcile',
      status: 'done',
      result: { ok: true, discovered: 2, indexed: 0, skipped: 2, purged: 4 },
    });
    expect(await listed()).toEqual(['p1', 'p2']);
    expect(embedder.calls).toBe(embedsBefore);
  });

  it('a second reconcile right after writes nothing and embeds nothing', async () => {
    const embedsBefore = embedder.calls;
    const report = await svc.reconcileSources();
    expect(report.sources[0]?.record).toMatchObject({ status: 'done', result: { indexed: 0, skipped: 2, purged: 0 } });
    expect(embedder.calls).toBe(embedsBefore);
  });
});
