// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The acceptance cases of the move into objectstack, beside the contract
 * suite, on `:memory:` and on a `file:` URL: Chinese text found with a fixed
 * fake embedder, an unchanged passage not embedded again, a changed model (the
 * same width and another) built as a new generation table while the old one is
 * not served under the new fingerprint and then dropped, two organizations that
 * never see each other's hits, a table of the store's earlier releases
 * answered "reindex needed" and then replaced, the metadata filter run before
 * ranking, and one queue for concurrent calls on a single-connection database.
 */

import { afterAll, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import type { KnowledgeDocument, KnowledgeSource } from '@objectstack/spec/ai';
import type { AdapterContext, IDataEngine, IEmbedder } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { KnowledgeService } from '@objectstack/service-knowledge';
import { KNOWLEDGE_REBUILD_REQUIRED, TursoKnowledgeAdapter } from '../index.js';
import { FakeEmbedder, storeOf, type StoreKind } from './turso.testkit.js';

const source = (id: string, extra: Record<string, unknown> = {}): KnowledgeSource =>
  ({
    id,
    label: id,
    adapter: 'under_test',
    source: { kind: 'object', object: 'article', contentFields: ['body'], metadataFields: ['status'], ...extra },
  }) as KnowledgeSource;

const FP_A = { fingerprint: 'fp-test:a', recipeHash: 'rh-test:1' };
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

type Row = Record<string, unknown>;

/** A data-engine double for the service's paged walk: rows by id order, `id > cursor`, a limit, and `id IN (…)`. */
function rowsEngine(rows: Row[]): IDataEngine {
  const matches = (row: Row, where: Record<string, unknown> | undefined): boolean => {
    for (const [key, value] of Object.entries(where ?? {})) {
      if (key === '$and') {
        if (!(value as Row[]).every((c) => matches(row, c))) return false;
        continue;
      }
      if (value !== null && typeof value === 'object') {
        const v = value as { $gt?: unknown; $in?: unknown[] };
        if (v.$in !== undefined && !v.$in.map(String).includes(String(row[key]))) return false;
        if (v.$gt !== undefined && !(String(row[key]) > String(v.$gt))) return false;
        continue;
      }
      if (row[key] !== value) return false;
    }
    return true;
  };
  return {
    find: async (_object: string, query: { where?: Row; limit?: number }) =>
      rows
        .filter((r) => matches(r, query?.where))
        .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))
        .slice(0, typeof query?.limit === 'number' ? query.limit : undefined)
        .map((r) => ({ ...r })),
    count: async (_object: string, query: { where?: Row }) => rows.filter((r) => matches(r, query?.where)).length,
  } as unknown as IDataEngine;
}

async function tables(client: Client, like: string): Promise<string[]> {
  const found = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ? ORDER BY name",
    args: [like],
  });
  return found.rows.map((r) => String(r.name));
}

async function refusal(promise: Promise<unknown>): Promise<Record<string, unknown>> {
  return promise.then(
    () => {
      throw new Error('expected a refusal, got an answer');
    },
    (e: unknown) => e as Record<string, unknown>,
  );
}

for (const kind of ['memory', 'file'] as StoreKind[]) {
  describe(`knowledge-turso acceptance on ${kind === 'memory' ? ':memory:' : 'a file: URL'}`, () => {
    const store = storeOf(kind);
    afterAll(() => store.closeAll());

    it('indexes Chinese text and finds it with a fixed fake embedder', async () => {
      const adapter = store.adapter();
      const s = source('zh');
      await adapter.upsert(
        [doc(s, '1', '合同到期前三十天提醒客户续约'), doc(s, '2', '仓库盘点每月一次，由物流部负责')],
        ctx(s),
      );
      const hits = await adapter.search('客户续约提醒', { source: s, topK: 5, index: { fingerprint: FP_A.fingerprint } });
      expect(hits[0]).toMatchObject({ documentId: `${s.id}:1`, snippet: '合同到期前三十天提醒客户续约' });
      expect(hits[0].score).toBeGreaterThan(0.3);
    });

    it('does not embed a passage again when its text is unchanged; embeds only what changed', async () => {
      const embedder = new FakeEmbedder();
      const adapter = store.adapter({ embedder });
      const s = source('rehash');
      const two = (second: string): KnowledgeDocument => ({
        ...doc(s, '1', `granite quarry. ${second}`),
        chunks: [
          { id: `${s.id}:1#0`, documentId: `${s.id}:1`, index: 0, content: 'granite quarry' },
          { id: `${s.id}:1#1`, documentId: `${s.id}:1`, index: 1, content: second },
        ],
      });
      await adapter.upsert([two('marble cliffs')], ctx(s));
      expect(embedder.texts).toEqual(['granite quarry', 'marble cliffs']);
      await adapter.upsert([two('marble cliffs')], ctx(s));
      expect(embedder.calls).toBe(1);
      await adapter.upsert([two('basalt columns')], ctx(s));
      expect(embedder.texts.slice(2)).toEqual(['basalt columns']);
      const hits = await adapter.search('basalt granite', { source: s, topK: 5 });
      expect(hits.map((h) => h.chunkId).sort()).toEqual([`${s.id}:1#0`, `${s.id}:1#1`]);
    });

    for (const [label, next] of [
      ['the same width', () => new FakeEmbedder(64, 'fake-other-model')],
      ['another width', () => new FakeEmbedder(96, 'fake-wider-model')],
    ] as const) {
      it(`a changed model (${label}) builds a new generation table; the old one is not served under the new fingerprint, then dropped`, async () => {
        let embedder: IEmbedder = new FakeEmbedder(64, 'fake-first-model');
        const client = store.client();
        const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: () => embedder });
        const s = source(`model_${label.replace(/\W/g, '_')}`);
        const rows: Row[] = [
          { id: 'r1', body: 'glacier valley ice', status: 'published' },
          { id: 'r2', body: 'harbour crane night', status: 'published' },
        ];
        const svc = new KnowledgeService({ dataEngine: rowsEngine(rows) });
        svc.registerAdapter('under_test', adapter);
        svc.registerSource(s);
        expect(await svc.reindexSource(s.id)).toMatchObject({ ok: true, indexed: 2 });
        expect(await tables(client, `knowledge_${s.id}_g%`)).toEqual([`knowledge_${s.id}_g1`]);
        const before = await adapter.indexStatus(ctx(s));

        embedder = next();
        // The new model's fingerprint is not the stored one: refused, never ranked against the old vectors.
        expect(await refusal(svc.search('glacier', { topK: 5, executionContext: SYSTEM }))).toMatchObject({
          code: KNOWLEDGE_REBUILD_REQUIRED,
          status: 409,
        });
        expect(await svc.reindexSource(s.id)).toMatchObject({ ok: true, indexed: 2, skipped: 0 });
        expect(await tables(client, `knowledge_${s.id}_g%`)).toEqual([`knowledge_${s.id}_g2`]);
        const after = await adapter.indexStatus(ctx(s));
        expect(after.fingerprint).toBeDefined();
        expect(after.fingerprint).not.toBe(before.fingerprint);
        const hits = await svc.search('glacier', { topK: 5, executionContext: SYSTEM });
        expect(hits.map((h) => h.documentId)).toEqual([`${s.id}:r1`]);
        const width = await client.execute(
          `SELECT dim, model FROM knowledge_generation WHERE source_id = '${s.id}'`,
        );
        expect(width.rows.map((r) => [Number(r.dim), r.model])).toEqual([[embedder.dimensions, embedder.model]]);
      });
    }

    it('while a build runs, the old generation answers its own fingerprint and the new one is refused as being rebuilt', async () => {
      const client = store.client();
      const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      const s = source('midbuild');
      await adapter.upsert([doc(s, '1', 'granite quarry')], ctx(s));
      const FP_B = { fingerprint: 'fp-test:b', recipeHash: 'rh-test:1' };
      await adapter.beginBuild(ctx(s, FP_B));
      expect(await tables(client, `knowledge_${s.id}_g%`)).toEqual([`knowledge_${s.id}_g1`, `knowledge_${s.id}_g2`]);
      const err = await refusal(adapter.search('granite', { source: s, topK: 5, index: { fingerprint: FP_B.fingerprint } }));
      expect(err).toMatchObject({ code: KNOWLEDGE_REBUILD_REQUIRED, status: 409 });
      expect(String(err.message)).toMatch(/is being rebuilt/);
      // A third fingerprint abandons the unfinished build: one builder per source.
      const FP_C = { fingerprint: 'fp-test:c', recipeHash: 'rh-test:1' };
      await adapter.beginBuild(ctx(s, FP_C));
      const rows = await client.execute(`SELECT generation, fingerprint, state FROM knowledge_generation WHERE source_id = '${s.id}' ORDER BY generation`);
      expect(rows.rows.map((r) => [Number(r.generation), r.fingerprint, r.state])).toEqual([
        [1, FP_A.fingerprint, 'active'],
        [2, FP_C.fingerprint, 'building'],
      ]);
      await expect(adapter.upsert([doc(s, '1', 'marble')], ctx(s, FP_B))).rejects.toMatchObject({ code: KNOWLEDGE_REBUILD_REQUIRED });
      expect(await adapter.indexStatus(ctx(s))).toEqual({ fingerprint: FP_A.fingerprint, building: true });
    });

    it("two organizations never see each other's hits: the filter runs in SQL, before ranking", async () => {
      const adapter = store.adapter();
      const s = source('orgs');
      await adapter.upsert(
        [
          doc(s, 'a', 'alpine meadow harbour', { organizationId: 'org_a' }),
          doc(s, 'b', 'alpine meadow alpine meadow', { organizationId: 'org_b' }),
        ],
        ctx(s),
      );
      const asA = await adapter.search('alpine meadow', { source: s, topK: 1, organizationIds: ['org_a'] });
      expect(asA.map((h) => h.documentId)).toEqual([`${s.id}:a`]);
      const asB = await adapter.search('alpine meadow harbour', { source: s, topK: 5, organizationIds: ['org_b'] });
      expect(asB.map((h) => h.documentId)).toEqual([`${s.id}:b`]);
    });

    it('the metadata filter runs before ranking, by JSON equality', async () => {
      const adapter = store.adapter();
      const s = source('meta');
      await adapter.upsert(
        [
          doc(s, '1', 'tidal pool tidal pool', { metadata: { status: 'draft', pinned: true, rank: 2 } }),
          doc(s, '2', 'tidal pool rocks', { metadata: { status: 'published', pinned: false, rank: 2 } }),
        ],
        ctx(s),
      );
      const top = await adapter.search('tidal pool', { source: s, topK: 1, filter: { status: 'published' } });
      expect(top.map((h) => h.documentId)).toEqual([`${s.id}:2`]);
      expect((await adapter.search('tidal', { source: s, topK: 5, filter: { pinned: true } })).map((h) => h.documentId)).toEqual([`${s.id}:1`]);
      expect((await adapter.search('tidal', { source: s, topK: 5, filter: { rank: 2 } })).length).toBe(2);
      expect(await adapter.search('tidal', { source: s, topK: 5, filter: { rank: '2' } })).toEqual([]);
    });

    it('a record scope matches a field by its stored key, and a string or number only, bound as values', async () => {
      const adapter = store.adapter();
      const s = source('scoped');
      await adapter.upsert(
        [
          doc(s, '1', 'harbour rules', { metadata: { 'policy.id': 'p1', flag: true } }),
          doc(s, '2', 'harbour rules', { metadata: { policy: { id: 'p1' }, flag: 'true' } }),
          doc(s, '3', 'harbour rules', { metadata: { "it's": ['x', 7.5] } }),
        ],
        ctx(s),
      );
      const ids = async (scope: NonNullable<Parameters<TursoKnowledgeAdapter['search']>[1]['scope']>) =>
        (await adapter.search('harbour rules', { source: s, topK: 5, scope })).map((h) => h.documentId).sort();
      // A dotted name is a key, never a JSON path into a nested object.
      expect(await ids([{ kind: 'metadata', field: 'policy.id', ids: ['p1'] }])).toEqual([`${s.id}:1`]);
      // A boolean matches no id, by either spelling; the string 'true' does. An object matches nothing.
      expect(await ids([{ kind: 'metadata', field: 'flag', ids: ['true'] }])).toEqual([`${s.id}:2`]);
      expect(await ids([{ kind: 'metadata', field: 'flag', ids: ['1'] }])).toEqual([]);
      expect(await ids([{ kind: 'metadata', field: 'policy', ids: ['{"id":"p1"}'] }])).toEqual([]);
      // A quote in a name is a value; a number in a list matches its text.
      expect(await ids([{ kind: 'metadata', field: "it's", ids: ['7.5'] }])).toEqual([`${s.id}:3`]);
      expect(await ids([{ kind: 'record', ids: ["1' OR '1'='1"] }])).toEqual([]);
    });

    it("a table of the store's earlier releases answers 'reindex needed', and is replaced by the first build", async () => {
      const client = store.client();
      const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      const s = source('legacy');
      // The cloud-repo release's layout: no generation, no hashes, no organization.
      await client.execute(`CREATE TABLE knowledge_legacy (
        chunk_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, source_record_id TEXT, content TEXT NOT NULL,
        title TEXT, metadata TEXT, embedding F32_BLOB(64) NOT NULL)`);
      await client.execute({
        sql: "INSERT INTO knowledge_legacy VALUES ('legacy:r1#0', 'legacy:r1', 'r1', 'glacier', NULL, '{}', vector32(?))",
        args: [`[${[1, ...new Array<number>(63).fill(0)].join(',')}]`],
      });

      expect(await refusal(adapter.search('glacier', { source: s, topK: 5 }))).toMatchObject({ code: KNOWLEDGE_REBUILD_REQUIRED, status: 409 });
      // A write outside a build would mix the new store with the old table: refused.
      expect(await refusal(adapter.upsert([doc(s, 'r1', 'glacier')], ctx(s)))).toMatchObject({ code: KNOWLEDGE_REBUILD_REQUIRED });
      expect(await adapter.indexStatus(ctx(s))).toEqual({});

      const rows: Row[] = [{ id: 'r1', body: 'glacier valley ice', status: 'published' }];
      const svc = new KnowledgeService({ dataEngine: rowsEngine(rows) });
      svc.registerAdapter('under_test', adapter);
      svc.registerSource(s);
      expect(await svc.reindexSource(s.id)).toMatchObject({ ok: true, indexed: 1 });
      expect(await tables(client, 'knowledge_legacy%')).toEqual(['knowledge_legacy_g1']);
      const hits = await svc.search('glacier', { topK: 5, executionContext: SYSTEM });
      expect(hits.map((h) => h.documentId)).toEqual([`${s.id}:r1`]);
    });

    it('a generation table of another source is never taken for a legacy table', async () => {
      const client = store.client();
      const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      // Source `a`'s first generation is `knowledge_a_g1`, the legacy name of a source `a_g1`.
      await adapter.upsert([doc(source('a'), '1', 'copper kettle')], ctx(source('a')));
      expect(await adapter.search('copper', { source: source('a_g1'), topK: 5 })).toEqual([]);
      await adapter.upsert([doc(source('a_g1'), '1', 'copper wire')], ctx(source('a_g1')));
      expect((await adapter.search('copper', { source: source('a'), topK: 5 })).map((h) => h.snippet)).toEqual(['copper kettle']);
      expect((await adapter.search('copper', { source: source('a_g1'), topK: 5 })).map((h) => h.snippet)).toEqual(['copper wire']);
    });

    it("the store's own generation table is never taken for a legacy table, whatever the source is called", async () => {
      const client = store.client();
      const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      const other = source('other');
      await adapter.upsert([doc(other, '1', 'amber lamp')], ctx(other));
      // `knowledge_generation` is the legacy name a source `generation` would have.
      const s = source('generation');
      expect(await adapter.search('amber', { source: s, topK: 5 })).toEqual([]);
      const svc = new KnowledgeService({ dataEngine: rowsEngine([{ id: 'r1', body: 'amber resin', status: 'published' }]) });
      svc.registerAdapter('under_test', adapter);
      svc.registerSource(s);
      expect(await svc.reindexSource(s.id)).toMatchObject({ ok: true, indexed: 1 });
      expect(await tables(client, 'knowledge_generation')).toEqual(['knowledge_generation']);
      expect((await adapter.search('amber', { source: other, topK: 5 })).map((h) => h.snippet)).toEqual(['amber lamp']);
      expect((await adapter.search('amber', { source: s, topK: 5 })).map((h) => h.documentId)).toEqual([`${s.id}:r1`]);
    });

    it('a table with the legacy columns but no F32_BLOB vector is not a legacy table', async () => {
      const client = store.client();
      const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      await client.execute(`CREATE TABLE knowledge_blobs (
        chunk_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, source_record_id TEXT, content TEXT NOT NULL,
        title TEXT, metadata TEXT, embedding BLOB)`);
      const s = source('blobs');
      expect(await adapter.search('x', { source: s, topK: 5 })).toEqual([]);
      await adapter.upsert([doc(s, '1', 'flint')], ctx(s));
      await adapter.completeBuild(ctx(s));
      expect(await tables(client, 'knowledge_blobs%')).toEqual(['knowledge_blobs', 'knowledge_blobs_g1']);
    });

    it('a search whose generation keeps being switched under it stops after three attempts, CONCURRENT_MODIFICATION 409, as pgvector answers', async () => {
      const client = store.client();
      const s = source('churn');
      const builder = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      await builder.upsert([doc(s, '1', 'spruce')], ctx(s));
      let n = 0;
      const churning = new (class extends FakeEmbedder {
        override async embed(texts: string[]): Promise<number[][]> {
          const next = { fingerprint: `fp-test:churn-${++n}`, recipeHash: 'rh-test:1' };
          await builder.beginBuild(ctx(s, next));
          await builder.completeBuild(ctx(s, next));
          return super.embed(texts);
        }
      })();
      const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: churning });
      expect(await refusal(adapter.search('spruce', { source: s, topK: 5 }))).toMatchObject({ code: 'CONCURRENT_MODIFICATION', status: 409 });
      expect(n).toBe(3);
    });

    it('a table the store did not make is never dropped, under a legacy name or a generation name', async () => {
      const client = store.client();
      const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      // A database shared with an application that keeps a table of its own.
      await client.execute('CREATE TABLE knowledge_articles (id TEXT PRIMARY KEY, body TEXT)');
      await client.execute("INSERT INTO knowledge_articles VALUES ('a1', 'kept')");
      const s = source('articles');
      expect(await adapter.search('kept', { source: s, topK: 5 })).toEqual([]);
      const svc = new KnowledgeService({ dataEngine: rowsEngine([{ id: 'r1', body: 'slate roof', status: 'published' }]) });
      svc.registerAdapter('under_test', adapter);
      svc.registerSource(s);
      expect(await svc.reindexSource(s.id)).toMatchObject({ ok: true, indexed: 1 });
      expect((await client.execute('SELECT body FROM knowledge_articles')).rows.map((r) => r.body)).toEqual(['kept']);
      // Under the name of a generation table it is refused, and left as it is.
      await client.execute('CREATE TABLE knowledge_notes_g1 (id TEXT PRIMARY KEY, body TEXT)');
      const notes = source('notes');
      expect(await refusal(adapter.upsert([doc(notes, '1', 'x')], ctx(notes)))).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
      expect(await tables(client, 'knowledge_notes_g1')).toEqual(['knowledge_notes_g1']);
    });

    it('a write planned for a generation switched while it embedded is refused, never written into another', async () => {
      const client = store.client();
      const s = source('switched');
      const FP_B = { fingerprint: 'fp-test:b', recipeHash: 'rh-test:1' };
      const other = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      await other.upsert([doc(s, '1', 'birch bark')], ctx(s));
      // While this adapter's embedder answers, another builder switches the source to FP_B.
      const switching = new (class extends FakeEmbedder {
        override async embed(texts: string[]): Promise<number[][]> {
          await other.beginBuild(ctx(s, FP_B));
          await other.completeBuild(ctx(s, FP_B));
          return super.embed(texts);
        }
      })();
      const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: switching });
      expect(await refusal(adapter.upsert([doc(s, '2', 'birch twig')], ctx(s)))).toMatchObject({ code: KNOWLEDGE_REBUILD_REQUIRED });
      expect(await other.search('birch', { source: s, topK: 5, index: FP_B })).toEqual([]);
    });

    it('a first generation is made afresh: a passage table left without its generation row is never adopted', async () => {
      const client = store.client();
      const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      const s = source('fresh');
      await adapter.upsert([doc(s, 'old', 'cedar chest')], ctx(s));
      await client.execute({ sql: 'DELETE FROM knowledge_generation WHERE source_id = ?', args: [s.id] });
      await adapter.upsert([doc(s, 'new', 'cedar fence')], ctx(s));
      expect((await adapter.search('cedar', { source: s, topK: 5 })).map((h) => h.documentId)).toEqual([`${s.id}:new`]);
    });

    it('concurrent calls on one client are queued, never refused for a held connection', async () => {
      const adapter = store.adapter();
      const s = source('queue');
      await adapter.upsert([doc(s, '0', 'seed passage')], ctx(s));
      const work = Array.from({ length: 12 }, (_, i) =>
        i % 2 === 0
          ? adapter.upsert([doc(s, String(i), `passage number ${i} lantern`)], ctx(s))
          : adapter.search('lantern', { source: s, topK: 3 }),
      );
      await expect(Promise.all(work)).resolves.toBeDefined();
      expect((await adapter.search('lantern', { source: s, topK: 10 })).length).toBe(6);
    });

    it('refuses a source id that cannot name a table, before any SQL', async () => {
      const adapter = store.adapter();
      const bad = source('x"; DROP TABLE knowledge_generation; --');
      await expect(adapter.upsert([doc(bad, '1', 'x')], ctx(bad))).rejects.toThrow(/cannot name a table/);
      expect(await refusal(adapter.listDocuments(ctx(bad), { limit: 1 }))).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      // The spec's own pattern, of any length.
      const long = source(`s_${'a'.repeat(80)}`);
      await adapter.upsert([doc(long, '1', 'long name')], ctx(long));
      expect((await adapter.search('long name', { source: long, topK: 1 })).length).toBe(1);
      await expect(adapter.search('x', { source: bad, topK: 1 })).rejects.toThrow(/cannot name a table/);
    });
  });
}

describe('knowledge-turso without a database or an embedder', () => {
  it('answers every call SERVICE_UNAVAILABLE in one sentence; the reason is operator text in remedy and healthCheck', async () => {
    const adapter = new TursoKnowledgeAdapter({ embedder: new FakeEmbedder(), unavailable: 'no native build for win32-arm64' });
    const s = source('none');
    const err = await refusal(adapter.search('x', { source: s, topK: 1 }));
    expect(err).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(String(err.message)).not.toMatch(/win32/);
    expect(err.remedy).toBe('no native build for win32-arm64');
    expect(await adapter.healthCheck()).toEqual({ ok: false, message: expect.stringContaining('win32-arm64') });
  });

  it('answers SERVICE_UNAVAILABLE without an embedder, before reading the index', async () => {
    const store = storeOf('memory');
    const adapter = store.adapter({ embedder: () => undefined });
    expect(await refusal(adapter.search('x', { source: source('e'), topK: 1 }))).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(adapter.embedding).toBeUndefined();
    store.closeAll();
  });

  it('bounds a request that never answers: SERVICE_UNAVAILABLE, and the queue moves on', async () => {
    let stalls = true;
    const store = storeOf('memory');
    const real = store.client();
    // A client whose next request hangs, as a remote database can.
    const client = new Proxy(real, {
      get(target, key, receiver) {
        if (key === 'execute') {
          return (...args: Parameters<Client['execute']>) => {
            if (stalls) {
              stalls = false;
              return new Promise(() => undefined);
            }
            return target.execute(...args);
          };
        }
        const value = Reflect.get(target, key, receiver) as unknown;
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    }) as Client;
    const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder(), requestTimeoutMs: 50 });
    const health = await adapter.healthCheck();
    expect(health).toMatchObject({ ok: false, message: expect.stringContaining('did not answer in time') });
    expect(await adapter.healthCheck()).toEqual({ ok: true, message: 'libSQL vectors ready' });
    expect(() => new TursoKnowledgeAdapter({ client, embedder: new FakeEmbedder(), requestTimeoutMs: 0 })).toThrow(RangeError);
    store.closeAll();
  });

  it('answers listDocuments SERVICE_UNAVAILABLE without an embedder, never KNOWLEDGE_REBUILD_REQUIRED', async () => {
    const store = storeOf('memory');
    const client = store.client();
    const s = source('listed');
    await new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() }).upsert([doc(s, '1', 'x')], ctx(s));
    const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: () => undefined });
    // Without an embedder the service's fingerprint is another one: answered 503, not 409.
    const other = { fingerprint: 'fp-test:no-embedder', recipeHash: 'rh-test:1' };
    expect(await refusal(adapter.listDocuments(ctx(s, other), { limit: 5 }))).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    store.closeAll();
  });
});

/** A client whose every request (and every request of its transactions) is delayed by `ms`; `stallAt` hangs the Nth. */
function slowClient(real: Client, ms: number, stallAt?: (request: number) => boolean): Client {
  let request = 0;
  const delayed = <T extends object>(target: T, methods: string[], wrap?: (v: unknown) => unknown): T =>
    new Proxy(target, {
      get(t, key) {
        const value = Reflect.get(t, key, t) as unknown;
        if (typeof value !== 'function') return value;
        const fn = (value as (...a: unknown[]) => unknown).bind(t);
        if (typeof key !== 'string' || !methods.includes(key)) return fn;
        return async (...args: unknown[]) => {
          request += 1;
          if (stallAt?.(request)) return new Promise(() => undefined);
          await new Promise((r) => setTimeout(r, ms));
          const answered = await (fn(...args) as Promise<unknown>);
          return key === 'transaction' && wrap ? wrap(answered) : answered;
        };
      },
    });
  return delayed(real, ['execute', 'batch', 'transaction'], (tx) => delayed(tx as object, ['execute', 'batch', 'commit', 'rollback']));
}

describe('knowledge-turso with a request bound (a remote database)', () => {
  it('bounds each request, not a page: a page of 40 documents on a slow database is written whole', async () => {
    const store = storeOf('file');
    const client = slowClient(store.client(), 15);
    const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder(), requestTimeoutMs: 120 });
    const s = source('slow');
    const docs = Array.from({ length: 40 }, (_, i) =>
      doc(s, String(i), `heron ${i}`, {
        chunks: [0, 1].map((index) => ({
          id: `${s.id}:${i}#${index}`,
          documentId: `${s.id}:${i}`,
          index,
          content: `heron ${i} ${index === 0 ? 'wading' : 'flying'}`,
        })),
      }),
    );
    await adapter.upsert(docs, ctx(s));
    // Again, unchanged: every passage is rewritten in place, still within the bound.
    await adapter.upsert(docs, ctx(s));
    expect((await adapter.listDocuments(ctx(s), { limit: 100 })).documents.length).toBe(40);
    store.closeAll();
  });

  it('a request that stalls inside a write answers SERVICE_UNAVAILABLE naming requestTimeoutMs, and nothing of the write lands', async () => {
    const store = storeOf('file');
    const real = store.client();
    const s = source('stall');
    const plain = new TursoKnowledgeAdapter({ id: 'under_test', client: real, embedder: new FakeEmbedder() });
    await plain.upsert([doc(s, 'seed', 'otter')], ctx(s));
    let batches = 0;
    // The second batch inside a write transaction hangs, as a remote database can: the first document is written by then.
    const client = slowClient(real, 0, () => false);
    const hanging = new Proxy(client, {
      get(t, key) {
        if (key !== 'transaction') return Reflect.get(t, key, t);
        return async (...args: unknown[]) => {
          const tx = await (t.transaction as (...a: unknown[]) => Promise<object>).apply(t, args);
          return new Proxy(tx, {
            get(x, k) {
              const v = Reflect.get(x, k, x) as unknown;
              if (k === 'batch' && ++batches === 2) return () => new Promise(() => undefined);
              return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(x) : v;
            },
          });
        };
      },
    }) as Client;
    const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client: hanging, embedder: new FakeEmbedder(), requestTimeoutMs: 80 });
    const err = await refusal(adapter.upsert([doc(s, 'a', 'otter pup'), doc(s, 'b', 'otter den')], ctx(s)));
    expect(err).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503, remedy: expect.stringContaining('requestTimeoutMs') });
    await new Promise((r) => setTimeout(r, 100));
    expect((await plain.listDocuments(ctx(s), { limit: 10 })).documents.map((d) => d.documentId)).toEqual([`${s.id}:seed`]);
    // The next write goes through.
    await adapter.upsert([doc(s, 'a', 'otter pup')], ctx(s));
    expect((await plain.listDocuments(ctx(s), { limit: 10 })).documents.length).toBe(2);
    store.closeAll();
  });
});
