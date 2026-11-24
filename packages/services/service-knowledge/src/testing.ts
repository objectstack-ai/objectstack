// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `IKnowledgeAdapter` contract test suite (ADR-0161 K8, rule 1) — written
 * once, run by every adapter package against its own factory:
 *
 * ```ts
 * import { runKnowledgeAdapterContract } from '@objectstack/service-knowledge/testing';
 *
 * runKnowledgeAdapterContract({
 *   name: 'knowledge-memory',
 *   makeAdapter: () => new KnowledgeMemoryAdapter(),
 *   implements: { listDocuments: true },
 * });
 * ```
 *
 * TEST-ONLY. This module imports `vitest`, and the package publishes it as its
 * own `./testing` subpath, ESM only, never through the runtime entry (`.`).
 *
 * What it covers: `upsert` / `search` / `delete` on the adapter alone; the
 * optional `listDocuments` (page boundaries at 0, one page and one page + 1;
 * `docHash` returned as stored); and, through a real `KnowledgeService` over a
 * small data-engine double, the skip of unchanged documents and the purge of
 * documents the source no longer has.
 *
 * Every optional member is DECLARED by the caller in `implements`, and the
 * suite asserts the declaration against the adapter: a member an adapter lacks
 * runs the case that pins the service's behaviour without it, never nothing.
 */

import { describe, expect, it } from 'vitest';
import type { IDataEngine, IKnowledgeAdapter, AdapterContext } from '@objectstack/spec/contracts';
import type { KnowledgeDocument, KnowledgeSource, ObjectKnowledgeSource } from '@objectstack/spec/ai';
import { KnowledgeService } from './knowledge-service.js';

/** Input of {@link runKnowledgeAdapterContract}. */
export interface KnowledgeAdapterContractOptions {
  /** Names the suite in the test report. */
  name: string;
  /**
   * A FRESH, empty adapter per call: every case makes its own, so no case
   * reads what another wrote. A store-backed adapter gives each call its own
   * store (or its own namespace in one).
   */
  makeAdapter: () => IKnowledgeAdapter | Promise<IKnowledgeAdapter>;
  /** The optional members this adapter implements; checked against the adapter. */
  implements: {
    listDocuments: boolean;
  };
}

/** Every case's source id starts with this, so a shared store can be told apart. */
const SOURCE_PREFIX = 'contract_';

function objectSource(id: string, extra: Partial<ObjectKnowledgeSource> = {}): KnowledgeSource {
  return {
    id: `${SOURCE_PREFIX}${id}`,
    label: id,
    adapter: 'under_test',
    source: { kind: 'object', object: 'article', contentFields: ['body'], metadataFields: ['status'], ...extra },
  } as KnowledgeSource;
}

function ctxOf(source: KnowledgeSource): AdapterContext {
  return { source, reason: 'manual' };
}

function doc(source: KnowledgeSource, n: string, content: string, docHash?: string): KnowledgeDocument {
  return {
    id: `${source.id}:${n}`,
    sourceId: source.id,
    sourceRecordId: n,
    content,
    title: `Title ${n}`,
    metadata: { status: 'published' },
    ...(docHash === undefined ? {} : { docHash }),
  };
}

/** Every page of `listDocuments`, asserting each page's bound; refuses a listing that does not end. */
async function listAll(
  adapter: IKnowledgeAdapter,
  source: KnowledgeSource,
  limit: number,
): Promise<{ pages: number; entries: Array<{ documentId: string; docHash?: string }> }> {
  const entries: Array<{ documentId: string; docHash?: string }> = [];
  let cursor: string | undefined;
  for (let pages = 1; pages <= 1000; pages++) {
    const page = await adapter.listDocuments!(ctxOf(source), cursor === undefined ? { limit } : { cursor, limit });
    expect(Array.isArray(page.documents)).toBe(true);
    expect(page.documents.length).toBeLessThanOrEqual(limit);
    entries.push(...page.documents);
    if (page.nextCursor === undefined) return { pages, entries };
    expect(page.nextCursor).not.toBe(cursor);
    cursor = page.nextCursor;
  }
  throw new Error('listDocuments never answered a page without nextCursor (1000 pages)');
}

type Row = Record<string, unknown>;

/**
 * A data-engine double serving `find` / `count` the way the knowledge service
 * calls them (the paged walk and the membership re-read), over rows the case
 * mutates directly. It refuses — by a throw — any `where` shape it does not
 * implement, so a service change it cannot answer turns the suite red rather
 * than being answered wrongly.
 */
function rowsEngine(rows: Row[]): IDataEngine {
  const matches = (row: Row, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    for (const [key, value] of Object.entries(where)) {
      if (key === '$and') {
        if (!Array.isArray(value)) throw new Error('engine double: $and takes an array');
        if (!value.every((c) => matches(row, c as Record<string, unknown>))) return false;
        continue;
      }
      if (key.startsWith('$')) throw new Error(`engine double: operator ${key} is not implemented`);
      if (value !== null && typeof value === 'object') {
        const ops = Object.keys(value);
        if (key !== 'id' || ops.length !== 1 || ops[0] !== '$gt') {
          throw new Error(`engine double: condition ${JSON.stringify(value)} on '${key}' is not implemented`);
        }
        if (!(String(row.id) > String((value as { $gt: unknown }).$gt))) return false;
        continue;
      }
      if (row[key] !== value) return false;
    }
    return true;
  };
  return {
    find: async (_object: string, query: { where?: Record<string, unknown>; limit?: number }) => {
      if (typeof query?.limit !== 'number' || !(query.limit > 0)) throw new Error('engine double: an unbounded find');
      return rows
        .filter((r) => matches(r, query.where))
        .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0))
        .slice(0, query.limit)
        .map((r) => ({ ...r }));
    },
    count: async (_object: string, query: { where?: Record<string, unknown> }) =>
      rows.filter((r) => matches(r, query?.where)).length,
  } as unknown as IDataEngine;
}

/** A `KnowledgeService` over `adapter` and `rows`, with the adapter's `upsert` counted. */
async function serviceOver(make: () => IKnowledgeAdapter | Promise<IKnowledgeAdapter>, rows: Row[], source: KnowledgeSource) {
  const adapter = await make();
  const upserted: string[][] = [];
  // Delegation, not a prototype proxy: an adapter with `#private` fields only
  // answers when its methods are called on the adapter itself.
  const counting: IKnowledgeAdapter = {
    id: adapter.id,
    upsert: async (docs, ctx) => {
      upserted.push(docs.map((d) => d.id));
      return adapter.upsert(docs, ctx);
    },
    search: (query, searchOpts) => adapter.search(query, searchOpts),
    delete: (ids, ctx) => adapter.delete(ids, ctx),
    ...(typeof adapter.listDocuments === 'function'
      ? { listDocuments: (ctx: AdapterContext, listOpts: { cursor?: string; limit: number }) => adapter.listDocuments!(ctx, listOpts) }
      : {}),
  };
  const svc = new KnowledgeService({ dataEngine: rowsEngine(rows) });
  svc.registerAdapter('under_test', counting);
  svc.registerSource(source);
  return { adapter, svc, upserted };
}

const rowsOf = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, body: `body number ${i} zebra${i}`, status: 'published' }));

/**
 * Register the contract suite for one adapter. Call it at the top level of a
 * test file.
 */
export function runKnowledgeAdapterContract(opts: KnowledgeAdapterContractOptions): void {
  const make = opts.makeAdapter;

  describe(`IKnowledgeAdapter contract — ${opts.name}`, () => {
    it('declares exactly the optional members it implements', async () => {
      const adapter = await make();
      expect(typeof adapter.id).toBe('string');
      expect(typeof adapter.listDocuments === 'function').toBe(opts.implements.listDocuments);
    });

    describe('upsert / search / delete', () => {
      it('a search finds an upserted document, scoped to the searched source, best first', async () => {
        const adapter = await make();
        const a = objectSource('a');
        const b = objectSource('b');
        await adapter.upsert([doc(a, '1', 'alpine meadow flowers'), doc(a, '2', 'harbour cranes at night')], ctxOf(a));
        await adapter.upsert([doc(b, '1', 'alpine meadow flowers')], ctxOf(b));
        const hits = await adapter.search('alpine meadow', { source: a, topK: 5 });
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].documentId).toBe(`${a.id}:1`);
        for (const hit of hits) expect(hit.sourceId).toBe(a.id);
        for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
        expect((await adapter.search('alpine meadow', { source: a, topK: 1 })).length).toBeLessThanOrEqual(1);
      });

      it('an upsert of an existing id replaces the document', async () => {
        const adapter = await make();
        const a = objectSource('a');
        await adapter.upsert([doc(a, '1', 'volcanic basalt columns')], ctxOf(a));
        await adapter.upsert([doc(a, '1', 'glacier ice caves')], ctxOf(a));
        const stale = await adapter.search('volcanic basalt', { source: a, topK: 5 });
        expect(stale.filter((h) => h.documentId === `${a.id}:1`)).toEqual([]);
        const fresh = await adapter.search('glacier ice', { source: a, topK: 5 });
        expect(fresh.map((h) => h.documentId)).toContain(`${a.id}:1`);
      });

      it('a deleted document is not found; deleting an absent id is a no-op', async () => {
        const adapter = await make();
        const a = objectSource('a');
        await adapter.upsert([doc(a, '1', 'copper kettle'), doc(a, '2', 'copper wire')], ctxOf(a));
        await adapter.delete([`${a.id}:1`, `${a.id}:absent`], ctxOf(a));
        const hits = await adapter.search('copper', { source: a, topK: 5 });
        expect(hits.map((h) => h.documentId)).toEqual([`${a.id}:2`]);
      });
    });

    if (opts.implements.listDocuments) {
      describe('listDocuments', () => {
        it.each([
          ['0 documents', 0],
          ['exactly one page', 3],
          ['one page + 1', 4],
        ])('%s: every document once, no page over its limit', async (_label, n) => {
          const adapter = await make();
          const a = objectSource('a');
          if (n > 0) {
            await adapter.upsert(
              Array.from({ length: n }, (_, i) => doc(a, `d${i}`, `listed document ${i}`, `hash-${i}`)),
              ctxOf(a),
            );
          }
          const { pages, entries } = await listAll(adapter, a, 3);
          const ids = entries.map((e) => e.documentId);
          expect(new Set(ids).size).toBe(ids.length);
          expect([...ids].sort()).toEqual(Array.from({ length: n }, (_, i) => `${a.id}:d${i}`).sort());
          // 0 and 3 documents fit one page (plus, at most, an empty one after it); 4 need two.
          expect(pages).toBeLessThanOrEqual(n === 4 ? 3 : 2);
          if (n === 4) expect(pages).toBeGreaterThanOrEqual(2);
        });

        it('returns each docHash as stored, and none for a document stored without one', async () => {
          const adapter = await make();
          const a = objectSource('a');
          await adapter.upsert([doc(a, '1', 'granite quarry', 'v1:opaque-as-given'), doc(a, '2', 'marble quarry')], ctxOf(a));
          await adapter.upsert([doc(a, '1', 'granite quarry, revised', 'v1:replaced')], ctxOf(a));
          const { entries } = await listAll(adapter, a, 10);
          const byId = new Map(entries.map((e) => [e.documentId, e.docHash]));
          expect(byId.get(`${a.id}:1`)).toBe('v1:replaced');
          expect(byId.has(`${a.id}:2`)).toBe(true);
          expect(byId.get(`${a.id}:2`)).toBeUndefined();
        });

        it("lists only the source's own documents, and none that were deleted", async () => {
          const adapter = await make();
          const a = objectSource('a');
          const b = objectSource('b');
          await adapter.upsert([doc(a, '1', 'tidal pool'), doc(a, '2', 'tidal flat')], ctxOf(a));
          await adapter.upsert([doc(b, '1', 'tidal pool')], ctxOf(b));
          await adapter.delete([`${a.id}:2`], ctxOf(a));
          const { entries } = await listAll(adapter, a, 10);
          expect(entries.map((e) => e.documentId)).toEqual([`${a.id}:1`]);
        });
      });

      describe('through KnowledgeService.reindexSource', () => {
        it('a second complete reindex skips every unchanged document and rewrites a changed one', async () => {
          const rows = rowsOf(3);
          const source = objectSource('skip');
          const h = await serviceOver(make, rows, source);
          expect(await h.svc.reindexSource(source.id)).toMatchObject({ ok: true, indexed: 3, skipped: 0, purged: 0 });
          h.upserted.length = 0;
          expect(await h.svc.reindexSource(source.id)).toMatchObject({ ok: true, discovered: 3, indexed: 0, skipped: 3, purged: 0 });
          expect(h.upserted).toEqual([]);
          rows[1].body = 'body number 1 rewritten';
          expect(await h.svc.reindexSource(source.id)).toMatchObject({ ok: true, indexed: 1, skipped: 2, purged: 0 });
          expect(h.upserted).toEqual([[`${source.id}:r1`]]);
        });

        it('a complete reindex purges the documents of a deleted row and of a row that left where', async () => {
          const rows = rowsOf(3);
          const source = objectSource('purge', { where: { status: 'published' } });
          const h = await serviceOver(make, rows, source);
          await h.svc.reindexSource(source.id);
          rows.splice(0, 1); // r0 deleted
          rows[1].status = 'draft'; // r2 stopped matching
          expect(await h.svc.reindexSource(source.id)).toMatchObject({ ok: true, discovered: 1, purged: 2 });
          const { entries } = await listAll(h.adapter, source, 10);
          expect(entries.map((e) => e.documentId)).toEqual([`${source.id}:r1`]);
          expect((await h.adapter.search('zebra0 zebra2', { source, topK: 5 })).map((x) => x.documentId)).toEqual([]);
        });

        it('a reindex with a limit or a dryRun purges nothing', async () => {
          const rows = rowsOf(3);
          const source = objectSource('partial');
          const h = await serviceOver(make, rows, source);
          await h.svc.reindexSource(source.id);
          rows.splice(0, 1);
          expect(await h.svc.reindexSource(source.id, { limit: 10 })).toMatchObject({ ok: true, purged: null });
          expect(await h.svc.reindexSource(source.id, { dryRun: true })).toMatchObject({ ok: true, purged: null });
          expect((await listAll(h.adapter, source, 10)).entries).toHaveLength(3);
        });
      });
    } else {
      describe('without listDocuments', () => {
        it('a complete reindex rewrites every document and reports purged: null', async () => {
          const rows = rowsOf(3);
          const source = objectSource('nolist');
          const h = await serviceOver(make, rows, source);
          await h.svc.reindexSource(source.id);
          rows.splice(0, 1);
          h.upserted.length = 0;
          expect(await h.svc.reindexSource(source.id)).toMatchObject({ ok: true, indexed: 2, skipped: 0, purged: null });
          expect(h.upserted.flat()).toEqual([`${source.id}:r1`, `${source.id}:r2`]);
        });
      });
    }
  });
}
