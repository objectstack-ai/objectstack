// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Generations on a LIVE PostgreSQL with pgvector (ADR-0161 K7, rules 1 to 4):
 * a changed fingerprint builds a new generation beside the active one, the
 * event-sync writes of the build land in the new generation only, a search
 * during the build is refused as "being rebuilt" and never answered from the
 * old generation, the purge reconciles once, the switch makes the new one
 * active, and the old one is deleted in batches. One builder per source, by a
 * PostgreSQL advisory lock: a second build is refused `LOCK_CONFLICT`, and a
 * build whose session died is resumed by the next one with what it wrote.
 */

import { afterAll, describe, expect, it } from 'vitest';
import type { KnowledgeDocument, KnowledgeSource } from '@objectstack/spec/ai';
import type { AdapterContext } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { KnowledgeService } from '@objectstack/service-knowledge';
import { KNOWLEDGE_REBUILD_REQUIRED, poolFromPg, type PgPoolLike, type PgvectorKnowledgeAdapter } from '../index.js';
import { FakeEmbedder, PG_URL, liveStore, requireLiveCell } from './live-pg.testkit.js';

requireLiveCell('knowledge-pgvector generations');

const store = liveStore('kpg_gen');

const SYSTEM = { positions: [], permissions: [], systemPermissions: [], isSystem: true } as unknown as ExecutionContext;

const FP_A = { fingerprint: 'fp-gen:a', recipeHash: 'rh-gen:1' };
const FP_B = { fingerprint: 'fp-gen:b', recipeHash: 'rh-gen:1' };
const FP_C = { fingerprint: 'fp-gen:c', recipeHash: 'rh-gen:1' };

const source = (id: string): KnowledgeSource =>
  ({
    name: id,
    label: id,
    adapter: 'under_test',
    source: { kind: 'object', object: 'article', content: ['body'], metadataFields: ['status'] },
  }) as KnowledgeSource;

const ctx = (s: KnowledgeSource, index: { fingerprint: string; recipeHash: string } = FP_A): AdapterContext => ({
  source: s,
  reason: 'manual',
  index,
});

function doc(s: KnowledgeSource, n: string, content: string): KnowledgeDocument {
  const id = `${s.name}:${n}`;
  return {
    id,
    sourceId: s.name,
    sourceRecordId: n,
    content,
    docHash: `h:${content}`,
    metadata: {},
    chunks: [{ id: `${id}#0`, documentId: id, index: 0, content }],
  };
}

/** A {@link FakeEmbedder} whose next `embed` call can be held until the test lets it go. */
class GatedEmbedder extends FakeEmbedder {
  private gate?: { entered: () => void; released: Promise<void> };

  /** Hold the next `embed` call: `entered` resolves when it starts, `release` lets it run. */
  holdNext(): { entered: Promise<void>; release: () => void } {
    let release!: () => void;
    let entered!: () => void;
    const released = new Promise<void>((r) => (release = r));
    const enteredP = new Promise<void>((r) => (entered = r));
    this.gate = { entered, released };
    return { entered: enteredP, release };
  }

  override async embed(texts: string[]): Promise<number[][]> {
    const gate = this.gate;
    this.gate = undefined;
    if (gate) {
      gate.entered();
      await gate.released;
    }
    return super.embed(texts);
  }
}

/** A data engine over a live list of rows: `find` with a keyset on `id`, equality and `$in`, and `count`. */
function liveRowsEngine(rows: Array<Record<string, unknown>>) {
  const matches = (row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === '$and') return (v as Array<Record<string, unknown>>).every((w) => matches(row, w));
      if (v !== null && typeof v === 'object') {
        const cond = v as Record<string, unknown>;
        if ('$gt' in cond) return String(row[k]) > String(cond.$gt);
        if ('$in' in cond) return (cond.$in as unknown[]).includes(row[k]);
        throw new Error(`liveRowsEngine: condition ${JSON.stringify(v)} is not implemented`);
      }
      return row[k] === v;
    });
  };
  const sorted = () => [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  return {
    async find(_object: string, query: { where?: Record<string, unknown>; limit?: number }) {
      const out = sorted().filter((r) => matches(r, query?.where));
      return query?.limit === undefined ? out : out.slice(0, query.limit);
    },
    async count(_object: string, query: { where?: Record<string, unknown> }) {
      return sorted().filter((r) => matches(r, query?.where)).length;
    },
  } as never;
}

const schemaOf = (adapter: PgvectorKnowledgeAdapter): string => (adapter as unknown as { schema: string }).schema;

/** The generation rows of a source, oldest first. */
async function generationRows(schema: string, sourceId: string) {
  const found = await store.pool().query<{ generation: number; fingerprint: string | null; state: string }>(
    `SELECT generation, fingerprint, state FROM "${schema}"."knowledge_generation" WHERE source_id = $1 ORDER BY generation`,
    [sourceId],
  );
  return found.rows;
}

/** How many passage rows each generation of a source holds in the 384-wide table. */
async function passagesByGeneration(schema: string, sourceId: string): Promise<Record<number, number>> {
  const found = await store.pool().query<{ generation: number; n: string }>(
    `SELECT generation, count(*) AS n FROM "${schema}"."knowledge_vec_d384" WHERE source_id = $1 GROUP BY generation`,
    [sourceId],
  );
  return Object.fromEntries(found.rows.map((r) => [Number(r.generation), Number(r.n)]));
}

describe.skipIf(!PG_URL)('knowledge-pgvector generations on a LIVE PostgreSQL', () => {
  afterAll(() => store.dropAll());

  it('same width, model changed: a new generation is built beside the old, which no search reads, then switched to and deleted', async () => {
    const embedder = new GatedEmbedder(384, 'model-one');
    const adapter = store.adapter({ embedder });
    const schema = schemaOf(adapter);
    const rows: Array<Record<string, unknown>> = [
      { id: 'r1', body: 'granite quarry', status: 'published' },
      { id: 'r2', body: 'marble quarry', status: 'published' },
    ];
    const svc = new KnowledgeService({ dataEngine: liveRowsEngine(rows) });
    svc.registerAdapter('under_test', adapter);
    const s = source('model_change');
    svc.registerSource(s);
    expect(await svc.reindexSource(s.name)).toMatchObject({ ok: true, indexed: 2 });
    const before = await adapter.indexStatus({ source: s, reason: 'manual' });
    expect(await generationRows(schema, s.name)).toEqual([{ generation: 1, fingerprint: before.fingerprint, state: 'active' }]);

    // Another model of the same width: the fingerprint moves, and the boot reading says so.
    embedder.model = 'model-two';
    expect(await svc.readIndexState(s.name)).toMatchObject({ state: 'new-fingerprint', due: true });

    // The build starts, and its first page's embed call is held.
    const gate = embedder.holdNext();
    const build = svc.reindexSource(s.name);
    await gate.entered;
    expect(await adapter.indexStatus({ source: s, reason: 'manual' })).toEqual({
      fingerprint: before.fingerprint,
      recipeHash: before.recipeHash,
      building: true,
    });
    expect((await generationRows(schema, s.name)).map((g) => [g.generation, g.state])).toEqual([
      [1, 'active'],
      [2, 'building'],
    ]);

    // A search during the build is refused as "being rebuilt", by code; the old generation answers nothing.
    const refused = await svc.search('granite', { topK: 3, executionContext: SYSTEM }).then(
      () => undefined,
      (e: unknown) => e as { code?: string; status?: number; message?: string },
    );
    expect(refused).toMatchObject({ code: KNOWLEDGE_REBUILD_REQUIRED, status: 409 });
    expect(refused?.message).toContain('is being rebuilt');

    // An event-sync write during the build (a record the walk has passed) lands in the new generation only.
    const late = { id: 'r0', body: 'basalt columns', status: 'published' };
    rows.push(late);
    await svc.handleRecordUpsert('article', late);
    expect(await passagesByGeneration(schema, s.name)).toEqual({ 1: 2, 2: 1 });

    gate.release();
    // The walk wrote both rows, the purge removed nothing written during the build, and the switch ran.
    expect(await build).toMatchObject({ ok: true, indexed: 2, skipped: 0, purged: 0 });

    const after = await adapter.indexStatus({ source: s, reason: 'manual' });
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.building).toBeUndefined();
    expect(await generationRows(schema, s.name)).toEqual([{ generation: 2, fingerprint: after.fingerprint, state: 'active' }]);
    // The old generation is deleted; the write made during the build is there.
    expect(await passagesByGeneration(schema, s.name)).toEqual({ 2: 3 });
    expect((await svc.search('basalt', { topK: 3, executionContext: SYSTEM })).map((h) => h.documentId)).toEqual([`${s.name}:r0`]);
    expect((await svc.search('granite', { topK: 3, executionContext: SYSTEM })).map((h) => h.documentId)).toEqual([`${s.name}:r1`]);
    expect(await svc.readIndexState(s.name)).toMatchObject({ state: 'current', due: false });
  });

  it('two concurrent builds of one source: one builds, the other is refused LOCK_CONFLICT and walks nothing', async () => {
    const first = new GatedEmbedder(384, 'model-one');
    const second = new FakeEmbedder(384, 'model-one');
    const a = store.adapter({ embedder: first });
    // Another process: its own adapter, on the same tables.
    const b = store.adapter({ embedder: second, schema: schemaOf(a) });
    const rows = [{ id: 'r1', body: 'granite quarry', status: 'published' }];
    const s = source('two_builders');
    const svcA = new KnowledgeService({ dataEngine: liveRowsEngine(rows) });
    const svcB = new KnowledgeService({ dataEngine: liveRowsEngine(rows) });
    svcA.registerAdapter('under_test', a);
    svcB.registerAdapter('under_test', b);
    svcA.registerSource(s);
    svcB.registerSource(s);

    const gate = first.holdNext();
    const buildA = svcA.reindexSource(s.name);
    await gate.entered;
    const refusedB = await svcB.reindexSource(s.name);
    expect(refusedB).toMatchObject({ ok: false, indexed: 0, discovered: 0 });
    expect(refusedB.message).toContain('is being built by another process');
    expect(second.calls).toBe(0);
    await expect(b.beginBuild(ctx(s, FP_A))).rejects.toMatchObject({ code: 'LOCK_CONFLICT', status: 409 });

    gate.release();
    expect(await buildA).toMatchObject({ ok: true, indexed: 1 });
    // The lock went with the completed build: the other process may build now.
    expect(await svcB.reindexSource(s.name)).toMatchObject({ ok: true, indexed: 0, skipped: 1 });
  });

  it('a build whose session died is resumed by the next one: what it wrote is kept, and only the rest is written', async () => {
    const a = store.adapter();
    const schema = schemaOf(a);
    const s = source('resume');
    await a.upsert([doc(s, '1', 'granite quarry'), doc(s, '2', 'marble quarry')], ctx(s, FP_A));
    await a.beginBuild(ctx(s, FP_B));
    await a.upsert([doc(s, '1', 'granite quarry')], ctx(s, FP_B));

    // The process dies: PostgreSQL ends its session, and the advisory lock with it.
    const lock = (a as unknown as { builders: Map<string, { client: { query: PgPoolLike['query'] } }> }).builders.get(s.name)!;
    const pid = (await lock.client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await store.pool().query('SELECT pg_terminate_backend($1)', [pid]);

    const b = store.adapter({ schema });
    await expect(b.beginBuild(ctx(s, FP_B))).resolves.toBeUndefined();
    // Resumed, not restarted: the generation under construction keeps the passage written before.
    const listed = await b.listDocuments(ctx(s, FP_B), { limit: 10 });
    expect(listed.documents).toEqual([{ documentId: `${s.name}:1`, docHash: 'h:granite quarry' }]);
    expect(await passagesByGeneration(schema, s.name)).toEqual({ 1: 2, 2: 1 });
    await b.upsert([doc(s, '2', 'marble quarry')], ctx(s, FP_B));
    await b.completeBuild(ctx(s, FP_B));
    expect(await passagesByGeneration(schema, s.name)).toEqual({ 2: 2 });
    expect(await b.indexStatus(ctx(s))).toEqual({ fingerprint: FP_B.fingerprint, recipeHash: FP_B.recipeHash });
  });

  it('a build that stops on a running process lets go after the idle time; event-sync writes do not hold it', async () => {
    const a = store.adapter({ buildLockIdleMs: 300 });
    const b = store.adapter({ schema: schemaOf(a) });
    const s = source('idle');
    await a.upsert([doc(s, '1', 'granite quarry')], ctx(s, FP_A));
    const started = Date.now();
    await a.beginBuild(ctx(s, FP_B));
    await expect(b.beginBuild(ctx(s, FP_B))).rejects.toMatchObject({ code: 'LOCK_CONFLICT', status: 409 });
    // The walk has stopped; record events keep arriving for the source under
    // the new fingerprint. They are not progress of the build, so the lock
    // still goes once the idle time has passed since the build's last call.
    let released = false;
    for (let i = 0; i < 60 && !released; i++) {
      await a.upsert([doc(s, '2', `marble quarry ${i}`)], { source: s, reason: 'event-sync', index: FP_B });
      await new Promise((r) => setTimeout(r, 50));
      released = await b.beginBuild(ctx(s, FP_B)).then(
        () => true,
        (e: unknown) => {
          if ((e as { code?: string }).code !== 'LOCK_CONFLICT') throw e;
          return false;
        },
      );
    }
    expect(released).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    await b.completeBuild(ctx(s, FP_B));
  });

  it('the old generation is deleted in batches, and a build for a third fingerprint abandons the one under construction', async () => {
    const base = poolFromPg(store.pool());
    const batches: string[] = [];
    const pool: PgPoolLike = {
      ...base,
      query: (text, params) => {
        if (/^WITH gone AS \(\s*DELETE/.test(text.trim())) batches.push(String(params?.[1]));
        return base.query(text, params);
      },
    };
    const adapter = store.adapter({ pool, deleteBatchSize: 2 });
    const schema = schemaOf(adapter);
    const s = source('batches');
    await adapter.upsert(['1', '2', '3', '4', '5'].map((n) => doc(s, n, `stone ${n}`)), ctx(s, FP_A));

    // A build under B is abandoned for one under C: B's generation is retired and deleted.
    await adapter.beginBuild(ctx(s, FP_B));
    await adapter.upsert([doc(s, '1', 'stone 1')], ctx(s, FP_B));
    await adapter.beginBuild(ctx(s, FP_C));
    expect((await generationRows(schema, s.name)).map((g) => [g.generation, g.fingerprint, g.state])).toEqual([
      [1, FP_A.fingerprint, 'active'],
      [3, FP_C.fingerprint, 'building'],
    ]);
    expect(await passagesByGeneration(schema, s.name)).toEqual({ 1: 5 });
    // A write under the abandoned fingerprint is refused; nothing reaches the active generation.
    await expect(adapter.upsert([doc(s, '9', 'stone 9')], ctx(s, FP_B))).rejects.toMatchObject({ code: KNOWLEDGE_REBUILD_REQUIRED });

    await adapter.upsert([doc(s, '1', 'stone 1')], ctx(s, FP_C));
    batches.length = 0;
    await adapter.completeBuild(ctx(s, FP_C));
    // Five passages, two a statement: three statements, all for generation 1.
    expect(batches).toEqual(['1', '1', '1']);
    expect(await generationRows(schema, s.name)).toEqual([{ generation: 3, fingerprint: FP_C.fingerprint, state: 'active' }]);
    expect(await passagesByGeneration(schema, s.name)).toEqual({ 3: 1 });
  });
});
