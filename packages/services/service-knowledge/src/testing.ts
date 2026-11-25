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
 *   implements: { listDocuments: true, chunks: true, organizationIds: true },
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
 * documents the source no longer has; the chunk channel (ADR-0161 K8,
 * item 5) — an adapter that declares `capabilities.chunks` receives the
 * service's passages and indexes them as given, one that does not keeps
 * receiving whole documents, and a `whole` document over the embedder's
 * budget is removed and reported, never truncated; and the organization filter
 * (ADR-0161 K8, item 9) — on the adapter alone, and through a real
 * `KnowledgeService` under the `isolated`, `group` and `single` postures.
 *
 * Every optional member is DECLARED by the caller in `implements`, and the
 * suite asserts the declaration against the adapter: a member an adapter lacks
 * runs the case that pins the service's behaviour without it, never nothing.
 * `organizationIds` is a search option, not a method, so its declaration is
 * asserted by behaviour: the cases it turns on fail for an adapter that
 * ignores the option.
 */

import { describe, expect, it } from 'vitest';
import type { IDataEngine, IKnowledgeAdapter, AdapterContext, AdapterSearchOptions } from '@objectstack/spec/contracts';
import type { KnowledgeDocument, KnowledgeSource, ObjectKnowledgeSource } from '@objectstack/spec/ai';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { TenancyPosture } from '@objectstack/spec/security';
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
    /**
     * The adapter's search honours `AdapterSearchOptions.organizationIds`
     * (ADR-0161 K8, item 9): it ranks only the documents of the organizations
     * it is handed, filtering before it ranks.
     */
    organizationIds: boolean;
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
  return (
    source: KnowledgeSource,
    n: string,
    content: string,
    docHash?: string,
    organizationId?: string,
  ): KnowledgeDocument => {
    const id = `${source.id}:${n}`;
    return {
      id,
      sourceId: source.id,
      sourceRecordId: n,
      content,
      title: `Title ${n}`,
      metadata: { status: 'published' },
      ...(docHash === undefined ? {} : { docHash }),
      ...(organizationId === undefined ? {} : { organizationId }),
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
 * calls them (the paged walk, the membership re-read and the search's
 * permission re-read), over rows the case mutates directly. It refuses — by a
 * throw — any `where` shape it does not implement, so a service change it
 * cannot answer turns the suite red rather than being answered wrongly.
 *
 * The permission re-read (`where: { id: { $in } }`, the caller's context in
 * the query) answers the rows `wall` admits for that context; without a
 * `wall`, every row.
 */
function rowsEngine(rows: Row[], wall?: (row: Row, context: ExecutionContext) => boolean): IDataEngine {
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
    find: async (
      _object: string,
      query: { where?: Record<string, unknown>; limit?: number; context?: ExecutionContext },
    ) => {
      const inIds = (query?.where?.id as { $in?: unknown } | undefined)?.$in;
      if (query?.context !== undefined && Array.isArray(inIds) && Object.keys(query.where ?? {}).length === 1) {
        const ctx = query.context;
        return rows
          .filter((r) => inIds.includes(r.id) && (wall === undefined || wall(r, ctx)))
          .map((r) => ({ id: r.id }));
      }
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

/** What {@link serviceOver} composes beside the adapter and the rows. */
interface ServiceSetup {
  /** The deployment's tenancy posture, read at each call; absent → no `tenancy` service. */
  posture?: () => TenancyPosture | undefined;
  /** The permission re-read's wall ({@link rowsEngine}). */
  wall?: (row: Row, context: ExecutionContext) => boolean;
  /**
   * Stands in for the limit the adapter's embedder would report
   * (`embedding.maxInputTokens`); omitted, the adapter's own report is used.
   */
  maxInputTokens?: number;
}

/**
 * A `KnowledgeService` over `adapter` and `rows`, with the adapter's `upsert`
 * counted and its documents kept, and the options of every `search` it is
 * handed recorded.
 */
async function serviceOver(
  make: () => IKnowledgeAdapter | Promise<IKnowledgeAdapter>,
  rows: Row[],
  source: KnowledgeSource,
  setup: ServiceSetup = {},
) {
  const adapter: IKnowledgeAdapter = await make();
  const upserted: string[][] = [];
  const received: KnowledgeDocument[] = [];
  const searched: AdapterSearchOptions[] = [];
  // Delegation, not a prototype proxy: an adapter with `#private` fields only
  // answers when its methods are called on the adapter itself. The
  // descriptors are read through on every access, as the service reads them.
  const counting: IKnowledgeAdapter = {
    id: adapter.id,
    get capabilities() {
      return adapter.capabilities;
    },
    get embedding() {
      return setup.maxInputTokens === undefined ? adapter.embedding : { maxInputTokens: setup.maxInputTokens };
    },
    upsert: async (docs, ctx) => {
      upserted.push(docs.map((d) => d.id));
      received.push(...docs);
      return adapter.upsert(docs, ctx);
    },
    search: (query, searchOpts) => {
      searched.push(searchOpts);
      return adapter.search(query, searchOpts);
    },
    delete: (ids, ctx) => adapter.delete(ids, ctx),
    ...(typeof adapter.listDocuments === 'function'
      ? { listDocuments: (ctx: AdapterContext, listOpts: { cursor?: string; limit: number }) => adapter.listDocuments!(ctx, listOpts) }
      : {}),
  };
  const posture = setup.posture;
  const svc = new KnowledgeService({
    dataEngine: rowsEngine(rows, setup.wall),
    ...(posture === undefined ? {} : { resolveTenancyPosture: async () => posture() }),
  });
  svc.registerAdapter('under_test', counting);
  svc.registerSource(source);
  return { adapter, svc, upserted, received, searched };
}

/** The last element of `list`, or `undefined` when it is empty. */
function lastOf<T>(list: readonly T[]): T | undefined {
  return list.length === 0 ? undefined : list[list.length - 1];
}

/** Two organizations' rows in one source: `rb` (organization B) outranks `ra` (A) for {@link ORG_QUERY}. */
const orgRows = (): Row[] => [
  { id: 'ra', body: 'alpine meadow harbour', status: 'published', organization_id: 'org_a' },
  { id: 'rb', body: 'alpine meadow alpine meadow', status: 'published', organization_id: 'org_b' },
];
const ORG_QUERY = 'alpine meadow';

/** A person in organization A only, active there. */
const CALLER_A: ExecutionContext = {
  userId: 'u_a', tenantId: 'org_a', accessible_org_ids: ['org_a'], positions: [], permissions: [], systemPermissions: [], isSystem: false,
} as ExecutionContext;
/** A person in organizations A and C, active in C: under `group` they reach A; under `isolated` only C. */
const CALLER_AC: ExecutionContext = {
  userId: 'u_ac', tenantId: 'org_c', accessible_org_ids: ['org_a', 'org_c'], positions: [], permissions: [], systemPermissions: [], isSystem: false,
} as ExecutionContext;
const SYSTEM: ExecutionContext = { positions: [], permissions: [], systemPermissions: [], isSystem: true } as ExecutionContext;

/**
 * The wall each posture puts on the permission re-read (ADR-0105 D1), as the
 * double's `wall`. The service never re-reads for the system identity, so the
 * wall is asked about persons only.
 */
function wallOf(posture: TenancyPosture): (row: Row, context: ExecutionContext) => boolean {
  if (posture === 'isolated') return (row, ctx) => row.organization_id === ctx.tenantId;
  if (posture === 'group') return (row, ctx) => (ctx.accessible_org_ids ?? []).includes(String(row.organization_id));
  return () => true;
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

    if (opts.implements.organizationIds) {
      describe('organizationIds (ADR-0161 K8, item 9)', () => {
        /** B's document outranks A's; a third document carries no organization. */
        async function seeded(): Promise<{ adapter: IKnowledgeAdapter; a: KnowledgeSource }> {
          const adapter: IKnowledgeAdapter = await make();
          const a = objectSource('org');
          await adapter.upsert(
            [
              doc(a, 'a1', 'alpine meadow harbour', undefined, 'org_a'),
              doc(a, 'b1', 'alpine meadow alpine meadow', undefined, 'org_b'),
              doc(a, 'n1', 'alpine meadow', undefined),
            ],
            ctxOf(a),
          );
          return { adapter, a };
        }

        it("ranks only the documents of the organizations it is handed, filtering before it ranks", async () => {
          const { adapter, a } = await seeded();
          // topK 1: a filter applied after ranking would keep B's better hit and drop it, answering nothing.
          const top = await adapter.search(ORG_QUERY, { source: a, topK: 1, organizationIds: ['org_a'] });
          expect(top.map((h) => h.documentId)).toEqual([`${a.id}:a1`]);
          const all = await adapter.search(ORG_QUERY, { source: a, topK: 5, organizationIds: ['org_a'] });
          expect(all.map((h) => h.documentId)).toEqual([`${a.id}:a1`]);
        });

        it('ranks the documents of every organization in the set, and none stored without one', async () => {
          const { adapter, a } = await seeded();
          const hits = await adapter.search(ORG_QUERY, { source: a, topK: 5, organizationIds: ['org_a', 'org_b'] });
          expect(hits.map((h) => h.documentId).sort()).toEqual([`${a.id}:a1`, `${a.id}:b1`]);
        });

        it('an empty set ranks nothing — it is never read as "no filter"', async () => {
          const { adapter, a } = await seeded();
          expect(await adapter.search(ORG_QUERY, { source: a, topK: 5, organizationIds: [] })).toEqual([]);
        });

        it('without the option every document is ranked, as before', async () => {
          const { adapter, a } = await seeded();
          const hits = await adapter.search(ORG_QUERY, { source: a, topK: 5 });
          expect(hits.map((h) => h.documentId).sort()).toEqual([`${a.id}:a1`, `${a.id}:b1`, `${a.id}:n1`]);
        });
      });
    }

    describe('the organization filter through KnowledgeService.search', () => {
      for (const posture of ['isolated', 'group'] as const) {
        it(`${posture}: a search from organization A never ranks or returns B's documents`, async () => {
          const rows = orgRows();
          const source = objectSource(`org_${posture}`);
          const h = await serviceOver(make, rows, source, { posture: () => posture, wall: wallOf(posture) });
          expect(await h.svc.reindexSource(source.id)).toMatchObject({ ok: true, indexed: 2 });
          const caller = posture === 'isolated' ? CALLER_A : CALLER_AC;
          const hits = await h.svc.search(ORG_QUERY, { topK: 1, executionContext: caller });
          // The service hands the adapter the caller's organizations, by the posture.
          expect(lastOf(h.searched)?.organizationIds).toEqual(posture === 'isolated' ? ['org_a'] : ['org_a', 'org_c']);
          expect(hits.map((x) => x.documentId)).not.toContain(`${source.id}:rb`);
          if (opts.implements.organizationIds) {
            // Filtered before ranking: B's better document does not take A's place.
            expect(hits.map((x) => x.documentId)).toEqual([`${source.id}:ra`]);
          }
        });
      }

      it('isolated: a caller with no active organization is handed an empty set, and gets nothing', async () => {
        const source = objectSource('org_none');
        const h = await serviceOver(make, orgRows(), source, { posture: () => 'isolated', wall: wallOf('isolated') });
        await h.svc.reindexSource(source.id);
        const nobody = { ...CALLER_A, tenantId: undefined, accessible_org_ids: [] } as ExecutionContext;
        expect(await h.svc.search(ORG_QUERY, { topK: 5, executionContext: nobody })).toEqual([]);
        expect(lastOf(h.searched)?.organizationIds).toEqual([]);
      });

      it('single posture and the system identity: no filter is handed, and the results are as before', async () => {
        const source = objectSource('org_single');
        const single = await serviceOver(make, orgRows(), source, { posture: () => 'single' });
        await single.svc.reindexSource(source.id);
        const hits = await single.svc.search(ORG_QUERY, { topK: 1, executionContext: CALLER_A });
        expect(lastOf(single.searched)).not.toHaveProperty('organizationIds');
        expect(hits.map((x) => x.documentId)).toEqual([`${source.id}:rb`]);

        const walled = await serviceOver(make, orgRows(), source, { posture: () => 'isolated', wall: wallOf('isolated') });
        await walled.svc.reindexSource(source.id);
        const asSystem = await walled.svc.search(ORG_QUERY, { topK: 1, executionContext: SYSTEM });
        expect(lastOf(walled.searched)).not.toHaveProperty('organizationIds');
        expect(asSystem.map((x) => x.documentId)).toEqual([`${source.id}:rb`]);
      });

      if (opts.implements.organizationIds) {
        it('a document indexed without its organization is not ranked behind a wall until a complete reindex writes it again', async () => {
          let posture: TenancyPosture = 'single';
          const source = objectSource('org_upgrade');
          const h = await serviceOver(make, orgRows(), source, { posture: () => posture, wall: wallOf('isolated') });
          await h.svc.reindexSource(source.id); // under `single`: no document carries an organization
          posture = 'isolated';
          expect(await h.svc.search(ORG_QUERY, { topK: 5, executionContext: CALLER_A })).toEqual([]);
          // The organization enters the hash, so the reindex writes both documents again rather than skipping them.
          expect(await h.svc.reindexSource(source.id)).toMatchObject({ ok: true, indexed: 2, skipped: 0 });
          const hits = await h.svc.search(ORG_QUERY, { topK: 5, executionContext: CALLER_A });
          expect(hits.map((x) => x.documentId)).toEqual([`${source.id}:ra`]);
        });
      }
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
