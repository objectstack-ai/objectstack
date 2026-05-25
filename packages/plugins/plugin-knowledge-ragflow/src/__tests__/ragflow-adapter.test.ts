// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { KnowledgeRagflowAdapter, type FetchLike } from '../index';
import type { KnowledgeSource, KnowledgeDocument } from '@objectstack/spec/ai';

const source: KnowledgeSource = {
  id: 'docs',
  label: 'Docs',
  adapter: 'ragflow',
  source: { kind: 'http', urls: ['https://docs.example.com'] } as KnowledgeSource['source'],
  options: { datasetId: 'ds_42' },
};

function fakeFetch(handler: (url: string, init?: any) => unknown): { fetch: FetchLike; calls: Array<{ url: string; init: any }> } {
  const calls: Array<{ url: string; init: any }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const out = await Promise.resolve(handler(url, init));
    const body = typeof out === 'string' ? out : JSON.stringify(out ?? {});
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => body,
      json: async () => JSON.parse(body),
    };
  };
  return { fetch, calls };
}

describe('KnowledgeRagflowAdapter', () => {
  it('rejects sources without datasetId', async () => {
    const { fetch } = fakeFetch(() => ({}));
    const a = new KnowledgeRagflowAdapter({ endpoint: 'http://x', apiKey: 'k', fetch });
    const bad: KnowledgeSource = { ...source, options: {} as Record<string, unknown> };
    await expect(a.search('q', { source: bad, topK: 1 })).rejects.toThrow(/datasetId/);
  });

  it('upsert deletes-then-creates chunks and stamps objectstack metadata', async () => {
    const { fetch, calls } = fakeFetch((url) => {
      if (url.includes('/api/v1/retrieval')) return { code: 0, data: { chunks: [] } };
      return { code: 0, data: {} };
    });
    const a = new KnowledgeRagflowAdapter({ endpoint: 'http://r', apiKey: 'k', fetch });
    const doc: KnowledgeDocument = {
      id: 'd1',
      sourceId: 'docs',
      sourceRecordId: 'rec_1',
      content: 'hello world',
      title: 'Greeting',
      metadata: { topic: 'intro' },
    };
    await a.upsert([doc], { source });
    // First call: lookup existing chunks; second: create chunk
    const createCall = calls.find((c) => c.url.endsWith('/api/v1/datasets/ds_42/chunks') && c.init.method === 'POST');
    expect(createCall).toBeDefined();
    const body = JSON.parse(createCall!.init.body);
    expect(body.content).toBe('hello world');
    expect(body.metadata.objectstack_doc_id).toBe('d1');
    expect(body.metadata.objectstack_record_id).toBe('rec_1');
    expect(body.metadata.objectstack_source_id).toBe('docs');
    expect(body.metadata.topic).toBe('intro');
  });

  it('search maps ragflow chunks to KnowledgeHit shape', async () => {
    const { fetch, calls } = fakeFetch(() => ({
      code: 0,
      data: {
        chunks: [
          {
            id: 'c1',
            content: 'snippet one',
            similarity: 0.91,
            metadata: { objectstack_doc_id: 'd1', objectstack_record_id: 'rec_1', title: 'T1' },
          },
          {
            id: 'c2',
            content: 'snippet two',
            similarity: 0.7,
            metadata: { objectstack_doc_id: 'd2' },
          },
        ],
      },
    }));
    const a = new KnowledgeRagflowAdapter({ endpoint: 'http://r', apiKey: 'k', fetch });
    const hits = await a.search('hello', { source, topK: 5 });
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({
      chunkId: 'c1',
      documentId: 'd1',
      sourceId: 'docs',
      sourceRecordId: 'rec_1',
      score: 0.91,
      snippet: 'snippet one',
      title: 'T1',
    });
    expect(hits[1].sourceRecordId).toBeUndefined();
    // Authorization header present
    const last = calls.at(-1)!;
    expect(last.init.headers.authorization).toBe('Bearer k');
  });

  it('search honours rerankModel + similarityThreshold + filter', async () => {
    const { fetch, calls } = fakeFetch(() => ({ code: 0, data: { chunks: [] } }));
    const a = new KnowledgeRagflowAdapter({ endpoint: 'http://r', apiKey: 'k', fetch });
    const s: KnowledgeSource = {
      ...source,
      options: { datasetId: 'ds_42', rerankModel: 'bge-reranker', similarityThreshold: 0.6 },
    };
    await a.search('q', { source: s, topK: 3, filter: { tag: 'a' } });
    const body = JSON.parse(calls[0].init.body);
    expect(body.rerank_id).toBe('bge-reranker');
    expect(body.similarity_threshold).toBe(0.6);
    expect(body.metadata_condition).toEqual({ tag: 'a' });
    expect(body.top_k).toBe(3);
  });

  it('delete looks up chunks then issues DELETE with chunk_ids', async () => {
    const { fetch, calls } = fakeFetch((url) => {
      if (url.includes('/api/v1/retrieval')) {
        return { code: 0, data: { chunks: [{ id: 'c1' }, { id: 'c2' }] } };
      }
      return { code: 0, data: {} };
    });
    const a = new KnowledgeRagflowAdapter({ endpoint: 'http://r', apiKey: 'k', fetch });
    await a.delete(['d1'], { source });
    const del = calls.find((c) => c.init.method === 'DELETE');
    expect(del).toBeDefined();
    expect(JSON.parse(del!.init.body)).toEqual({ chunk_ids: ['c1', 'c2'] });
  });

  it('healthCheck pings dataset list', async () => {
    const { fetch } = fakeFetch(() => ({ code: 0, data: { datasets: [] } }));
    const a = new KnowledgeRagflowAdapter({ endpoint: 'http://r', apiKey: 'k', fetch });
    const h = await a.healthCheck();
    expect(h.ok).toBe(true);
  });

  it('healthCheck reports failure when request throws', async () => {
    const fetch: FetchLike = async () => {
      throw new Error('boom');
    };
    const a = new KnowledgeRagflowAdapter({ endpoint: 'http://r', apiKey: 'k', fetch });
    const h = await a.healthCheck();
    expect(h.ok).toBe(false);
    expect(h.message).toMatch(/boom/);
  });

  it('throws on non-zero RAGFlow error code', async () => {
    const { fetch } = fakeFetch(() => ({ code: 102, message: 'bad request' }));
    const a = new KnowledgeRagflowAdapter({ endpoint: 'http://r', apiKey: 'k', fetch });
    await expect(a.search('q', { source, topK: 1 })).rejects.toThrow(/bad request/);
  });

  it('constructor validates endpoint and apiKey', () => {
    expect(() => new KnowledgeRagflowAdapter({ endpoint: '', apiKey: 'k', fetch: (async () => ({}) as any) })).toThrow(/endpoint/);
    expect(() => new KnowledgeRagflowAdapter({ endpoint: 'http://x', apiKey: '', fetch: (async () => ({}) as any) })).toThrow(/apiKey/);
  });
});
