// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What the live PostgreSQL files of this package share: the URL, the named
 * failure when a runner that declared the dialect matrix has none, a pool,
 * a fresh schema per adapter, and a fixed fake embedder.
 *
 * Needs `OS_TEST_POSTGRES_URL` pointing at a PostgreSQL with the pgvector
 * extension available (CI: the `pgvector/pgvector` service image); without one
 * the files are a named skip, and `OS_EXPECT_LIVE_DIALECT_MATRIX=1` turns the
 * skip into a failure, as in the platform's other live files.
 */

import { createHash } from 'node:crypto';
import { describe, it } from 'vitest';
import pg from 'pg';
import type { IEmbedder } from '@objectstack/spec/contracts';
import { PgvectorKnowledgeAdapter, poolFromPg, type PgvectorKnowledgeAdapterOptions } from '../index.js';

export const PG_URL = process.env.OS_TEST_POSTGRES_URL;
const EXPECT_LIVE = process.env.OS_EXPECT_LIVE_DIALECT_MATRIX === '1';

/** Registers the failing case that stands in for a skipped live file on a provisioned runner. */
export function requireLiveCell(name: string): void {
  if (EXPECT_LIVE && !PG_URL) {
    describe(`${name} — live PostgreSQL`, () => {
      it('OS_TEST_POSTGRES_URL must be set on a runner that declared it provisioned', () => {
        throw new Error('OS_EXPECT_LIVE_DIALECT_MATRIX=1 without OS_TEST_POSTGRES_URL: the live cell would have been skipped.');
      });
    });
  }
}

/**
 * A fixed embedder for tests: each lower-cased word hashed into one of
 * `dimensions` slots, counted, and the vector scaled to unit length. Two texts
 * sharing words point the same way; texts sharing none are orthogonal. It
 * counts its calls and the texts it embedded.
 */
export class FakeEmbedder implements IEmbedder {
  readonly id = 'fake';
  readonly dimensions: number;
  model: string;
  calls = 0;
  texts: string[] = [];

  constructor(dimensions = 384, model = 'fake-bag-of-words') {
    this.dimensions = dimensions;
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    this.calls += 1;
    this.texts.push(...texts);
    return texts.map((t) => this.vector(t));
  }

  private vector(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    for (const word of text.toLowerCase().split(/[^a-z0-9一-鿿]+/i)) {
      if (word === '') continue;
      const slot = createHash('sha256').update(word).digest().readUInt32BE(0) % this.dimensions;
      v[slot] += 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return norm === 0 ? v : v.map((x) => x / norm);
  }
}

/**
 * One pool per file, and a fresh schema per adapter it makes; `dropAll` lets
 * go of every builder lock its adapters hold (each on a session of its own),
 * then drops every schema it made.
 */
export function liveStore(prefix: string) {
  let pool: pg.Pool | undefined;
  let n = 0;
  const schemas: string[] = [];
  const adapters: PgvectorKnowledgeAdapter[] = [];
  const run = `${process.pid}_${Date.now().toString(36)}`;
  return {
    pool(): pg.Pool {
      pool ??= new pg.Pool({ connectionString: PG_URL, max: 4 });
      return pool;
    },
    /** A fresh schema name, recorded for {@link dropAll}. */
    schema(): string {
      const name = `${prefix}_${run}_${++n}`.toLowerCase();
      schemas.push(name);
      return name;
    },
    adapter(opts: Partial<PgvectorKnowledgeAdapterOptions> & { embedder?: PgvectorKnowledgeAdapterOptions['embedder'] } = {}) {
      const adapter = new PgvectorKnowledgeAdapter({
        id: 'under_test',
        pool: poolFromPg(this.pool()),
        schema: this.schema(),
        embedder: new FakeEmbedder(),
        ...opts,
      });
      adapters.push(adapter);
      return adapter;
    },
    async dropAll(): Promise<void> {
      for (const adapter of adapters.splice(0)) await adapter.close();
      if (!pool) return;
      for (const schema of schemas) await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
      pool = undefined;
    },
  };
}
