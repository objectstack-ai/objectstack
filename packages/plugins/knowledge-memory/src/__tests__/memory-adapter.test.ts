// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { KnowledgeMemoryAdapter } from '../index';
import type { KnowledgeDocument } from '@objectstack/spec/ai';
import type { KnowledgeSource } from '@objectstack/spec/ai';

const source: KnowledgeSource = {
  id: 'src1',
  label: 'Test source',
  adapter: 'memory',
  source: { kind: 'http', urls: ['https://example.com'] } as KnowledgeSource['source'],
};

const docs: KnowledgeDocument[] = [
  {
    id: 'd1',
    sourceId: 'src1',
    content: 'The quick brown fox jumps over the lazy dog. Foxes are clever animals.',
    title: 'Fox facts',
    metadata: { topic: 'animals' },
  },
  {
    id: 'd2',
    sourceId: 'src1',
    content: 'Refunds require a receipt and must be processed within 30 days of purchase.',
    title: 'Refund policy',
    metadata: { topic: 'policy' },
  },
  {
    id: 'd3',
    sourceId: 'src1',
    content: 'Customer support is available 24/7 by email at help@example.com.',
    title: 'Support',
    metadata: { topic: 'policy' },
  },
];

describe('KnowledgeMemoryAdapter', () => {
  it('upsert + search returns the semantically closest doc on top', async () => {
    const a = new KnowledgeMemoryAdapter();
    await a.upsert(docs, { source });
    const hits = await a.search('how do refunds work', { source, topK: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].documentId).toBe('d2');
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('respects topK', async () => {
    const a = new KnowledgeMemoryAdapter();
    await a.upsert(docs, { source });
    const hits = await a.search('refund support fox', { source, topK: 1 });
    expect(hits.length).toBe(1);
  });

  it('returns empty array when no token overlap', async () => {
    const a = new KnowledgeMemoryAdapter();
    await a.upsert(docs, { source });
    const hits = await a.search('xyzzy plugh', { source, topK: 5 });
    expect(hits).toEqual([]);
  });

  it('filters by metadata', async () => {
    const a = new KnowledgeMemoryAdapter();
    await a.upsert(docs, { source });
    const hits = await a.search('fox', { source, topK: 5, filter: { topic: 'policy' } });
    expect(hits.find((h) => h.documentId === 'd1')).toBeUndefined();
  });

  it('delete removes a document', async () => {
    const a = new KnowledgeMemoryAdapter();
    await a.upsert(docs, { source });
    await a.delete(['d2'], { source });
    const hits = await a.search('refund', { source, topK: 5 });
    expect(hits.find((h) => h.documentId === 'd2')).toBeUndefined();
  });

  it('upsert replaces existing chunks for the same doc', async () => {
    const a = new KnowledgeMemoryAdapter();
    await a.upsert(docs, { source });
    await a.upsert(
      [{ id: 'd2', sourceId: 'src1', content: 'Pineapples are tropical fruit.', title: 'New' }],
      { source },
    );
    const hits = await a.search('refund', { source, topK: 5 });
    expect(hits.find((h) => h.documentId === 'd2')).toBeUndefined();
    const tropical = await a.search('pineapple tropical', { source, topK: 5 });
    expect(tropical[0]?.documentId).toBe('d2');
  });

  it("indexes the service's passages as given: one hit per passage, the service's chunk id, never re-split", async () => {
    const a = new KnowledgeMemoryAdapter();
    expect(a.capabilities.chunks).toBe(true);
    const long = 'lorem ipsum dolor sit amet '.repeat(200);
    const passages = ['alpha passage about lorem', long, 'gamma passage about lorem'];
    await a.upsert(
      [{
        id: 'long',
        sourceId: 'src1',
        content: passages.join('\n\n'),
        chunks: passages.map((content, index) => ({ id: `long#${index}`, documentId: 'long', index, content })),
      }],
      { source },
    );
    const hits = await a.search('lorem', { source, topK: 10 });
    expect(hits.map((h) => h.chunkId).sort()).toEqual(['long#0', 'long#1', 'long#2']);
    // The long passage comes back whole: the adapter does not cut what the service cut.
    expect(hits.find((h) => h.chunkId === 'long#1')?.snippet).toBe(long);
  });

  it('a document handed over without chunks is one passage of its whole text', async () => {
    const a = new KnowledgeMemoryAdapter();
    const long = 'lorem ipsum dolor sit amet '.repeat(200);
    await a.upsert([{ id: 'long', sourceId: 'src1', content: long }], { source });
    const hits = await a.search('lorem', { source, topK: 10 });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ chunkId: 'long#0', snippet: long });
  });

  it('a document with no passage is still listed with its docHash', async () => {
    const a = new KnowledgeMemoryAdapter();
    await a.upsert([{ id: 'empty', sourceId: 'src1', content: '', docHash: 'v1:x', chunks: [] }], { source });
    expect(await a.listDocuments({ source }, { limit: 10 })).toEqual({ documents: [{ documentId: 'empty', docHash: 'v1:x' }] });
    expect(await a.search('anything', { source, topK: 5 })).toEqual([]);
  });

  it('healthCheck returns ok', async () => {
    const a = new KnowledgeMemoryAdapter();
    const h = await a.healthCheck();
    expect(h.ok).toBe(true);
  });
});
