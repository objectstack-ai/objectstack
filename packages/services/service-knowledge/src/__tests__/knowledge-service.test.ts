// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { LiteKernel, ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { KnowledgeServicePlugin } from '../knowledge-service-plugin.js';
import {
  DOC_HASH_VERSION,
  KnowledgeService,
  LIST_DOCUMENTS_PAGE_SIZE,
  REINDEX_PAGE_SIZE,
  SEARCH_FIRST_ROUND_FACTOR,
  SEARCH_FRESHNESS_ROUNDS,
  SEARCH_REFILL_FACTOR,
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
    name: id,
    label: id,
    adapter,
    source: {
      kind: 'object',
      object,
      content: ['title', 'notes'],
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
    expect(() => svc.getAdapter('nope')).toThrow(/adapter 'nope' is not mounted/);
  });

  it('registerSource / listSources / getSource / unregister', () => {
    const svc = new KnowledgeService();
    const s = objectSource('s1', 'task');
    svc.registerSource(s);
    // The source as parsed: what the author wrote, with the schema's defaults stated.
    expect(svc.getSource('s1')).toEqual({ ...s, refresh: {}, aiExposed: true });
    expect(svc.listSources()).toHaveLength(1);
    svc.unregisterSource('s1');
    expect(svc.getSource('s1')).toBeUndefined();
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
    expect(callArg.source.name).toBe('s2');
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

  it("a refusal's remedy (operator text) reaches the warn log, never refused[].message or the thrown message", async () => {
    const over = (name: string, adapter: string): KnowledgeSource => objectSource(name, 'task', adapter);
    // The system identity: a source is searched for it with no engine to re-check with.
    const asSystem = { positions: [], permissions: [], isSystem: true };
    const remedy = 'Run as a database owner:\nDELETE FROM "os_knowledge"."knowledge_generation" WHERE source_id = \'refusing\';';
    const refusing = Object.assign(makeAdapter('refusing'), {
      search: vi.fn(async () => {
        throw Object.assign(new Error("Knowledge source 'refusing' needs a rebuild."), {
          code: 'KNOWLEDGE_REBUILD_REQUIRED', status: 409, remedy,
        });
      }),
    });
    const answering = makeAdapter('answering', [{ chunkId: 'c1', documentId: 'd1', sourceId: 'answering', score: 0.9, snippet: 'ok' }]);
    const warn = vi.fn();
    const svc = new KnowledgeService({ logger: { warn } as never });
    svc.registerAdapter('refusing', refusing);
    svc.registerAdapter('answering', answering);
    svc.registerSource(over('refusing', 'refusing'));
    svc.registerSource(over('answering', 'answering'));

    // Some sources answer: the refused one is named, its message alone.
    const report = await svc.searchWithRefusals('q', { executionContext: asSystem });
    expect(report.hits.map((h) => h.documentId)).toEqual(['d1']);
    expect(report.refused).toEqual([
      { sourceId: 'refusing', code: 'KNOWLEDGE_REBUILD_REQUIRED', status: 409, message: "Knowledge source 'refusing' needs a rebuild." },
    ]);
    expect(warn.mock.calls.some(([line]) => String(line).includes('DELETE FROM'))).toBe(true);

    // None answers: the thrown refusal carries no remedy either.
    const thrown = await svc.searchWithRefusals('q', { sourceIds: ['refusing'], executionContext: asSystem }).then(
      () => undefined,
      (e: unknown) => e as { code?: string; message: string; refused?: Array<{ message: string }> },
    );
    expect(thrown).toMatchObject({ code: 'KNOWLEDGE_REBUILD_REQUIRED', status: 409 });
    expect(thrown?.message).not.toContain('DELETE');
    expect(thrown?.refused?.every((r) => !r.message.includes('DELETE'))).toBe(true);
  });

  it('a refused beginBuild stops a complete reindex before any listing or write: ok:false, the remedy carried', async () => {
    const find = vi.fn(async () => [{ id: 'r1', title: 'T1', notes: 'N1' }]);
    const listDocuments = vi.fn(async () => ({ documents: [] }));
    const completeBuild = vi.fn(async () => undefined);
    const adapter = Object.assign(makeAdapter('memory'), {
      listDocuments,
      completeBuild,
      beginBuild: vi.fn(async () => {
        throw Object.assign(new Error("Knowledge source 's1' needs a rebuild."), {
          code: 'KNOWLEDGE_REBUILD_REQUIRED',
          status: 409,
          remedy: 'DELETE FROM "os_knowledge"."knowledge_generation" WHERE source_id = \'s1\';',
        });
      }),
    });
    const svc = new KnowledgeService({ dataEngine: { find } as unknown as IDataEngine });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('s1', 'task'));
    const res = await svc.reindexSource('s1');
    expect(res).toMatchObject({ ok: false, indexed: 0, purged: null });
    expect(res.message).toContain('needs a rebuild');
    expect(res.message).toContain('DELETE FROM');
    expect(listDocuments).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(adapter.upsertSpy).not.toHaveBeenCalled();
    expect(adapter.deleteSpy).not.toHaveBeenCalled();
    expect(completeBuild).not.toHaveBeenCalled();
  });

  it('a completeBuild that throws turns a complete reindex into ok:false, though every page was written', async () => {
    const find = vi.fn(async (_obj: string, query: { where?: unknown }) =>
      (query.where === undefined ? [{ id: 'r1', title: 'T1', notes: 'N1' }] : []));
    const adapter = Object.assign(makeAdapter('memory'), {
      listDocuments: vi.fn(async () => ({ documents: [] })),
      beginBuild: vi.fn(async () => undefined),
      completeBuild: vi.fn(async () => {
        throw new Error('the generation row could not be written');
      }),
    });
    const svc = new KnowledgeService({ dataEngine: { find } as unknown as IDataEngine });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('s1', 'task'));
    const res = await svc.reindexSource('s1');
    expect(res).toMatchObject({ ok: false, indexed: 1 });
    expect(res.message).toContain('did not complete the build');
    expect(res.message).toContain('the generation row could not be written');
    expect(adapter.upsertSpy).toHaveBeenCalledOnce();
    expect(adapter.completeBuild).toHaveBeenCalledOnce();
  });

  it('returns ok:false when no dataEngine is bound', async () => {
    const svc = new KnowledgeService();
    svc.registerAdapter('memory', makeAdapter('memory'));
    svc.registerSource(objectSource('s1', 'task'));
    const res = await svc.reindexSource('s1');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/IDataEngine/);
  });

});

describe('Pure helpers', () => {
  it('documentIdFor is deterministic', () => {
    expect(documentIdFor('s', 'r')).toBe('s:r');
  });

  it('recordToDocument concatenates content and projects metadataFields', () => {
    const src = objectSource('s1', 'task');
    const objSrc = src.source as ObjectKnowledgeSource;
    const doc = recordToDocument(src, objSrc, { id: 'r1', title: 'Hello', notes: 'World', status: 'open' });
    expect(doc.id).toBe('s1:r1');
    expect(doc.sourceRecordId).toBe('r1');
    expect(doc.content).toBe('Hello\n\nWorld');
    expect(doc.metadata?.status).toBe('open');
  });

  it('recordToDocument reads the listed fields, in the listed order, and no other field', () => {
    const src: KnowledgeSource = {
      name: 's1', label: 'listed', adapter: 'memory',
      source: { kind: 'object', object: 'task', content: ['notes', 'title'] },
    };
    const doc = recordToDocument(src, src.source, { id: 'r1', title: 'A', notes: 'B', private_note: 'C', count: 7 });
    expect(doc.content).toBe('B\n\nA');
    expect(JSON.stringify(doc)).not.toContain('C');
  });
});

// An index document is searchable text served to every reader its source
// admits, so it never carries a credential-class field (the set the engine
// masks on read) or an `internal: true` field (the set it omits), even when a
// source names one. The field sets come from the same
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
  const source = (content: string[], metadataFields: string[] = []): KnowledgeSource => ({
    name: 's1', label: 's1', adapter: 'memory',
    source: { kind: 'object', object: 'probe_doc', content, metadataFields } as ObjectKnowledgeSource,
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
  // when the source names it.
  it.each([
    ['named as content only', ['title', 'notes', 'api_token'], [] as string[], 'Visible\n\nBody', {}],
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
    svc.registerSource(source(['title', 'notes', 'api_token', 'lookup_digest']));
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
  let heldReached: (() => void) | undefined;
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
    if (gate) {
      heldReached?.();
      await gate;
    }
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
    /**
     * The next `find` reads at call time but resolves only once the returned
     * function is called; its `reached` resolves when that `find` has been
     * entered, so a case waits on the walk itself, never on a clock.
     */
    holdNextFind(): (() => void) & { reached: Promise<void> } {
      let release!: () => void;
      hold = new Promise<void>((resolve) => { release = resolve; });
      const reached = new Promise<void>((resolve) => { heldReached = resolve; });
      return Object.assign(release, { reached });
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
    expect(res).toEqual({ ok: true, object: 'task', discovered: 0, indexed: 0, skipped: 0, purged: null, failed: 0, failures: [] });
    expect(h.find).toHaveBeenCalledTimes(1);
    expect(h.adapter.upsertSpy).not.toHaveBeenCalled();
  });

  it('exactly one page: one upsert of the page, then a read that comes back empty', async () => {
    const h = reindexHarness(taskRows(100));
    const res = await h.svc.reindexSource('s1');
    expect(res).toEqual({ ok: true, object: 'task', discovered: 100, indexed: 100, skipped: 0, purged: null, failed: 0, failures: [] });
    expect(upsertedIds(h.adapter)).toEqual([ids(0, 100)]);
    expect(h.find).toHaveBeenCalledTimes(2);
    expect(h.find.mock.calls[1][1].where).toEqual({ id: { $gt: 'r099' } });
  });

  it('one page + 1: two upserts (100, then 1), each row once, in id order', async () => {
    const h = reindexHarness(taskRows(101));
    const res = await h.svc.reindexSource('s1');
    expect(res).toEqual({ ok: true, object: 'task', discovered: 101, indexed: 101, skipped: 0, purged: null, failed: 0, failures: [] });
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
    expect(res).toEqual({ ok: true, object: 'task', discovered: 200, indexed: 200, skipped: 0, purged: null, failed: 0, failures: [] });
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
    expect(res).toEqual({ ok: true, object: 'task', discovered: total, indexed: total, skipped: 0, purged: null, failed: 0, failures: [] });
    expect(h.find.mock.calls.map((c) => c[1].limit)).toEqual(reads);
    expect(upsertedIds(h.adapter).flat()).toEqual(ids(0, total));
  });

  it('a limit above the row count reads to the end', async () => {
    const h = reindexHarness(taskRows(120));
    const res = await h.svc.reindexSource('s1', { limit: 500 });
    expect(res).toEqual({ ok: true, object: 'task', discovered: 120, indexed: 120, skipped: 0, purged: null, failed: 0, failures: [] });
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
    expect(res).toEqual({ ok: true, object: 'task', discovered: 249, indexed: 249, skipped: 0, purged: null, failed: 0, failures: [] });
    expect(upsertedIds(h.adapter).map((p) => p.length)).toEqual([99, 100, 50]);
    expect(upsertedIds(h.adapter).flat()).toEqual(ids(0, 250).filter((id) => id !== 's1:r049'));
    expect(h.find).toHaveBeenCalledTimes(4);
  });

  it('numeric ids: the cursor keeps the number and the pages follow numeric order', async () => {
    const rows = taskRows(150).map((r) => ({ ...r, id: Number(String(r.id).slice(1)) + 1 }));
    const h = reindexHarness(rows);
    const res = await h.svc.reindexSource('s1');
    expect(res).toEqual({ ok: true, object: 'task', discovered: 150, indexed: 150, skipped: 0, purged: null, failed: 0, failures: [] });
    const want = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => `s1:${from + k}`);
    expect(upsertedIds(h.adapter)).toEqual([want(1, 100), want(101, 150)]);
    expect(h.find.mock.calls.map((c) => c[1].where)).toEqual([undefined, { id: { $gt: 100 } }, { id: { $gt: 150 } }]);
  });

  it('a fractional limit is floored', async () => {
    const h = reindexHarness(taskRows(250));
    const res = await h.svc.reindexSource('s1', { limit: 150.7 });
    expect(res).toEqual({ ok: true, object: 'task', discovered: 150, indexed: 150, skipped: 0, purged: null, failed: 0, failures: [] });
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
    expect(again).toEqual({ ok: true, object: 'task', discovered: 250, indexed: 250, skipped: 0, purged: null, failed: 0, failures: [] });
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
    expect(a).toEqual({ ok: true, object: 'task', discovered: 150, indexed: 150, skipped: 0, purged: null, failed: 0, failures: [] });
    expect(b).toEqual(a);
    expect(order).toEqual(['s1:r000+100', 's1:r100+50', 's1:r000+100', 's1:r100+50']);
  });

  it('walks of different sources do not wait for each other', async () => {
    const h = reindexHarness(taskRows(10));
    h.svc.registerSource(objectSource('s2', 'task'));
    const release = h.holdNextFind();
    const first = h.svc.reindexSource('s1');
    const other = await h.svc.reindexSource('s2');
    expect(other).toEqual({ ok: true, object: 'task', discovered: 10, indexed: 10, skipped: 0, purged: null, failed: 0, failures: [] });
    release();
    expect(await first).toEqual({ ok: true, object: 'task', discovered: 10, indexed: 10, skipped: 0, purged: null, failed: 0, failures: [] });
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
    expect(await h.svc.reindexSource('s1')).toEqual({ ok: true, object: 'task', discovered: 150, indexed: 150, skipped: 0, purged: 0, failed: 0, failures: [] });
    la.upsertSpy.mockClear();
    expect(await h.svc.reindexSource('s1')).toEqual({ ok: true, object: 'task', discovered: 150, indexed: 0, skipped: 150, purged: 0, failed: 0, failures: [] });
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
    expect(res).toEqual({ ok: true, object: 'task', discovered: 3, indexed: 0, skipped: 3, purged: 2, failed: 0, failures: [] });
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
    await release.reached;
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
    expect(await h.svc.reindexSource('s1')).toEqual({ ok: true, object: 'task', discovered: 3, indexed: 0, skipped: 3, purged: null, failed: 0, failures: [] });
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

describe('KnowledgeService — the purge never deletes on an answer it cannot read, and waits for the event sync', () => {
  it('a walk page that answers no list stops the walk: ok:false, purged: null, nothing deleted', async () => {
    const la = listingAdapter();
    const h = reindexHarness(taskRows(3), objectSource('s1', 'task'), la.adapter);
    await h.svc.reindexSource('s1');
    const real = h.find.getMockImplementation()!;
    h.find.mockImplementation(async (o, q, opt) => (q.limit === REINDEX_PAGE_SIZE ? (null as never) : real(o, q, opt)));
    const res = await h.svc.reindexSource('s1');
    expect(res).toMatchObject({ ok: false, discovered: 0, purged: null });
    expect(res.message).toContain('page 1: the read answered null instead of a list of rows.');
    expect(la.deleteSpy).not.toHaveBeenCalled();
    expect(la.stored.size).toBe(3);
  });

  it('a purge re-read that answers no list stops the purge: ok:false, the document kept', async () => {
    const la = listingAdapter();
    const h = reindexHarness(taskRows(3), objectSource('s1', 'task'), la.adapter);
    await h.svc.reindexSource('s1');
    h.rows.splice(h.rows.findIndex((r) => r.id === 'r000'), 1);
    const real = h.find.getMockImplementation()!;
    h.find.mockImplementation(async (o, q, opt) => (q.limit === 1 ? (undefined as never) : real(o, q, opt)));
    const res = await h.svc.reindexSource('s1');
    expect(res).toMatchObject({ ok: false, discovered: 2, purged: 0 });
    expect(res.message).toMatch(/document 's1:r000': the re-read of record 'r000' answered undefined instead of a list of rows/);
    expect(la.deleteSpy).not.toHaveBeenCalled();
    expect(la.stored.has('s1:r000')).toBe(true);
  });

  it("the purge's re-read and delete run on the document's sync chain: an event sync arriving meanwhile lands after them", async () => {
    const la = listingAdapter();
    const h = reindexHarness(taskRows(3), objectSource('s1', 'task'), la.adapter);
    await h.svc.reindexSource('s1');
    const r001 = h.rows.splice(h.rows.findIndex((r) => r.id === 'r001'), 1)[0];
    // Hold the purge's re-read of r001 AFTER it has read (no row): the purge is
    // now between its re-read and its delete.
    const real = h.find.getMockImplementation()!;
    let reached!: () => void;
    const atReread = new Promise<void>((resolve) => { reached = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let held = false;
    h.find.mockImplementation(async (o, q, opt) => {
      const answer = await real(o, q, opt);
      if (q.limit === 1 && !held) {
        held = true;
        reached();
        await gate;
      }
      return answer;
    });
    const walk = h.svc.reindexSource('s1');
    await atReread;
    // The row is restored and its event sync fires while the purge is held.
    h.rows.push(r001);
    const sync = h.svc.handleRecordUpsert('task', { id: 'r001' });
    // Let every promise that can run, run (one macrotask turn — no clock: the
    // paths under test await only promises). Off the chain the sync finishes
    // here, before the purge's delete; on it, the sync is still queued.
    await new Promise<void>((resolve) => setImmediate(resolve));
    release();
    await Promise.all([walk, sync]);
    // On the chain, the sync re-reads after the purge's delete and writes the
    // document back; off it, the sync would write first and the purge delete it.
    expect(la.stored.has('s1:r001')).toBe(true);
  });

  it('the purge re-reads by the id text only: a numeric id restored mid-walk is not found (the stated limit)', async () => {
    // The engine double compares with `!==`, as driver-mongodb and driver-memory
    // do: a row stored under the number 2 is not found by `{ id: '2' }`. The
    // purge does not ask again by the number (on driver-sql that number is
    // bound against a text column), so this pins the limit the docs state.
    const la = listingAdapter();
    const rows = taskRows(5).map((r) => ({ ...r, id: Number(String(r.id).slice(1)) + 1 }));
    const h = reindexHarness(rows, objectSource('s1', 'task'), la.adapter);
    await h.svc.reindexSource('s1');
    const row2 = h.rows.splice(h.rows.findIndex((r) => r.id === 2), 1)[0];
    h.rows.splice(h.rows.findIndex((r) => r.id === 4), 1);
    const release = h.holdNextFind();
    const walk = h.svc.reindexSource('s1');
    await release.reached;
    h.rows.push(row2);
    release();
    const res = await walk;
    expect(res).toMatchObject({ ok: true, purged: 2 });
    expect(deletedOf(la.deleteSpy).sort()).toEqual(['s1:2', 's1:4']);
    const rereads = h.find.mock.calls.filter((c) => c[1].limit === 1).map((c) => c[1].where);
    expect(rereads).toEqual([{ id: '2' }, { id: '4' }]);
  });
});

describe('KnowledgeService — the event sync on an unreadable re-read', () => {
  it('a re-read that answers no list leaves the document and warns once; it does not delete', async () => {
    const warn = vi.fn();
    const adapter = makeAdapter('memory');
    const find = vi.fn(async () => undefined as never);
    const svc = new KnowledgeService({ dataEngine: { find } as unknown as IDataEngine, logger: { warn } });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('s1', 'task'));
    await expect(svc.handleRecordUpsert('task', { id: 'r1', title: 'T', notes: 'N' })).resolves.toBeUndefined();
    expect(find).toHaveBeenCalledTimes(1);
    expect(adapter.deleteSpy).not.toHaveBeenCalled();
    expect(adapter.upsertSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/event-sync failed for source 's1': the re-read of record 'r1' answered undefined instead of a list of rows/);
  });
});

// ADR-0161 K8, item 9: a document assembled from a record carries the record's
// organization under a walled tenancy posture, and a search hands the adapter
// the caller's organizations, computed by the service from the caller's
// execution context and the deployment's posture (ADR-0105 D1).
describe('KnowledgeService — documents carry their organization (ADR-0161 K8, item 9)', () => {
  const src = objectSource('s1', 'task');
  const objSrc = src.source as ObjectKnowledgeSource;
  const row = { id: 'r1', title: 'A', notes: 'B', status: 'open', organization_id: 'org_a' };

  it.each([
    ['group', 'org_a'],
    ['isolated', 'org_a'],
    ['single', undefined],
    [undefined, undefined],
  ] as const)('recordToDocument under %s sets organizationId %s', (posture, expected) => {
    const doc = recordToDocument(src, objSrc, row, undefined, posture);
    expect(doc.organizationId).toBe(expected);
    expect(doc.docHash).toBe(computeDocHash(doc));
  });

  it('a record with no organization gives a document with none, under a walled posture too', () => {
    expect(recordToDocument(src, objSrc, { ...row, organization_id: null }, undefined, 'isolated')).not.toHaveProperty('organizationId');
    expect(recordToDocument(src, objSrc, { ...row, organization_id: '' }, undefined, 'group')).not.toHaveProperty('organizationId');
  });

  it('the organization enters docHash only when set: a document without one hashes by the recipe it had before', async () => {
    const { createHash } = await import('node:crypto');
    const body = { content: 'Body', title: 'T', metadata: { status: 'open' } };
    // The pre-organization recipe, spelled out: sorted keys, `v1:` prefix.
    const before = `v1:${createHash('sha256').update(JSON.stringify({ content: 'Body', metadata: { status: 'open' }, title: 'T' })).digest('hex')}`;
    expect(computeDocHash(body)).toBe(before);
    expect(computeDocHash({ ...body, organizationId: undefined })).toBe(before);
    expect(computeDocHash({ ...body, organizationId: 'org_a' })).not.toBe(before);
    expect(computeDocHash({ ...body, organizationId: 'org_a' })).not.toBe(computeDocHash({ ...body, organizationId: 'org_b' }));
  });

  it('the reindex walk and the event sync stamp the organization under a walled posture', async () => {
    const adapter = makeAdapter('memory');
    const find = vi.fn(async (_o: string, q: { where?: Record<string, unknown> }) =>
      (q.where && '$and' in q.where) || (q.where && 'id' in q.where && typeof q.where.id === 'object') ? [] : [row]);
    const svc = new KnowledgeService({
      dataEngine: { find, count: vi.fn() } as unknown as IDataEngine,
      resolveTenancyPosture: async () => 'isolated',
    });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(src);
    expect(await svc.reindexSource('s1')).toMatchObject({ ok: true, indexed: 1 });
    expect((adapter.upsertSpy.mock.calls[0][0] as KnowledgeDocument[])[0].organizationId).toBe('org_a');
    await svc.handleRecordUpsert('task', row);
    expect((adapter.upsertSpy.mock.calls[adapter.upsertSpy.mock.calls.length - 1][0] as KnowledgeDocument[])[0].organizationId).toBe('org_a');
  });

  it('a reindex whose posture cannot be read writes nothing and says why', async () => {
    const adapter = makeAdapter('memory');
    const find = vi.fn(async () => [row]);
    const svc = new KnowledgeService({
      dataEngine: { find, count: vi.fn() } as unknown as IDataEngine,
      resolveTenancyPosture: async () => {
        throw new Error('tenancy store down');
      },
    });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(src);
    const result = await svc.reindexSource('s1');
    expect(result).toMatchObject({ ok: false, indexed: 0, purged: null });
    expect(result.message).toContain('tenancy posture');
    expect(adapter.upsertSpy).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });
});

describe('KnowledgeService — search hands the adapter the caller\'s organizations (ADR-0161 K8, item 9)', () => {
  const person = (extra: Record<string, unknown>) =>
    ({ userId: 'u1', positions: [], permissions: [], systemPermissions: [], isSystem: false, ...extra }) as never;

  function searchSetup(opts: {
    posture?: () => Promise<'single' | 'group' | 'isolated' | undefined>;
    schema?: unknown;
    logger?: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  } = {}) {
    const adapter = makeAdapter('memory');
    const engine = {
      find: vi.fn(async () => []),
      getSchema: vi.fn(() => opts.schema),
    } as unknown as IDataEngine;
    const options: ConstructorParameters<typeof KnowledgeService>[0] = { dataEngine: engine };
    if (opts.posture) options.resolveTenancyPosture = opts.posture;
    if (opts.logger) options.logger = opts.logger as unknown as NonNullable<typeof options>['logger'];
    const svc = new KnowledgeService(options);
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('s1', 'task'));
    const handed = (sourceId: string) =>
      adapter.searchSpy.mock.calls.find(([, o]) => (o as { source: KnowledgeSource }).source.name === sourceId)?.[1] as
        | Record<string, unknown>
        | undefined;
    return { svc, adapter, handed };
  }

  it('isolated: the caller\'s active organization, never their other memberships', async () => {
    const h = searchSetup({ posture: async () => 'isolated' });
    await h.svc.search('q', { executionContext: person({ tenantId: 'org_a', accessible_org_ids: ['org_a', 'org_b'] }) });
    expect(h.handed('s1')?.organizationIds).toEqual(['org_a']);
  });

  it('group: every organization the caller holds a membership in, once each', async () => {
    const h = searchSetup({ posture: async () => 'group' });
    await h.svc.search('q', { executionContext: person({ tenantId: 'org_c', accessible_org_ids: ['org_a', 'org_c', 'org_a'] }) });
    expect(h.handed('s1')?.organizationIds).toEqual(['org_a', 'org_c']);
  });

  it.each([
    ['isolated with no active organization', 'isolated', { accessible_org_ids: ['org_a'] }],
    ['group with no membership', 'group', { tenantId: 'org_a', accessible_org_ids: [] }],
  ] as const)('%s: an empty set, never "no filter"', async (_label, posture, ctx) => {
    const h = searchSetup({ posture: async () => posture });
    await h.svc.search('q', { executionContext: person(ctx) });
    expect(h.handed('s1')?.organizationIds).toEqual([]);
  });

  it.each([
    ['the single posture', async () => 'single' as const, person({ tenantId: 'org_a', accessible_org_ids: ['org_a'] })],
    ['no tenancy service', async () => undefined, person({ tenantId: 'org_a', accessible_org_ids: ['org_a'] })],
    ['the system identity', async () => 'isolated' as const, { positions: [], permissions: [], isSystem: true } as never],
  ])('%s: no filter is handed', async (_label, posture, ctx) => {
    const h = searchSetup({ posture });
    await h.svc.search('q', { executionContext: ctx });
    expect(h.handed('s1')).toBeDefined();
    expect(h.handed('s1')).not.toHaveProperty('organizationIds');
  });

  it.each([
    ['tenancy disabled', { name: 'task', tenancy: { enabled: false }, fields: { organization_id: {}, notes: {} } }],
    ['no organization column', { name: 'task', fields: { notes: {}, title: {}, status: {} } }],
  ])('an object outside the wall (%s) is handed no filter', async (_label, schema) => {
    const h = searchSetup({ posture: async () => 'isolated', schema });
    await h.svc.search('q', { executionContext: person({ tenantId: 'org_a', accessible_org_ids: ['org_a'] }) });
    expect(h.handed('s1')).toBeDefined();
    expect(h.handed('s1')).not.toHaveProperty('organizationIds');
  });

  it('a caller-supplied filter is passed opaquely and never becomes the organization set', async () => {
    const h = searchSetup({ posture: async () => 'isolated' });
    await h.svc.search('q', {
      filter: { organizationIds: ['org_b'] },
      executionContext: person({ tenantId: 'org_a', accessible_org_ids: ['org_a'] }),
    });
    expect(h.handed('s1')?.organizationIds).toEqual(['org_a']);
  });

  it('a posture that cannot be read leaves every source unsearched and says so at error', async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const h = searchSetup({
      posture: async () => {
        throw new Error('tenancy store down');
      },
      logger,
    });
    await h.svc.search('q', { executionContext: person({ tenantId: 'org_a', accessible_org_ids: ['org_a'] }) });
    expect(h.handed('s1')).toBeUndefined();
    expect(h.adapter.searchSpy).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('tenancy posture could not be read'));
  });
});

// The plugin's `resolveTenancyPosture` wiring is the only production reader of
// the posture (ADR-0161 K8, item 9): broken, every deployment reads as
// `single`, no document is stamped and no filter is handed, silently. So the
// wiring is driven through real kernels with a `tenancy` service: `LiteKernel`
// (no async accessor: the sync leg) and `ObjectKernel` (`getServiceAsync`).
describe('KnowledgeServicePlugin reads the tenancy posture from the kernel (ADR-0161 K8, item 9)', () => {
  const PERSON = {
    userId: 'u1', tenantId: 'org_a', accessible_org_ids: ['org_a'], positions: [], permissions: [], systemPermissions: [], isSystem: false,
  } as never;

  class FakeHostPlugin implements Plugin {
    name = 'test.fake.host';
    version = '1.0.0';
    type = 'standard' as const;
    constructor(private readonly tenancy: unknown) {}
    async init(ctx: PluginContext): Promise<void> {
      ctx.registerService('objectql', { find: vi.fn(async () => []) });
      if (this.tenancy !== undefined) ctx.registerService('tenancy', this.tenancy);
    }
  }

  async function boot(Kernel: typeof LiteKernel | typeof ObjectKernel, tenancy: unknown) {
    // `ObjectKernel` refuses to start without a `data` service; this harness composes none.
    const kernel = Kernel === ObjectKernel
      ? new ObjectKernel({ skipSystemValidation: true, logger: { level: 'silent' }, gracefulShutdown: false })
      : new LiteKernel();
    await kernel.use(new FakeHostPlugin(tenancy));
    await kernel.use(new KnowledgeServicePlugin({ enableEventSync: false, sources: [objectSource('s1', 'task')] }));
    await kernel.bootstrap();
    const svc = kernel instanceof ObjectKernel
      ? await kernel.getServiceAsync<KnowledgeService>('knowledge')
      : kernel.getService<KnowledgeService>('knowledge');
    const adapter = makeAdapter('memory');
    svc.registerAdapter('memory', adapter);
    return { kernel, svc, adapter };
  }

  it.each([
    ['LiteKernel', LiteKernel],
    ['ObjectKernel', ObjectKernel],
  ] as const)('%s: a walled posture hands the adapter the caller\'s organizations', async (_name, Kernel) => {
    const { kernel, svc, adapter } = await boot(Kernel, { posture: 'isolated' });
    await svc.search('q', { executionContext: PERSON });
    expect(adapter.searchSpy).toHaveBeenCalledOnce();
    expect(adapter.searchSpy.mock.calls[0][1]).toMatchObject({ organizationIds: ['org_a'] });
    await kernel.shutdown();
  });

  it('no `tenancy` service registered: no wall exists, and no filter is handed', async () => {
    const { kernel, svc, adapter } = await boot(LiteKernel, undefined);
    await svc.search('q', { executionContext: PERSON });
    expect(adapter.searchSpy).toHaveBeenCalledOnce();
    expect(adapter.searchSpy.mock.calls[0][1]).not.toHaveProperty('organizationIds');
    await kernel.shutdown();
  });

  it('a `tenancy` service that is registered but cannot be read: no object source is searched', async () => {
    const unreadable = Object.defineProperty({}, 'posture', {
      get: () => {
        throw new Error('tenancy store down');
      },
    });
    const { kernel, svc, adapter } = await boot(LiteKernel, unreadable);
    expect(await svc.search('q', { executionContext: PERSON })).toEqual([]);
    expect(adapter.searchSpy).not.toHaveBeenCalled();
    await kernel.shutdown();
  });
});

describe('KnowledgeService — an event sync whose tenancy posture cannot be read (ADR-0161 K8, item 9)', () => {
  it('logs at warn and leaves the stored document as it was: no upsert, no delete', async () => {
    const adapter = makeAdapter('memory');
    const row = { id: 'r1', title: 'A', notes: 'B', status: 'open', organization_id: 'org_a' };
    const warn = vi.fn();
    const svc = new KnowledgeService({
      dataEngine: { find: vi.fn(async () => [row]) } as unknown as IDataEngine,
      logger: { warn },
      resolveTenancyPosture: async () => {
        throw new Error('tenancy store down');
      },
    });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('s1', 'task'));
    await svc.handleRecordUpsert('task', row);
    expect(adapter.upsertSpy).not.toHaveBeenCalled();
    expect(adapter.deleteSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('tenancy store down'));
  });
});

// The permission re-check runs after ranking, so a caller who may read few of
// the matching rows must not be answered from what is left of `topK` ranked
// hits: object sources are over-asked, and refilled once when short.
describe('KnowledgeService — search refills after the permission filter', () => {
  const MEMBER = { userId: 'u1', positions: ['member'], permissions: [], isSystem: false };
  const SYSTEM = { positions: [], permissions: [], isSystem: true };

  /** `n` hits of one source, best first: rank i scores 1 - i/1000 and names `rec_i`. */
  function rankedHits(sourceId: string, n: number): KnowledgeHit[] {
    return Array.from({ length: n }, (_, i) => ({
      chunkId: `${sourceId}-c${i}`, documentId: `${sourceId}:rec_${i}`, sourceId,
      sourceRecordId: `rec_${i}`, score: 1 - i / 1000, snippet: `passage ${i}`,
    }));
  }

  /** An adapter that ranks like a real one: the best `min(topK, cap)` of `corpus` for the source asked. */
  function rankingAdapter(corpus: Record<string, KnowledgeHit[]>, cap = Infinity) {
    const searchSpy = vi.fn(async (_q: string, opts: { source: KnowledgeSource; topK: number }) =>
      (corpus[opts.source.name] ?? []).slice(0, Math.min(opts.topK, cap)));
    return { id: 'memory', upsert: vi.fn(async () => undefined), delete: vi.fn(async () => undefined), search: searchSpy, searchSpy };
  }

  /** An engine whose re-check as a non-system caller admits only `readable` record ids. */
  function engineReading(readable: string[]) {
    const find = vi.fn(async (_obj: string, q: { where?: { id?: { $in?: string[] } }; context?: { isSystem?: boolean } }) =>
      (q.where?.id?.$in ?? []).filter((id) => q.context?.isSystem || readable.includes(id)).map((id) => ({ id })));
    return { find } as unknown as IDataEngine & { find: typeof find };
  }

  function setup(corpus: Record<string, KnowledgeHit[]>, readable: string[], opts: { cap?: number; sources?: string[] } = {}) {
    const adapter = rankingAdapter(corpus, opts.cap);
    const engine = engineReading(readable);
    const debug = vi.fn();
    const svc = new KnowledgeService({ dataEngine: engine, logger: { debug, warn: vi.fn(), error: vi.fn() } });
    svc.registerAdapter('memory', adapter);
    for (const id of opts.sources ?? ['s1']) svc.registerSource(objectSource(id, 'task'));
    const asked = () => adapter.searchSpy.mock.calls.map((c) => [(c[1] as { source: KnowledgeSource }).source.name, (c[1] as { topK: number }).topK]);
    return { svc, adapter, engine, debug, asked };
  }

  it('the first round asks topK × 5 and the refill topK × 20', () => {
    expect(SEARCH_FIRST_ROUND_FACTOR).toBe(5);
    expect(SEARCH_REFILL_FACTOR).toBe(20);
  });

  it('100 matching hits, the caller may read 5 spread across them: all 5 are answered, best first', async () => {
    const readable = ['rec_3', 'rec_30', 'rec_50', 'rec_70', 'rec_99'];
    const { svc, asked } = setup({ s1: rankedHits('s1', 100) }, readable);
    const out = await svc.search('q', { topK: 5, executionContext: MEMBER });
    expect(out.map((h) => h.sourceRecordId)).toEqual(readable);
    // Round one: 25, one survivor; the source answered all 25, so one refill of 100.
    expect(asked()).toEqual([['s1', 25], ['s1', 100]]);
  });

  it('a readable row beyond the refill cap is not reached: fewer than topK are answered', async () => {
    const { svc, asked } = setup({ s1: rankedHits('s1', 150) }, ['rec_10', 'rec_120']);
    const out = await svc.search('q', { topK: 5, executionContext: MEMBER });
    expect(out.map((h) => h.sourceRecordId)).toEqual(['rec_10']);
    expect(asked()).toEqual([['s1', 25], ['s1', 100]]); // two rounds, never a third
  });

  it('enough survivors in round one: no refill', async () => {
    const readable = Array.from({ length: 25 }, (_, i) => `rec_${i}`).filter((_, i) => i % 2 === 0);
    const { svc, asked } = setup({ s1: rankedHits('s1', 100) }, readable);
    const out = await svc.search('q', { topK: 5, executionContext: MEMBER });
    expect(out.map((h) => h.sourceRecordId)).toEqual(['rec_0', 'rec_2', 'rec_4', 'rec_6', 'rec_8']);
    expect(asked()).toEqual([['s1', 25]]);
  });

  it('an adapter that caps topK answers fewer than asked, so it is not asked again', async () => {
    const { svc, asked } = setup({ s1: rankedHits('s1', 100) }, ['rec_50'], { cap: 10 });
    expect(await svc.search('q', { topK: 5, executionContext: MEMBER })).toEqual([]);
    expect(asked()).toEqual([['s1', 25]]);
  });

  it('several sources: only a source that answered all it was asked is refilled; the others keep round one', async () => {
    const corpus = { s1: rankedHits('s1', 100), s2: rankedHits('s2', 3) };
    const { svc, asked } = setup(corpus, ['rec_1', 'rec_60'], { sources: ['s1', 's2'] });
    const out = await svc.search('q', { topK: 5, executionContext: MEMBER });
    // s1:rec_1 and s2:rec_1 score the same; their order between them is not pinned.
    expect(out.map((h) => h.documentId).sort()).toEqual(['s1:rec_1', 's1:rec_60', 's2:rec_1']);
    expect(out[2].documentId).toBe('s1:rec_60');
    expect(asked()).toEqual([['s1', 25], ['s2', 25], ['s1', 100]]);
  });

  it('the refill decision counts records, not passages: two passages of one record leave a slot another source can refill', async () => {
    // topK 3. s2 answers two passages of one readable record; s1's readable
    // rec_15 lies past its first round (15) and outranks both of them.
    const s2: KnowledgeHit[] = [
      { chunkId: 's2-a', documentId: 's2:r', sourceId: 's2', sourceRecordId: 'r', score: 0.5, snippet: 'a' },
      { chunkId: 's2-b', documentId: 's2:r', sourceId: 's2', sourceRecordId: 'r', score: 0.49, snippet: 'b' },
    ];
    const { svc, asked } = setup({ s1: rankedHits('s1', 100), s2 }, ['rec_0', 'rec_15', 'r'], { sources: ['s1', 's2'] });
    const out = await svc.search('q', { topK: 3, executionContext: MEMBER });
    expect(out.map((h) => h.chunkId)).toEqual(['s1-c0', 's1-c15', 's2-a']);
    expect(asked()).toEqual([['s1', 15], ['s2', 15], ['s1', 60]]);
  });

  it('a refill the adapter fails keeps the source\'s round-one survivors', async () => {
    const { svc, adapter } = setup({ s1: rankedHits('s1', 100) }, ['rec_2']);
    const first = adapter.searchSpy.getMockImplementation()!;
    adapter.searchSpy.mockImplementationOnce(first).mockImplementationOnce(async () => {
      throw new Error('store unavailable');
    });
    const out = await svc.search('q', { topK: 5, executionContext: MEMBER });
    expect(out.map((h) => h.sourceRecordId)).toEqual(['rec_2']);
    expect(adapter.searchSpy).toHaveBeenCalledTimes(2);
  });

  it('the system identity: one round of topK, no refill, no re-check', async () => {
    const { svc, asked, engine } = setup({ s1: rankedHits('s1', 100) }, []);
    const out = await svc.search('q', { topK: 5, executionContext: SYSTEM });
    expect(out).toHaveLength(5);
    expect(asked()).toEqual([['s1', 5]]);
    expect(engine.find).not.toHaveBeenCalled();
  });

  it('no context: no source is searched (fail closed)', async () => {
    const { svc, adapter } = setup({ s1: rankedHits('s1', 100) }, []);
    const out = await svc.search('q', { topK: 5 });
    expect(out).toEqual([]);
    expect(adapter.searchSpy).not.toHaveBeenCalled();
  });

  it('the count the re-check removed goes to the debug log only; the answer and its type are unchanged', async () => {
    const { svc, debug } = setup({ s1: rankedHits('s1', 100) }, ['rec_7']);
    const out = await svc.search('q', { topK: 5, executionContext: MEMBER });
    expect(out).toEqual([rankedHits('s1', 100)[7]]);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('removed 99 hit(s)'));
    expectTypeOf(svc.search).returns.toEqualTypeOf<Promise<KnowledgeHit[]>>();
  });
});

// ADR-0161 K5: the title a document carries is declared — the object's display
// field (ADR-0079 `resolveDisplayField`), never a field that happens to be
// named `title`.
describe('KnowledgeService — search scope (ADR-0161 K8, item 17)', () => {
  const MEMBER = { userId: 'u1', positions: ['member'], permissions: [], isSystem: false };
  const SYSTEM = { positions: [], permissions: [], isSystem: true };
  type Term = { kind: 'record'; ids: string[] } | { kind: 'metadata'; field: string; ids: string[] };

  /**
   * Twenty records of `task`, three passages each, every passage best first.
   * The passages of `rec_3` and `rec_7` score below every other record's;
   * record `rec_i` belongs to policy `p${i % 4}` through the lookup `policy`.
   */
  function corpus(sourceId: string): KnowledgeHit[] {
    const hits: KnowledgeHit[] = [];
    for (let i = 0; i < 20; i++) {
      const low = i === 3 || i === 7;
      for (let p = 0; p < 3; p++) {
        hits.push({
          chunkId: `${sourceId}:rec_${i}#${p}`, documentId: `${sourceId}:rec_${i}`, sourceId,
          sourceRecordId: `rec_${i}`, score: (low ? 0.4 : 0.9) - i / 1000 - p / 10000, snippet: `passage ${p} of ${i}`,
          metadata: { status: 'open', policy: `p${i % 4}` },
        });
      }
    }
    return hits.sort((a, b) => b.score - a.score);
  }

  /** Whether a term of `scope` holds for `hit` — the adapter's own reading, written apart from the service's. */
  const holds = (hit: KnowledgeHit, scope: Term[]): boolean =>
    scope.some((t) => (t.kind === 'record' ? t.ids.includes(String(hit.sourceRecordId)) : t.ids.includes(String(hit.metadata?.[t.field]))));

  /** An adapter that ranks `hits` of the source asked; `honours` applies the scope before ranking, else ignores it. */
  function adapterOver(hits: Record<string, KnowledgeHit[]>, honours: boolean) {
    const searchSpy = vi.fn(async (_q: string, opts: { source: KnowledgeSource; topK: number; scope?: Term[] }) => {
      const all = hits[opts.source.name] ?? [];
      const ranked = honours && opts.scope !== undefined ? all.filter((h) => holds(h, opts.scope!)) : all;
      return ranked.slice(0, opts.topK);
    });
    return { id: 'memory', upsert: vi.fn(async () => undefined), delete: vi.fn(async () => undefined), search: searchSpy, searchSpy };
  }

  /** An engine whose re-check as a non-system caller admits only `readable`, answering `schemas` from `getSchema`. */
  function engineOver(readable: (id: string) => boolean, schemas: Record<string, unknown> = {}) {
    const find = vi.fn(async (_obj: string, q: { where?: { id?: { $in?: string[] } }; context?: { isSystem?: boolean } }) =>
      (q.where?.id?.$in ?? []).filter((id) => q.context?.isSystem || readable(id)).map((id) => ({ id })));
    return { find, getSchema: (name: string) => schemas[name] } as unknown as IDataEngine & { find: typeof find };
  }

  const TASK_SCHEMA = {
    name: 'task',
    fields: {
      title: { type: 'text' }, notes: { type: 'textarea' }, status: { type: 'select' },
      policy: { type: 'lookup', reference: 'policy' },
      cited_policy: { type: 'lookup', reference: 'policy' },
    },
  };

  function taskSource(id: string, metadataFields: string[] = ['status', 'policy'], object = 'task'): KnowledgeSource {
    return {
      name: id, label: id, adapter: 'memory',
      source: { kind: 'object', object, content: ['title', 'notes'], metadataFields } as ObjectKnowledgeSource,
    };
  }

  function setup(opts: {
    honours?: boolean;
    readable?: (id: string) => boolean;
    sources?: KnowledgeSource[];
    /** More hits of the first source, ranked with its corpus. */
    extra?: KnowledgeHit[];
  } = {}) {
    const sources = opts.sources ?? [taskSource('s1')];
    const hits = Object.fromEntries(sources.map((s, i) => [
      s.name,
      [...corpus(s.name), ...(i === 0 ? opts.extra ?? [] : [])].sort((a, b) => b.score - a.score),
    ]));
    const adapter = adapterOver(hits, opts.honours ?? true);
    const engine = engineOver(opts.readable ?? (() => true), { task: TASK_SCHEMA });
    const warn = vi.fn();
    const svc = new KnowledgeService({ dataEngine: engine, logger: { warn, debug: vi.fn(), error: vi.fn() } });
    svc.registerAdapter('memory', adapter);
    for (const s of sources) svc.registerSource(s);
    const handed = () => adapter.searchSpy.mock.calls.map((c) => (c[1] as { scope?: Term[] }).scope);
    return { svc, adapter, engine, warn, handed };
  }

  const records = (hits: KnowledgeHit[]) => [...new Set(hits.map((h) => h.sourceRecordId))].sort();

  it('20 records, two of them in scope, topK 5: every hit is one of the two, and the page is full', async () => {
    const { svc, handed } = setup();
    const out = await svc.search('q', { topK: 5, scope: [{ object: 'task', ids: ['rec_3', 'rec_7'] }], executionContext: MEMBER });
    expect(out).toHaveLength(5);
    expect(records(out)).toEqual(['rec_3', 'rec_7']);
    expect(handed()).toEqual([[{ kind: 'record', ids: ['rec_3', 'rec_7'] }]]);
  });

  it('an adapter that ignores the scope: no out-of-scope hit is answered, and the service logs once for the adapter', async () => {
    const { svc, warn } = setup({ honours: false });
    const scope = [{ object: 'task', ids: ['rec_3', 'rec_7'] }];
    // A person: the refill after the permission filter reaches past the out-of-scope ranks.
    const asMember = await svc.search('q', { topK: 5, scope, executionContext: MEMBER });
    expect(records(asMember)).toEqual(['rec_3', 'rec_7']);
    // The system identity gets one round: the out-of-scope ranks are emptied, never answered.
    const asSystem = await svc.search('q', { topK: 5, scope, executionContext: SYSTEM });
    expect(asSystem).toEqual([]);
    const reports = warn.mock.calls.map(([m]) => String(m)).filter((m) => m.includes("outside the search's scope"));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("adapter 'memory'");
  });

  it('ids are compared as strings: a lookup value stored as the number 7 is in scope for the id "7"', async () => {
    const numeric: KnowledgeHit = {
      chunkId: 's1:rec_n#0', documentId: 's1:rec_n', sourceId: 's1', sourceRecordId: 'rec_n', score: 0.1, snippet: '',
      metadata: { status: 'open', policy: 7 },
    };
    const { svc } = setup({ extra: [numeric] });
    const out = await svc.search('q', { topK: 5, scope: [{ object: 'policy', ids: ['7'] }], executionContext: MEMBER });
    expect(out.map((h) => h.chunkId)).toEqual(['s1:rec_n#0']);
  });

  it('a parent scope: the adapter is handed a metadata term on the listed lookup, and only that parent\'s records answer', async () => {
    const { svc, handed } = setup();
    const out = await svc.search('q', { topK: 5, scope: [{ object: 'policy', ids: ['p1'] }], executionContext: MEMBER });
    expect(handed()).toEqual([[{ kind: 'metadata', field: 'policy', ids: ['p1'] }]]);
    expect(out).toHaveLength(5);
    for (const hit of out) expect(hit.metadata?.policy).toBe('p1');
  });

  it('a parent scope asks the engine nothing about the parent object, and an adapter that changes the terms it was handed does not change the check', async () => {
    const held = corpus('s1');
    const handed: unknown[] = [];
    // An adapter that widens the terms it is handed to every policy and every record, then ranks by them.
    const search = vi.fn(async (_q: string, opts: { source: KnowledgeSource; topK: number; scope?: Term[] }) => {
      handed.push(structuredClone(opts.scope));
      const scope = opts.scope ?? [];
      for (const term of scope) term.ids.push('p0', 'p2', 'p3');
      scope.push({ kind: 'record', ids: held.map((h) => String(h.sourceRecordId)) });
      return held.filter((h) => holds(h, scope)).slice(0, opts.topK);
    });
    // Every call the service makes on the engine, by method and arguments.
    const asked: Array<{ method: string; args: unknown[] }> = [];
    const inner = engineOver(() => true, { task: TASK_SCHEMA });
    const engine = new Proxy(inner, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          asked.push({ method: String(prop), args });
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const warn = vi.fn();
    const svc = new KnowledgeService({ dataEngine: engine, logger: { warn, debug: vi.fn(), error: vi.fn() } });
    svc.registerAdapter('memory', { id: 'memory', upsert: vi.fn(async () => undefined), delete: vi.fn(async () => undefined), search });
    svc.registerSource(taskSource('s1'));
    const scope = [{ object: 'policy', ids: ['p1'] }];

    for (const executionContext of [SYSTEM, MEMBER]) {
      const out = await svc.search('q', { topK: 5, scope, executionContext });
      expect(out.length).toBeGreaterThan(0);
      for (const hit of out) expect(hit.metadata?.policy).toBe('p1');
    }
    // Every round was handed the service's own terms, whatever the adapter did with the last ones.
    expect(handed.length).toBeGreaterThan(2);
    for (const terms of handed) expect(terms).toEqual([{ kind: 'metadata', field: 'policy', ids: ['p1'] }]);
    expect(scope).toEqual([{ object: 'policy', ids: ['p1'] }]);
    // The indexed object's definition was read; nothing of the parent object was asked.
    expect(asked.some((c) => c.method === 'getSchema' && c.args[0] === 'task')).toBe(true);
    expect(asked.filter((c) => c.args[0] === 'policy')).toEqual([]);
    expect(warn.mock.calls.map(([m]) => String(m)).filter((m) => m.includes("outside the search's scope"))).toHaveLength(1);
  });

  it('a scope with groupBy, or with granularity record, over an adapter that ignores it: every round is handed the terms, and no out-of-scope record answers', async () => {
    const scope = [{ object: 'task', ids: ['rec_1', 'rec_3'] }];
    for (const shape of [{ groupBy: 'policy' }, { granularity: 'record' as const }]) {
      const { svc, handed } = setup({ honours: false });
      const out = await svc.search('q', { topK: 5, scope, executionContext: MEMBER, ...shape });
      expect(out.length).toBeGreaterThan(0);
      for (const record of records(out)) expect(['rec_1', 'rec_3']).toContain(record);
      expect(handed().length).toBeGreaterThan(0);
      for (const terms of handed()) expect(terms).toEqual([{ kind: 'record', ids: ['rec_1', 'rec_3'] }]);
    }
  });

  it('an object no searched source reaches: no adapter is asked, and the answer is empty', async () => {
    const { svc, adapter } = setup();
    expect(await svc.search('q', { topK: 5, scope: [{ object: 'invoice', ids: ['i1'] }], executionContext: MEMBER })).toEqual([]);
    expect(adapter.searchSpy).not.toHaveBeenCalled();
  });

  it('an empty scope, and an entry with no ids, answer nothing — never read as "no scope"', async () => {
    const { svc, adapter } = setup();
    expect(await svc.search('q', { topK: 5, scope: [], executionContext: MEMBER })).toEqual([]);
    expect(await svc.search('q', { topK: 5, scope: [{ object: 'task', ids: [] }], executionContext: MEMBER })).toEqual([]);
    expect(adapter.searchSpy).not.toHaveBeenCalled();
  });

  it('a source the scope reaches is searched; one it does not reach is not', async () => {
    const { svc, adapter } = setup({ sources: [taskSource('s1'), taskSource('s2', ['status'], 'note')] });
    const out = await svc.search('q', { topK: 5, scope: [{ object: 'policy', ids: ['p1'] }], executionContext: MEMBER });
    expect(adapter.searchSpy.mock.calls.map((c) => (c[1] as { source: KnowledgeSource }).source.name)).toEqual(['s1']);
    expect(new Set(out.map((h) => h.sourceId))).toEqual(new Set(['s1']));
  });

  it('a source listing two lookups to the scoped object is not searched, reported once naming both fields', async () => {
    const { svc, adapter, warn } = setup({ sources: [taskSource('s1', ['status', 'policy', 'cited_policy'])] });
    for (let i = 0; i < 2; i++) {
      expect(await svc.search('q', { topK: 5, scope: [{ object: 'policy', ids: ['p1'] }], executionContext: MEMBER })).toEqual([]);
    }
    expect(adapter.searchSpy).not.toHaveBeenCalled();
    const reports = warn.mock.calls.map(([m]) => String(m)).filter((m) => m.includes("fields pointing at 'policy'"));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain('policy, cited_policy');
  });

  it('a caller who cannot read one of the scoped records gets no hit from it', async () => {
    const { svc } = setup({ readable: (id) => id !== 'rec_3' });
    const out = await svc.search('q', { topK: 5, scope: [{ object: 'task', ids: ['rec_3', 'rec_7'] }], executionContext: MEMBER });
    expect(out.length).toBeGreaterThan(0);
    expect(records(out)).toEqual(['rec_7']);
  });

  it.each([
    ['11 entries', Array.from({ length: 11 }, () => ({ object: 'task', ids: ['rec_1'] })), /at most 10 entries/],
    ['501 ids', [{ object: 'task', ids: Array.from({ length: 501 }, (_, i) => `rec_${i}`) }], /at most 500 ids/],
  ])('bounds exceeded (%s): a coded refusal naming the bound, before any adapter or engine is asked', async (_label, scope, message) => {
    const { svc, adapter, engine } = setup();
    const refused = svc.search('q', { topK: 5, scope, executionContext: MEMBER });
    await expect(refused).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    await expect(refused).rejects.toThrow(message);
    expect(adapter.searchSpy).not.toHaveBeenCalled();
    expect(engine.find).not.toHaveBeenCalled();
  });
});

describe('recordToDocument reads the title from the object\'s display field', () => {
  const src: KnowledgeSource = {
    name: 's1', label: 's1', adapter: 'memory',
    source: { kind: 'object', object: 'invoice', content: ['body'] } as ObjectKnowledgeSource,
  };
  const title = (record: Record<string, unknown>, schema?: unknown) =>
    recordToDocument(src, src.source as ObjectKnowledgeSource, { id: 'r1', body: 'B', ...record }, schema).title;

  it('an explicit nameField over a field not called title', () => {
    const schema = { nameField: 'subject', fields: { subject: { type: 'text' }, title: { type: 'text' }, body: { type: 'textarea' } } };
    expect(title({ subject: 'Quarterly policy', title: 'ignored' }, schema)).toBe('Quarterly policy');
  });

  it('a derived display field: `name` wins over `title`', () => {
    const schema = { fields: { title: { type: 'text' }, name: { type: 'text' }, body: { type: 'textarea' } } };
    expect(title({ name: 'Acme', title: 'Mr' }, schema)).toBe('Acme');
  });

  it('a formula name field (text result) and an autonumber name field', () => {
    const formula = { nameField: 'label', fields: { label: { type: 'formula', returnType: 'text' }, body: { type: 'textarea' } } };
    expect(title({ label: 'INV — Acme' }, formula)).toBe('INV — Acme');
    const autonumber = { nameField: 'number', fields: { number: { type: 'autonumber' }, body: { type: 'textarea' } } };
    expect(title({ number: 'INV-0042' }, autonumber)).toBe('INV-0042');
    expect(title({ number: 42 }, autonumber)).toBe('42');
  });

  it('a withheld name field (credential-class or internal) gives no title', () => {
    const internal = { nameField: 'digest', fields: { digest: { type: 'text', internal: true }, body: { type: 'textarea' } } };
    expect(title({ digest: 'synthetic-internal-91c2' }, internal)).toBeUndefined();
    const secret = { nameField: 'token', fields: { token: { type: 'secret' }, body: { type: 'textarea' } } };
    expect(title({ token: 'synthetic-credential-5b1d' }, secret)).toBeUndefined();
  });

  it('an empty value, a value that is not text or a number, or no resolvable field gives no title', () => {
    const schema = { nameField: 'subject', fields: { subject: { type: 'text' }, body: { type: 'textarea' } } };
    expect(title({ subject: '  ' }, schema)).toBeUndefined();
    expect(title({ subject: { nested: true } }, schema)).toBeUndefined();
    expect(title({ title: 'not the display field' }, { fields: { amount: { type: 'number' }, body: { type: 'json' } } })).toBeUndefined();
    // A nameField the definition does not declare is no title source.
    expect(title({ ghost: 'G' }, { nameField: 'ghost', fields: { body: { type: 'textarea' } } })).toBeUndefined();
  });

  it('no object definition: a field named title, as before', () => {
    expect(title({ title: 'Hello' })).toBe('Hello');
    expect(title({ name: 'Acme' })).toBeUndefined();
  });

  it('the event sync and the reindex walk build the title from the engine\'s definition', async () => {
    const schema = { name: 'invoice', nameField: 'subject', fields: { subject: { type: 'text' }, body: { type: 'textarea' } } };
    const row = { id: 'r1', subject: 'Travel policy', body: 'B' };
    const find = vi.fn(async (_obj: string, q: { where?: unknown }) => {
      const w = q.where as { id?: unknown; $and?: unknown } | undefined;
      return w === undefined || (w as { id?: unknown }).id === 'r1' ? [row] : [];
    });
    const svc = new KnowledgeService({ dataEngine: { find, getSchema: () => schema } as unknown as IDataEngine });
    const adapter = makeAdapter('memory');
    svc.registerAdapter('memory', adapter);
    svc.registerSource(src);
    await svc.handleRecordUpsert('invoice', { id: 'r1' });
    await svc.reindexSource('s1');
    const titles = adapter.upsertSpy.mock.calls.flatMap((c) => (c[0] as KnowledgeDocument[]).map((d) => d.title));
    expect(titles).toEqual(['Travel policy', 'Travel policy']);
  });
});

// ADR-0161 K1 (record-level return), K8 items 3 and 14: `granularity: 'record'`
// answers one hit per record, `groupBy` one per metadata value, and each hit
// answered is checked against its record as it reads now.
describe('KnowledgeService — record-level search (granularity, groupBy, freshness)', () => {
  const MEMBER = { userId: 'u1', positions: ['member'], permissions: [], isSystem: false };
  const SYSTEM = { positions: [], permissions: [], isSystem: true };

  type Row = Record<string, unknown> & { id: string };

  /** A clause source: content `body`, metadata `policy`, over object `clause`. */
  function clauseSource(id: string, extra: Partial<ObjectKnowledgeSource> = {}): KnowledgeSource {
    return {
      name: id, label: id, adapter: 'memory',
      source: { kind: 'object', object: 'clause', content: ['body'], metadataFields: ['policy'], ...extra } as ObjectKnowledgeSource,
    };
  }

  /** The hit an index would answer for `row`'s passage `n`, carrying the hash its document was indexed with. */
  function hitOf(source: KnowledgeSource, row: Row, n: number, score: number, schema?: unknown): KnowledgeHit {
    const doc = recordToDocument(source, source.source as ObjectKnowledgeSource, row, schema);
    return {
      chunkId: `${doc.id}#${n}`, documentId: doc.id, sourceId: source.name, sourceRecordId: row.id,
      score, snippet: `${row.body as string} (${n})`, metadata: doc.metadata, docHash: doc.docHash,
    };
  }

  /** An adapter answering the best `topK` of `corpus[sourceId]`. */
  function rankingAdapter(corpus: Record<string, KnowledgeHit[]>) {
    const searchSpy = vi.fn(async (_q: string, opts: { source: KnowledgeSource; topK: number }) =>
      [...(corpus[opts.source.name] ?? [])].sort((a, b) => b.score - a.score).slice(0, opts.topK));
    return {
      id: 'memory', upsert: vi.fn(async () => undefined), delete: vi.fn(async () => undefined),
      search: searchSpy, searchSpy,
    };
  }

  /** Whether a recorded `find` call ran as the system identity (its context in the query or in the options). */
  type FindCall = unknown[];
  const isSystemCall = (c: FindCall): boolean =>
    ((c[1] as { context?: { isSystem?: boolean } }).context ?? (c[2] as { context?: { isSystem?: boolean } } | undefined)?.context)
      ?.isSystem === true;

  /**
   * An engine over `table`: a caller's re-read answers the `readable` ids,
   * projected to the fields asked; a system read (context in the query or in
   * the options: the freshness check, the event sync's re-read) answers the
   * rows matching `where` (equality, `$and`, `id: { $in }`), projected to the
   * fields asked when it asks any — so a projection that leaves out a field
   * assembly reads changes the recomputed hash, as a real engine would.
   */
  function tableEngine(table: Row[], readable?: string[]) {
    const matches = (row: Row, where: Record<string, unknown> | undefined): boolean =>
      Object.entries(where ?? {}).every(([k, v]) => {
        if (k === '$and') return (v as Record<string, unknown>[]).every((w) => matches(row, w));
        if (k.startsWith('$')) throw new Error(`tableEngine: combinator ${k} is not implemented`);
        if (v !== null && typeof v === 'object') {
          const ops = Object.keys(v as object);
          if (ops.length !== 1 || ops[0] !== '$in') throw new Error(`tableEngine: condition ${JSON.stringify(v)} is not implemented`);
          return (v as { $in: string[] }).$in.includes(row[k] as string);
        }
        return row[k] === v;
      });
    const find = vi.fn(async (_obj: string, q: { where?: Record<string, unknown>; fields?: string[]; context?: { isSystem?: boolean } }, o?: { context?: { isSystem?: boolean } }) => {
      const context = q.context ?? o?.context;
      const rows = table.filter((r) => matches(r, q.where));
      const project = (r: Row) => (q.fields ? Object.fromEntries(q.fields.filter((f) => f in r).map((f) => [f, r[f]])) : { ...r });
      if (context?.isSystem) return rows.map(project);
      return rows.filter((r) => readable === undefined || readable.includes(r.id)).map(project);
    });
    return { find } as unknown as IDataEngine & { find: typeof find };
  }

  function setup(opts: {
    table: Row[];
    sources: KnowledgeSource[];
    corpus: (sources: Record<string, KnowledgeSource>) => Record<string, KnowledgeHit[]>;
    readable?: string[];
    engine?: boolean;
  }) {
    const byId = Object.fromEntries(opts.sources.map((s) => [s.name, s]));
    const adapter = rankingAdapter(opts.corpus(byId));
    const engine = opts.engine === false ? undefined : tableEngine(opts.table, opts.readable);
    const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const svc = new KnowledgeService({ ...(engine ? { dataEngine: engine } : {}), logger });
    svc.registerAdapter('memory', adapter);
    for (const s of opts.sources) svc.registerSource(s);
    const asked = () => adapter.searchSpy.mock.calls.map((c) => [(c[1] as { source: KnowledgeSource }).source.name, (c[1] as { topK: number }).topK]);
    const systemReads = () => (engine?.find.mock.calls ?? []).filter((c) => isSystemCall(c));
    /** The freshness check's reads: system reads that pin ids with `$in` (the repair's re-read pins one id, `limit: 1`). */
    const freshnessReads = () => systemReads().filter((c) => JSON.stringify((c[1] as { where?: unknown }).where ?? {}).includes('"$in"'));
    return { svc, adapter, engine, logger, asked, systemReads, freshnessReads };
  }

  const policyRows = (): Row[] => [
    { id: 'c1', body: 'leave clause one', policy: 'P_leave' },
    { id: 'c2', body: 'leave clause two', policy: 'P_leave' },
    { id: 'c3', body: 'travel clause', policy: 'P_travel' },
    { id: 'c4', body: 'expense clause', policy: 'P_expense' },
  ];

  it('one record with three matching passages answers one hit, the best-scoring one', async () => {
    const table = policyRows();
    const h = setup({
      table, sources: [clauseSource('s1')],
      corpus: ({ s1 }) => ({ s1: [hitOf(s1, table[0], 0, 0.5), hitOf(s1, table[0], 1, 0.9), hitOf(s1, table[0], 2, 0.7), hitOf(s1, table[2], 0, 0.6)] }),
    });
    const out = await h.svc.search('q', { granularity: 'record', topK: 5, executionContext: MEMBER });
    expect(out.map((x) => x.chunkId)).toEqual(['s1:c1#1', 's1:c3#0']);
    expect(out[0].score).toBe(0.9);
  });

  it('the default stays chunk-level: every passage, no freshness read', async () => {
    const table = policyRows();
    const h = setup({
      table, sources: [clauseSource('s1')],
      corpus: ({ s1 }) => ({ s1: [hitOf(s1, table[0], 0, 0.5), hitOf(s1, table[0], 1, 0.9)] }),
    });
    const out = await h.svc.search('q', { topK: 5, executionContext: MEMBER });
    expect(out.map((x) => x.chunkId)).toEqual(['s1:c1#1', 's1:c1#0']);
    expect(h.systemReads()).toEqual([]);
  });

  it('topK counts records: three passages a record, topK 5 answers 5 records from one round of topK × 5', async () => {
    const table: Row[] = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, body: `body ${i}`, policy: 'P' }));
    const h = setup({
      table, sources: [clauseSource('s1')],
      corpus: ({ s1 }) => ({ s1: table.flatMap((r, i) => [0, 1, 2].map((n) => hitOf(s1, r, n, 1 - i / 100 - n / 1000))) }),
    });
    const out = await h.svc.search('q', { granularity: 'record', topK: 5, executionContext: SYSTEM });
    expect(out.map((x) => x.sourceRecordId)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    expect(h.asked()).toEqual([['s1', 25]]);
  });

  it('fewer records than topK within the refill cap: fewer are answered, refilled once, and logged', async () => {
    const table: Row[] = [{ id: 'r0', body: 'only', policy: 'P' }, { id: 'r1', body: 'other', policy: 'P' }];
    // 120 passages of r0 fill every round; r1's passage lies past the cap (topK × 20 = 100).
    const h = setup({
      table, sources: [clauseSource('s1')],
      corpus: ({ s1 }) => ({ s1: [...Array.from({ length: 120 }, (_, n) => hitOf(s1, table[0], n, 1 - n / 1000)), hitOf(s1, table[1], 0, 0.1)] }),
    });
    const out = await h.svc.search('q', { granularity: 'record', topK: 5, executionContext: SYSTEM });
    expect(out.map((x) => x.sourceRecordId)).toEqual(['r0']);
    expect(h.asked()).toEqual([['s1', 25], ['s1', 100]]);
    expect(h.logger.debug).toHaveBeenCalledWith(expect.stringContaining('answered 1 of topK=5 records'));
  });

  it("groupBy 'policy': one hit per policy, its best clause, the value in the hit's metadata", async () => {
    const table = policyRows();
    const h = setup({
      table, sources: [clauseSource('s1')],
      corpus: ({ s1 }) => ({ s1: [hitOf(s1, table[0], 0, 0.6), hitOf(s1, table[1], 0, 0.9), hitOf(s1, table[2], 0, 0.7), hitOf(s1, table[3], 0, 0.5)] }),
    });
    const out = await h.svc.search('q', { groupBy: 'policy', topK: 2, executionContext: MEMBER });
    expect(out.map((x) => [x.sourceRecordId, x.metadata?.policy])).toEqual([['c2', 'P_leave'], ['c3', 'P_travel']]);
  });

  it('groupBy: a source that does not list the field is not searched; a record with no value is not answered', async () => {
    const table: Row[] = [...policyRows(), { id: 'c5', body: 'orphan clause' }];
    const noPolicy = clauseSource('s2', { metadataFields: ['status'] });
    const h = setup({
      table, sources: [clauseSource('s1'), noPolicy],
      corpus: ({ s1, s2 }) => ({ s1: [hitOf(s1, table[4], 0, 0.99), hitOf(s1, table[2], 0, 0.5)], s2: [hitOf(s2, table[0], 0, 0.95)] }),
    });
    const out = await h.svc.search('q', { groupBy: 'policy', topK: 5, executionContext: MEMBER });
    expect(out.map((x) => x.documentId)).toEqual(['s1:c3']);
    expect(h.asked().map(([id]) => id)).not.toContain('s2');
  });

  it('groupBy across several sources: the same value is one group, the best hit of either source', async () => {
    const table = policyRows();
    const h = setup({
      table, sources: [clauseSource('s1'), clauseSource('s2')],
      corpus: ({ s1, s2 }) => ({
        s1: [hitOf(s1, table[0], 0, 0.6)],
        s2: [hitOf(s2, table[1], 0, 0.8), hitOf(s2, table[2], 0, 0.3)],
      }),
    });
    const out = await h.svc.search('q', { groupBy: 'policy', topK: 5, executionContext: MEMBER });
    expect(out.map((x) => x.chunkId)).toEqual(['s2:c2#0', 's2:c3#0']);
  });

  it("groupBy with granularity 'chunk', an empty groupBy and an unknown granularity are refused, coded VALIDATION_ERROR / 400", async () => {
    const h = setup({ table: [], sources: [clauseSource('s1')], corpus: () => ({}) });
    const coded = (message: RegExp) => expect.objectContaining({ code: 'VALIDATION_ERROR', status: 400, message: expect.stringMatching(message) });
    await expect(h.svc.search('q', { groupBy: 'policy', granularity: 'chunk', executionContext: SYSTEM }))
      .rejects.toEqual(coded(/cannot be combined with granularity 'chunk'/));
    await expect(h.svc.search('q', { groupBy: '', executionContext: SYSTEM })).rejects.toEqual(coded(/must name a metadata field/));
    await expect(h.svc.search('q', { granularity: 'passage' as never, executionContext: SYSTEM }))
      .rejects.toEqual(coded(/granularity must be 'chunk' or 'record', got 'passage'/));
    expect(h.adapter.searchSpy).not.toHaveBeenCalled();
  });

  it('freshness: a record deleted or out of where since indexing is not answered, and the next record moves up', async () => {
    const table = policyRows();
    const source = clauseSource('s1', { where: { policy: 'P_leave' } });
    // Indexed while c3 and c4 were still in the source; c3 has since left `where`, c4 was deleted.
    const indexed = [{ ...table[2], policy: 'P_leave' }, { id: 'c4', body: 'gone', policy: 'P_leave' }];
    const h = setup({
      table: table.filter((r) => r.id !== 'c4'), sources: [source],
      corpus: ({ s1 }) => ({ s1: [hitOf(s1, indexed[0], 0, 0.9), hitOf(s1, indexed[1], 0, 0.8), hitOf(s1, table[0], 0, 0.7), hitOf(s1, table[1], 0, 0.6)] }),
    });
    const out = await h.svc.search('q', { granularity: 'record', topK: 2, executionContext: SYSTEM });
    expect(out.map((x) => x.sourceRecordId)).toEqual(['c1', 'c2']);
    // Round one read the two leads with the source's where; round two the two that moved up.
    const reads = h.freshnessReads();
    expect(reads.map((c) => (c[1] as { where: { $and: [unknown, { id: { $in: string[] } }] } }).where)).toEqual([
      { $and: [{ policy: 'P_leave' }, { id: { $in: ['c3', 'c4'] } }] },
      { $and: [{ policy: 'P_leave' }, { id: { $in: ['c1', 'c2'] } }] },
    ]);
  });

  it('freshness: a record changed since indexing is not answered (no stale snippet), and is repaired once', async () => {
    const table = policyRows();
    const source = clauseSource('s1');
    const before = { ...table[0], body: 'leave clause one, before the edit' };
    const h = setup({
      table, sources: [source],
      corpus: ({ s1 }) => ({ s1: [hitOf(s1, before, 0, 0.9), hitOf(s1, table[2], 0, 0.5)] }),
    });
    const first = await h.svc.search('q', { granularity: 'record', topK: 5, executionContext: SYSTEM });
    expect(first.map((x) => x.sourceRecordId)).toEqual(['c3']);
    await vi.waitFor(() => expect(h.adapter.upsert).toHaveBeenCalledTimes(1));
    const [[docs]] = h.adapter.upsert.mock.calls as unknown as [[KnowledgeDocument[]]];
    expect(docs.map((d) => [d.id, d.content])).toEqual([['s1:c1', 'leave clause one']]);
    // The index (this double) still answers the old hash: the next search drops it again, without a second repair.
    await h.svc.search('q', { granularity: 'record', topK: 5, executionContext: SYSTEM });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.adapter.upsert).toHaveBeenCalledTimes(1);
  });

  it('freshness: a hash that matches is answered and clears the repair, so a later change is repaired again', async () => {
    const table = policyRows();
    const source = clauseSource('s1');
    const corpus: Record<string, KnowledgeHit[]> = { s1: [] };
    const h = setup({ table, sources: [source], corpus: () => corpus });
    corpus.s1 = [hitOf(source, { ...table[0], body: 'old' }, 0, 0.9)];
    await h.svc.search('q', { granularity: 'record', executionContext: SYSTEM });
    await vi.waitFor(() => expect(h.adapter.upsert).toHaveBeenCalledTimes(1));
    corpus.s1 = [hitOf(source, table[0], 0, 0.9)];
    expect((await h.svc.search('q', { granularity: 'record', executionContext: SYSTEM })).map((x) => x.sourceRecordId)).toEqual(['c1']);
    table[0].body = 'edited again';
    await h.svc.search('q', { granularity: 'record', executionContext: SYSTEM });
    await vi.waitFor(() => expect(h.adapter.upsert).toHaveBeenCalledTimes(2));
  });

  it('freshness: a hit whose adapter stores no hash is checked for membership only', async () => {
    const table = policyRows();
    const h = setup({
      table, sources: [clauseSource('s1')],
      corpus: ({ s1 }) => ({ s1: [{ ...hitOf(s1, { ...table[0], body: 'old' }, 0, 0.9), docHash: undefined }] }),
    });
    const out = await h.svc.search('q', { granularity: 'record', executionContext: SYSTEM });
    expect(out.map((x) => x.sourceRecordId)).toEqual(['c1']);
    expect(h.adapter.upsert).not.toHaveBeenCalled();
  });

  it('freshness: a read that fails answers none of that source\'s checked hits, reported at warn', async () => {
    const table = policyRows();
    const h = setup({ table, sources: [clauseSource('s1')], corpus: ({ s1 }) => ({ s1: [hitOf(s1, table[0], 0, 0.9)] }) });
    h.engine!.find.mockImplementation(async (_o, q, o) => {
      if ((q.context ?? o?.context)?.isSystem) throw new Error('db down');
      return [{ id: 'c1' }];
    });
    expect(await h.svc.search('q', { granularity: 'record', executionContext: MEMBER })).toEqual([]);
    expect(h.logger.warn).toHaveBeenCalledWith(expect.stringContaining('could not read its records (db down)'));
  });

  it('the permission re-read stays one query as the caller, reads the display field too, and the hit carries the title as it reads now', async () => {
    const table: Row[] = [{ id: 'c1', body: 'clause', policy: 'P', name: 'Leave policy (2026)' }];
    const source = clauseSource('s1');
    const h = setup({
      table, sources: [source], readable: ['c1'],
      corpus: ({ s1 }) => ({ s1: [{ ...hitOf(s1, table[0], 0, 0.9), title: 'Leave policy (2025)', docHash: undefined }] }),
    });
    (h.engine as unknown as { getSchema: (o: string) => unknown }).getSchema = () => ({
      name: 'clause', nameField: 'name', fields: { body: { type: 'textarea' }, policy: { type: 'text' }, name: { type: 'text' } },
    });
    const out = await h.svc.search('q', { granularity: 'record', executionContext: MEMBER });
    expect(out.map((x) => x.title)).toEqual(['Leave policy (2026)']);
    const callerReads = h.engine!.find.mock.calls.filter((c) => !isSystemCall(c));
    expect(callerReads).toHaveLength(1);
    expect(callerReads[0][1]).toMatchObject({ where: { id: { $in: ['c1'] } }, fields: ['id', 'name'], context: MEMBER });
    // The freshness read is projected to the fields assembly reads.
    expect(h.freshnessReads()[0][1]).toEqual({ where: { id: { $in: ['c1'] } }, fields: ['id', 'body', 'policy', 'name'] });
    expect(h.freshnessReads()[0][2]).toEqual({ context: expect.objectContaining({ isSystem: true }) });
  });

  it('a record the caller may not read is not answered; the system identity is answered without a caller re-read', async () => {
    const table = policyRows();
    const h = setup({
      table, sources: [clauseSource('s1')], readable: ['c3'],
      corpus: ({ s1 }) => ({ s1: [hitOf(s1, table[0], 0, 0.9), hitOf(s1, table[2], 0, 0.5)] }),
    });
    expect((await h.svc.search('q', { granularity: 'record', executionContext: MEMBER })).map((x) => x.sourceRecordId)).toEqual(['c3']);
    h.engine!.find.mockClear();
    expect((await h.svc.search('q', { granularity: 'record', executionContext: SYSTEM })).map((x) => x.sourceRecordId)).toEqual(['c1', 'c3']);
    expect(h.engine!.find.mock.calls.every((c) => isSystemCall(c))).toBe(true);
  });

  it('freshness: a source an external indexer owns (refresh.onRecordChange: false) drops its stale hits and is never repaired', async () => {
    const table = policyRows();
    const external = clauseSource('s1', { where: { policy: 'P_leave' } });
    const ext: KnowledgeSource = { ...external, refresh: { onRecordChange: false } } as KnowledgeSource;
    const owned = clauseSource('s2');
    // s1: c1 changed since indexing, c9 deleted. s2 (synced by the service): c3 changed.
    const h = setup({
      table, sources: [ext, owned],
      corpus: ({ s1, s2 }) => ({
        s1: [hitOf(s1, { ...table[0], body: 'old' }, 0, 0.9), hitOf(s1, { id: 'c9', body: 'gone', policy: 'P_leave' }, 0, 0.8), hitOf(s1, table[1], 0, 0.3)],
        s2: [hitOf(s2, { ...table[2], body: 'old' }, 0, 0.7)],
      }),
    });
    const out = await h.svc.search('q', { granularity: 'record', topK: 5, executionContext: SYSTEM });
    expect(out.map((x) => `${x.sourceId}:${x.sourceRecordId}`)).toEqual(['s1:c2']);
    await vi.waitFor(() => expect(h.adapter.upsert).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    const upserted = (h.adapter.upsert.mock.calls as unknown as [KnowledgeDocument[]][]).flatMap(([docs]) => docs.map((d) => d.id));
    expect(upserted).toEqual(['s2:c3']);
    expect(h.adapter.delete).not.toHaveBeenCalled();
  });

  it(`freshness: stale leads past ${SEARCH_FRESHNESS_ROUNDS} rounds leave the rest unanswered, read ${SEARCH_FRESHNESS_ROUNDS} times, logged as the round cap`, async () => {
    const table: Row[] = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, body: `body ${i}`, policy: 'P' }));
    // r0–r3 changed since indexing; each round checks one lead (topK 1), so three rounds clear r0–r2 and r3 is still unchecked.
    const h = setup({
      table, sources: [clauseSource('s1')],
      corpus: ({ s1 }) => ({ s1: table.map((r, i) => hitOf(s1, i < 4 ? { ...r, body: 'old' } : r, 0, 1 - i / 10)) }),
    });
    const out = await h.svc.search('q', { granularity: 'record', topK: 1, executionContext: SYSTEM });
    expect(out).toEqual([]);
    expect(h.freshnessReads().map((c) => (c[1] as { where: { id: { $in: string[] } } }).where.id.$in)).toEqual([['r0'], ['r1'], ['r2']]);
    expect(h.logger.debug).toHaveBeenCalledWith(expect.stringContaining(`stopped checking freshness after ${SEARCH_FRESHNESS_ROUNDS} rounds; 1 unchecked hit(s) not answered`));
    expect(h.logger.debug).not.toHaveBeenCalledWith(expect.stringContaining('no more within the refill cap'));
  });

  it('freshness: a source naming a field the object does not declare reads the whole row, so its record hashes as assembly did', async () => {
    const table: Row[] = [{ id: 'c1', body: 'clause', policy: 'P', created_at: '2026-11-01' }];
    const schema = { name: 'clause', fields: { body: { type: 'textarea' }, policy: { type: 'text' } } };
    const source = clauseSource('s1', { metadataFields: ['policy', 'created_at'] });
    // Assembly (the walk, the event sync) read the whole row, so the stored hash covers `created_at`.
    const h = setup({ table, sources: [source], corpus: ({ s1 }) => ({ s1: [hitOf(s1, table[0], 0, 0.9, schema)] }) });
    (h.engine as unknown as { getSchema: (o: string) => unknown }).getSchema = () => schema;
    const out = await h.svc.search('q', { granularity: 'record', executionContext: SYSTEM });
    expect(out.map((x) => x.sourceRecordId)).toEqual(['c1']);
    expect(h.freshnessReads().map((c) => c[1])).toEqual([{ where: { id: { $in: ['c1'] } } }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.adapter.upsert).not.toHaveBeenCalled();
  });

  it('freshness: a projected read recomputes the hash assembly stored, so an unchanged record is answered and not repaired', async () => {
    const table: Row[] = [{ id: 'c1', body: 'clause', policy: 'P', name: 'Leave policy', notes: 'not indexed' }];
    const schema = {
      name: 'clause', nameField: 'name',
      fields: { body: { type: 'textarea' }, policy: { type: 'text' }, name: { type: 'text' }, notes: { type: 'text' } },
    };
    const h = setup({ table, sources: [clauseSource('s1')], corpus: ({ s1 }) => ({ s1: [hitOf(s1, table[0], 0, 0.9, schema)] }) });
    (h.engine as unknown as { getSchema: (o: string) => unknown }).getSchema = () => schema;
    const out = await h.svc.search('q', { granularity: 'record', executionContext: SYSTEM });
    expect(out.map((x) => x.sourceRecordId)).toEqual(['c1']);
    // The double answers only the fields asked, as a real engine does.
    expect(h.freshnessReads().map((c) => c[1])).toEqual([{ where: { id: { $in: ['c1'] } }, fields: ['id', 'body', 'policy', 'name'] }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.adapter.upsert).not.toHaveBeenCalled();
  });

  it('a hit carries its passage heading path through', async () => {
    const table = policyRows();
    const h = setup({
      table, sources: [clauseSource('s1')],
      corpus: ({ s1 }) => ({ s1: [{ ...hitOf(s1, table[0], 0, 0.9), headingPath: ['Leave', 'Annual'] }] }),
    });
    const [hit] = await h.svc.search('q', { granularity: 'record', executionContext: SYSTEM });
    expect(hit.headingPath).toEqual(['Leave', 'Annual']);
  });
});

/**
 * ADR-0161 — a source whose named adapter is not mounted (the runtime mounts
 * one store per database, so a source naming the other is the common case):
 * the service mounts, the boot says so once at `error`, and indexing and
 * searching that source answer `SERVICE_UNAVAILABLE` naming the adapters that
 * are mounted. Never an empty answer that reads as "nothing matched".
 */
describe('KnowledgeService — a source naming an adapter that is not mounted', () => {
  function serviceWith() {
    const logs: Array<[string, string]> = [];
    const logger = {
      info: () => undefined,
      debug: () => undefined,
      warn: (m: string) => logs.push(['warn', m]),
      error: (m: string) => logs.push(['error', m]),
    };
    const svc = new KnowledgeService({ logger });
    const turso = makeAdapter('turso', [{ chunkId: 'c1', documentId: 'd1', sourceId: 'notes', snippet: 'x', score: 1 }]);
    svc.registerAdapter('turso', turso);
    svc.registerSource(objectSource('notes', 'task', 'turso'));
    svc.registerSource(objectSource('docs', 'doc', 'pgvector'));
    return { svc, logs, turso };
  }

  it('the boot reading names each such source once, at error, with the mounted choices', () => {
    const { svc, logs } = serviceWith();
    expect(svc.reportUnmountedAdapters()).toEqual(['docs']);
    const errors = logs.filter(([level]) => level === 'error').map(([, m]) => m);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("source 'docs' names adapter 'pgvector', which is not mounted (mounted: turso)");
  });

  it('indexing it answers SERVICE_UNAVAILABLE naming the choices', async () => {
    const { svc } = serviceWith();
    const err = await svc.reindexSource('docs').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect((err as Error).message).toContain("adapter 'pgvector' is not mounted (mounted: turso)");
  });

  it('searching it alone is refused whole; beside a mounted source it is named as refused', async () => {
    const { svc, logs } = serviceWith();
    const system = { isSystem: true } as never;
    const alone = await svc.search('q', { sourceIds: ['docs'], executionContext: system }).catch((e: unknown) => e);
    expect(alone).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect((alone as { refused: unknown }).refused).toEqual([
      expect.objectContaining({ sourceId: 'docs', code: 'SERVICE_UNAVAILABLE', status: 503 }),
    ]);
    const both = await svc.searchWithRefusals('q', { executionContext: system });
    expect(both.hits.map((h) => h.sourceId)).toEqual(['notes']);
    expect(both.refused).toEqual([expect.objectContaining({ sourceId: 'docs', code: 'SERVICE_UNAVAILABLE' })]);
    // Said once at boot, never a line per search.
    expect(logs.filter(([, m]) => m.includes("'docs'"))).toEqual([]);
  });

  it('the plugin takes the reading at kernel:bootstrapped, after every store has registered; boot goes on', async () => {
    const reading = vi.spyOn(KnowledgeService.prototype, 'reportUnmountedAdapters');
    try {
      const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
      const late: Plugin = {
        name: 'test.late-store',
        init: async () => undefined,
        start: async (ctx: PluginContext) => {
          ctx.getService<KnowledgeService>('knowledge').registerAdapter('turso', makeAdapter('turso'));
        },
      };
      kernel.use(
        new KnowledgeServicePlugin({
          sources: [objectSource('notes', 'task', 'turso'), objectSource('docs', 'doc', 'pgvector')],
          enableEventSync: false,
        }),
      );
      kernel.use(late);
      await kernel.bootstrap();
      // Taken once, after the store that started last registered: only 'docs' is named.
      expect(reading).toHaveBeenCalledTimes(1);
      expect(reading.mock.results[0]?.value).toEqual(['docs']);
      await kernel.shutdown();
    } finally {
      reading.mockRestore();
    }
  });
});

/**
 * [ADR-0161 K4 ◆] A source that names no `adapter` binds to the deployment's
 * adapter — the store the runtime marked when it mounted it
 * (`deploymentAdapter`) — else to the only adapter registered. Several
 * registered and none the deployment's: refused at registration, naming them.
 */
describe('KnowledgeService — a source that names no adapter (the deployment\'s store)', () => {
  const ec = { positions: [], permissions: [], isSystem: true };
  /** `objectSource` with its `adapter` left out, as an author may now write it. */
  function unnamed(id: string, object = 'task'): KnowledgeSource {
    const { adapter: _omitted, ...source } = objectSource(id, object);
    return source as KnowledgeSource;
  }

  it('binds to the deployment\'s store when the runtime marked one, beside an adapter application code registered', async () => {
    const deployment = makeAdapter('turso');
    const app = makeAdapter('memory');
    const svc = new KnowledgeService({ deploymentAdapter: 'turso' });
    svc.registerAdapter('memory', app);
    svc.registerAdapter('turso', deployment);
    svc.registerSource(unnamed('s1'));
    expect(svc.adapterIdFor(svc.getSource('s1')!)).toBe('turso');
    await svc.search('q', { sourceIds: ['s1'], executionContext: ec });
    expect(deployment.searchSpy).toHaveBeenCalledOnce();
    expect(app.searchSpy).not.toHaveBeenCalled();
    await svc.handleRecordUpsert('task', { id: 'r1', title: 'T', notes: 'N' });
    expect(deployment.upsertSpy).toHaveBeenCalledOnce();
    expect(app.upsertSpy).not.toHaveBeenCalled();
  });

  it('a named adapter is kept as named, whatever the deployment\'s store is', async () => {
    const deployment = makeAdapter('turso');
    const app = makeAdapter('memory');
    const svc = new KnowledgeService({ deploymentAdapter: 'turso' });
    svc.registerAdapter('turso', deployment);
    svc.registerAdapter('memory', app);
    svc.registerSource(objectSource('s1', 'task', 'memory'));
    await svc.search('q', { sourceIds: ['s1'], executionContext: ec });
    expect(app.searchSpy).toHaveBeenCalledOnce();
    expect(deployment.searchSpy).not.toHaveBeenCalled();
  });

  it('with no mark, binds to the only adapter registered — placed where it is used, so a store registering after the source is found', async () => {
    const svc = new KnowledgeService();
    // A source registered in code at init(), before any store's start().
    svc.registerSource(unnamed('s1'));
    const only = makeAdapter('memory');
    svc.registerAdapter('memory', only);
    await svc.search('q', { sourceIds: ['s1'], executionContext: ec });
    expect(only.searchSpy).toHaveBeenCalledOnce();
  });

  it('two adapters registered by application code and none the deployment\'s: refused at registration, naming both', () => {
    const svc = new KnowledgeService();
    svc.registerAdapter('memory', makeAdapter('memory'));
    svc.registerAdapter('pgvector', makeAdapter('pgvector'));
    let refused: unknown;
    try {
      svc.registerSource(unnamed('s1'));
    } catch (err) {
      refused = err;
    }
    expect(refused).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(String((refused as Error).message)).toContain("source 's1' names no adapter, and 2 adapters are registered (memory, pgvector)");
    expect(svc.getSource('s1')).toBeUndefined();
    // The metadata door refuses the same way.
    expect(() => svc.registerMetadataSource(unnamed('s2'))).toThrow(/Name one of 'memory', 'pgvector'/);
    expect(svc.getSource('s2')).toBeUndefined();
  });

  it('two adapters registered after the source, none the deployment\'s: the search refuses it with the same code, naming both', async () => {
    const svc = new KnowledgeService();
    svc.registerSource(unnamed('s1'));
    svc.registerAdapter('memory', makeAdapter('memory'));
    svc.registerAdapter('pgvector', makeAdapter('pgvector'));
    // The only source asked for cannot be searched, so the search answers its refusal.
    const refused = await svc.search('q', { sourceIds: ['s1'], executionContext: ec }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(String((refused as Error).message)).toContain('2 adapters are registered (memory, pgvector)');
    expect(svc.reportUnmountedAdapters()).toEqual(['s1']);
  });

  it('the deployment\'s store marked but not mounted, and nothing else: SERVICE_UNAVAILABLE naming the store', async () => {
    const svc = new KnowledgeService({ deploymentAdapter: 'turso' });
    svc.registerSource(unnamed('s1'));
    expect(() => svc.adapterFor(svc.getSource('s1')!)).toThrow(/the deployment's store 'turso' is not mounted/);
    const refused = await svc.search('q', { sourceIds: ['s1'], executionContext: ec }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
  });

  it('the save of an unplaceable source is refused to its author, naming the adapters', async () => {
    const svc = new KnowledgeService({ dataEngine: {} as IDataEngine });
    svc.registerAdapter('memory', makeAdapter('memory'));
    svc.registerAdapter('pgvector', makeAdapter('pgvector'));
    const verdict = await svc.admitAuthoredSource(unnamed('s1'), { userId: 'u1', positions: [], permissions: [] } as never);
    expect(verdict).toMatchObject({ admitted: false, code: 'VALIDATION_ERROR', status: 400 });
    expect((verdict as { message: string }).message).toContain("Name one of 'memory', 'pgvector'");
  });

  it('KnowledgeServicePlugin hands its `deploymentAdapter` option to the service', async () => {
    const kernel = new LiteKernel();
    await kernel.use(new KnowledgeServicePlugin({ deploymentAdapter: 'turso', enableEventSync: false, buildAtBoot: false }));
    await kernel.bootstrap();
    try {
      const svc = kernel.getService<KnowledgeService>('knowledge');
      svc.registerAdapter('memory', makeAdapter('memory'));
      svc.registerAdapter('turso', makeAdapter('turso'));
      svc.registerSource(unnamed('s1'));
      expect(svc.adapterIdFor(svc.getSource('s1')!)).toBe('turso');
    } finally {
      await kernel.shutdown();
    }
  });
});
