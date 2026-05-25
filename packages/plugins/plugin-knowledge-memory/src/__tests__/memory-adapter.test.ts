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

  it('chunks long documents (snippet bounded)', async () => {
    const a = new KnowledgeMemoryAdapter();
    const long = 'lorem ipsum dolor sit amet '.repeat(200);
    await a.upsert([{ id: 'long', sourceId: 'src1', content: long }], { source });
    const hits = await a.search('lorem', { source, topK: 10 });
    expect(hits.length).toBeGreaterThan(1);
    for (const h of hits) expect(h.snippet.length).toBeLessThanOrEqual(900);
  });

  it('healthCheck returns ok', async () => {
    const a = new KnowledgeMemoryAdapter();
    const h = await a.healthCheck();
    expect(h.ok).toBe(true);
  });
});
