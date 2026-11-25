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
 *   implements: { listDocuments: true, chunks: true },
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
 * documents the source no longer has; and the chunk channel (ADR-0161 K8,
 * item 5) — an adapter that declares `capabilities.chunks` receives the
 * service's passages and indexes them as given, one that does not keeps
 * receiving whole documents, and a `whole` document over the embedder's
 * budget is removed and reported, never truncated.
 *
 * Every optional member is DECLARED by the caller in `implements`, and the
 * suite asserts the declaration against the adapter: a member an adapter lacks
 * runs the case that pins the service's behaviour without it, never nothing.
 */

import { describe, expect, it } from 'vitest';
import type { IDataEngine, IKnowledgeAdapter, AdapterContext } from '@objectstack/spec/contracts';
import type { KnowledgeDocument, KnowledgeSource, ObjectKnowledgeSource } from '@objectstack/spec/ai';
import { KnowledgeService } from './knowledge-service.js';
import { resolveSplit, splitDocument } from './split/index.js';

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
    /** `capabilities.chunks === true`: the adapter takes the service's passages. */
    chunks: boolean;
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

/**
 * A document as the service hands it to this adapter: with one passage (the
 * whole text, as split `whole` gives it) when the adapter takes chunks.
 */
function docFor(withChunks: boolean) {
  return (source: KnowledgeSource, n: string, content: string, docHash?: string): KnowledgeDocument => {
    const id = `${source.id}:${n}`;
    return {
      id,
      sourceId: source.id,
      sourceRecordId: n,
      content,
      title: `Title ${n}`,
      metadata: { status: 'published' },
      ...(docHash === undefined ? {} : { docHash }),
      ...(withChunks ? { chunks: [{ id: `${id}#0`, documentId: id, index: 0, content }] } : {}),
    };
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

/**
 * A `KnowledgeService` over `adapter` and `rows`, with the adapter's `upsert`
 * counted and its documents kept. `maxInputTokens` stands in for the limit the
 * adapter's embedder would report; omitted, the adapter's own report is used.
 */
async function serviceOver(
  make: () => IKnowledgeAdapter | Promise<IKnowledgeAdapter>,
  rows: Row[],
  source: KnowledgeSource,
  opts: { maxInputTokens?: number } = {},
) {
  const adapter: IKnowledgeAdapter = await make();
  const upserted: string[][] = [];
  const received: KnowledgeDocument[] = [];
  // Delegation, not a prototype proxy: an adapter with `#private` fields only
  // answers when its methods are called on the adapter itself. The
  // descriptors are read through on every access, as the service reads them.
  const counting: IKnowledgeAdapter = {
    id: adapter.id,
    get capabilities() {
      return adapter.capabilities;
    },
    get embedding() {
      return opts.maxInputTokens === undefined ? adapter.embedding : { maxInputTokens: opts.maxInputTokens };
    },
    upsert: async (docs, ctx) => {
      upserted.push(docs.map((d) => d.id));
      received.push(...docs);
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
  return { adapter, svc, upserted, received };
}

const rowsOf = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, body: `body number ${i} zebra${i}`, status: 'published' }));

/**
 * Register the contract suite for one adapter. Call it at the top level of a
 * test file.
 */
export function runKnowledgeAdapterContract(opts: KnowledgeAdapterContractOptions): void {
  const make = opts.makeAdapter;
  const doc = docFor(opts.implements.chunks);

  describe(`IKnowledgeAdapter contract — ${opts.name}`, () => {
    it('declares exactly the optional members it implements', async () => {
      const adapter: IKnowledgeAdapter = await make();
      expect(typeof adapter.id).toBe('string');
      expect(typeof adapter.listDocuments === 'function').toBe(opts.implements.listDocuments);
      expect(adapter.capabilities?.chunks === true).toBe(opts.implements.chunks);
    });

    describe('upsert / search / delete', () => {
      it('a search finds an upserted document, scoped to the searched source, best first', async () => {
        const adapter: IKnowledgeAdapter = await make();
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
        const adapter: IKnowledgeAdapter = await make();
        const a = objectSource('a');
        await adapter.upsert([doc(a, '1', 'volcanic basalt columns')], ctxOf(a));
        await adapter.upsert([doc(a, '1', 'glacier ice caves')], ctxOf(a));
        const stale = await adapter.search('volcanic basalt', { source: a, topK: 5 });
        expect(stale.filter((h) => h.documentId === `${a.id}:1`)).toEqual([]);
        const fresh = await adapter.search('glacier ice', { source: a, topK: 5 });
        expect(fresh.map((h) => h.documentId)).toContain(`${a.id}:1`);
      });

      it('a deleted document is not found; deleting an absent id is a no-op', async () => {
        const adapter: IKnowledgeAdapter = await make();
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
          const adapter: IKnowledgeAdapter = await make();
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
          const adapter: IKnowledgeAdapter = await make();
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
          const adapter: IKnowledgeAdapter = await make();
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

    describe('the chunk channel (ADR-0161 K8, item 5)', () => {
      const longBody =
        'Glaciers carve valleys over centuries. Their ice holds ancient air bubbles. ' +
        'Harbour cranes unload containers at night. The night shift starts at ten. ' +
        'Copper wire conducts heat and electricity well. It is drawn through dies.';
      const splitSource = (id: string) =>
        objectSource(id, { split: { strategy: 'recursive', maxChars: 80, minChars: 0 } } as Partial<ObjectKnowledgeSource>);

      if (opts.implements.chunks) {
        it("receives the service's passages, cut once, and indexes them as given", async () => {
          const source = splitSource('chunks');
          const rows: Row[] = [{ id: 'r1', body: longBody, status: 'published' }];
          const h = await serviceOver(make, rows, source);
          expect(await h.svc.reindexSource(source.id)).toMatchObject({ ok: true, indexed: 1, failed: 0, failures: [] });
          const [sent] = h.received;
          const expected = splitDocument(
            sent,
            resolveSplit({
              split: (source.source as ObjectKnowledgeSource).split,
              maxInputTokens: h.adapter.embedding?.maxInputTokens,
            }),
          );
          if (!expected.ok) throw new Error(expected.reason);
          expect(expected.chunks.length).toBeGreaterThan(1);
          expect(sent.chunks).toEqual(expected.chunks);
          // Indexed as given: a hit is one of those passages, by id and text.
          const third = expected.chunks.find((c) => c.content.includes('Copper'))!;
          const hits = await h.adapter.search('copper wire electricity', { source, topK: 3 });
          expect(hits[0]).toMatchObject({ chunkId: third.id, documentId: sent.id, snippet: third.content });
        });

        it("a whole document over the embedder's budget is removed and reported, never truncated", async () => {
          const source = objectSource('whole', { split: { strategy: 'whole' } } as Partial<ObjectKnowledgeSource>);
          const rows: Row[] = [
            { id: 'r1', body: 'short tundra note', status: 'published' },
            { id: 'r2', body: longBody, status: 'published' },
          ];
          // 60 tokens: a 48-token budget, which the short row fits and the long one does not.
          const h = await serviceOver(make, rows, source, { maxInputTokens: 60 });
          const first = await h.svc.reindexSource(source.id);
          expect(first).toMatchObject({ ok: true, discovered: 2, indexed: 1, failed: 1 });
          expect(first.failures).toEqual([{ documentId: `${source.id}:r2`, reason: expect.stringContaining("split 'whole'") }]);
          expect(await h.adapter.search('glaciers copper', { source, topK: 5 })).toEqual([]);
          // A document that fit and then grew past the budget leaves the index too.
          rows[0].body = `tundra ${longBody}`;
          const second = await h.svc.reindexSource(source.id);
          expect(second).toMatchObject({ ok: true, failed: 2 });
          expect((await h.adapter.search('tundra', { source, topK: 5 })).map((x) => x.documentId)).toEqual([]);
        });

        it('indexDocument refuses caller-supplied chunks', async () => {
          const source = splitSource('push');
          const h = await serviceOver(make, [], source);
          await expect(
            h.svc.indexDocument(source.id, {
              id: `${source.id}:x`,
              sourceId: source.id,
              content: 'pushed',
              chunks: [{ id: `${source.id}:x#0`, documentId: `${source.id}:x`, index: 0, content: 'pushed' }],
            }),
          ).rejects.toThrow(/chunks are cut by the knowledge service/);
          expect(h.upserted).toEqual([]);
        });
      } else {
        it('receives whole documents, never chunks, whatever the source splits by or the budget', async () => {
          const source = splitSource('nochunks');
          const rows: Row[] = [{ id: 'r1', body: longBody, status: 'published' }];
          const h = await serviceOver(make, rows, source, { maxInputTokens: 20 });
          expect(await h.svc.reindexSource(source.id)).toMatchObject({ ok: true, indexed: 1, failed: 0 });
          expect(h.received).toHaveLength(1);
          expect(h.received[0].content).toBe(longBody);
          expect('chunks' in h.received[0]).toBe(false);
        });
      }
    });
  });
}
