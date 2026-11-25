// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Without a database that can hold the store, nothing is created, every call
 * answers a readable `SERVICE_UNAVAILABLE` naming the SQL to run by hand,
 * `healthCheck` answers `ok: false`, and boot goes on (card #37100). Runs
 * everywhere: the database is a double that answers like PostgreSQL without
 * the `vector` extension and without the right to create it.
 */

import { describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import type { KnowledgeSource } from '@objectstack/spec/ai';
import { KNOWLEDGE_SERVICE } from '@objectstack/spec/contracts';
import {
  KnowledgePgvectorPlugin,
  PgvectorKnowledgeAdapter,
  resolveStoreUrl,
  vectorTable,
  type PgPoolLike,
} from '../index.js';
import { FakeEmbedder } from './live-pg.testkit.js';

const source = { id: 's1', label: 's1', adapter: 'pgvector', source: { kind: 'object', object: 'a', contentFields: ['body'] } } as KnowledgeSource;

/** A database without pgvector, where this connection may not create it; `installed` flips that. */
function databaseWithoutVector() {
  const statements: string[] = [];
  let installed = false;
  const pool: PgPoolLike = {
    query: async <R>(text: string) => {
      statements.push(text);
      if (text.includes('FROM pg_extension')) {
        return { rows: (installed ? [{ schema: 'public', version: '0.8.0' }] : []) as R[] };
      }
      if (text.startsWith('CREATE EXTENSION')) {
        throw new Error('permission denied to create extension "vector"');
      }
      return { rows: [] as R[] };
    },
    connect: async () => {
      throw new Error('no transaction expected');
    },
  };
  return { pool, statements, install: () => { installed = true; } };
}

describe('knowledge-pgvector when the database is not ready', () => {
  it('refuses every call SERVICE_UNAVAILABLE with the SQL to run, creates nothing, and is ready once the SQL has run', async () => {
    const db = databaseWithoutVector();
    const adapter = new PgvectorKnowledgeAdapter({ pool: db.pool, embedder: new FakeEmbedder() });
    const ctx = { source, reason: 'manual' as const };

    const err = await adapter.upsert([{ id: 'd1', sourceId: 's1', content: 'x' }], ctx).then(
      () => undefined,
      (e: unknown) => e as { code?: string; status?: number; message: string },
    );
    expect(err).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(err?.message).toContain("'vector' extension (pgvector) is not installed");
    expect(err?.message).toContain('permission denied');
    expect(err?.message).toContain('CREATE EXTENSION IF NOT EXISTS vector;');
    expect(err?.message).toContain('CREATE SCHEMA IF NOT EXISTS "os_knowledge";');
    await expect(adapter.search('x', { source, topK: 3 })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await expect(adapter.listDocuments(ctx, { limit: 5 })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const health = await adapter.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.message).toContain('CREATE EXTENSION IF NOT EXISTS vector;');
    // Nothing past the extension was attempted.
    expect(db.statements.some((s) => s.startsWith('CREATE SCHEMA') || s.startsWith('CREATE TABLE'))).toBe(false);

    // An operator runs the SQL; the next call succeeds without a restart.
    db.install();
    expect((await adapter.healthCheck()).ok).toBe(true);
    expect(db.statements.some((s) => s.startsWith('CREATE SCHEMA IF NOT EXISTS "os_knowledge"'))).toBe(true);
  });

  it('with no database at all, every call says why', async () => {
    const adapter = new PgvectorKnowledgeAdapter({ embedder: new FakeEmbedder(), unavailable: 'the platform database (OS_DATABASE_URL) is not PostgreSQL.' });
    await expect(adapter.search('x', { source, topK: 3 })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: expect.stringContaining('OS_DATABASE_URL'),
    });
    expect((await adapter.healthCheck()).ok).toBe(false);
  });

  it('the plugin registers the adapter and boot goes on, warning with the SQL', async () => {
    const registered: string[] = [];
    const warn = vi.fn();
    const ctx = {
      getService: (name: string) => {
        if (name === KNOWLEDGE_SERVICE) return { registerAdapter: (id: string) => registered.push(id) };
        throw new Error(`no service ${name}`);
      },
      logger: { warn, info: vi.fn() },
    } as unknown as PluginContext;
    const plugin = new KnowledgePgvectorPlugin({ env: { OS_DATABASE_URL: 'file:./data/app.db' } });
    await expect(plugin.start(ctx)).resolves.toBeUndefined();
    expect(registered).toEqual(['pgvector']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not ready'));
    expect(warn.mock.calls[0][0]).toContain('is not PostgreSQL');
    await plugin.destroy();
  });

  it('an embedder that is not registered is a readable SERVICE_UNAVAILABLE, not a crash', async () => {
    const db = databaseWithoutVector();
    db.install();
    const adapter = new PgvectorKnowledgeAdapter({ pool: db.pool, embedder: () => undefined });
    expect(adapter.embedding).toBeUndefined();
    await expect(adapter.upsert([{ id: 'd1', sourceId: 's1', content: 'x' }], { source, reason: 'manual' })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: expect.stringContaining('no embedder'),
    });
  });
});

describe('knowledge-pgvector configuration', () => {
  it('reads the store URL from the option, else the platform database when it is PostgreSQL', () => {
    expect(resolveStoreUrl({ url: 'postgres://h/db', env: {} })).toEqual({ url: 'postgres://h/db', from: 'the plugin option `url`' });
    expect(resolveStoreUrl({ env: { OS_DATABASE_URL: 'postgresql://h/db' } })).toEqual({ url: 'postgresql://h/db', from: 'OS_DATABASE_URL' });
    expect(resolveStoreUrl({ env: { DATABASE_URL: 'postgres://h/legacy' } })).toEqual({ url: 'postgres://h/legacy', from: 'DATABASE_URL' });
    expect(resolveStoreUrl({ env: { OS_DATABASE_URL: 'mysql://h/db' } })).toMatchObject({ reason: expect.stringContaining('not PostgreSQL') });
    expect(resolveStoreUrl({ env: {} })).toMatchObject({ reason: expect.stringContaining('not set') });
    expect(resolveStoreUrl({ url: 'mysql://h/db', env: {} })).toMatchObject({ reason: expect.stringContaining('postgres://') });
  });

  it('holds the schema to a lower-case identifier and the width to a positive integer', () => {
    expect(() => new PgvectorKnowledgeAdapter({ embedder: new FakeEmbedder(), schema: 'Bad"Schema' })).toThrow(/lower-case identifier/);
    expect(vectorTable(3072)).toBe('knowledge_vec_d3072');
    expect(() => vectorTable(0)).toThrow(RangeError);
    expect(() => vectorTable(1.5)).toThrow(RangeError);
  });

  it('reports its embedder as the fingerprint reads it: model and dimensions', () => {
    const adapter = new PgvectorKnowledgeAdapter({ embedder: new FakeEmbedder(1536, 'text-embedding-3-small') });
    expect(adapter.embedding).toEqual({ dimensions: 1536, model: 'text-embedding-3-small' });
  });
});
