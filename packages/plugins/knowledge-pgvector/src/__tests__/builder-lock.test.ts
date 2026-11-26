// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The builder lock's release, without a database: a session advisory lock
 * that its session no longer holds when the build lets go of it (a
 * transaction-mode pooler ran the lock and the unlock on different server
 * connections) is reported at `warn`, naming the connection the store needs.
 */

import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeSource } from '@objectstack/spec/ai';
import { PgvectorKnowledgeAdapter, type PgClientLike, type PgPoolLike } from '../index.js';
import { FakeEmbedder } from './live-pg.testkit.js';

const source = { id: 'locked', label: 'locked', adapter: 'pgvector', source: { kind: 'object', object: 'a', contentFields: ['b'] } } as KnowledgeSource;
const index = { fingerprint: 'fp', recipeHash: 'rh' };

/** A store that answers every statement the build's start and end run; the unlock answers `unlocked`. */
function fakePool(unlocked: boolean): PgPoolLike {
  const answer = async <R>(text: string): Promise<{ rows: R[] }> => {
    if (text.includes('FROM pg_extension')) return { rows: [{ schema: 'public', version: '0.8.0' }] as R[] };
    if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] as R[] };
    if (text.includes('pg_advisory_unlock')) return { rows: [{ unlocked }] as R[] };
    if (text.includes('RETURNING generation')) {
      return { rows: [{ generation: 1, fingerprint: 'fp', recipe_hash: null, dim: 384, state: 'active' }] as R[] };
    }
    if (text.includes('to_regclass')) return { rows: [{ present: 'x' }] as R[] };
    return { rows: [] as R[] };
  };
  const client = (): PgClientLike => ({ query: answer, release: () => undefined });
  return { query: answer, connect: async () => client(), connectSession: async () => client() };
}

describe('knowledge-pgvector builder lock release', () => {
  it('warns when the session no longer held the lock it releases', async () => {
    const warn = vi.fn();
    const adapter = new PgvectorKnowledgeAdapter({ pool: fakePool(false), embedder: new FakeEmbedder(), logger: { warn } });
    await adapter.beginBuild({ source, reason: 'reindex', index });
    await adapter.close();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('direct or session-mode PostgreSQL connection');
  });

  it('says nothing when the session held it', async () => {
    const warn = vi.fn();
    const adapter = new PgvectorKnowledgeAdapter({ pool: fakePool(true), embedder: new FakeEmbedder(), logger: { warn } });
    await adapter.beginBuild({ source, reason: 'reindex', index });
    await adapter.close();
    expect(warn).not.toHaveBeenCalled();
  });
});
