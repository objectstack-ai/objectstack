// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The reconcile over the reference store (ADR-0161 K1: "Events keep an index
 * fresh; a reconcile pass keeps it correct"; `KnowledgeService.reconcileSources`).
 *
 * Each case changes the rows behind the index's back — no record event
 * reaches the service, as when event sync is off, an event is lost, a sync
 * fails or a write rolls back — and asks one reconcile to bring the index
 * back to the rows:
 *
 * - inserted, changed, deleted by a predicate (`multi: true`) delete and
 *   moved out of `where`: the index lists exactly the matching rows, and a
 *   second reconcile writes nothing;
 * - a document built from an insert that rolled back is purged;
 * - an embedder outage during record writes is healed with no operator step;
 * - a fingerprint that moved while the server runs is built as a new
 *   generation, and the source answers searches again.
 *
 * The memory store embeds inside `upsert`, so the documents it is handed are
 * the documents embedded: the cases count them as the embedder's calls.
 */

import { describe, expect, it } from 'vitest';
import type { KnowledgeSource } from '@objectstack/spec/ai';
import type { AdapterContext, IDataEngine } from '@objectstack/spec/contracts';
import { KnowledgeService } from '@objectstack/service-knowledge';
import { KnowledgeMemoryAdapter } from '../index';

type Row = Record<string, unknown>;

const SYSTEM = { executionContext: { positions: [], permissions: [], systemPermissions: [], isSystem: true } };

/**
 * The rows of one object. `find` applies scalar equality, `$and`, `id: { $gt }`
 * and `id: { $in }`, ordered by id; any other condition throws, so a query the
 * double does not understand turns a case red rather than answering it wrongly.
 * `deleteWhere` is a predicate delete: rows go, and no record event is sent.
 */
function makeEngine(initial: Row[]) {
  const rows = new Map<string, Row>(initial.map((r) => [String(r.id), { ...r }]));
  const matches = (row: Row, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    for (const [key, value] of Object.entries(where)) {
      if (key === '$and') {
        if (!(value as Array<Record<string, unknown>>).every((c) => matches(row, c))) return false;
        continue;
      }
      if (value !== null && typeof value === 'object') {
        const cond = value as { $gt?: unknown; $in?: unknown[] };
        if (cond.$gt !== undefined) {
          if (!(String(row[key]) > String(cond.$gt))) return false;
          continue;
        }
        if (Array.isArray(cond.$in)) {
          if (!cond.$in.map(String).includes(String(row[key]))) return false;
          continue;
        }
        throw new Error(`engine double: condition on '${key}' is not implemented`);
      }
      if (row[key] !== value) return false;
    }
    return true;
  };
  const select = (where?: Record<string, unknown>) =>
    [...rows.values()].filter((r) => matches(r, where)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const engine = {
    async find(_object: string, query?: { where?: Record<string, unknown>; limit?: number }) {
      const all = select(query?.where);
      return (typeof query?.limit === 'number' ? all.slice(0, query.limit) : all).map((r) => ({ ...r }));
    },
    async count(_object: string, query?: { where?: Record<string, unknown> }) {
      return select(query?.where).length;
    },
  } as unknown as IDataEngine;
  return {
    rows,
    engine,
    put(row: Row) {
      rows.set(String(row.id), { ...row });
    },
    deleteWhere(where: Record<string, unknown>) {
      for (const row of select(where)) rows.delete(String(row.id));
    },
  };
}

const PUBLISHED = { status: 'published' };

const SOURCE: KnowledgeSource = {
  name: 'kb',
  label: 'Knowledge base',
  adapter: 'memory',
  source: { kind: 'object', object: 'kb_article', content: ['title', 'body'], where: PUBLISHED },
};

const row = (id: string, body: string, status = 'published', topic = 'policy'): Row => ({ id, title: `Article ${id}`, body, status, topic });

/** A service over one memory store, with the store's upsert counted and switchable off (an embedder outage). */
function makeService(engine: IDataEngine, opts: { chunkTarget?: () => number | undefined } = {}) {
  const adapter = new KnowledgeMemoryAdapter('memory');
  const upsert = adapter.upsert.bind(adapter);
  const embedded = { documents: 0, calls: 0, down: false };
  adapter.upsert = async (docs, ctx) => {
    if (embedded.down) throw new Error('embedding provider unavailable (503)');
    embedded.calls += 1;
    embedded.documents += docs.length;
    await upsert(docs, ctx);
  };
  const warnings: string[] = [];
  const service = new KnowledgeService({
    dataEngine: engine,
    logger: { info: () => {}, warn: (m: string) => { warnings.push(m); }, error: () => {}, debug: () => {} },
    ...(opts.chunkTarget ? { resolveChunkTarget: async () => opts.chunkTarget!() } : {}),
  });
  service.registerAdapter('memory', adapter);
  service.registerSource(SOURCE);
  return { service, adapter, embedded, warnings };
}

/** The record ids the store lists for the source, in order. */
async function indexed(adapter: KnowledgeMemoryAdapter): Promise<string[]> {
  const page = await adapter.listDocuments({ source: SOURCE, reason: 'reindex' } as AdapterContext, { limit: 1000 });
  return page.documents.map((d) => d.documentId.slice('kb:'.length));
}

/** The record ids the store holds `docHash`es for, by record id. */
async function hashes(adapter: KnowledgeMemoryAdapter): Promise<Map<string, string | undefined>> {
  const page = await adapter.listDocuments({ source: SOURCE, reason: 'reindex' } as AdapterContext, { limit: 1000 });
  return new Map(page.documents.map((d) => [d.documentId.slice('kb:'.length), d.docHash]));
}

describe('one reconcile brings the index back to the rows', () => {
  it('rows inserted, changed, deleted by a predicate delete and moved out of where, with no event: the index lists exactly the matching rows', async () => {
    const db = makeEngine([row('a1', 'Twenty days of paid leave'), row('a2', 'Economy class'), row('a3', 'Receipts in thirty days', 'published', 'expense'), row('a4', 'Remote work')]);
    const { service, adapter, embedded } = makeService(db.engine);
    const first = await service.reconcileSources();
    expect(first.sources[0]?.record).toMatchObject({ trigger: 'reconcile', status: 'done', result: { indexed: 4, purged: 0 } });
    expect(await indexed(adapter)).toEqual(['a1', 'a2', 'a3', 'a4']);

    // Event sync is off: the service hears of none of this.
    db.put(row('a5', 'Parental leave'));                     // inserted
    db.put(row('a2', 'Business class over six hours'));      // changed
    db.deleteWhere({ topic: 'expense' });                    // a multi: true delete (a3)
    db.put(row('a4', 'Remote work', 'draft'));               // moved out of where
    const before = await hashes(adapter);

    const report = await service.reconcileSources();
    expect(report.unfinished).toEqual([]);
    expect(report.sources[0]?.record).toMatchObject({
      trigger: 'reconcile',
      status: 'done',
      result: { ok: true, discovered: 3, indexed: 2, skipped: 1, purged: 2 },
    });
    expect(await indexed(adapter)).toEqual(['a1', 'a2', 'a5']);
    const after = await hashes(adapter);
    expect(after.get('a1')).toBe(before.get('a1'));
    expect(after.get('a2')).not.toBe(before.get('a2'));

    // A second reconcile right after: nothing is written, nothing embedded.
    const callsBefore = embedded.calls;
    const second = await service.reconcileSources();
    expect(second.sources[0]?.record).toMatchObject({ status: 'done', result: { indexed: 0, skipped: 3, purged: 0 } });
    expect(embedded.calls).toBe(callsBefore);
  });

  it('a document built from an insert that rolled back is purged', async () => {
    const db = makeEngine([row('a1', 'Twenty days of paid leave')]);
    const { service, adapter } = makeService(db.engine);
    await service.reconcileSources();

    // The insert's sync re-read the uncommitted row inside the write's unit and
    // built its document; then the unit rolled back, so the row never existed.
    db.put(row('t9', 'Never committed'));
    await service.handleRecordUpsert('kb_article', row('t9', 'Never committed'));
    db.rows.delete('t9');
    expect(await indexed(adapter)).toEqual(['a1', 't9']);

    const report = await service.reconcileSources();
    expect(report.sources[0]?.record).toMatchObject({ status: 'done', result: { purged: 1, indexed: 0 } });
    expect(await indexed(adapter)).toEqual(['a1']);
  });

  it('a row whose event was lost is indexed, and a row changed with no event is written again', async () => {
    const db = makeEngine([row('a1', 'Twenty days of paid leave')]);
    const { service, adapter } = makeService(db.engine);
    await service.reconcileSources();
    const before = await hashes(adapter);

    db.put(row('a2', 'Economy class'));       // its created event never arrived
    db.put(row('a1', 'Twenty-five days'));    // its updated event never arrived

    const report = await service.reconcileSources();
    expect(report.sources[0]?.record).toMatchObject({ status: 'done', result: { indexed: 2, skipped: 0, purged: 0 } });
    expect(await indexed(adapter)).toEqual(['a1', 'a2']);
    expect((await hashes(adapter)).get('a1')).not.toBe(before.get('a1'));
  });
});

describe('a reindex after an outage converges', () => {
  it('rows written while the embedder was down are indexed by the next reconcile, with no operator action', async () => {
    const db = makeEngine([row('a1', 'Twenty days of paid leave')]);
    const { service, adapter, embedded } = makeService(db.engine);
    await service.reconcileSources();

    // The embedder fails during N record writes: each event's sync fails.
    embedded.down = true;
    const written = ['b1', 'b2', 'b3'];
    for (const id of written) {
      db.put(row(id, `Written during the outage ${id}`));
      await service.handleRecordUpsert('kb_article', row(id, `Written during the outage ${id}`));
    }
    db.put(row('a1', 'Changed during the outage'));
    await service.handleRecordUpsert('kb_article', row('a1', 'Changed during the outage'));
    expect(await indexed(adapter)).toEqual(['a1']);

    embedded.down = false;
    const report = await service.reconcileSources();
    expect(report.unfinished).toEqual([]);
    expect(report.sources[0]?.record).toMatchObject({ status: 'done', result: { indexed: written.length + 1, skipped: 0 } });
    expect(await indexed(adapter)).toEqual(['a1', ...written]);
    expect((await service.search('outage', SYSTEM)).map((h) => h.sourceRecordId).sort()).toEqual(['a1', ...written]);
  });

  it('a reconcile while the embedder is still down does not finish, names the source, and the next one converges', async () => {
    const db = makeEngine([row('a1', 'Twenty days of paid leave')]);
    const { service, adapter, embedded } = makeService(db.engine);
    await service.reconcileSources();
    db.put(row('b1', 'Written during the outage'));

    embedded.down = true;
    const failed = await service.reconcileSources();
    expect(failed.unfinished).toEqual([expect.objectContaining({ sourceId: 'kb', status: 'failed' })]);
    expect(failed.unfinished[0]?.message).toContain('embedding provider unavailable');

    embedded.down = false;
    const healed = await service.reconcileSources();
    expect(healed.unfinished).toEqual([]);
    expect(await indexed(adapter)).toEqual(['a1', 'b1']);
  });
});

describe('a fingerprint that moved while the server runs', () => {
  it('is built as a new generation by the reconcile, and the source answers searches again without a restart', async () => {
    const db = makeEngine([row('a1', 'Twenty days of paid leave'), row('a2', 'Economy class under six hours')]);
    let target: number | undefined;
    const { service, adapter } = makeService(db.engine, { chunkTarget: () => target });
    await service.reconcileSources();
    const fingerprintBefore = (await adapter.indexStatus({ source: SOURCE, reason: 'reindex' } as AdapterContext)).fingerprint;
    expect((await service.search('leave', SYSTEM)).map((h) => h.sourceRecordId)).toEqual(['a1']);

    // The settings page's chunk target is saved while the server runs: the
    // split, and so the fingerprint, moved; the stored index is refused.
    target = 400;
    await expect(service.search('leave', SYSTEM)).rejects.toMatchObject({ code: 'KNOWLEDGE_REBUILD_REQUIRED' });
    expect(await service.readIndexState('kb')).toMatchObject({ state: 'new-fingerprint', due: true });

    const report = await service.reconcileSources();
    expect(report.sources[0]?.record).toMatchObject({ trigger: 'reconcile', status: 'done', result: { indexed: 2 } });
    const status = await adapter.indexStatus({ source: SOURCE, reason: 'reindex' } as AdapterContext);
    expect(status.fingerprint).not.toBe(fingerprintBefore);
    expect(status.building).toBeUndefined();
    expect(await service.readIndexState('kb')).toMatchObject({ state: 'current' });
    expect((await service.search('leave', SYSTEM)).map((h) => h.sourceRecordId)).toEqual(['a1']);
  });
});
