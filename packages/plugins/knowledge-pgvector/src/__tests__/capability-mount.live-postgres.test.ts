// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0161 — `requires: ['knowledge']` on a PostgreSQL platform database, on
 * the LIVE PostgreSQL: the token's rule (`resolveCapabilityExtras`,
 * `@objectstack/core`, which `os serve` and `@objectstack/verify` both read)
 * chooses this store and hands it the platform URL; mounted beside the
 * token's main provider, a record write is indexed into the platform database
 * and `search_knowledge` (the executor the MCP doors call) finds it. The
 * SQLite half of the rule boots in `@objectstack/verify`
 * (`harness.required-providers.test.ts`).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPABILITY_PROVIDERS, LiteKernel, resolveCapabilityExtras } from '@objectstack/core';
import { KnowledgeService, KnowledgeServicePlugin } from '@objectstack/service-knowledge';
import { EMBEDDER_SERVICE } from '@objectstack/spec/contracts';
import { KnowledgePgvectorPlugin } from '../index.js';
import { FakeEmbedder, PG_URL, liveStore, requireLiveCell } from './live-pg.testkit.js';

requireLiveCell('knowledge-pgvector mounted by the knowledge capability');

const store = liveStore('kpg_mount');

describe.skipIf(!PG_URL)('requires knowledge on PostgreSQL — the token mounts pgvector on the platform database', { timeout: 60_000 }, () => {
  let kernel: LiteKernel;
  let svc: KnowledgeService;
  const schema = store.schema();

  beforeAll(async () => {
    const extras = resolveCapabilityExtras('knowledge', {
      stack: {},
      packageRoot: process.cwd(),
      env: {},
      database: { driver: 'postgres', url: PG_URL },
    });
    expect(CAPABILITY_PROVIDERS.knowledge.export).toBe('KnowledgeServicePlugin');
    expect(extras).toHaveLength(1);
    const [extra] = extras;
    expect(extra).toMatchObject({ pkg: '@objectstack/knowledge-pgvector', export: 'KnowledgePgvectorPlugin', argument: { url: PG_URL } });

    kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use({
      name: 'test.embedder',
      init: async (ctx: { registerService(n: string, s: unknown): void }) => ctx.registerService(EMBEDDER_SERVICE, new FakeEmbedder()),
    } as never);
    kernel.use(
      new KnowledgeServicePlugin({
        enableEventSync: false,
        sources: [{ id: 'kpg_notes', label: 'Notes', adapter: 'pgvector', source: { kind: 'object', object: 'kpg_note', contentFields: ['body'] } }],
      }),
    );
    // The store as the rule builds it — its argument — in a schema of this file's own.
    kernel.use(new KnowledgePgvectorPlugin({ ...(extra.argument as object), schema }));
    await kernel.bootstrap();
    svc = kernel.getService<KnowledgeService>('knowledge');
  });

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
    await store.dropAll();
  });

  it('the store is mounted, ready, on the platform database', async () => {
    expect(svc.listAdapters()).toEqual(['pgvector']);
    expect(await svc.getAdapter('pgvector').healthCheck!()).toMatchObject({ ok: true });
    expect(svc.reportUnmountedAdapters()).toEqual([]);
  });

  it('a record write is indexed there, and search_knowledge finds it', async () => {
    await svc.handleRecordUpsert('kpg_note', { id: 'n1', body: 'granite quarry near the river' });
    const { rows } = await store.pool().query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1`,
      [schema],
    );
    expect(rows[0].n).toBeGreaterThan(0);
    const answer = await svc.knowledgeTools().searchKnowledge(
      { query: 'granite quarry' },
      { isSystem: true, userId: 'system', roles: [], permissions: [] } as never,
    );
    expect(answer.refused).toBeUndefined();
    expect(answer.hits.map((h) => h.sourceId)).toEqual(['kpg_notes']);
    expect(JSON.stringify(answer.hits[0])).toContain('granite');
  });
});
