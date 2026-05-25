// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { KnowledgeService, documentIdFor, recordToDocument } from '../knowledge-service';
import type {
  IDataEngine,
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
    expect(a.upsertSpy).toHaveBeenCalledWith([doc], expect.objectContaining({ reason: 'manual' }));
    await svc.deleteDocument('s1', 'd1');
    expect(a.deleteSpy).toHaveBeenCalledWith(['d1'], expect.objectContaining({ reason: 'manual' }));
  });

  it('indexDocument throws on unknown source', async () => {
    const svc = new KnowledgeService();
    await expect(svc.indexDocument('nope', { id: 'd', sourceId: 'nope', content: '' })).rejects.toThrow(/unknown source/);
  });
});

describe('KnowledgeService — permission-aware search', () => {
  function buildSetup(hits: KnowledgeHit[]) {
    const adapter = makeAdapter('memory', hits);
    const findSpy = vi.fn(async (_obj: string, opts: { context: { isSystem?: boolean } }) => {
      if (opts.context?.isSystem) return [{ id: 'rec_1' }, { id: 'rec_2' }];
      return [{ id: 'rec_1' }];
    });
    const engine = { find: findSpy } as unknown as IDataEngine;
    const svc = new KnowledgeService({ dataEngine: engine });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('s1', 'task'));
    return { svc, adapter, findSpy };
  }

  it('passes through every hit when no executionContext is provided', async () => {
    const hits: KnowledgeHit[] = [
      { chunkId: 'c1', documentId: 'd1', sourceId: 's1', sourceRecordId: 'rec_1', score: 0.9, snippet: '' },
      { chunkId: 'c2', documentId: 'd2', sourceId: 's1', sourceRecordId: 'rec_2', score: 0.8, snippet: '' },
    ];
    const { svc, findSpy } = buildSetup(hits);
    const out = await svc.search('q');
    expect(out).toHaveLength(2);
    expect(findSpy).not.toHaveBeenCalled();
  });

  it('passes through every hit when context is isSystem:true', async () => {
    const hits: KnowledgeHit[] = [
      { chunkId: 'c1', documentId: 'd1', sourceId: 's1', sourceRecordId: 'rec_1', score: 0.9, snippet: '' },
    ];
    const { svc, findSpy } = buildSetup(hits);
    const out = await svc.search('q', { executionContext: { roles: [], permissions: [], isSystem: true } });
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
      executionContext: { userId: 'u1', roles: ['member'], permissions: [], isSystem: false },
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
      executionContext: { userId: 'u1', roles: [], permissions: [], isSystem: false },
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
    const out = await svc.search('q', { executionContext: { userId: 'u', roles: [], permissions: [], isSystem: false } });
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
    const out = await svc.search('q', { topK: 2 });
    expect(out.map((h) => h.documentId)).toEqual(['d2', 'd3']);
  });

  it('search target restriction via sourceIds', async () => {
    const a = makeAdapter('memory', []);
    const svc = new KnowledgeService();
    svc.registerAdapter('memory', a);
    svc.registerSource(objectSource('s1', 'task'));
    svc.registerSource(objectSource('s2', 'note'));
    await svc.search('q', { sourceIds: ['s2'] });
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
    const find = vi.fn(async () => [
      { id: 'r1', title: 'T1', notes: 'N1', status: 'open' },
      { id: 'r2', title: 'T2', notes: 'N2', status: 'done' },
    ]);
    const adapter = makeAdapter('memory');
    const svc = new KnowledgeService({ dataEngine: { find } as unknown as IDataEngine });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('s1', 'task'));
    const res = await svc.reindexSource('s1');
    expect(res.ok).toBe(true);
    expect(res.indexed).toBe(2);
    expect(res.discovered).toBe(2);
    expect((find.mock.calls[0][1] as { context: { isSystem?: boolean } }).context.isSystem).toBe(true);
    expect(adapter.upsertSpy).toHaveBeenCalledOnce();
  });

  it('dryRun reports counts without calling adapter', async () => {
    const find = vi.fn(async () => [{ id: 'r1', title: 'T1', notes: 'N1' }]);
    const adapter = makeAdapter('memory');
    const svc = new KnowledgeService({ dataEngine: { find } as unknown as IDataEngine });
    svc.registerAdapter('memory', adapter);
    svc.registerSource(objectSource('s1', 'task'));
    const res = await svc.reindexSource('s1', { dryRun: true });
    expect(res.indexed).toBe(0);
    expect(res.discovered).toBe(1);
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
