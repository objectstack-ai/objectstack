// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The builder lock as a fence, on a LIVE PostgreSQL with pgvector (ADR-0161
 * K7, rule 2):
 *
 * - a build whose session advisory lock is gone mid-walk embeds no further
 *   page: its next write is refused `LOCK_CONFLICT`, and the walk stops;
 * - `completeBuild` completes only the build this adapter began, and only
 *   the generation it began: with two builders, the first one's lock lapsing
 *   and the second taking the source up, the first one's completion is
 *   refused and switches nothing;
 * - a kept lock is re-checked at the next `beginBuild`: a session that ended
 *   is not taken for a lock still held;
 * - a building generation is retired at `beginBuild` when the fingerprint
 *   went back to the active one's.
 */

import { afterAll, describe, expect, it } from 'vitest';
import type { KnowledgeDocument, KnowledgeSource } from '@objectstack/spec/ai';
import type { AdapterContext } from '@objectstack/spec/contracts';
import { KnowledgeService } from '@objectstack/service-knowledge';
import type { PgPoolLike, PgvectorKnowledgeAdapter } from '../index.js';
import { FakeEmbedder, PG_URL, liveStore, requireLiveCell } from './live-pg.testkit.js';

requireLiveCell('knowledge-pgvector build fence');

const store = liveStore('kpg_fence');

const FP_A = { fingerprint: 'fp-fence:a', recipeHash: 'rh-fence:1' };
const FP_B = { fingerprint: 'fp-fence:b', recipeHash: 'rh-fence:1' };

const source = (name: string): KnowledgeSource =>
  ({ name, label: name, adapter: 'under_test', source: { kind: 'object', object: 'article', content: ['body'] } }) as KnowledgeSource;

const ctx = (s: KnowledgeSource, index = FP_A, reason: AdapterContext['reason'] = 'reindex'): AdapterContext => ({ source: s, reason, index });

function doc(s: KnowledgeSource, n: string, content: string): KnowledgeDocument {
  const id = `${s.name}:${n}`;
  return { id, sourceId: s.name, sourceRecordId: n, content, docHash: `h:${content}`, metadata: {}, chunks: [{ id: `${id}#0`, documentId: id, index: 0, content }] };
}

const schemaOf = (adapter: PgvectorKnowledgeAdapter): string => (adapter as unknown as { schema: string }).schema;

/** End the database session the adapter holds the source's builder lock on, as a dropped connection would. */
async function endLockSession(adapter: PgvectorKnowledgeAdapter, sourceId: string): Promise<void> {
  const lock = (adapter as unknown as { builders: Map<string, { client: { query: PgPoolLike['query'] } }> }).builders.get(sourceId)!;
  const pid = (await lock.client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await store.pool().query('SELECT pg_terminate_backend($1)', [pid]);
}

async function generationRows(schema: string, sourceId: string) {
  const found = await store.pool().query<{ generation: number; fingerprint: string | null; state: string }>(
    `SELECT generation, fingerprint, state FROM "${schema}"."knowledge_generation" WHERE source_id = $1 ORDER BY generation`,
    [sourceId],
  );
  return found.rows;
}

/** A data engine over a list of rows: `find` with equality, `$and` and a keyset on `id`, ordered by id. */
function rowsEngine(rows: Array<Record<string, unknown>>) {
  const matches = (row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === '$and') return (v as Array<Record<string, unknown>>).every((w) => matches(row, w));
      if (v !== null && typeof v === 'object') {
        const cond = v as Record<string, unknown>;
        if ('$gt' in cond) return String(row[k]) > String(cond.$gt);
        throw new Error(`rowsEngine: condition ${JSON.stringify(v)} is not implemented`);
      }
      return row[k] === v;
    });
  };
  return {
    async find(_object: string, query?: { where?: Record<string, unknown>; limit?: number }) {
      const page = rows.filter((r) => matches(r, query?.where));
      return (typeof query?.limit === 'number' ? page.slice(0, query.limit) : page).map((r) => ({ ...r }));
    },
    async count() {
      return rows.length;
    },
  } as never;
}

afterAll(async () => {
  await store.dropAll();
});

describe.skipIf(!PG_URL)('knowledge-pgvector build fence on a LIVE PostgreSQL', () => {
  it('a build whose lock session ends mid-walk embeds no further page and completes nothing', async () => {
    const embedder = new FakeEmbedder(384, 'model-fence');
    const adapter = store.adapter({ embedder });
    const s = source('lost_mid_walk');
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: `r${String(i + 1).padStart(4, '0')}`, body: `granite ${i + 1}` }));
    const service = new KnowledgeService({ dataEngine: rowsEngine(rows) });
    const upsert = adapter.upsert.bind(adapter);
    let pages = 0;
    adapter.upsert = async (batch, c) => {
      await upsert(batch, c);
      pages += 1;
      // The session holding the builder lock drops after the first page.
      if (pages === 1) await endLockSession(adapter, s.name);
    };
    service.registerAdapter('under_test', adapter);
    service.registerSource(s);

    const result = await service.reindexSource(s.name);

    expect(result).toMatchObject({ ok: false, discovered: 100, indexed: 100 });
    expect(result.message).toContain('stopped at page 2');
    expect(result.message).toContain("no longer holds the source's builder lock");
    expect(pages).toBe(1);
    expect(embedder.calls).toBe(1);
    // Not completed: no recipe hash was recorded, so the source still reads as due.
    expect((await adapter.indexStatus(ctx(s))).recipeHash).toBeUndefined();
  });

  it('two builders, the first one\'s lock lapses: its completion is refused and switches nothing', async () => {
    const a = store.adapter({ buildLockIdleMs: 200 });
    const b = store.adapter({ schema: schemaOf(a) });
    const schema = schemaOf(a);
    const s = source('two_builders_lapse');
    await a.upsert([doc(s, '1', 'granite quarry'), doc(s, '2', 'marble quarry')], ctx(s, FP_A, 'manual'));

    await a.beginBuild(ctx(s, FP_B));
    await a.upsert([doc(s, '1', 'granite quarry')], ctx(s, FP_B));
    // The first builder stops making progress; its lock goes after the idle time.
    await new Promise((r) => setTimeout(r, 400));

    // The second takes the source up: the same generation, under construction.
    await b.beginBuild(ctx(s, FP_B));
    // The first builder's next page is refused before it is embedded ...
    await expect(a.upsert([doc(s, '2', 'marble quarry')], ctx(s, FP_B))).rejects.toMatchObject({ code: 'LOCK_CONFLICT', status: 409 });
    // ... and so is its completion, which would switch the generation the second one is still writing.
    await expect(a.completeBuild(ctx(s, FP_B))).rejects.toMatchObject({ code: 'LOCK_CONFLICT', status: 409 });
    // Nothing switched: the old generation is still the active one, the new one still building.
    expect((await generationRows(schema, s.name)).map((g) => [g.fingerprint, g.state])).toEqual([
      [FP_A.fingerprint, 'active'],
      [FP_B.fingerprint, 'building'],
    ]);

    // The second builder finishes its build.
    await b.upsert([doc(s, '2', 'marble quarry')], ctx(s, FP_B));
    await b.completeBuild(ctx(s, FP_B));
    expect(await b.indexStatus(ctx(s))).toEqual({ fingerprint: FP_B.fingerprint, recipeHash: FP_B.recipeHash });
  });

  it('a builder whose lock lapsed with no write since is refused at its completion alone', async () => {
    const a = store.adapter({ buildLockIdleMs: 200 });
    const b = store.adapter({ schema: schemaOf(a) });
    const s = source('lapsed_then_complete');
    await a.upsert([doc(s, '1', 'granite quarry')], ctx(s, FP_A, 'manual'));
    await a.beginBuild(ctx(s, FP_B));
    await new Promise((r) => setTimeout(r, 400));
    await b.beginBuild(ctx(s, FP_B));

    await expect(a.completeBuild(ctx(s, FP_B))).rejects.toMatchObject({ code: 'LOCK_CONFLICT', status: 409 });
    expect((await generationRows(schemaOf(a), s.name)).map((g) => g.state)).toEqual(['active', 'building']);
    await b.completeBuild(ctx(s, FP_B));
  });

  it('a build whose generation was replaced while it held the lock completes nothing', async () => {
    const a = store.adapter();
    const schema = schemaOf(a);
    const s = source('replaced_generation');
    await a.upsert([doc(s, '1', 'granite quarry')], ctx(s, FP_A, 'manual'));
    await a.beginBuild(ctx(s, FP_B));
    // Another generation under the same fingerprint takes the place of the one this build began.
    const t = `"${schema}"."knowledge_generation"`;
    await store.pool().query(`UPDATE ${t} SET state = 'retired' WHERE source_id = $1 AND state = 'building'`, [s.name]);
    await store.pool().query(
      `INSERT INTO ${t} (source_id, generation, fingerprint, dim, model, state) VALUES ($1, 9, $2, 384, 'x', 'building')`,
      [s.name, FP_B.fingerprint],
    );

    await expect(a.completeBuild(ctx(s, FP_B))).rejects.toMatchObject({ code: 'LOCK_CONFLICT', status: 409 });
    expect((await generationRows(schema, s.name)).find((g) => g.state === 'active')?.fingerprint).toBe(FP_A.fingerprint);
  });

  it('a lock kept from an earlier build is re-checked: a session that ended is not taken for a held lock', async () => {
    const a = store.adapter();
    const b = store.adapter({ schema: schemaOf(a) });
    const s = source('kept_session');
    await a.beginBuild(ctx(s, FP_A));
    await endLockSession(a, s.name);

    // The lock went with the session: another process takes it.
    await b.beginBuild(ctx(s, FP_A));
    // The first process begins again: it must not build beside the second.
    await expect(a.beginBuild(ctx(s, FP_A))).rejects.toMatchObject({ code: 'LOCK_CONFLICT', status: 409 });
    await b.completeBuild(ctx(s, FP_A));
  });

  it('a building generation is retired at beginBuild when the fingerprint went back to the active one', async () => {
    const adapter = store.adapter();
    const schema = schemaOf(adapter);
    const s = source('reverted');
    await adapter.upsert([doc(s, '1', 'granite quarry')], ctx(s, FP_A, 'manual'));
    await adapter.beginBuild(ctx(s, FP_B));
    await adapter.upsert([doc(s, '1', 'granite quarry')], ctx(s, FP_B));
    // The change is reverted before the build completes: the next build is under the active fingerprint.
    await adapter.beginBuild(ctx(s, FP_A));
    expect((await generationRows(schema, s.name)).map((g) => [g.fingerprint, g.state])).toEqual([[FP_A.fingerprint, 'active']]);
    const passages = await store.pool().query<{ n: string }>(
      `SELECT count(*) AS n FROM "${schema}"."knowledge_vec_d384" WHERE source_id = $1 AND generation <> 1`,
      [s.name],
    );
    expect(Number(passages.rows[0].n)).toBe(0);
    await adapter.completeBuild(ctx(s, FP_A));
    expect(await adapter.indexStatus(ctx(s))).toEqual({ fingerprint: FP_A.fingerprint, recipeHash: FP_A.recipeHash });
  });
});
