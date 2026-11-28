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
import { containsPattern, ftsPhrase, keywordTerms } from '../sql.js';
import { FakeEmbedder, storeOf, type StoreKind } from './turso.testkit.js';

const source = (id: string, extra: Record<string, unknown> = {}): KnowledgeSource =>
  ({
    name: id,
    label: id,
    adapter: 'under_test',
    source: { kind: 'object', object: 'article', content: ['body'], metadataFields: ['status'], ...extra },
  }) as KnowledgeSource;

const FP_A = { fingerprint: 'fp-test:a', recipeHash: 'rh-test:1' };
const ctx = (s: KnowledgeSource, index = FP_A): AdapterContext => ({ source: s, reason: 'manual', index });

function doc(s: KnowledgeSource, n: string, content: string, extra: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  const id = `${s.name}:${n}`;
  return {
    id,
    sourceId: s.name,
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
    // A passage table's keyword index (`<table>-kw`, `<table>-fts` and FTS5's
    // own tables) is read by `keywordObjects`, never here.
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ? AND instr(name, '-') = 0 ORDER BY name",
    args: [like],
  });
  return found.rows.map((r) => String(r.name));
}

/** The keyword-index objects (map, FTS5 table, triggers) of a passage table, by name. */
async function keywordObjects(client: Client, table: string): Promise<string[]> {
  const found = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE name IN (?, ?, ?, ?, ?) ORDER BY name",
    args: [`${table}-fts`, `${table}-kw`, `${table}-kw-delete`, `${table}-kw-insert`, `${table}-kw-update`],
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
      expect(hits[0]).toMatchObject({ documentId: `${s.name}:1`, snippet: '合同到期前三十天提醒客户续约' });
      expect(hits[0].score).toBeGreaterThan(0.3);
    });

    it('does not embed a passage again when its text is unchanged; embeds only what changed', async () => {
      const embedder = new FakeEmbedder();
      const adapter = store.adapter({ embedder });
      const s = source('rehash');
      const two = (second: string): KnowledgeDocument => ({
        ...doc(s, '1', `granite quarry. ${second}`),
        chunks: [
          { id: `${s.name}:1#0`, documentId: `${s.name}:1`, index: 0, content: 'granite quarry' },
          { id: `${s.name}:1#1`, documentId: `${s.name}:1`, index: 1, content: second },
        ],
      });
      await adapter.upsert([two('marble cliffs')], ctx(s));
      expect(embedder.texts).toEqual(['granite quarry', 'marble cliffs']);
      await adapter.upsert([two('marble cliffs')], ctx(s));
      expect(embedder.calls).toBe(1);
      await adapter.upsert([two('basalt columns')], ctx(s));
      expect(embedder.texts.slice(2)).toEqual(['basalt columns']);
      const hits = await adapter.search('basalt granite', { source: s, topK: 5 });
      expect(hits.map((h) => h.chunkId).sort()).toEqual([`${s.name}:1#0`, `${s.name}:1#1`]);
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
        expect(await svc.reindexSource(s.name)).toMatchObject({ ok: true, indexed: 2 });
        expect(await tables(client, `knowledge_${s.name}_g%`)).toEqual([`knowledge_${s.name}_g1`]);
        const before = await adapter.indexStatus(ctx(s));

        embedder = next();
        // The new model's fingerprint is not the stored one: refused, never ranked against the old vectors.
        expect(await refusal(svc.search('glacier', { topK: 5, executionContext: SYSTEM }))).toMatchObject({
          code: KNOWLEDGE_REBUILD_REQUIRED,
          status: 409,
        });
        expect(await svc.reindexSource(s.name)).toMatchObject({ ok: true, indexed: 2, skipped: 0 });
        expect(await tables(client, `knowledge_${s.name}_g%`)).toEqual([`knowledge_${s.name}_g2`]);
        const after = await adapter.indexStatus(ctx(s));
        expect(after.fingerprint).toBeDefined();
        expect(after.fingerprint).not.toBe(before.fingerprint);
        const hits = await svc.search('glacier', { topK: 5, executionContext: SYSTEM });
        expect(hits.map((h) => h.documentId)).toEqual([`${s.name}:r1`]);
        const width = await client.execute(
          `SELECT dim, model FROM knowledge_generation WHERE source_id = '${s.name}'`,
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
      expect(await tables(client, `knowledge_${s.name}_g%`)).toEqual([`knowledge_${s.name}_g1`, `knowledge_${s.name}_g2`]);
      const err = await refusal(adapter.search('granite', { source: s, topK: 5, index: { fingerprint: FP_B.fingerprint } }));
      expect(err).toMatchObject({ code: KNOWLEDGE_REBUILD_REQUIRED, status: 409 });
      expect(String(err.message)).toMatch(/is being rebuilt/);
      // A third fingerprint abandons the unfinished build: one builder per source.
      const FP_C = { fingerprint: 'fp-test:c', recipeHash: 'rh-test:1' };
      await adapter.beginBuild(ctx(s, FP_C));
      const rows = await client.execute(`SELECT generation, fingerprint, state FROM knowledge_generation WHERE source_id = '${s.name}' ORDER BY generation`);
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
      expect(asA.map((h) => h.documentId)).toEqual([`${s.name}:a`]);
      const asB = await adapter.search('alpine meadow harbour', { source: s, topK: 5, organizationIds: ['org_b'] });
      expect(asB.map((h) => h.documentId)).toEqual([`${s.name}:b`]);
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
      expect(top.map((h) => h.documentId)).toEqual([`${s.name}:2`]);
      expect((await adapter.search('tidal', { source: s, topK: 5, filter: { pinned: true } })).map((h) => h.documentId)).toEqual([`${s.name}:1`]);
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
      expect(await ids([{ kind: 'metadata', field: 'policy.id', ids: ['p1'] }])).toEqual([`${s.name}:1`]);
      // A boolean matches no id, by either spelling; the string 'true' does. An object matches nothing.
      expect(await ids([{ kind: 'metadata', field: 'flag', ids: ['true'] }])).toEqual([`${s.name}:2`]);
      expect(await ids([{ kind: 'metadata', field: 'flag', ids: ['1'] }])).toEqual([]);
      expect(await ids([{ kind: 'metadata', field: 'policy', ids: ['{"id":"p1"}'] }])).toEqual([]);
      // A quote in a name is a value; a number in a list matches its text.
      expect(await ids([{ kind: 'metadata', field: "it's", ids: ['7.5'] }])).toEqual([`${s.name}:3`]);
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
      expect(await svc.reindexSource(s.name)).toMatchObject({ ok: true, indexed: 1 });
      expect(await tables(client, 'knowledge_legacy%')).toEqual(['knowledge_legacy_g1']);
      const hits = await svc.search('glacier', { topK: 5, executionContext: SYSTEM });
      expect(hits.map((h) => h.documentId)).toEqual([`${s.name}:r1`]);
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
      expect(await svc.reindexSource(s.name)).toMatchObject({ ok: true, indexed: 1 });
      expect(await tables(client, 'knowledge_generation')).toEqual(['knowledge_generation']);
      expect((await adapter.search('amber', { source: other, topK: 5 })).map((h) => h.snippet)).toEqual(['amber lamp']);
      expect((await adapter.search('amber', { source: s, topK: 5 })).map((h) => h.documentId)).toEqual([`${s.name}:r1`]);
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
      expect(await svc.reindexSource(s.name)).toMatchObject({ ok: true, indexed: 1 });
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
      await client.execute({ sql: 'DELETE FROM knowledge_generation WHERE source_id = ?', args: [s.name] });
      await adapter.upsert([doc(s, 'new', 'cedar fence')], ctx(s));
      expect((await adapter.search('cedar', { source: s, topK: 5 })).map((h) => h.documentId)).toEqual([`${s.name}:new`]);
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

    it('a search narrowed to a few records reads them through the source_record_id index, never by scanning the table', async () => {
      // Every statement the adapter runs, so the search's own SQL is planned below.
      const client = store.client();
      const ran: Array<{ sql: string; args: unknown }> = [];
      const recording = new Proxy(client, {
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop, target);
          if (prop === 'execute') {
            return (stmt: { sql: string; args?: unknown }) => {
              ran.push({ sql: stmt.sql, args: stmt.args });
              return target.execute(stmt as never);
            };
          }
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });
      const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client: recording, embedder: new FakeEmbedder() });
      const s = source('narrowed');
      await adapter.upsert(
        Array.from({ length: 40 }, (_, i) => doc(s, `r${i}`, `harbour crane passage ${i}`)),
        ctx(s),
      );
      ran.length = 0;
      const hits = await adapter.search('harbour crane', {
        source: s, topK: 5, organizationIds: ['org_a'], scope: [{ kind: 'record', ids: ['r3', 'r7'] }],
      });
      expect(hits).toEqual([]); // no passage carries org_a: the organization filter still applies
      const search = ran.find((r) => r.sql.trimStart().startsWith('WITH'));
      expect(search).toBeDefined();
      const plan = await client.execute({ sql: `EXPLAIN QUERY PLAN ${search!.sql}`, args: search!.args as never });
      const details = plan.rows.map((r) => String(r.detail));
      const table = `knowledge_${s.name}_g1`;
      expect(details.some((d) => d.includes(`USING INDEX ${table}_record`))).toBe(true);
      // Neither leg nor the keyword statistics reads the passage table whole (its
      // keyword index, `<table>-fts`, is searched by MATCH, a virtual table's own plan).
      expect(details.filter((d) => new RegExp(`^SCAN (${table}|p)(\\s|$)`).test(d))).toEqual([]);
    });
  });
}

/** A build's context: the walk's calls carry `reason: 'reindex'`. */
const buildCtx = (s: KnowledgeSource, index = FP_A): AdapterContext => ({ source: s, reason: 'reindex', index });

/** What the store holds for a source: its generation rows (`n:fingerprint:state`) and its passage tables. */
async function heldFor(client: Client, s: KnowledgeSource): Promise<{ generations: string[]; tables: string[] }> {
  const rows = await client.execute({
    sql: 'SELECT generation, fingerprint, state FROM knowledge_generation WHERE source_id = ? ORDER BY generation',
    args: [s.name],
  });
  return {
    generations: rows.rows.map((r) => `${Number(r.generation)}:${String(r.fingerprint)}:${String(r.state)}`),
    tables: await tables(client, `knowledge_${s.name}_g%`),
  };
}

const NOTHING = { generations: [], tables: [] };

for (const kind of ['memory', 'file'] as StoreKind[]) {
  describe(`knowledge-turso: a build whose source is dropped while it runs, on ${kind === 'memory' ? ':memory:' : 'a file: URL'}`, () => {
    const store = storeOf(kind);
    afterAll(() => store.closeAll());

    /**
     * Two adapters over one store, standing for two processes: each keeps its
     * own builds; on a file, each has its own connection to the database.
     */
    function twoProcesses(embedder: IEmbedder = new FakeEmbedder()) {
      const at = store.url();
      const first = store.client(at);
      const second = kind === 'file' ? store.client(at) : first;
      return {
        client: first,
        a: new TursoKnowledgeAdapter({ id: 'under_test', client: first, embedder }),
        b: new TursoKnowledgeAdapter({ id: 'under_test', client: second, embedder: new FakeEmbedder() }),
      };
    }

    const FP_B = { fingerprint: 'fp-test:b', recipeHash: 'rh-test:1' };
    const FP_C = { fingerprint: 'fp-test:c', recipeHash: 'rh-test:1' };

    const begins = [
      ['beside the active generation', FP_B, true],
      ['inside the active generation', FP_A, true],
      ['of a source that held nothing', FP_A, false],
    ] as const;
    const calls = {
      write: (a: TursoKnowledgeAdapter, c: AdapterContext) => a.upsert([doc(c.source as KnowledgeSource, '2', 'granite quarry')], c),
      list: (a: TursoKnowledgeAdapter, c: AdapterContext) => a.listDocuments(c, { limit: 10 }),
      complete: (a: TursoKnowledgeAdapter, c: AdapterContext) => a.completeBuild(c),
    } as const;

    for (const [shape, index, seeded] of begins) {
      for (const [call, run] of Object.entries(calls)) {
        it(`a build ${shape}, then a drop in another process: the build's ${call} is refused LOCK_CONFLICT, nothing is held, and the source builds again from nothing`, async () => {
          const { client, a, b } = twoProcesses();
          const s = source(`drop_${seeded ? (index === FP_A ? 'inside' : 'beside') : 'empty'}_${call}`);
          if (seeded) await a.upsert([doc(s, '1', 'granite quarry')], ctx(s));
          await a.beginBuild(buildCtx(s, index));
          await b.dropSource(ctx(s));

          expect(await refusal(run(a, buildCtx(s, index)))).toMatchObject({ code: 'LOCK_CONFLICT', status: 409 });
          expect(await heldFor(client, s)).toEqual(NOTHING);
          expect(await b.indexStatus(ctx(s))).toEqual({});

          // The build ended: one that begins after the drop builds the source from nothing.
          await a.beginBuild(buildCtx(s, index));
          await a.upsert([doc(s, '3', 'basalt columns')], buildCtx(s, index));
          await a.completeBuild(buildCtx(s, index));
          expect(await heldFor(client, s)).toEqual({ generations: [`1:${index.fingerprint}:active`], tables: [`knowledge_${s.name}_g1`] });
          const hits = await b.search('basalt', { source: s, topK: 5, index: { fingerprint: index.fingerprint } });
          expect(hits.map((h) => h.documentId)).toEqual([`${s.name}:3`]);
        });
      }
    }

    it("a drop in the build's own process ends the build the same way", async () => {
      const { client, a } = twoProcesses();
      const s = source('drop_same_process');
      await a.upsert([doc(s, '1', 'granite quarry')], ctx(s));
      await a.beginBuild(buildCtx(s, FP_B));
      await a.dropSource(ctx(s));
      expect(await refusal(a.upsert([doc(s, '2', 'marble')], buildCtx(s, FP_B)))).toMatchObject({ code: 'LOCK_CONFLICT', status: 409 });
      expect(await heldFor(client, s)).toEqual(NOTHING);
    });

    it('a page whose embedding was under way when the drop committed is written nowhere', async () => {
      let drop: (() => Promise<void>) | undefined;
      const embedder = new (class extends FakeEmbedder {
        override async embed(texts: string[]): Promise<number[][]> {
          const now = drop;
          drop = undefined;
          if (now) await now();
          return super.embed(texts);
        }
      })();
      const { client, a, b } = twoProcesses(embedder);
      const s = source('drop_while_embedding');
      await a.upsert([doc(s, '1', 'granite quarry')], ctx(s));
      await a.beginBuild(buildCtx(s, FP_B));
      drop = () => b.dropSource(ctx(s));
      expect(await refusal(a.upsert([doc(s, '2', 'marble')], buildCtx(s, FP_B)))).toMatchObject({ code: 'LOCK_CONFLICT', status: 409 });
      expect(drop).toBeUndefined();
      expect(await heldFor(client, s)).toEqual(NOTHING);
    });

    it('a build another process replaced under another fingerprint is ended the same way; the replacing build goes on', async () => {
      const { client, a, b } = twoProcesses();
      const s = source('replaced_build');
      await a.upsert([doc(s, '1', 'granite quarry')], ctx(s));
      await a.beginBuild(buildCtx(s, FP_B));
      await b.beginBuild(buildCtx(s, FP_C));
      // The replacing build's generation took the number of the one it replaced.
      expect((await heldFor(client, s)).generations).toEqual([`1:${FP_A.fingerprint}:active`, `2:${FP_C.fingerprint}:building`]);
      expect(await refusal(a.upsert([doc(s, '2', 'marble')], buildCtx(s, FP_B)))).toMatchObject({ code: 'LOCK_CONFLICT', status: 409 });
      await b.upsert([doc(s, '3', 'basalt columns')], buildCtx(s, FP_C));
      await b.completeBuild(buildCtx(s, FP_C));
      expect(await b.indexStatus(ctx(s))).toEqual({ fingerprint: FP_C.fingerprint, recipeHash: FP_C.recipeHash });
      expect((await b.search('basalt marble', { source: s, topK: 5, index: FP_C })).map((h) => h.documentId)).toEqual([`${s.name}:3`]);
    });

    for (const [label, next, pause] of [
      ['under another fingerprint', FP_C, 0],
      ['under the same fingerprint, made later', FP_A, 10],
    ] as const) {
      it(`a generation that takes a dropped build's number ${label} is never that build's`, async () => {
        const { client, a, b } = twoProcesses();
        const s = source(`reused_${next === FP_A ? 'same' : 'other'}`);
        await a.beginBuild(buildCtx(s, FP_A));
        await b.dropSource(ctx(s));
        if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
        await b.beginBuild(buildCtx(s, next));
        expect((await heldFor(client, s)).generations).toEqual([`1:${next.fingerprint}:active`]);
        expect(await refusal(a.upsert([doc(s, '1', 'marble')], buildCtx(s, FP_A)))).toMatchObject({ code: 'LOCK_CONFLICT', status: 409 });
        expect(await b.listDocuments(buildCtx(s, next), { limit: 10 })).toEqual({ documents: [] });
      });
    }

    it('through KnowledgeService: a walk whose source another process drops after its first page stops, and leaves nothing', async () => {
      const { client, a, b } = twoProcesses();
      const s = source('drop_mid_walk');
      const rows = Array.from({ length: 250 }, (_, i) => ({ id: `r${String(i + 1).padStart(4, '0')}`, body: `granite ${i + 1}`, status: 'published' }));
      const svc = new KnowledgeService({ dataEngine: rowsEngine(rows) });
      const upsert = a.upsert.bind(a);
      let pages = 0;
      a.upsert = async (batch, c) => {
        await upsert(batch, c);
        pages += 1;
        if (pages === 1) await b.dropSource(ctx(s));
      };
      svc.registerAdapter('under_test', a);
      svc.registerSource(s);

      expect(await svc.reindexSource(s.name)).toMatchObject({ ok: false, indexed: 100 });
      expect(pages).toBe(1);
      expect(await heldFor(client, s)).toEqual(NOTHING);
      expect(await b.indexStatus(ctx(s))).toEqual({});

      // Drop-then-build: the next walk builds the source from nothing.
      a.upsert = upsert;
      expect(await svc.reindexSource(s.name)).toMatchObject({ ok: true, indexed: 250 });
      expect((await heldFor(client, s)).tables).toEqual([`knowledge_${s.name}_g1`]);
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
          id: `${s.name}:${i}#${index}`,
          documentId: `${s.name}:${i}`,
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
    expect((await plain.listDocuments(ctx(s), { limit: 10 })).documents.map((d) => d.documentId)).toEqual([`${s.name}:seed`]);
    // The next write goes through.
    await adapter.upsert([doc(s, 'a', 'otter pup')], ctx(s));
    expect((await plain.listDocuments(ctx(s), { limit: 10 })).documents.length).toBe(2);
    store.closeAll();
  });
});

/**
 * A database shared with object tables (an object's table is named for the
 * object): a table the store did not make under the name of one of its
 * generation tables, or of its generation table, is never dropped or used.
 * Each case puts an object table where a generation row points — the store's
 * own table removed by hand, an object of that name created — and the call
 * that would drop it is refused, coded, naming the table, with nothing removed.
 */
for (const kind of ['memory', 'file'] as StoreKind[]) {
  describe(`knowledge-turso beside object tables on ${kind === 'memory' ? ':memory:' : 'a file: URL'}`, () => {
    const store = storeOf(kind);
    afterAll(() => store.closeAll());
    const FP_B = { fingerprint: 'fp-test:b', recipeHash: 'rh-test:1' };
    const FP_C = { fingerprint: 'fp-test:c', recipeHash: 'rh-test:1' };

    /** Replaces the store's table `table` with an object table holding one row. */
    async function occupy(client: Client, table: string): Promise<void> {
      await client.execute(`DROP TABLE "${table}"`);
      await client.execute(`CREATE TABLE "${table}" (id TEXT PRIMARY KEY, name TEXT)`);
      await client.execute(`INSERT INTO "${table}" VALUES ('r1', 'kept')`);
    }

    async function objectRows(client: Client, table: string): Promise<unknown[]> {
      return (await client.execute(`SELECT name FROM "${table}"`)).rows.map((r) => r.name);
    }

    async function generationRows(client: Client, sourceId: string): Promise<string[]> {
      const found = await client.execute({
        sql: 'SELECT generation, state FROM knowledge_generation WHERE source_id = ? ORDER BY generation',
        args: [sourceId],
      });
      return found.rows.map((r) => `${String(r.generation)}:${String(r.state)}`);
    }

    it('beginBuild never drops an object table under the name of the unfinished build it replaces', async () => {
      const client = store.client();
      const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      const s = source('ob_begin');
      await adapter.upsert([doc(s, '1', 'walnut desk')], ctx(s));
      await adapter.beginBuild(ctx(s, FP_B));
      await occupy(client, 'knowledge_ob_begin_g2');
      const err = await refusal(adapter.beginBuild(ctx(s, FP_C)));
      expect(err).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
      expect(String(err.message)).toContain("'knowledge_ob_begin_g2'");
      expect(await objectRows(client, 'knowledge_ob_begin_g2')).toEqual(['kept']);
      expect(await generationRows(client, s.name)).toEqual(['1:active', '2:building']);
      expect((await adapter.search('walnut', { source: s, topK: 5 })).map((h) => h.snippet)).toEqual(['walnut desk']);
    });

    it('completeBuild never drops an object table under the name of the active generation it replaces', async () => {
      const client = store.client();
      const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      const s = source('ob_complete');
      await adapter.upsert([doc(s, '1', 'maple floor')], ctx(s));
      await adapter.beginBuild(ctx(s, FP_B));
      await adapter.upsert([doc(s, '1', 'maple floor')], ctx(s, FP_B));
      await occupy(client, 'knowledge_ob_complete_g1');
      const err = await refusal(adapter.completeBuild(ctx(s, FP_B)));
      expect(err).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
      expect(String(err.message)).toContain("'knowledge_ob_complete_g1'");
      expect(await objectRows(client, 'knowledge_ob_complete_g1')).toEqual(['kept']);
      expect(await generationRows(client, s.name)).toEqual(['1:active', '2:building']);
      expect(await adapter.indexStatus(ctx(s))).toMatchObject({ fingerprint: FP_A.fingerprint, building: true });
    });

    it('dropSource never drops an object table under a generation name, and removes nothing of the source', async () => {
      const client = store.client();
      const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      const s = source('ob_drop');
      await adapter.upsert([doc(s, '1', 'cherry bench')], ctx(s));
      await adapter.beginBuild(ctx(s, FP_B));
      // The building generation's name is taken; the active one's table is the store's and comes first.
      await occupy(client, 'knowledge_ob_drop_g2');
      const err = await refusal(adapter.dropSource(ctx(s)));
      expect(err).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
      expect(String(err.message)).toContain("'knowledge_ob_drop_g2'");
      expect(await objectRows(client, 'knowledge_ob_drop_g2')).toEqual(['kept']);
      expect(await generationRows(client, s.name)).toEqual(['1:active', '2:building']);
      expect(await tables(client, 'knowledge_ob_drop%')).toEqual(['knowledge_ob_drop_g1', 'knowledge_ob_drop_g2']);
      expect((await adapter.search('cherry', { source: s, topK: 5 })).map((h) => h.snippet)).toEqual(['cherry bench']);
    });

    it("the store's own tables are still dropped by a rebuild and by dropSource", async () => {
      const client = store.client();
      const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      const s = source('ob_own');
      await adapter.upsert([doc(s, '1', 'pine shelf')], ctx(s));
      await adapter.beginBuild(ctx(s, FP_B));
      await adapter.upsert([doc(s, '2', 'pine crate')], ctx(s, FP_B));
      // FP_B's unfinished build is dropped, and generation 2 made afresh for FP_C.
      await adapter.beginBuild(ctx(s, FP_C));
      expect(await adapter.listDocuments(ctx(s, FP_C), { limit: 5 })).toEqual({ documents: [] });
      await adapter.upsert([doc(s, '1', 'pine shelf')], ctx(s, FP_C));
      await adapter.completeBuild(ctx(s, FP_C));
      expect(await tables(client, 'knowledge_ob_own%')).toEqual(['knowledge_ob_own_g2']);
      expect(await generationRows(client, s.name)).toEqual(['2:active']);
      await adapter.dropSource(ctx(s));
      expect(await tables(client, 'knowledge_ob_own%')).toEqual([]);
      expect(await generationRows(client, s.name)).toEqual([]);
    });

    it('an object table named knowledge_generation makes the store unavailable, naming it, and is left untouched', async () => {
      const client = store.client();
      // An object whose fields include the two the generation table's indexes read.
      await client.execute('CREATE TABLE knowledge_generation (id TEXT PRIMARY KEY, source_id TEXT, state TEXT)');
      await client.execute("INSERT INTO knowledge_generation VALUES ('r1', 'src', 'active')");
      const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      const health = await adapter.healthCheck();
      expect(health).toMatchObject({ ok: false, message: expect.stringContaining("'knowledge_generation'") });
      const s = source('ob_gen');
      const err = await refusal(adapter.upsert([doc(s, '1', 'oak door')], ctx(s)));
      expect(err).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
      expect(String(err.message)).toContain("'knowledge_generation'");
      // The generation table's two indexes were not added to it (its own primary-key index has no SQL).
      const indexes = await client.execute(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'knowledge_generation' AND sql IS NOT NULL",
      );
      expect(indexes.rows).toEqual([]);
      const kept = await client.execute('SELECT id, source_id, state FROM knowledge_generation');
      expect(kept.rows.map((r) => [r.id, r.source_id, r.state])).toEqual([['r1', 'src', 'active']]);
      expect(await tables(client, 'knowledge_ob_gen%')).toEqual([]);
    });

    it("the store's own knowledge_generation is found as its generation table by a second adapter on the database", async () => {
      const client = store.client();
      const first = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      const s = source('ob_again');
      await first.upsert([doc(s, '1', 'teak chair')], ctx(s));
      const second = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      expect(await second.healthCheck()).toEqual({ ok: true, message: 'libSQL vectors ready' });
      expect((await second.search('teak', { source: s, topK: 5 })).map((h) => h.snippet)).toEqual(['teak chair']);
    });
  });
}

/**
 * Hybrid search: a keyword leg (an FTS5 trigram index per passage table, and
 * `LIKE` for a term under three characters) merged with the vector leg by
 * reciprocal rank fusion. A hit's score says which legs ranked it: 1 for first
 * in both, 0.5 for first in one alone. The fake embedder ranks by shared
 * words, so the fixtures put the exact code where shared words rank it last.
 */
for (const kind of ['memory', 'file'] as StoreKind[]) {
  describe(`knowledge-turso hybrid search on ${kind === 'memory' ? ':memory:' : 'a file: URL'}`, () => {
    const store = storeOf(kind);
    afterAll(() => store.closeAll());
    const FP_B = { fingerprint: 'fp-test:b', recipeHash: 'rh-test:1' };
    const QUESTION = 'What is the warranty of the X-200 pump?';
    const CODE = 'Seal kit for model X-200, part 7731.';
    const fillers = (s: KnowledgeSource, extra: Partial<KnowledgeDocument> = {}) =>
      ['a', 'b', 'c', 'd', 'e', 'f'].map((n) =>
        doc(s, `filler_${n}`, `What the pump warranty is, and the scope of the pump warranty (${n})`, extra),
      );

    /** The rank (from 1) the vector leg alone gives `content` among `docs` for `query`. */
    async function vectorRank(query: string, docs: KnowledgeDocument[], content: string): Promise<number> {
      const embedder = new FakeEmbedder();
      const [q, ...vs] = await embedder.embed([query, ...docs.map((d) => d.content)]);
      const cos = vs.map((v, i) => ({ content: docs[i].content, cos: v.reduce((sum, x, j) => sum + x * q[j], 0) }));
      cos.sort((a, b) => b.cos - a.cos);
      return cos.findIndex((c) => c.content === content) + 1;
    }

    it('a question naming an exact code finds the passage the vector leg alone ranks below topK', async () => {
      const adapter = store.adapter();
      const s = source('codes');
      const docs = [...fillers(s), doc(s, 'code', CODE)];
      await adapter.upsert(docs, ctx(s));
      // The fixture holds: by shared words alone the code's passage is last.
      expect(await vectorRank(QUESTION, docs, CODE)).toBe(7);
      const hits = await adapter.search(QUESTION, { source: s, topK: 3 });
      expect(hits).toHaveLength(3);
      expect(hits.map((h) => h.snippet)).toContain(CODE);
      // The code alone: first in the keyword leg, and in the vector leg.
      const exact = await adapter.search('X-200', { source: s, topK: 1 });
      expect(exact.map((h) => h.snippet)).toEqual([CODE]);
      expect(exact[0].score).toBe(1);
    });

    it('quotes every term as an FTS5 phrase: no query text is FTS5 syntax', async () => {
      const adapter = store.adapter();
      const s = source('syntax');
      await adapter.upsert([doc(s, '1', 'Valve "A" NEAR(the X-200) OR * pump^2'), doc(s, '2', 'grain silo')], ctx(s));
      for (const query of ['X-200', '"A"', 'NEAR(the', 'OR', '* pump^2', 'col:umn', '-x', 'a AND b NOT c']) {
        await expect(adapter.search(query, { source: s, topK: 5 })).resolves.toBeInstanceOf(Array);
      }
      expect((await adapter.search('NEAR(the X-200)', { source: s, topK: 5 })).map((h) => h.documentId)).toEqual([`${s.name}:1`]);
    });

    it('a 2-character Chinese term hits by LIKE, a longer one by the trigram index; both in the keyword leg', async () => {
      const adapter = store.adapter();
      const s = source('zh_short');
      await adapter.upsert(
        [doc(s, '1', '员工出差住宿标准为每晚三百元'), doc(s, '2', '仓库盘点每月一次，由物流部负责'), doc(s, '3', '合同到期前三十天提醒客户续约')],
        ctx(s),
      );
      for (const query of ['出差', '住宿标准']) {
        const hits = await adapter.search(query, { source: s, topK: 1 });
        expect(hits.map((h) => h.documentId)).toEqual([`${s.name}:1`]);
        // First in both legs: the keyword leg ranked it.
        expect(hits[0].score).toBe(1);
      }
      // A term no passage holds ranks nothing in the keyword leg.
      expect((await adapter.search('报销', { source: s, topK: 5 })).every((h) => h.score < 1)).toBe(true);
    });

    it('splits a query into terms at white space and punctuation, keeping a code whole', () => {
      expect(keywordTerms('What is the X-200 pump? v1.2, a/b; #tag (part 7731)')).toEqual([
        'What', 'is', 'the', 'X-200', 'pump', 'v1.2', 'a/b', 'tag', 'part', '7731',
      ]);
      expect(keywordTerms('出差的住宿标准，「三十天」。出差')).toEqual(['出差的住宿标准', '三十天', '出差']);
      expect(keywordTerms('pump PUMP Pump')).toEqual(['pump']);
      expect(keywordTerms(Array.from({ length: 40 }, (_, i) => `w${i}`).join(' '))).toHaveLength(16);
      expect(containsPattern('a%_\\b')).toBe('%a\\%\\_\\\\b%');
      expect(ftsPhrase('say "hi"')).toBe('"say ""hi"""');
    });

    it('the organization filter, the record scope and the metadata filter hold in the keyword leg too', async () => {
      const adapter = store.adapter();
      const s = source('kw_scope');
      // The out-of-scope passage holds the code; the in-scope ones share no word with it.
      await adapter.upsert(
        [
          doc(s, 'in1', 'grain silo inspection', { organizationId: 'org_a', metadata: { status: 'published' } }),
          doc(s, 'in2', 'grain silo moisture', { organizationId: 'org_a', metadata: { status: 'published' } }),
          doc(s, 'out', 'X-200 出差 grain', { organizationId: 'org_b', metadata: { status: 'draft' } }),
        ],
        ctx(s),
      );
      const ids = async (o: Partial<Parameters<TursoKnowledgeAdapter['search']>[1]>, query = 'X-200 出差') =>
        (await adapter.search(query, { source: s, topK: 5, ...o })).map((h) => h.documentId).sort();
      // Unfiltered, the code finds it.
      expect(await ids({})).toContain(`${s.name}:out`);
      expect(await ids({ organizationIds: ['org_a'] })).toEqual([]);
      expect(await ids({ scope: [{ kind: 'record', ids: ['in1', 'in2'] }] })).toEqual([]);
      expect(await ids({ filter: { status: 'published' } })).toEqual([]);
      // In scope, the keyword leg still ranks: a word of the in-scope passages.
      expect(await ids({ organizationIds: ['org_a'] }, 'moisture')).toEqual([`${s.name}:in2`]);
    });

    it('keeps the keyword index in step with every write, removal, rebuild and drop', async () => {
      const client = store.client();
      const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      const s = source('kw_step');
      const keyword = async (query: string) =>
        (await adapter.search(query, { source: s, topK: 5 })).filter((h) => h.score === 1).map((h) => h.documentId);
      await adapter.upsert([doc(s, '1', 'pump model Q-118'), doc(s, '2', 'valve model R-220')], ctx(s));
      expect(await keyword('Q-118')).toEqual([`${s.name}:1`]);
      // A rewrite of the text: the old code leaves the index, the new one enters.
      await adapter.upsert([doc(s, '1', 'pump model Q-119')], ctx(s));
      expect(await keyword('Q-118')).toEqual([]);
      expect(await keyword('Q-119')).toEqual([`${s.name}:1`]);
      // A removed document leaves it.
      await adapter.delete([`${s.name}:2`], ctx(s));
      expect(await keyword('R-220')).toEqual([]);
      expect((await client.execute(`SELECT count(*) AS n FROM "knowledge_${s.name}_g1-kw"`)).rows[0].n).toBe(1);
      // A rebuild under another fingerprint: the new generation has its own index; the old one goes with its table.
      await adapter.beginBuild(ctx(s, FP_B));
      await adapter.upsert([doc(s, '1', 'pump model Q-120')], ctx(s, FP_B));
      await adapter.completeBuild(ctx(s, FP_B));
      expect(await keywordObjects(client, `knowledge_${s.name}_g1`)).toEqual([]);
      expect(await keywordObjects(client, `knowledge_${s.name}_g2`)).toHaveLength(5);
      expect(
        (await adapter.search('Q-120', { source: s, topK: 5, index: { fingerprint: FP_B.fingerprint } })).map((h) => h.score),
      ).toEqual([1]);
      await adapter.dropSource(ctx(s, FP_B));
      expect(await keywordObjects(client, `knowledge_${s.name}_g2`)).toEqual([]);
      expect((await client.execute("SELECT name FROM sqlite_master WHERE name LIKE 'knowledge_kw_step%'")).rows).toEqual([]);
    });

    it('a passage table made before the keyword index gets one, from its rows, at its first search', async () => {
      const client = store.client();
      const s = source('kw_legacy');
      const before = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      await before.upsert([...fillers(s), doc(s, 'code', CODE)], ctx(s));
      // The table as a release without a keyword index left it.
      const table = `knowledge_${s.name}_g1`;
      for (const name of ['kw-insert', 'kw-delete', 'kw-update']) await client.execute(`DROP TRIGGER "${table}-${name}"`);
      await client.execute(`DROP TABLE "${table}-fts"`);
      await client.execute(`DROP TABLE "${table}-kw"`);
      expect(await keywordObjects(client, table)).toEqual([]);
      // A new process: its first search makes the index and answers from it.
      const after = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      const hits = await after.search(QUESTION, { source: s, topK: 3 });
      expect(hits.map((h) => h.snippet)).toContain(CODE);
      expect(await keywordObjects(client, table)).toHaveLength(5);
      expect((await client.execute(`SELECT count(*) AS n FROM "${table}-kw"`)).rows[0].n).toBe(7);
      // And keeps it in step from then on.
      await after.delete([`${s.name}:code`], ctx(s));
      expect((await after.search('X-200', { source: s, topK: 5 })).filter((h) => h.score >= 0.5)).toEqual([]);
    });

    it('an object it did not make under a keyword-index name is never dropped; the generation is refused', async () => {
      const client = store.client();
      const s = source('kw_taken');
      await client.execute(`CREATE TABLE "knowledge_${s.name}_g1-kw" (id TEXT PRIMARY KEY, note TEXT)`);
      await client.execute(`INSERT INTO "knowledge_${s.name}_g1-kw" VALUES ('r1', 'kept')`);
      const adapter = new TursoKnowledgeAdapter({ id: 'under_test', client, embedder: new FakeEmbedder() });
      const refused = await refusal(adapter.upsert([doc(s, '1', 'oak table')], ctx(s)));
      expect(refused).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
      expect(String(refused.remedy)).toContain(`knowledge_${s.name}_g1-kw`);
      expect((await client.execute(`SELECT note FROM "knowledge_${s.name}_g1-kw"`)).rows.map((r) => r.note)).toEqual(['kept']);
    });
  });
}
