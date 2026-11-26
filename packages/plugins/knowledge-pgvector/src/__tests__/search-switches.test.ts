// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A search whose source's index is switched under it on every attempt,
 * without a database: after three attempts it is refused with the ADR-0112
 * code `CONCURRENT_MODIFICATION` (409), so a caller can tell it from a fault
 * and retry.
 */

import { describe, expect, it } from 'vitest';
import type { KnowledgeSource } from '@objectstack/spec/ai';
import { PgvectorKnowledgeAdapter, type PgClientLike, type PgPoolLike } from '../index.js';
import { FakeEmbedder } from './live-pg.testkit.js';

const source = { id: 'switching', label: 'switching', adapter: 'pgvector', source: { kind: 'object', object: 'a', contentFields: ['b'] } } as KnowledgeSource;

/** A store whose active generation is a new one at every read of the generations, and whose ranking finds nothing. */
function switchingPool(): { pool: PgPoolLike; rankings: () => number } {
  let generation = 0;
  let rankings = 0;
  const answer = async <R>(text: string): Promise<{ rows: R[] }> => {
    if (text.includes('FROM pg_extension')) return { rows: [{ schema: 'public', version: '0.8.0' }] as R[] };
    if (text.includes('to_regclass')) return { rows: [{ present: 'x' }] as R[] };
    if (/SELECT generation, fingerprint, recipe_hash, dim, state FROM/.test(text)) {
      generation += 1;
      return { rows: [{ generation, fingerprint: 'fp', recipe_hash: 'rh', dim: 384, state: 'active' }] as R[] };
    }
    if (text.includes('AS distance')) {
      rankings += 1;
      return { rows: [] as R[] };
    }
    return { rows: [] as R[] };
  };
  const client = (): PgClientLike => ({ query: answer, release: () => undefined });
  return { pool: { query: answer, connect: async () => client() }, rankings: () => rankings };
}

describe('knowledge-pgvector search under repeated switches', () => {
  it('is refused CONCURRENT_MODIFICATION (409) after three attempts', async () => {
    const store = switchingPool();
    const adapter = new PgvectorKnowledgeAdapter({ pool: store.pool, embedder: new FakeEmbedder() });

    const refusal = await adapter
      .search('granite', { source, topK: 5, index: { fingerprint: 'fp', recipeHash: 'rh' } })
      .then(
        () => undefined,
        (err: unknown) => err,
      );

    expect(refusal).toMatchObject({ code: 'CONCURRENT_MODIFICATION', status: 409 });
    expect(String((refusal as Error).message)).toContain("Knowledge source 'switching'");
    expect(store.rankings()).toBe(3);
  });
});
