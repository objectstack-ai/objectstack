// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  DOC_HASH_VERSION,
  KnowledgeService,
  LIST_DOCUMENTS_PAGE_SIZE,
  REINDEX_PAGE_SIZE,
  computeDocHash,
  documentIdFor,
  recordToDocument,
} from '../knowledge-service.js';
import type {
  IDataEngine,
  AdapterContext,
  IKnowledgeAdapter,
} from '@objectstack/spec/contracts';
import type {
  KnowledgeDocument,
  KnowledgeHit,
  KnowledgeSource,
  ObjectKnowledgeSource,
} from '@objectstack/spec/ai';

function makeAdapter(id: string, hits: KnowledgeHit[] = []): IKnowledgeAdapter & {
  upsertSpy: ReturnType<typeof vi.fn>;
  deleteSpy: ReturnType<typeof vi.fn>;
  searchSpy: ReturnType<typeof vi.fn>;
} {
  const upsertSpy = vi.fn(async () => undefined);
  const deleteSpy = vi.fn(async () => undefined);
  const searchSpy = vi.fn(async () => hits);
  return {
    id,
    upsert: upsertSpy,
    delete: deleteSpy,
    search: searchSpy,
    upsertSpy,
    deleteSpy,
    searchSpy,
  };
}

function objectSource(id: string, object: string, adapter = 'memory'): KnowledgeSource {
  return {
    id,
    label: id,
    adapter,
    source: {
      kind: 'object',
      object,
      contentFields: ['title', 'notes'],
      metadataFields: ['status'],
    } as ObjectKnowledgeSource,
  };
}

describe('KnowledgeService — adapter & source registry', () => {
  it('registerAdapter / getAdapter / listAdapters', () => {
    const svc = new KnowledgeService();
    const a = makeAdapter('memory');
    svc.registerAdapter('memory', a);
    expect(svc.getAdapter('memory')).toBe(a);
    expect(svc.listAdapters()).toEqual(['memory']);
    expect(() => svc.getAdapter('nope')).toThrow(/unknown adapter/);
  });

  it('registerSource / listSources / getSource / unregister', () => {
    const svc = new KnowledgeService();
    const s = objectSource('s1', 'task');
    svc.registerSource(s);
    expect(svc.getSource('s1')).toEqual(s);
    expect(svc.listSources()).toHaveLength(1);
    svc.unregisterSource('s1');
    expect(svc.getSource('s1')).toBeUndefined();
  });

  it('indexDocument / deleteDocument route to the right adapter', async () => {
    const svc = new KnowledgeService();
    const a = makeAdapter('memory');
    svc.registerAdapter('memory', a);
    svc.registerSource(objectSource('s1', 'task'));
    const doc: KnowledgeDocument = { id: 'd1', sourceId: 's1', content: 'hello' };
    await svc.indexDocument('s1', doc);
    // The service computes `docHash` and stamps it on the document it hands the adapter.
    expect(a.upsertSpy).toHaveBeenCalledWith(
      [{ ...doc, docHash: computeDocHash(doc) }],
      expect.objectContaining({ reason: 'manual' }),
    );
    await svc.deleteDocument('s1', 'd1');
    expect(a.deleteSpy).toHaveBeenCalledWith(['d1'], expect.objectContaining({ reason: 'manual' }));
  });

  it('indexDocument refuses a caller-supplied docHash, naming it, and writes nothing', async () => {
    const svc = new KnowledgeService();
    const a = makeAdapter('memory');
    svc.registerAdapter('memory', a);
    svc.registerSource(objectSource('s1', 'task'));
    const doc: KnowledgeDocument = { id: 'd1', sourceId: 's1', content: 'hello', docHash: 'v1:caller-supplied' };
    await expect(svc.indexDocument('s1', doc)).rejects.toThrow(
      /indexDocument refused document 'd1': docHash is computed by the knowledge service/,
    );
    expect(a.upsertSpy).not.toHaveBeenCalled();
  });

  it('indexDocument throws on unknown source', async () => {
    const svc = new KnowledgeService();
    await expect(svc.indexDocument('nope', { id: 'd', sourceId: 'nope', content: '' })).rejects.toThrow(/unknown source/);
  });
});

describe('KnowledgeService — permission-aware search', () => {
  function buildSetup(hits: KnowledgeHit[]) {
    const adapter = makeAdapter('memory', hits);
    const findSpy = vi.fn(async (
      _obj: string,
      opts: { where?: Record<string, unknown>; fields?: string[]; context: { isSystem?: boolean } },
    ) => {
      if (opts.context?.isSystem) return [{ id: 'rec_1' }, { id: 'rec_2' }];
      return [{ id: 'rec_1' }];
    });
    const engine = { find: findSpy } as unknown as IDataEngine;
    const svc = new KnowledgeService({ dataEngine: engine });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('s1', 'task'));
    return { svc, adapter, findSpy };
  }

  it('fails closed on object-source hits when no executionContext is provided (#2981)', async () => {
    // A missing identity is NOT a grant of authority: object-backed hits are
    // dropped rather than returned unfiltered (the agent/RAG fall-open).
    const hits: KnowledgeHit[] = [
      { chunkId: 'c1', documentId: 'd1', sourceId: 's1', sourceRecordId: 'rec_1', score: 0.9, snippet: '' },
      { chunkId: 'c2', documentId: 'd2', sourceId: 's1', sourceRecordId: 'rec_2', score: 0.8, snippet: '' },
    ];
    const { svc, findSpy } = buildSetup(hits);
    const out = await svc.search('q');
    expect(out).toHaveLength(0);            // object-backed hits withheld
    expect(findSpy).not.toHaveBeenCalled(); // dropped without a lookup
  });

  it('keeps file/http hits but drops object hits when no executionContext (#2981)', async () => {
    // The fail-closed drop is scoped to record-backed hits; ACL-less
    // file/http hits still flow (their adapter owns any enforcement).
    const hits: KnowledgeHit[] = [
      { chunkId: 'c1', documentId: 'd1', sourceId: 's1', sourceRecordId: 'rec_1', score: 0.9, snippet: '' },
      { chunkId: 'c2', documentId: 'd2', sourceId: 'http_src', score: 0.5, snippet: 'web' },
    ];
    const { svc } = buildSetup(hits);
    // The fixture's http hit names a source, so the source is registered: a
    // hit is served only as a registered source it was searched for.
    svc.registerSource({
      id: 'http_src', label: 'HTTP', adapter: 'memory',
      source: { kind: 'http', urls: ['https://x.test'] } as KnowledgeSource['source'],
    });
    const out = await svc.search('q');
    expect(out.map((h) => h.documentId)).toEqual(['d2']);
  });

  it('passes through every hit when context is isSystem:true', async () => {
    const hits: KnowledgeHit[] = [
      { chunkId: 'c1', documentId: 'd1', sourceId: 's1', sourceRecordId: 'rec_1', score: 0.9, snippet: '' },
    ];
    const { svc, findSpy } = buildSetup(hits);
    const out = await svc.search('q', { executionContext: { positions: [], permissions: [], isSystem: true } });
    expect(out).toHaveLength(1);
    expect(findSpy).not.toHaveBeenCalled();
  });

  it('drops hits the user cannot read (RLS re-check)', async () => {
    const hits: KnowledgeHit[] = [
      { chunkId: 'c1', documentId: 'd1', sourceId: 's1', sourceRecordId: 'rec_1', score: 0.9, snippet: '' },
      { chunkId: 'c2', documentId: 'd2', sourceId: 's1', sourceRecordId: 'rec_2', score: 0.8, snippet: '' },
    ];
    const { svc, findSpy } = buildSetup(hits);
    const out = await svc.search('q', {
      executionContext: { userId: 'u1', positions: ['member'], permissions: [], isSystem: false },
    });
    expect(out.map((h) => h.documentId)).toEqual(['d1']);
    expect(findSpy).toHaveBeenCalledOnce();
    const [obj, opts] = findSpy.mock.calls[0];
    expect(obj).toBe('task');
    expect(opts.context.isSystem).toBe(false);
    expect(opts.where).toEqual({ id: { $in: ['rec_1', 'rec_2'] } });
  });

  it('keeps hits without sourceRecordId (file/http) regardless of RLS', async () => {
    const hits: KnowledgeHit[] = [
      { chunkId: 'c1', documentId: 'd1', sourceId: 'http_src', score: 0.5, snippet: 'web' },
    ];
    const adapter = makeAdapter('memory', hits);
    const engine = { find: vi.fn(async () => []) } as unknown as IDataEngine;
    const svc = new KnowledgeService({ dataEngine: engine });
    svc.registerAdapter('memory', adapter);
    svc.registerSource({
      id: 'http_src', label: 'HTTP', adapter: 'memory',
      source: { kind: 'http', urls: ['https://x.test'] } as KnowledgeSource['source'],
    });
    const out = await svc.search('q', {
      executionContext: { userId: 'u1', positions: [], permissions: [], isSystem: false },
    });
    expect(out).toHaveLength(1);
  });

  it('without dataEngine, drops object-source hits but keeps file/http hits', async () => {
    const adapter = makeAdapter('memory');
    adapter.search = vi.fn(async (_q, opts) => {
      if (opts.source.id === 's1') {
        return [{ chunkId: 'c1', documentId: 'd1', sourceId: 's1', sourceRecordId: 'rec_1', score: 0.9, snippet: '' }];
      }
      return [{ chunkId: 'c2', documentId: 'd2', sourceId: 'http', score: 0.5, snippet: 'web' }];
    });
    const svc = new KnowledgeService();
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('s1', 'task'));
    svc.registerSource({
      id: 'http', label: 'HTTP', adapter: 'memory',
      source: { kind: 'http', urls: ['https://x.test'] } as KnowledgeSource['source'],
    });
    const out = await svc.search('q', { executionContext: { userId: 'u', positions: [], permissions: [], isSystem: false } });
    expect(out.map((h) => h.documentId)).toEqual(['d2']);
  });

  it('topK honoured + hits sorted by score desc', async () => {
    const adapter = makeAdapter('memory', [
      { chunkId: 'c1', documentId: 'd1', sourceId: 's1', score: 0.3, snippet: '' },
      { chunkId: 'c2', documentId: 'd2', sourceId: 's1', score: 0.9, snippet: '' },
      { chunkId: 'c3', documentId: 'd3', sourceId: 's1', score: 0.6, snippet: '' },
    ]);
    const svc = new KnowledgeService();
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('s1', 'task'));
    // System context: an object source is searched for no other caller without an engine.
    const out = await svc.search('q', { topK: 2, executionContext: { positions: [], permissions: [], isSystem: true } });
    expect(out.map((h) => h.documentId)).toEqual(['d2', 'd3']);
  });

  it('search target restriction via sourceIds', async () => {
    const a = makeAdapter('memory', []);
    const svc = new KnowledgeService();
    svc.registerAdapter('memory', a);
    svc.registerSource(objectSource('s1', 'task'));
    svc.registerSource(objectSource('s2', 'note'));
    await svc.search('q', { sourceIds: ['s2'], executionContext: { positions: [], permissions: [], isSystem: true } });
    expect(a.searchSpy).toHaveBeenCalledOnce();
    const callArg = a.searchSpy.mock.calls[0][1] as { source: KnowledgeSource };
    expect(callArg.source.id).toBe('s2');
  });
});

describe('KnowledgeService — event sync', () => {
  it('handleRecordUpsert routes to every matching object source', async () => {
    const a1 = makeAdapter('memory');
    const a2 = makeAdapter('other');
    const svc = new KnowledgeService();
    svc.registerAdapter('memory', a1);
    svc.registerAdapter('other', a2);
    svc.registerSource(objectSource('s1', 'task', 'memory'));
    svc.registerSource(objectSource('s2', 'task', 'other'));
    svc.registerSource(objectSource('s3', 'note', 'memory'));
    await svc.handleRecordUpsert('task', { id: 'rec_1', title: 'T', notes: 'N' });
    expect(a1.upsertSpy).toHaveBeenCalledOnce();
    expect(a2.upsertSpy).toHaveBeenCalledOnce();
    const doc = a1.upsertSpy.mock.calls[0][0][0];
    expect(doc.sourceRecordId).toBe('rec_1');
    expect(doc.content).toContain('T');
  });

  it('handleRecordUpsert swallows adapter errors (sync must not block writes)', async () => {
    const a = makeAdapter('memory');
    a.upsert = vi.fn(async () => {
      throw new Error('adapter down');
    });
    const svc = new KnowledgeService();
    svc.registerAdapter('memory', a);
    svc.registerSource(objectSource('s1', 'task'));
    await expect(
      svc.handleRecordUpsert('task', { id: 'r', title: 't', notes: 'n' }),
    ).resolves.toBeUndefined();
  });

  it('handleRecordDelete deletes the derived doc id from every matching source', async () => {
    const a = makeAdapter('memory');
    const svc = new KnowledgeService();
    svc.registerAdapter('memory', a);
    svc.registerSource(objectSource('s1', 'task'));
    await svc.handleRecordDelete('task', 'rec_1');
    expect(a.deleteSpy).toHaveBeenCalledWith(['s1:rec_1'], expect.anything());
  });
});

describe('KnowledgeService — reindex', () => {
  it('object source: walks IDataEngine with isSystem context and pushes docs', async () => {
    // The first page holds both rows; the read after it (id > 'r2') is empty.
    const find = vi.fn(async (
      _obj: string,
      query: { where?: unknown; limit?: number },
      _options: { context: { isSystem?: boolean } },
    ) => (query.where === undefined ? [
      { id: 'r1', title: 'T1', notes: 'N1', status: 'open' },
      { id: 'r2', title: 'T2', notes: 'N2', status: 'done' },
    ] : []));
    const adapter = makeAdapter('memory');
    const svc = new KnowledgeService({ dataEngine: { find } as unknown as IDataEngine });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('s1', 'task'));
    const res = await svc.reindexSource('s1');
    expect(res.ok).toBe(true);
    expect(res.indexed).toBe(2);
    expect(res.discovered).toBe(2);
    expect(find.mock.calls[0][2].context.isSystem).toBe(true);
    expect(adapter.upsertSpy).toHaveBeenCalledOnce();
  });

  it('dryRun asks count, reads no rows and does not call the adapter', async () => {
    const find = vi.fn(async () => [{ id: 'r1', title: 'T1', notes: 'N1' }]);
    const count = vi.fn(async () => 1);
    const adapter = makeAdapter('memory');
    const svc = new KnowledgeService({ dataEngine: { find, count } as unknown as IDataEngine });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('s1', 'task'));
    const res = await svc.reindexSource('s1', { dryRun: true });
    expect(res.indexed).toBe(0);
    expect(res.discovered).toBe(1);
    expect(find).not.toHaveBeenCalled();
    expect(adapter.upsertSpy).not.toHaveBeenCalled();
  });

  it('returns ok:false when no dataEngine is bound', async () => {
    const svc = new KnowledgeService();
    svc.registerAdapter('memory', makeAdapter('memory'));
    svc.registerSource(objectSource('s1', 'task'));
    const res = await svc.reindexSource('s1');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/IDataEngine/);
  });

  it('returns ok:false for non-object sources (delegates to adapter)', async () => {
    const svc = new KnowledgeService({ dataEngine: { find: vi.fn() } as unknown as IDataEngine });
    svc.registerAdapter('memory', makeAdapter('memory'));
    svc.registerSource({
      id: 'http', label: 'HTTP', adapter: 'memory',
      source: { kind: 'http', urls: ['https://x.test'] } as KnowledgeSource['source'],
    });
    const res = await svc.reindexSource('http');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/adapter/);
  });
});

describe('Pure helpers', () => {
  it('documentIdFor is deterministic', () => {
    expect(documentIdFor('s', 'r')).toBe('s:r');
  });

  it('recordToDocument concatenates contentFields and projects metadataFields', () => {
    const src = objectSource('s1', 'task');
    const objSrc = src.source as ObjectKnowledgeSource;
    const doc = recordToDocument(src, objSrc, { id: 'r1', title: 'Hello', notes: 'World', status: 'open' });
    expect(doc.id).toBe('s1:r1');
    expect(doc.sourceRecordId).toBe('r1');
    expect(doc.content).toBe('Hello\n\nWorld');
    expect(doc.metadata?.status).toBe('open');
  });

  it('recordToDocument supports * for contentFields', () => {
    const src: KnowledgeSource = {
      id: 's1', label: 'all', adapter: 'memory',
      source: { kind: 'object', object: 'task', contentFields: ['*'] } as ObjectKnowledgeSource,
    };
    const objSrc = src.source as ObjectKnowledgeSource;
    const doc = recordToDocument(src, objSrc, { id: 'r1', title: 'A', notes: 'B', count: 7 });
    expect(doc.content).toContain('A');
    expect(doc.content).toContain('B');
    expect(doc.content).not.toContain('r1'); // id excluded
  });
});

// An index document is searchable text served to every reader its source
// admits, so it never carries a credential-class field (the set the engine
// masks on read) or an `internal: true` field (the set it omits) — under `*`,
// or when a source names one explicitly. The field sets come from the same
// collectors the write-response helper uses. Synthetic values.
describe('recordToDocument withholds credential-class and internal fields', () => {
  const CREDENTIAL = 'synthetic-credential-a27f';
  const INTERNAL = 'synthetic-internal-6e30';
  const schema = {
    name: 'probe_doc',
    fields: {
      id: { name: 'id', type: 'text' },
      title: { name: 'title', type: 'text' },
      notes: { name: 'notes', type: 'textarea' },
      api_token: { name: 'api_token', type: 'secret' },
      passphrase: { name: 'passphrase', type: 'password' },
      lookup_digest: { name: 'lookup_digest', type: 'text', internal: true },
    },
  };
  const record = () => ({
    id: 'r1', title: 'Visible', notes: 'Body',
    api_token: CREDENTIAL, passphrase: `${CREDENTIAL}-p`, lookup_digest: INTERNAL,
  });
  const source = (contentFields: string[], metadataFields: string[] = []): KnowledgeSource => ({
    id: 's1', label: 's1', adapter: 'memory',
    source: { kind: 'object', object: 'probe_doc', contentFields, metadataFields } as ObjectKnowledgeSource,
  });

  it("skips them under '*'", () => {
    const src = source(['*']);
    const doc = recordToDocument(src, src.source as ObjectKnowledgeSource, record(), schema);
    expect(doc.content).toBe('Visible\n\nBody');
    expect(JSON.stringify(doc)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(doc)).not.toContain(INTERNAL);
  });

  it('skips them when named explicitly as content or metadata', () => {
    const src = source(['title', 'api_token', 'lookup_digest'], ['passphrase', 'notes']);
    const doc = recordToDocument(src, src.source as ObjectKnowledgeSource, record(), schema);
    expect(doc.content).toBe('Visible');
    expect(doc.metadata).toEqual({ notes: 'Body' });
    expect(JSON.stringify(doc)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(doc)).not.toContain(INTERNAL);
  });

  // The event-sync path builds its document from the row it RE-READS (the
  // source's `where` decides membership), and that row carries every column —
  // the payload here carries only the id. The re-read row goes through the same
  // gate as the reindex walk, so a withheld field stays out of the document
  // whether the source takes `'*'` or names it.
  it.each([
    ["'*'", ['*'], [] as string[], 'Visible\n\nBody', {}],
    ['named explicitly', ['title', 'api_token', 'lookup_digest'], ['passphrase', 'notes'], 'Visible', { notes: 'Body' }],
  ])('the event-sync path withholds them from the re-read row (%s)', async (_label, content, meta, text, metadata) => {
    const getSchema = vi.fn((name: string) => (name === 'probe_doc' ? schema : undefined));
    const find = vi.fn(async () => [record()]);
    const svc = new KnowledgeService({ dataEngine: { find, getSchema } as unknown as IDataEngine });
    const adapter = makeAdapter('memory');
    svc.registerAdapter('memory', adapter);
    svc.registerSource(source(content, meta));
    await svc.handleRecordUpsert('probe_doc', { id: 'r1' });
    expect(find).toHaveBeenCalledTimes(1);
    expect(getSchema).toHaveBeenCalledWith('probe_doc');
    const [docs] = adapter.upsertSpy.mock.calls[0] as unknown as [KnowledgeDocument[]];
    expect(docs[0].content).toBe(text);
    expect(docs[0].metadata).toEqual(metadata);
    expect(JSON.stringify(docs)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(docs)).not.toContain(INTERNAL);
  });

  it('the reindex walk reads the schema off the bound engine', async () => {
    const getSchema = vi.fn((name: string) => (name === 'probe_doc' ? schema : undefined));
    // One row on the first page; the read after it (id > that row) is empty.
    const find = vi.fn(async (_obj: string, query: { where?: unknown }) => (query.where === undefined ? [record()] : []));
    const svc = new KnowledgeService({ dataEngine: { find, getSchema } as unknown as IDataEngine });
    const adapter = makeAdapter('memory');
    svc.registerAdapter('memory', adapter);
    svc.registerSource(source(['*']));
    const res = await svc.reindexSource('s1');
    expect(res).toMatchObject({ ok: true, indexed: 1 });
    const [docs] = adapter.upsertSpy.mock.calls[0] as unknown as [KnowledgeDocument[]];
    expect(JSON.stringify(docs)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(docs)).not.toContain(INTERNAL);
  });

  it('without a schema nothing is withheld here', () => {
    const src = source(['title', 'notes']);
    const doc = recordToDocument(src, src.source as ObjectKnowledgeSource, { id: 'r1', title: 'A', notes: 'B' });
    expect(doc.content).toBe('A\n\nB');
  });
});

// ── The reindex walk pages by id ────────────────────────────────────
//
// The walk reads at most one page per `find` (ordered by `id`, continuing
// after the previous page's last id) and upserts each page in its own call.
// The engine double below REFUSES, by a throw, any `find` without a positive
// `limit` or without the `id` ascending order, and any operator it does not
// implement — so an unbounded read turns the suite red rather than being
// answered. Ids are zero-padded and inserted shuffled: the order the walk
// sees is the engine's, never insertion order.

type PagedRow = Record<string, unknown>;

/** The double's id order: numbers numerically, anything else by string. */
function compareIds(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function pagedEngine(rowsIn: PagedRow[]) {
  const rows = [...rowsIn];
  let hold: Promise<void> | undefined;
  const matches = (row: PagedRow, where: Record<string, unknown> | undefined): boolean => {
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
        if (!(compareIds(row.id, (value as { $gt: unknown }).$gt) > 0)) return false;
        continue;
      }
      if (row[key] !== value) return false;
    }
    return true;
  };
  const pinsId = (where: Record<string, unknown> | undefined): boolean =>
    where !== undefined &&
    (typeof where.id === 'string' || typeof where.id === 'number' ||
      (Array.isArray(where.$and) && where.$and.some((c) => pinsId(c as Record<string, unknown>))));
  const find = vi.fn(async (
    _object: string,
    query: { where?: Record<string, unknown>; orderBy?: unknown; limit?: number },
    options: { context?: { isSystem?: boolean } },
  ): Promise<PagedRow[]> => {
    if (typeof query?.limit !== 'number' || !(query.limit > 0)) {
      throw new Error('engine double: an unbounded find (no positive limit)');
    }
    // The membership re-read (event sync, purge) pins one id and needs no order;
    // every other read is a walk page and must be ordered by id.
    const pinsOneId = query.limit === 1 && pinsId(query.where);
    if (!pinsOneId && JSON.stringify(query.orderBy) !== JSON.stringify([{ field: 'id', order: 'asc' }])) {
      throw new Error(`engine double: expected orderBy id asc, got ${JSON.stringify(query.orderBy)}`);
    }
    if (options?.context?.isSystem !== true) throw new Error('engine double: expected the system context');
    const page = rows
      .filter((r) => matches(r, query.where))
      .sort((a, b) => compareIds(a.id, b.id))
      .slice(0, query.limit)
      .map((r) => ({ ...r }));
    const gate = hold;
    hold = undefined;
    if (gate) await gate;
    return page;
  });
  const count = vi.fn(async (_object: string, query: { where?: Record<string, unknown> }) =>
    rows.filter((r) => matches(r, query?.where)).length);
  return {
    engine: { find, count } as unknown as IDataEngine,
    find,
    count,
    /** The double's live rows: a case mutates them to change the database under the service. */
    rows,
    /** The next `find` reads at call time but resolves only once the returned function is called. */
    holdNextFind(): () => void {
      let release!: () => void;
      hold = new Promise<void>((resolve) => { release = resolve; });
      return release;
    },
  };
}

/** `n` task rows `r000…`, inserted in a shuffled (but deterministic) order. */
function taskRows(n: number, extra: (i: number) => PagedRow = () => ({})): PagedRow[] {
  const out: PagedRow[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: `r${String(i).padStart(3, '0')}`, title: `T${i}`, notes: `N${i}`, status: 'open', ...extra(i) });
  }
  return out.sort((a, b) => ((Number(String(a.id).slice(1)) * 7919) % 1009) - ((Number(String(b.id).slice(1)) * 7919) % 1009));
}

function upsertedIds(adapter: ReturnType<typeof makeAdapter>): string[][] {
  return (adapter.upsertSpy.mock.calls as unknown as Array<[KnowledgeDocument[]]>).map(([docs]) => docs.map((d) => d.id));
}

function reindexHarness<A extends IKnowledgeAdapter = ReturnType<typeof makeAdapter>>(
  rows: PagedRow[],
  src: KnowledgeSource = objectSource('s1', 'task'),
  adapter: A = makeAdapter('memory') as unknown as A,
) {
  const db = pagedEngine(rows);
  const svc = new KnowledgeService({ dataEngine: db.engine });
  svc.registerAdapter('memory', adapter);
  svc.registerSource(src);
  return { ...db, adapter, svc };
}

const ids = (from: number, to: number): string[] =>
  Array.from({ length: to - from }, (_, k) => `s1:r${String(from + k).padStart(3, '0')}`);

describe('KnowledgeService — the reindex walk pages by id', () => {
  it('the page size is 100', () => {
    expect(REINDEX_PAGE_SIZE).toBe(100);
  });

  it('0 rows: one bounded read, no upsert', async () => {
    const h = reindexHarness([]);
    const res = await h.svc.reindexSource('s1');
    expect(res).toEqual({ ok: true, object: 'task', discovered: 0, indexed: 0, skipped: 0, purged: null });
    expect(h.find).toHaveBeenCalledTimes(1);
    expect(h.adapter.upsertSpy).not.toHaveBeenCalled();
  });

  it('exactly one page: one upsert of the page, then a read that comes back empty', async () => {
    const h = reindexHarness(taskRows(100));
    const res = await h.svc.reindexSource('s1');
    expect(res).toEqual({ ok: true, object: 'task', discovered: 100, indexed: 100, skipped: 0, purged: null });
    expect(upsertedIds(h.adapter)).toEqual([ids(0, 100)]);
    expect(h.find).toHaveBeenCalledTimes(2);
    expect(h.find.mock.calls[1][1].where).toEqual({ id: { $gt: 'r099' } });
  });

  it('one page + 1: two upserts (100, then 1), each row once, in id order', async () => {
    const h = reindexHarness(taskRows(101));
    const res = await h.svc.reindexSource('s1');
    expect(res).toEqual({ ok: true, object: 'task', discovered: 101, indexed: 101, skipped: 0, purged: null });
    expect(upsertedIds(h.adapter)).toEqual([ids(0, 100), ids(100, 101)]);
    // A short page is not the end — only the empty third read is.
    expect(h.find).toHaveBeenCalledTimes(3);
    expect(h.find.mock.calls[2][1].where).toEqual({ id: { $gt: 'r100' } });
    for (const call of h.find.mock.calls) expect(call[1].limit).toBe(REINDEX_PAGE_SIZE);
    for (const call of h.adapter.upsertSpy.mock.calls as unknown as Array<[KnowledgeDocument[], { reason: string }]>) {
      expect(call[0].length).toBeLessThanOrEqual(REINDEX_PAGE_SIZE);
      expect(call[1].reason).toBe('reindex');
    }
  });

  it("the source's where is ANDed with the cursor on every page", async () => {
    const src = objectSource('s1', 'task');
    (src.source as ObjectKnowledgeSource).where = { status: 'open' };
    const h = reindexHarness(taskRows(250, (i) => ({ status: i % 5 === 0 ? 'done' : 'open' })), src);
    const res = await h.svc.reindexSource('s1');
    expect(res).toEqual({ ok: true, object: 'task', discovered: 200, indexed: 200, skipped: 0, purged: null });
    const all = upsertedIds(h.adapter).flat();
    expect(all).toHaveLength(200);
    expect(new Set(all).size).toBe(200);
    expect(all.every((id) => Number(id.slice(4)) % 5 !== 0)).toBe(true);
    expect(h.find.mock.calls[0][1].where).toEqual({ status: 'open' });
    expect(h.find.mock.calls[1][1].where).toEqual({ $and: [{ status: 'open' }, { id: { $gt: all[99].slice(3) } }] });
  });

  it.each([
    [150, [100, 50], 150],
    [100, [100], 100],
    [30, [30], 30],
    [0, [], 0],
  ])('limit %i caps the total: reads %j', async (limit, reads, total) => {
    const h = reindexHarness(taskRows(250));
    const res = await h.svc.reindexSource('s1', { limit });
    expect(res).toEqual({ ok: true, object: 'task', discovered: total, indexed: total, skipped: 0, purged: null });
    expect(h.find.mock.calls.map((c) => c[1].limit)).toEqual(reads);
    expect(upsertedIds(h.adapter).flat()).toEqual(ids(0, total));
  });

  it('a limit above the row count reads to the end', async () => {
    const h = reindexHarness(taskRows(120));
    const res = await h.svc.reindexSource('s1', { limit: 500 });
    expect(res).toEqual({ ok: true, object: 'task', discovered: 120, indexed: 120, skipped: 0, purged: null });
  });

  it('a short page is not the end: a page that lost a row to a hook does not stop the walk', async () => {
    const h = reindexHarness(taskRows(250));
    const real = h.find.getMockImplementation()!;
    // An afterFind-style drop: the first full page comes back with 99 of its 100 rows.
    h.find.mockImplementation(async (o, q, opt) => {
      const page = await real(o, q, opt);
      return h.find.mock.calls.length === 1 ? page.filter((r) => r.id !== 'r049') : page;
    });
    const res = await h.svc.reindexSource('s1');
    expect(res).toEqual({ ok: true, object: 'task', discovered: 249, indexed: 249, skipped: 0, purged: null });
    expect(upsertedIds(h.adapter).map((p) => p.length)).toEqual([99, 100, 50]);
    expect(upsertedIds(h.adapter).flat()).toEqual(ids(0, 250).filter((id) => id !== 's1:r049'));
    expect(h.find).toHaveBeenCalledTimes(4);
  });

  it('numeric ids: the cursor keeps the number and the pages follow numeric order', async () => {
    const rows = taskRows(150).map((r) => ({ ...r, id: Number(String(r.id).slice(1)) + 1 }));
    const h = reindexHarness(rows);
    const res = await h.svc.reindexSource('s1');
    expect(res).toEqual({ ok: true, object: 'task', discovered: 150, indexed: 150, skipped: 0, purged: null });
    const want = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => `s1:${from + k}`);
    expect(upsertedIds(h.adapter)).toEqual([want(1, 100), want(101, 150)]);
    expect(h.find.mock.calls.map((c) => c[1].where)).toEqual([undefined, { id: { $gt: 100 } }, { id: { $gt: 150 } }]);
  });

  it('a fractional limit is floored', async () => {
    const h = reindexHarness(taskRows(250));
    const res = await h.svc.reindexSource('s1', { limit: 150.7 });
    expect(res).toEqual({ ok: true, object: 'task', discovered: 150, indexed: 150, skipped: 0, purged: null });
    expect(h.find.mock.calls.map((c) => c[1].limit)).toEqual([100, 50]);
  });

  it.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY]])('limit %s is refused with ok:false, reading nothing', async (limit) => {
    const h = reindexHarness(taskRows(10));
    for (const dryRun of [false, true]) {
      const res = await h.svc.reindexSource('s1', { limit, dryRun });
      expect(res).toMatchObject({ ok: false, object: 'task', discovered: 0, indexed: 0 });
      expect(res.message).toContain('limit must be a non-negative finite number');
    }
    expect(h.find).not.toHaveBeenCalled();
    expect(h.count).not.toHaveBeenCalled();
    expect(h.adapter.upsertSpy).not.toHaveBeenCalled();
  });

  it("a page whose documents cannot be built ends the walk with ok:false naming the page", async () => {
    const h = reindexHarness(taskRows(150));
    const real = h.find.getMockImplementation()!;
    h.find.mockImplementation(async (o, q, opt) => {
      const page = await real(o, q, opt);
      if (h.find.mock.calls.length === 2) {
        Object.defineProperty(page[3], 'title', { get() { throw new Error('unreadable column'); } });
      }
      return page;
    });
    const res = await h.svc.reindexSource('s1');
    expect(res).toMatchObject({ ok: false, discovered: 100, indexed: 100 });
    expect(res.message).toContain('page 2');
    expect(res.message).toContain('unreadable column');
    expect(h.adapter.upsertSpy).toHaveBeenCalledTimes(1);
  });

  it('a thrown non-Error is reported by its text', async () => {
    const h = reindexHarness(taskRows(10));
    h.adapter.upsertSpy.mockImplementationOnce(async () => { throw 'quota exhausted'; });
    const res = await h.svc.reindexSource('s1');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('quota exhausted');
    expect(res.message).not.toContain('undefined');
  });

  it('dryRun counts under the where, capped by limit, and reads no rows', async () => {
    const src = objectSource('s1', 'task');
    (src.source as ObjectKnowledgeSource).where = { status: 'open' };
    const h = reindexHarness(taskRows(250, (i) => ({ status: i % 5 === 0 ? 'done' : 'open' })), src);
    expect(await h.svc.reindexSource('s1', { dryRun: true })).toMatchObject({ ok: true, discovered: 200, indexed: 0 });
    expect(await h.svc.reindexSource('s1', { dryRun: true, limit: 150 })).toMatchObject({ ok: true, discovered: 150, indexed: 0 });
    expect(h.count.mock.calls[0][1]).toEqual({ where: { status: 'open' } });
    expect(h.find).not.toHaveBeenCalled();
    expect(h.adapter.upsertSpy).not.toHaveBeenCalled();
  });

  it('a failed page read ends the walk with ok:false naming the page; earlier pages stay counted', async () => {
    const h = reindexHarness(taskRows(250));
    const real = h.find.getMockImplementation()!;
    h.find.mockImplementation(async (o, q, opt) => {
      if (h.find.mock.calls.length === 2) throw new Error('connection reset');
      return real(o, q, opt);
    });
    const res = await h.svc.reindexSource('s1');
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ object: 'task', discovered: 100, indexed: 100 });
    expect(res.message).toContain('page 2');
    expect(res.message).toContain("after id 'r099'");
    expect(res.message).toContain('connection reset');
    expect(upsertedIds(h.adapter)).toEqual([ids(0, 100)]);
  });

  it('a failed page upsert ends the walk with ok:false naming the page; the next walk runs', async () => {
    const h = reindexHarness(taskRows(250));
    h.adapter.upsertSpy.mockImplementationOnce(async () => undefined);
    h.adapter.upsertSpy.mockImplementationOnce(async () => { throw new Error('embedder 429'); });
    const res = await h.svc.reindexSource('s1');
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ discovered: 100, indexed: 100 });
    expect(res.message).toContain('page 2');
    expect(res.message).toContain('embedder 429');
    expect(h.find).toHaveBeenCalledTimes(2);
    // The failed walk released the source's lock.
    const again = await h.svc.reindexSource('s1');
    expect(again).toEqual({ ok: true, object: 'task', discovered: 250, indexed: 250, skipped: 0, purged: null });
  });

  it('an engine that ignores the cursor ends the walk instead of looping', async () => {
    const page = taskRows(100);
    const find = vi.fn(async () => page.map((r) => ({ ...r })).sort((a, b) => String(a.id).localeCompare(String(b.id))));
    const adapter = makeAdapter('memory');
    const svc = new KnowledgeService({ dataEngine: { find } as unknown as IDataEngine });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('s1', 'task'));
    const res = await svc.reindexSource('s1');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('page 2');
    expect(res.message).toMatch(/did not move past the cursor/);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('a page whose last row has no id ends the walk after indexing it', async () => {
    const rows = taskRows(100).map((r) => ({ ...r }));
    const find = vi.fn(async () => rows.map((r, i) => (i === rows.length - 1 ? { title: 'no id' } : r)));
    const adapter = makeAdapter('memory');
    const svc = new KnowledgeService({ dataEngine: { find } as unknown as IDataEngine });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('s1', 'task'));
    const res = await svc.reindexSource('s1');
    expect(res).toMatchObject({ ok: false, discovered: 100, indexed: 100 });
    expect(res.message).toMatch(/page 1: .*carries no id/);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('a second reindex of the same source waits: the two walks never interleave', async () => {
    const h = reindexHarness(taskRows(150));
    const order: string[] = [];
    h.adapter.upsertSpy.mockImplementation(async (...args: unknown[]) => {
      const docs = args[0] as KnowledgeDocument[];
      order.push(`${docs[0].id}+${docs.length}`);
    });
    const release = h.holdNextFind();
    const first = h.svc.reindexSource('s1');
    const second = h.svc.reindexSource('s1');
    await new Promise((r) => setTimeout(r, 5));
    // The first walk's first read is held; the second walk has not read at all.
    expect(h.find).toHaveBeenCalledTimes(1);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual({ ok: true, object: 'task', discovered: 150, indexed: 150, skipped: 0, purged: null });
    expect(b).toEqual(a);
    expect(order).toEqual(['s1:r000+100', 's1:r100+50', 's1:r000+100', 's1:r100+50']);
  });

  it('walks of different sources do not wait for each other', async () => {
    const h = reindexHarness(taskRows(10));
    h.svc.registerSource(objectSource('s2', 'task'));
    const release = h.holdNextFind();
    const first = h.svc.reindexSource('s1');
    const other = await h.svc.reindexSource('s2');
    expect(other).toEqual({ ok: true, object: 'task', discovered: 10, indexed: 10, skipped: 0, purged: null });
    release();
    expect(await first).toEqual({ ok: true, object: 'task', discovered: 10, indexed: 10, skipped: 0, purged: null });
  });
});

// ── docHash, skip and purge (ADR-0161 K8, items 1–2) ─────────────────
//
// The adapter below stores each document's `docHash` and lists it back, one
// page of `opts.limit` at a time, in id order: the smallest adapter that
// implements `listDocuments`. Its calls are counted, so "not upserted" is read
// from the adapter, never inferred from the result.

function listingAdapter(id = 'memory') {
  const stored = new Map<string, string | undefined>();
  const upsertSpy = vi.fn(async (docs: KnowledgeDocument[], _ctx: AdapterContext) => {
    for (const d of docs) stored.set(d.id, d.docHash);
  });
  const deleteSpy = vi.fn(async (documentIds: string[], _ctx: AdapterContext) => {
    for (const d of documentIds) stored.delete(d);
  });
  const listSpy = vi.fn(async (_ctx: AdapterContext, opts: { cursor?: string; limit: number }) => {
    const all = [...stored.keys()].sort().filter((d) => opts.cursor === undefined || d > opts.cursor);
    const page = all.slice(0, opts.limit);
    return {
      documents: page.map((documentId) => ({ documentId, docHash: stored.get(documentId) })),
      ...(all.length > page.length ? { nextCursor: page[page.length - 1] } : {}),
    };
  });
  const adapter = {
    id,
    upsert: upsertSpy,
    delete: deleteSpy,
    search: vi.fn(async () => [] as KnowledgeHit[]),
    listDocuments: listSpy,
  };
  return { adapter, stored, upsertSpy, deleteSpy, listSpy };
}

const upsertedOf = (spy: { mock: { calls: unknown[][] } }): string[] =>
  (spy.mock.calls as Array<[KnowledgeDocument[]]>).flatMap(([docs]) => docs.map((d) => d.id));
const deletedOf = (spy: { mock: { calls: unknown[][] } }): string[] =>
  (spy.mock.calls as Array<[string[]]>).flatMap(([docIds]) => docIds);

describe('computeDocHash', () => {
  const base = { content: 'Body', title: 'T', metadata: { status: 'open', tags: ['a', 'b'], nested: { y: 1, x: 2 } } };

  it('carries the version prefix and is stable under metadata key order, at every depth', () => {
    const h = computeDocHash(base);
    expect(h).toMatch(new RegExp(`^${DOC_HASH_VERSION}:[0-9a-f]{64}$`));
    expect(computeDocHash({ ...base, metadata: { nested: { x: 2, y: 1 }, tags: ['a', 'b'], status: 'open' } })).toBe(h);
  });

  it.each([
    ['content', { ...base, content: 'Body!' }],
    ['title', { ...base, title: 'T2' }],
    ['an absent title', { ...base, title: undefined }],
    ['a metadata value', { ...base, metadata: { ...base.metadata, status: 'done' } }],
    ['array order', { ...base, metadata: { ...base.metadata, tags: ['b', 'a'] } }],
  ])('changes with %s', (_what, changed) => {
    expect(computeDocHash(changed)).not.toBe(computeDocHash(base));
  });

  it('recordToDocument stamps it on every document it builds', () => {
    const src = objectSource('s1', 'task');
    const doc = recordToDocument(src, src.source as ObjectKnowledgeSource, { id: 'r1', title: 'A', notes: 'B', status: 'open' });
    expect(doc.docHash).toBe(computeDocHash(doc));
  });
});

describe('KnowledgeService — a complete reindex skips unchanged documents and purges stale ones', () => {
  it('first reindex over an empty listing writes everything; the next writes nothing unchanged', async () => {
    const la = listingAdapter();
    const h = reindexHarness(taskRows(150), objectSource('s1', 'task'), la.adapter);
    expect(await h.svc.reindexSource('s1')).toEqual({ ok: true, object: 'task', discovered: 150, indexed: 150, skipped: 0, purged: 0 });
    la.upsertSpy.mockClear();
    expect(await h.svc.reindexSource('s1')).toEqual({ ok: true, object: 'task', discovered: 150, indexed: 0, skipped: 150, purged: 0 });
    expect(la.upsertSpy).not.toHaveBeenCalled();
    expect(la.deleteSpy).not.toHaveBeenCalled();
  });

  it('a changed row is written again; only it', async () => {
    const la = listingAdapter();
    const h = reindexHarness(taskRows(10), objectSource('s1', 'task'), la.adapter);
    await h.svc.reindexSource('s1');
    la.upsertSpy.mockClear();
    h.rows.find((r) => r.id === 'r003')!.notes = 'changed';
    h.rows.find((r) => r.id === 'r007')!.status = 'done'; // a metadata field
    expect(await h.svc.reindexSource('s1')).toMatchObject({ ok: true, indexed: 2, skipped: 8, purged: 0 });
    expect(upsertedOf(la.upsertSpy)).toEqual(['s1:r003', 's1:r007']);
  });

  it('a listed entry with no docHash reads as changed', async () => {
    const la = listingAdapter();
    const h = reindexHarness(taskRows(3), objectSource('s1', 'task'), la.adapter);
    await h.svc.reindexSource('s1');
    la.stored.set('s1:r001', undefined);
    la.upsertSpy.mockClear();
    expect(await h.svc.reindexSource('s1')).toMatchObject({ indexed: 1, skipped: 2 });
    expect(upsertedOf(la.upsertSpy)).toEqual(['s1:r001']);
  });

  it('the listing is read page by page to its end before the walk', async () => {
    const la = listingAdapter();
    const h = reindexHarness(taskRows(3), objectSource('s1', 'task'), la.adapter);
    for (let i = 0; i < LIST_DOCUMENTS_PAGE_SIZE + 1; i++) la.stored.set(`s1:zz${String(i).padStart(4, '0')}`, 'x');
    const res = await h.svc.reindexSource('s1');
    expect(la.listSpy.mock.calls.map((c) => c[1])).toEqual([
      { limit: LIST_DOCUMENTS_PAGE_SIZE },
      { cursor: `s1:zz${String(LIST_DOCUMENTS_PAGE_SIZE - 1).padStart(4, '0')}`, limit: LIST_DOCUMENTS_PAGE_SIZE },
    ]);
    // Every listed `zz` document has no row: all purged.
    expect(res).toMatchObject({ ok: true, indexed: 3, purged: LIST_DOCUMENTS_PAGE_SIZE + 1 });
  });

  it('purges the document of a deleted row and of a row that stopped matching where, each confirmed by a re-read', async () => {
    const src = objectSource('s1', 'task');
    (src.source as ObjectKnowledgeSource).where = { status: 'open' };
    const la = listingAdapter();
    const h = reindexHarness(taskRows(5), src, la.adapter);
    await h.svc.reindexSource('s1');
    h.rows.splice(h.rows.findIndex((r) => r.id === 'r001'), 1);
    h.rows.find((r) => r.id === 'r003')!.status = 'done';
    h.find.mockClear();
    const res = await h.svc.reindexSource('s1');
    expect(res).toEqual({ ok: true, object: 'task', discovered: 3, indexed: 0, skipped: 3, purged: 2 });
    expect(deletedOf(la.deleteSpy).sort()).toEqual(['s1:r001', 's1:r003']);
    for (const call of la.deleteSpy.mock.calls) expect(call[1]).toMatchObject({ reason: 'reindex' });
    // The confirming re-reads are the event sync's: `where` AND id, one row, system context.
    const rereads = h.find.mock.calls.filter((c) => c[1].limit === 1).map((c) => c[1].where);
    expect(rereads).toEqual([
      { $and: [{ status: 'open' }, { id: 'r001' }] },
      { $and: [{ status: 'open' }, { id: 'r003' }] },
    ]);
    expect([...la.stored.keys()].sort()).toEqual(['s1:r000', 's1:r002', 's1:r004']);
  });

  it.each([
    ['a limit', { limit: 100 }],
    ['a limit of 0', { limit: 0 }],
    ['a dryRun', { dryRun: true }],
  ])('a reindex with %s purges nothing and says purged: null', async (_what, opts) => {
    const la = listingAdapter();
    const h = reindexHarness(taskRows(5), objectSource('s1', 'task'), la.adapter);
    await h.svc.reindexSource('s1');
    h.rows.splice(0, 2);
    const res = await h.svc.reindexSource('s1', opts);
    expect(res).toMatchObject({ ok: true, purged: null });
    expect(la.deleteSpy).not.toHaveBeenCalled();
    expect(la.stored.size).toBe(5);
  });

  it('a walk with a failed page purges nothing', async () => {
    const la = listingAdapter();
    const h = reindexHarness(taskRows(150), objectSource('s1', 'task'), la.adapter);
    await h.svc.reindexSource('s1');
    h.rows.splice(0, 1);
    const real = h.find.getMockImplementation()!;
    h.find.mockClear();
    h.find.mockImplementation(async (o, q, opt) => {
      if (h.find.mock.calls.length === 2) throw new Error('connection reset');
      return real(o, q, opt);
    });
    const res = await h.svc.reindexSource('s1');
    expect(res).toMatchObject({ ok: false, purged: null });
    expect(res.message).toContain('page 2');
    expect(la.deleteSpy).not.toHaveBeenCalled();
  });

  it('a document written by the event sync during the walk survives the purge', async () => {
    const la = listingAdapter();
    const h = reindexHarness(taskRows(3), objectSource('s1', 'task'), la.adapter);
    await h.svc.reindexSource('s1');
    // r001's row is gone when the walk reads, so its listed document is a
    // candidate — but the row is restored, and synced, before the purge runs.
    const r001 = h.rows.splice(h.rows.findIndex((r) => r.id === 'r001'), 1)[0];
    const release = h.holdNextFind();
    const walk = h.svc.reindexSource('s1');
    await new Promise((r) => setTimeout(r, 5));
    h.rows.push(r001);
    await h.svc.handleRecordUpsert('task', { id: 'r001' });
    // A row created during the walk: its document was never listed.
    h.rows.push({ id: 'r900', title: 'New', notes: 'N', status: 'open' });
    await h.svc.handleRecordUpsert('task', { id: 'r900' });
    release();
    const res = await walk;
    expect(res).toMatchObject({ ok: true, purged: 0 });
    expect(la.deleteSpy).not.toHaveBeenCalled();
    expect(la.stored.has('s1:r001')).toBe(true);
    expect(la.stored.has('s1:r900')).toBe(true);
  });

  it('a source with refresh.onRecordChange: false still skips, and is never purged', async () => {
    const src = { ...objectSource('s1', 'task'), refresh: { onRecordChange: false } } as KnowledgeSource;
    const la = listingAdapter();
    const h = reindexHarness(taskRows(4), src, la.adapter);
    await h.svc.reindexSource('s1');
    h.rows.splice(0, 1);
    expect(await h.svc.reindexSource('s1')).toEqual({ ok: true, object: 'task', discovered: 3, indexed: 0, skipped: 3, purged: null });
    expect(la.deleteSpy).not.toHaveBeenCalled();
  });

  it('a listing that fails skips and purges nothing, writes every document, and says why', async () => {
    const la = listingAdapter();
    const h = reindexHarness(taskRows(4), objectSource('s1', 'task'), la.adapter);
    await h.svc.reindexSource('s1');
    h.rows.splice(0, 1);
    la.listSpy.mockImplementationOnce(async () => { throw new Error('vector store timeout'); });
    la.upsertSpy.mockClear();
    const res = await h.svc.reindexSource('s1');
    expect(res).toMatchObject({ ok: true, discovered: 3, indexed: 3, skipped: 0, purged: null });
    expect(res.message).toContain('vector store timeout');
    expect(upsertedOf(la.upsertSpy)).toHaveLength(3);
    expect(la.deleteSpy).not.toHaveBeenCalled();
  });

  it('a listing whose cursor comes back twice is refused rather than looped on', async () => {
    const la = listingAdapter();
    const h = reindexHarness(taskRows(2), objectSource('s1', 'task'), la.adapter);
    la.listSpy.mockImplementation(async () => ({ documents: [], nextCursor: 'same' }));
    const res = await h.svc.reindexSource('s1');
    expect(res).toMatchObject({ ok: true, indexed: 2, purged: null });
    expect(res.message).toMatch(/came back twice/);
    expect(la.listSpy).toHaveBeenCalledTimes(2);
  });

  it('a purge whose re-read fails stops, keeps the document and reports ok:false', async () => {
    const la = listingAdapter();
    const h = reindexHarness(taskRows(3), objectSource('s1', 'task'), la.adapter);
    await h.svc.reindexSource('s1');
    h.rows.splice(0, 1);
    const real = h.find.getMockImplementation()!;
    h.find.mockImplementation(async (o, q, opt) => {
      if (q.limit === 1) throw new Error('replica lag');
      return real(o, q, opt);
    });
    const res = await h.svc.reindexSource('s1');
    expect(res).toMatchObject({ ok: false, discovered: 2, purged: 0 });
    expect(res.message).toMatch(/purge stopped after 0 deletion\(s\): document 's1:r000': replica lag/);
    expect(la.stored.has('s1:r000')).toBe(true);
  });

  it('a listed document whose id this source does not derive is kept, and the result says so', async () => {
    const la = listingAdapter();
    const h = reindexHarness(taskRows(2), objectSource('s1', 'task'), la.adapter);
    la.stored.set('pushed-faq-1', 'x');
    const res = await h.svc.reindexSource('s1');
    expect(res).toMatchObject({ ok: true, purged: 0 });
    expect(res.message).toMatch(/1 listed document\(s\) carry an id/);
    expect(la.stored.has('pushed-faq-1')).toBe(true);
  });
});
