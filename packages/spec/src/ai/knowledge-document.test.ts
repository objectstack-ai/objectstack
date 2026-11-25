// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { KnowledgeChunkSchema, KnowledgeDocumentSchema, type KnowledgeChunk } from './knowledge-document.zod';

const chunk = { id: 'kb:r1#0', documentId: 'kb:r1', index: 0, content: 'passage text' };

describe('KnowledgeChunk.metadata — retired (ADR-0049; ADR-0161 K8 item 5)', () => {
  it('authoring it is refused at parse with the prescription', () => {
    expect(() => KnowledgeChunkSchema.parse({ ...chunk, metadata: { status: 'published' } }))
      .toThrow(/`KnowledgeChunk\.metadata` was removed.*Delete the key.*KnowledgeDocument\.metadata/s);
    expect(() => KnowledgeDocumentSchema.parse({
      id: 'kb:r1', sourceId: 'kb', content: 'passage text', chunks: [{ ...chunk, metadata: {} }],
    })).toThrow(/`KnowledgeChunk\.metadata` was removed/);
  });

  it('a chunk without it parses, and carries no metadata', () => {
    const parsed = KnowledgeChunkSchema.parse({ ...chunk, headingPath: ['Policy', 'Travel'] });
    expect(parsed).not.toHaveProperty('metadata');
    expect(parsed).toEqual({ ...chunk, headingPath: ['Policy', 'Travel'] });
  });

  it('authoring it is a type error', () => {
    // @ts-expect-error — the retired key's input type is `never`.
    const literal: KnowledgeChunk = { ...chunk, metadata: { status: 'published' } };
    expect(literal.id).toBe('kb:r1#0');
  });
});
