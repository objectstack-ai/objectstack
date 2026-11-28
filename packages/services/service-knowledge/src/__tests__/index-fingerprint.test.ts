// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The index fingerprint and the recipe hash (ADR-0161 K7, rule 6): computed
// over values, in a fixed order, the same on every machine. The two hex
// digests below are the pin: a change to what either hash covers or how it
// serializes turns this file red, and then bumps INDEX_FINGERPRINT_VERSION or
// RECIPE_HASH_VERSION in the same change — every stored index then reads as
// built under another hash, never as matching one it was not built under.

import { describe, expect, it } from 'vitest';
import type { KnowledgeSource } from '@objectstack/spec/ai';
import {
  ASSEMBLY_RULE_VERSION,
  INDEX_FINGERPRINT_VERSION,
  RECIPE_HASH_VERSION,
  computeIndexFingerprint,
  computeRecipeHash,
} from '../knowledge-index-fingerprint.js';
import { SPLIT_ALGORITHM_VERSION, resolveSplit } from '../split/index.js';

const source = (extra: Record<string, unknown> = {}): KnowledgeSource =>
  ({
    name: 'kb_articles',
    label: 'Articles',
    adapter: 'pgvector',
    source: { kind: 'object', object: 'article', content: ['title', 'body'], metadataFields: ['status'], ...extra },
  }) as KnowledgeSource;

const embedding = { model: 'text-embedding-3-large', dimensions: 3072, maxInputTokens: 8191 };
const split = resolveSplit({ split: { strategy: 'markdown', maxChars: 600 }, maxInputTokens: 8191 });

describe('index fingerprint (ADR-0161 K7)', () => {
  it('is pinned for a fixed input', () => {
    expect([INDEX_FINGERPRINT_VERSION, SPLIT_ALGORITHM_VERSION, ASSEMBLY_RULE_VERSION]).toEqual(['fp1', 1, 1]);
    expect(computeIndexFingerprint({ source: source(), embedding, split })).toBe(
      computeIndexFingerprint({ source: source(), embedding: { ...embedding }, split: { ...split } }),
    );
    expect(computeIndexFingerprint({ source: source(), embedding, split })).toMatchInlineSnapshot(`"fp1:1455ed0d278a0e58b26ccc2d423298c29d65162125032d76453847fbbc9b58ed"`);
  });

  it('changes with each of its five components', () => {
    const base = computeIndexFingerprint({ source: source(), embedding, split });
    const variants = [
      computeIndexFingerprint({ source: source(), embedding: { ...embedding, model: 'bge-m3' }, split }),
      computeIndexFingerprint({ source: source(), embedding: { ...embedding, variant: 'passage-prefix' }, split }),
      computeIndexFingerprint({ source: source(), embedding: { ...embedding, dimensions: 1024 }, split }),
      computeIndexFingerprint({ source: source(), embedding, split: { ...split, maxChars: 400 } }),
      computeIndexFingerprint({ source: source(), embedding, split: { ...split, strategy: 'recursive' } }),
      computeIndexFingerprint({ source: source(), embedding }),
      computeIndexFingerprint({ source: source({ content: ['body', 'title'] }), embedding, split }),
      computeIndexFingerprint({ source: source({ object: 'faq' }), embedding, split }),
    ];
    for (const v of variants) expect(v).not.toBe(base);
    expect(new Set(variants).size).toBe(variants.length);
  });

  it('does not change with what only the recipe hash reads, nor with the maxInputTokens report itself', () => {
    const base = computeIndexFingerprint({ source: source(), embedding, split });
    expect(computeIndexFingerprint({ source: source({ where: { status: 'published' }, metadataFields: [] }), embedding, split })).toBe(base);
    // The limit reaches the fingerprint through the resolved split only.
    expect(computeIndexFingerprint({ source: source(), embedding: { ...embedding, maxInputTokens: 1 }, split })).toBe(base);
  });
});

describe('recipe hash (ADR-0161 K7)', () => {
  const schema = {
    name: 'article',
    fields: {
      title: { type: 'text' },
      body: { type: 'textarea' },
      status: { type: 'select' },
      api_token: { type: 'password' },
      internal_note: { type: 'text', internal: true },
    },
  };

  it('is pinned for a fixed input', () => {
    expect(RECIPE_HASH_VERSION).toBe('rh1');
    expect(computeRecipeHash({ source: source({ where: { status: 'published' } }), schema })).toMatchInlineSnapshot(`"rh1:5def4262d86bc8f5a6e138e3139f369eb9c239f816ad974331cd195ddccf5326"`);
  });

  it('changes with where, metadataFields, the title field and the fields an index may not carry', () => {
    const base = computeRecipeHash({ source: source(), schema });
    expect(computeRecipeHash({ source: source({ where: { status: 'published' } }), schema })).not.toBe(base);
    expect(computeRecipeHash({ source: source({ metadataFields: [] }), schema })).not.toBe(base);
    expect(computeRecipeHash({ source: source(), schema: { ...schema, nameField: 'status' } })).not.toBe(base);
    const { internal_note: _dropped, ...rest } = schema.fields;
    expect(computeRecipeHash({ source: source(), schema: { ...schema, fields: { ...rest, internal_note: { type: 'text' } } } })).not.toBe(base);
  });

  it('does not change with the content list, which is the fingerprint\'s', () => {
    expect(computeRecipeHash({ source: source({ content: ['body'] }), schema })).toBe(computeRecipeHash({ source: source(), schema }));
  });
});
