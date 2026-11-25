// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A complete reindex over the REAL data path on a LIVE PostgreSQL: a real
 * `ObjectQL` over a real `SqlDriver` as the knowledge service's data engine,
 * and this store as its adapter (card #37100, comment 7145881825).
 *
 * The record ids are the ones a keyset walk and a listing in another order
 * would disagree on: mixed case (`Ab`, `aB`, `AB`), numeric-looking (`9`,
 * `10`, `010`), and enough of them to take several pages of the walk. Every
 * record is indexed once, none is skipped or purged, and a second complete
 * reindex writes nothing — the listing (byte order) and the walk (the
 * database's order) agree on every id.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { KnowledgeService } from '@objectstack/service-knowledge';
import type { KnowledgeSource } from '@objectstack/spec/ai';
import type { IKnowledgeAdapter } from '@objectstack/spec/contracts';
import { FakeEmbedder, PG_URL, liveStore, requireLiveCell } from './live-pg.testkit.js';

requireLiveCell('knowledge-pgvector reindex over the real driver');

const store = liveStore('kpg_driver');

/** The walk's page (service-knowledge `REINDEX_PAGE_SIZE`): the ids below span more than two pages. */
const REINDEX_PAGE_SIZE = 100;

const OBJECT = 'kpg_article';
const ARTICLE = {
  name: OBJECT,
  label: 'Article',
  fields: {
    body: { name: 'body', type: 'textarea' },
    status: { name: 'status', type: 'text' },
  },
};

/** Ids the byte order and a collation's order put differently, past two pages of the walk. */
function recordIds(): string[] {
  const odd = ['Ab', 'aB', 'AB', 'ab', 'a-b', 'a_b', '9', '10', '010', '1e3', 'Z', 'z', 'Éclair', 'eclair'];
  const filler = Array.from({ length: REINDEX_PAGE_SIZE * 2 + 13 }, (_, i) => (i % 2 === 0 ? `R${i}` : `${1000 + i}`));
  return [...odd, ...filler];
}

describe.skipIf(!PG_URL)('knowledge-pgvector — complete reindex over ObjectQL + SqlDriver on a LIVE PostgreSQL', { timeout: 60_000 }, () => {
  const objectSchema = store.schema();
  let driver: SqlDriver;
  let engine: ObjectQL;
  let svc: KnowledgeService;
  let upserted: string[];
  let embedder: FakeEmbedder;
  const ids = recordIds();
  const source = {
    id: 'driver_walk',
    label: 'Driver walk',
    adapter: 'pgvector',
    source: { kind: 'object', object: OBJECT, contentFields: ['body'], metadataFields: ['status'] },
  } as KnowledgeSource;

  beforeAll(async () => {
    await store.pool().query(`DROP SCHEMA IF EXISTS "${objectSchema}" CASCADE`);
    await store.pool().query(`CREATE SCHEMA "${objectSchema}"`);
    driver = new SqlDriver({ client: 'pg', connection: PG_URL, searchPath: [objectSchema] } as never);
    await driver.initObjects([ARTICLE] as never);
    for (const id of ids) {
      // Seeded through the driver: data at rest, as an install holds it.
      await driver.create(OBJECT, { id, body: `passage of record ${id} granite`, status: 'published' });
    }
    engine = new ObjectQL();
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject(ARTICLE as never, 'com.objectstack.test.knowledge-pgvector');

    embedder = new FakeEmbedder();
    const adapter = store.adapter({ id: 'pgvector', embedder });
    upserted = [];
    const counting: IKnowledgeAdapter = Object.assign(Object.create(adapter) as IKnowledgeAdapter, {
      upsert: (docs: Parameters<IKnowledgeAdapter['upsert']>[0], ctx: Parameters<IKnowledgeAdapter['upsert']>[1]) => {
        upserted.push(...docs.map((d) => d.sourceRecordId ?? d.id));
        return adapter.upsert(docs, ctx);
      },
    });
    svc = new KnowledgeService({ dataEngine: engine as never });
    svc.registerAdapter('pgvector', counting);
    svc.registerSource(source);
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    await store.dropAll();
  });

  it('indexes every record exactly once, skips none, purges none', async () => {
    const first = await svc.reindexSource(source.id);
    expect(first).toMatchObject({ ok: true, discovered: ids.length, indexed: ids.length, skipped: 0, failed: 0 });
    expect(first.purged ?? 0).toBe(0);
    expect([...upserted].sort()).toEqual([...ids].sort());
  });

  it('a second complete reindex writes nothing, embeds nothing, and purges nothing', async () => {
    const before = { upserts: upserted.length, embeds: embedder.calls };
    const second = await svc.reindexSource(source.id);
    expect(second).toMatchObject({ ok: true, discovered: ids.length, indexed: 0, skipped: ids.length, failed: 0 });
    expect(second.purged ?? 0).toBe(0);
    expect(upserted.length).toBe(before.upserts);
    expect(embedder.calls).toBe(before.embeds);
  });
});
