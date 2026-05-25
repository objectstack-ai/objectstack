// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../tools/tool-registry';
import { registerKnowledgeTools, SEARCH_KNOWLEDGE_TOOL } from '../tools/knowledge-tools';
import type {
  IKnowledgeService,
  KnowledgeSearchOptions,
} from '@objectstack/spec/contracts';
import type { KnowledgeHit } from '@objectstack/spec/ai';

function makeService(overrides: Partial<IKnowledgeService> = {}): {
  service: IKnowledgeService;
  search: ReturnType<typeof vi.fn>;
} {
  const search = vi.fn(async (_q: string, _o?: KnowledgeSearchOptions) =>
    [
      {
        chunkId: 'd1#0',
        documentId: 'd1',
        sourceId: 'src1',
        sourceRecordId: 'rec_1',
        score: 0.93,
        snippet: 'snippet',
        title: 'T',
        metadata: { topic: 'refunds' },
      },
    ] as KnowledgeHit[],
  );
  const service: IKnowledgeService = {
    registerAdapter: vi.fn(),
    getAdapter: vi.fn(),
    listAdapters: vi.fn(() => []),
    registerSource: vi.fn(),
    unregisterSource: vi.fn(),
    listSources: vi.fn(() => []),
    getSource: vi.fn(() => undefined),
    indexDocument: vi.fn(),
    deleteDocument: vi.fn(),
    reindexSource: vi.fn(async () => ({ indexed: 0, discovered: 0, ok: true })),
    search,
    ...overrides,
  };
  return { service, search };
}

function call(reg: ToolRegistry, input: Record<string, unknown>, ctx?: unknown) {
  return reg.execute(
    { type: 'tool-call', toolCallId: 'tc1', toolName: 'search_knowledge', input } as never,
    ctx as never,
  );
}

function payload(r: { output: { value: string } }): { count: number; hits: any[]; error?: string } {
  return JSON.parse(r.output.value);
}

describe('search_knowledge tool', () => {
  it('definition has proper shape', () => {
    expect(SEARCH_KNOWLEDGE_TOOL.name).toBe('search_knowledge');
    expect(SEARCH_KNOWLEDGE_TOOL.parameters.required).toContain('query');
  });

  it('returns JSON envelope with hits', async () => {
    const { service, search } = makeService();
    const reg = new ToolRegistry();
    registerKnowledgeTools(reg, { knowledgeService: service });
    const r = await call(reg, { query: 'refund policy', topK: 3 });
    const parsed = payload(r as never);
    expect(parsed.count).toBe(1);
    expect(parsed.hits[0].documentId).toBe('d1');
    expect(parsed.hits[0].score).toBe(0.93);
    expect(search).toHaveBeenCalledWith(
      'refund policy',
      expect.objectContaining({ topK: 3 }),
    );
  });

  it('threads actor into executionContext (RLS path)', async () => {
    const { service, search } = makeService();
    const reg = new ToolRegistry();
    registerKnowledgeTools(reg, { knowledgeService: service });
    await call(reg, { query: 'q' }, {
      actor: { id: 'u_42', roles: ['agent'], permissions: ['read'] },
      environmentId: 'env_a',
      traceId: 't1',
    });
    const opts = search.mock.calls[0][1] as KnowledgeSearchOptions;
    expect(opts.executionContext?.userId).toBe('u_42');
    expect(opts.executionContext?.isSystem).toBe(false);
    expect(opts.executionContext?.tenantId).toBe('env_a');
    expect(opts.executionContext?.traceId).toBe('t1');
  });

  it('falls back to isSystem when no actor is supplied', async () => {
    const { service, search } = makeService();
    const reg = new ToolRegistry();
    registerKnowledgeTools(reg, { knowledgeService: service });
    await call(reg, { query: 'q' });
    const opts = search.mock.calls[0][1] as KnowledgeSearchOptions;
    expect(opts.executionContext?.isSystem).toBe(true);
  });

  it('rejects empty query gracefully (JSON error)', async () => {
    const { service } = makeService();
    const reg = new ToolRegistry();
    registerKnowledgeTools(reg, { knowledgeService: service });
    const r = await call(reg, { query: '   ' });
    expect(payload(r as never).error).toMatch(/query/);
  });

  it('clamps topK to [1, 20]', async () => {
    const { service, search } = makeService();
    const reg = new ToolRegistry();
    registerKnowledgeTools(reg, { knowledgeService: service });
    await call(reg, { query: 'q', topK: 999 });
    expect((search.mock.calls[0][1] as KnowledgeSearchOptions).topK).toBe(20);
    await call(reg, { query: 'q', topK: 0 });
    expect((search.mock.calls[1][1] as KnowledgeSearchOptions).topK).toBe(1);
  });

  it('passes sourceIds and filter through', async () => {
    const { service, search } = makeService();
    const reg = new ToolRegistry();
    registerKnowledgeTools(reg, { knowledgeService: service });
    await call(reg, { query: 'q', sourceIds: ['a', 'b'], filter: { topic: 'refunds' } });
    const opts = search.mock.calls[0][1] as KnowledgeSearchOptions;
    expect(opts.sourceIds).toEqual(['a', 'b']);
    expect(opts.filter).toEqual({ topic: 'refunds' });
  });

  it('returns JSON error when service throws', async () => {
    const { service } = makeService({
      search: vi.fn(async () => {
        throw new Error('adapter down');
      }) as unknown as IKnowledgeService['search'],
    });
    const reg = new ToolRegistry();
    registerKnowledgeTools(reg, { knowledgeService: service });
    const r = await call(reg, { query: 'q' });
    expect(payload(r as never).error).toMatch(/adapter down/);
  });
});
