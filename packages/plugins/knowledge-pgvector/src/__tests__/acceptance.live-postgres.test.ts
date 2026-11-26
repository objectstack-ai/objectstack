// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The acceptance cases of #37100 on a LIVE PostgreSQL with pgvector, beside
 * the contract suite: a 3072-wide model, two organizations that never see each
 * other's passages, an unchanged passage that is not embedded again, a changed
 * fingerprint that is refused and never served, the printed statements that
 * clear a source run as printed, a first generation that never adopts rows left
 * behind, a passage removed under a concurrent write that is not lost, and the
 * store's tables kept out of the connection's own schema.
 */

import { afterAll, describe, expect, it } from 'vitest';
import type { KnowledgeDocument, KnowledgeSource } from '@objectstack/spec/ai';
import type { AdapterContext } from '@objectstack/spec/contracts';
import { KnowledgeService } from '@objectstack/service-knowledge';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { KNOWLEDGE_REBUILD_REQUIRED, poolFromPg, type PgPoolLike } from '../index.js';
import { FakeEmbedder, PG_URL, liveStore, requireLiveCell } from './live-pg.testkit.js';

requireLiveCell('knowledge-pgvector acceptance');

const store = liveStore('kpg_accept');

const source = (id: string): KnowledgeSource =>
  ({
    id,
    label: id,
    adapter: 'under_test',
    source: { kind: 'object', object: 'article', contentFields: ['body'], metadataFields: ['status'] },
  }) as KnowledgeSource;

const FP_A = { fingerprint: 'fp-test:a', recipeHash: 'rh-test:1' };
const FP_B = { fingerprint: 'fp-test:b', recipeHash: 'rh-test:1' };
const ctx = (s: KnowledgeSource, index = FP_A): AdapterContext => ({ source: s, reason: 'manual', index });

function doc(s: KnowledgeSource, n: string, content: string, extra: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  const id = `${s.id}:${n}`;
  return {
    id,
    sourceId: s.id,
    sourceRecordId: n,
    content,
    title: `Title ${n}`,
    metadata: { status: 'published' },
    chunks: [{ id: `${id}#0`, documentId: id, index: 0, content }],
    ...extra,
  };
}

const SYSTEM = { positions: [], permissions: [], systemPermissions: [], isSystem: true } as unknown as ExecutionContext;

describe.skipIf(!PG_URL)('knowledge-pgvector acceptance on a LIVE PostgreSQL', () => {
  afterAll(() => store.dropAll());

  it('stores and ranks 3072-wide vectors: an exact scan, no index width limit', async () => {
    const embedder = new FakeEmbedder(3072, 'fake-3072');
    const adapter = store.adapter({ embedder });
    const s = source('wide');
    await adapter.upsert([doc(s, '1', 'glacier valley ice'), doc(s, '2', 'harbour crane night')], ctx(s));
    const hits = await adapter.search('glacier ice', { source: s, topK: 5, index: { fingerprint: FP_A.fingerprint } });
    expect(hits.map((h) => h.documentId)).toEqual([`${s.id}:1`]);
    expect(hits[0].score).toBeGreaterThan(0.5);
    const width = await store.pool().query<{ t: string }>(
      `SELECT format_type(a.atttypid, a.atttypmod) AS t FROM pg_attribute a
        WHERE a.attrelid = to_regclass($1) AND a.attname = 'embedding'`,
      [`"${(adapter as unknown as { schema: string }).schema}"."knowledge_vec_d3072"`],
    );
    expect(width.rows[0]?.t).toBe('vector(3072)');
  });

  it('two organizations never see each other\'s passages: the filter runs in SQL, before ranking', async () => {
    const adapter = store.adapter();
    const s = source('orgs');
    // Organization B's passage would outrank A's for the query.
    await adapter.upsert(
      [
        doc(s, 'a', 'alpine meadow harbour', { organizationId: 'org_a' }),
        doc(s, 'b', 'alpine meadow alpine meadow', { organizationId: 'org_b' }),
      ],
      ctx(s),
    );
    const search = (organizationIds?: string[]) =>
      adapter.search('alpine meadow', { source: s, topK: 1, index: { fingerprint: FP_A.fingerprint }, ...(organizationIds ? { organizationIds } : {}) });
    expect((await search()).map((h) => h.documentId)).toEqual([`${s.id}:b`]);
    expect((await search(['org_a'])).map((h) => h.documentId)).toEqual([`${s.id}:a`]);
    expect((await search(['org_b'])).map((h) => h.documentId)).toEqual([`${s.id}:b`]);
    expect(await search([])).toEqual([]);
    expect(await search(['org_c'])).toEqual([]);
  });

  it('the metadata filter runs in SQL before ranking, so topK is filled from matching passages', async () => {
    const adapter = store.adapter();
    const s = source('meta');
    await adapter.upsert(
      [
        doc(s, '1', 'basalt basalt basalt', { metadata: { status: 'draft' } }),
        doc(s, '2', 'basalt columns', { metadata: { status: 'published' } }),
      ],
      ctx(s),
    );
    const hits = await adapter.search('basalt', { source: s, topK: 1, filter: { status: 'published' }, index: { fingerprint: FP_A.fingerprint } });
    expect(hits.map((h) => h.documentId)).toEqual([`${s.id}:2`]);
    expect(hits[0].metadata).toEqual({ status: 'published' });
  });

  it('an unchanged passage is not embedded again; its metadata is rewritten', async () => {
    const embedder = new FakeEmbedder();
    const adapter = store.adapter({ embedder });
    const s = source('same');
    await adapter.upsert([doc(s, '1', 'copper wire conducts heat')], ctx(s));
    expect(embedder.calls).toBe(1);
    await adapter.upsert([doc(s, '1', 'copper wire conducts heat', { metadata: { status: 'archived' } })], ctx(s));
    expect(embedder.calls).toBe(1);
    const [hit] = await adapter.search('copper', { source: s, topK: 1, index: { fingerprint: FP_A.fingerprint } });
    expect(hit.metadata).toEqual({ status: 'archived' });
    // A changed passage is embedded, and only it (the search above embedded its query).
    const before = embedder.calls;
    await adapter.upsert(
      [{ ...doc(s, '1', 'x'), chunks: [
        { id: `${s.id}:1#0`, documentId: `${s.id}:1`, index: 0, content: 'copper wire conducts heat' },
        { id: `${s.id}:1#1`, documentId: `${s.id}:1`, index: 1, content: 'drawn through dies' },
      ] }],
      ctx(s),
    );
    expect(embedder.calls).toBe(before + 1);
    expect(embedder.texts.slice(-1)).toEqual(['drawn through dies']);
  });

  it('through KnowledgeService: a second complete reindex of unchanged records embeds nothing', async () => {
    const embedder = new FakeEmbedder();
    const adapter = store.adapter({ embedder });
    const rows = [
      { id: 'r1', body: 'granite quarry', status: 'published' },
      { id: 'r2', body: 'marble quarry', status: 'published' },
    ];
    const svc = new KnowledgeService({ dataEngine: rowsEngine(rows) });
    svc.registerAdapter('under_test', adapter);
    const s = source('svc_same');
    svc.registerSource(s);
    expect(await svc.reindexSource(s.id)).toMatchObject({ ok: true, indexed: 2 });
    const after = embedder.calls;
    expect(await svc.reindexSource(s.id)).toMatchObject({ ok: true, indexed: 0, skipped: 2 });
    expect(embedder.calls).toBe(after);
    expect((await svc.search('granite', { topK: 3, executionContext: SYSTEM })).map((h) => h.documentId)).toEqual([`${s.id}:r1`]);
  });

  it('a changed embedding model changes the fingerprint: search is refused by name, and the old rows are not served', async () => {
    const embedder = new FakeEmbedder(384, 'model-one');
    const adapter = store.adapter({ embedder });
    const svc = new KnowledgeService({ dataEngine: rowsEngine([{ id: 'r1', body: 'granite quarry', status: 'published' }]) });
    svc.registerAdapter('under_test', adapter);
    const s = source('svc_model');
    svc.registerSource(s);
    await svc.reindexSource(s.id);
    expect(await svc.search('granite', { topK: 3, executionContext: SYSTEM })).toHaveLength(1);

    embedder.model = 'model-two';
    const refused = await svc.search('granite', { topK: 3, executionContext: SYSTEM }).then(
      () => undefined,
      (e: unknown) => e as { code?: string; status?: number; message?: string },
    );
    expect(refused).toMatchObject({ code: KNOWLEDGE_REBUILD_REQUIRED, status: 409 });
    expect(refused?.message).toContain(s.id);
    // The caller is told the source needs a rebuild, never the SQL.
    expect(refused?.message).not.toContain('DELETE');
    // A complete reindex under the new model is refused before anything is written, naming the SQL that clears the source.
    const rebuilt = await svc.reindexSource(s.id);
    expect(rebuilt.ok).toBe(false);
    expect(rebuilt.message).toContain('DELETE FROM');
  });

  it('the printed statements clear the source exactly; run as printed, the next complete reindex embeds afresh', async () => {
    const embedder = new FakeEmbedder(384, 'model-one');
    const adapter = store.adapter({ embedder });
    const schema = (adapter as unknown as { schema: string }).schema;
    const svc = new KnowledgeService({ dataEngine: rowsEngine([{ id: 'r1', body: 'granite quarry', status: 'published' }]) });
    svc.registerAdapter('under_test', adapter);
    const s = source('svc_clear');
    svc.registerSource(s);
    expect(await svc.reindexSource(s.id)).toMatchObject({ ok: true, indexed: 1 });

    embedder.model = 'model-two';
    const refused = await svc.reindexSource(s.id);
    expect(refused.ok).toBe(false);
    const statements = (refused.message ?? '').split('\n').filter((line) => line.startsWith('DELETE FROM'));
    // Passages first, then the generation row; every table named exactly.
    expect(statements).toEqual([
      `DELETE FROM "${schema}"."knowledge_vec_d384" WHERE source_id = '${s.id}';`,
      `DELETE FROM "${schema}"."knowledge_generation" WHERE source_id = '${s.id}';`,
    ]);
    for (const statement of statements) await store.pool().query(statement);

    const before = embedder.calls;
    expect(await svc.reindexSource(s.id)).toMatchObject({ ok: true, indexed: 1 });
    expect(embedder.calls).toBe(before + 1);
    expect(await adapter.indexStatus({ source: s, reason: 'manual' })).toMatchObject({ fingerprint: expect.any(String) });
    expect(await svc.search('granite', { topK: 3, executionContext: SYSTEM })).toHaveLength(1);
  });

  it('a first generation never adopts passages left behind: a generation row deleted alone does not carry its vectors over', async () => {
    const embedder = new FakeEmbedder(384, 'model-one');
    const adapter = store.adapter({ embedder });
    const schema = (adapter as unknown as { schema: string }).schema;
    const svc = new KnowledgeService({ dataEngine: rowsEngine([{ id: 'r1', body: 'granite quarry', status: 'published' }]) });
    svc.registerAdapter('under_test', adapter);
    const s = source('svc_leftover');
    svc.registerSource(s);
    expect(await svc.reindexSource(s.id)).toMatchObject({ ok: true, indexed: 1 });

    // Same width, another model; an operator deletes only the generation row.
    embedder.model = 'model-two';
    await store.pool().query(`DELETE FROM "${schema}"."knowledge_generation" WHERE source_id = $1`, [s.id]);
    const before = embedder.calls;
    expect(await svc.reindexSource(s.id)).toMatchObject({ ok: true, indexed: 1, skipped: 0 });
    // The passage was embedded again under the new model: the old vector was not adopted.
    expect(embedder.calls).toBe(before + 1);
    expect(embedder.texts.slice(-1)).toEqual(['granite quarry']);
    const rows = await store.pool().query<{ n: string }>(
      `SELECT count(*) AS n FROM "${schema}"."knowledge_vec_d384" WHERE source_id = $1`,
      [s.id],
    );
    expect(Number(rows.rows[0].n)).toBe(1);
  });

  it('an unchanged passage removed by a concurrent write before this one commits is embedded and kept, not lost', async () => {
    const embedder = new FakeEmbedder();
    const base = poolFromPg(store.pool());
    let interfere: (() => Promise<void>) | undefined;
    const pool: PgPoolLike = {
      query: (text, params) => base.query(text, params),
      connect: async () => {
        // The concurrent write lands between this write's read of the stored
        // hashes and its transaction.
        const run = interfere;
        interfere = undefined;
        if (run) await run();
        return base.connect();
      },
    };
    const adapter = store.adapter({ embedder, pool });
    const schema = (adapter as unknown as { schema: string }).schema;
    const s = source('race');
    await adapter.upsert([doc(s, '1', 'copper wire conducts heat')], ctx(s));
    expect(embedder.calls).toBe(1);
    interfere = async () => {
      await base.query(`DELETE FROM "${schema}"."knowledge_vec_d384" WHERE source_id = $1`, [s.id]);
    };
    await adapter.upsert([doc(s, '1', 'copper wire conducts heat', { metadata: { status: 'archived' } })], ctx(s));
    expect(embedder.calls).toBe(2);
    const [hit] = await adapter.search('copper', { source: s, topK: 1, index: { fingerprint: FP_A.fingerprint } });
    expect(hit).toMatchObject({ documentId: `${s.id}:1`, metadata: { status: 'archived' } });
  });

  it('beginBuild under another fingerprint is refused with the SQL that clears the source; under its own it is a no-op', async () => {
    const adapter = store.adapter();
    const s = source('build');
    await adapter.upsert([doc(s, '1', 'granite quarry')], ctx(s, FP_A));
    await expect(adapter.beginBuild(ctx(s, FP_A))).resolves.toBeUndefined();
    const err = await adapter.beginBuild(ctx(s, FP_B)).then(
      () => undefined,
      (e: unknown) => e as { code?: string; message?: string; remedy?: string },
    );
    expect(err).toMatchObject({ code: KNOWLEDGE_REBUILD_REQUIRED, status: 409 });
    expect(err?.message).not.toContain('DELETE');
    expect(err?.remedy).toContain(`WHERE source_id = '${s.id}'`);
    // Nothing was served from, or written to, the stored generation under B.
    await expect(adapter.search('granite', { source: s, topK: 3, index: { fingerprint: FP_B.fingerprint } })).rejects.toMatchObject({
      code: KNOWLEDGE_REBUILD_REQUIRED,
    });
    expect(await adapter.indexStatus(ctx(s))).toEqual({ fingerprint: FP_A.fingerprint });
  });

  it('keeps its tables in its own schema, never the connection\'s current schema', async () => {
    const adapter = store.adapter();
    const s = source('where');
    await adapter.upsert([doc(s, '1', 'granite quarry')], ctx(s));
    const own = (adapter as unknown as { schema: string }).schema;
    const tables = await store.pool().query<{ table_schema: string; table_name: string }>(
      `SELECT table_schema, table_name FROM information_schema.tables
        WHERE table_name LIKE 'knowledge\\_%' AND table_schema IN ($1, current_schema()) ORDER BY table_name`,
      [own],
    );
    expect(tables.rows).toEqual([
      { table_schema: own, table_name: 'knowledge_generation' },
      { table_schema: own, table_name: 'knowledge_vec_d384' },
    ]);
  });
});

/** A data engine over fixed rows, for the service's walk: `find` with a keyset on `id`, and `count`. */
function rowsEngine(rows: Array<Record<string, unknown>>) {
  const sorted = [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const matches = (row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === '$and') return (v as Array<Record<string, unknown>>).every((w) => matches(row, w));
      if (v !== null && typeof v === 'object') {
        const cond = v as Record<string, unknown>;
        if ('$gt' in cond) return String(row[k]) > String(cond.$gt);
        if ('$in' in cond) return (cond.$in as unknown[]).includes(row[k]);
        throw new Error(`rowsEngine: condition ${JSON.stringify(v)} is not implemented`);
      }
      return row[k] === v;
    });
  };
  return {
    async find(_object: string, query: { where?: Record<string, unknown>; limit?: number }) {
      const out = sorted.filter((r) => matches(r, query?.where));
      return query?.limit === undefined ? out : out.slice(0, query.limit);
    },
    async count(_object: string, query: { where?: Record<string, unknown> }) {
      return sorted.filter((r) => matches(r, query?.where)).length;
    },
  } as never;
}
