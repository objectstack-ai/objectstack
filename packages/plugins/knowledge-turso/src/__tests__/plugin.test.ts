// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The plugin: where the store's file is by default, the platform's own
 * database file refused, WAL and the busy timeout on the file it opens, and a
 * platform with no native libSQL build degrading to a store that says so,
 * never a failed boot.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import type { IKnowledgeAdapter, IKnowledgeService } from '@objectstack/spec/contracts';
import { EMBEDDER_SERVICE, KNOWLEDGE_SERVICE } from '@objectstack/spec/contracts';
import { KnowledgeTursoPlugin, defaultStoreUrl, resolveStoreUrl } from '../index.js';
import { FakeEmbedder } from './turso.testkit.js';

/** A plugin context with a knowledge service that records registrations, an embedder, and a logger that records. */
function contextOf(services: Record<string, unknown> = {}) {
  const adapters = new Map<string, IKnowledgeAdapter>();
  const logs: Array<['info' | 'warn', string]> = [];
  const svc = { registerAdapter: (id: string, a: IKnowledgeAdapter) => adapters.set(id, a) } as unknown as IKnowledgeService;
  // Read live: a case may register a service after start.
  const all = services;
  if (!(KNOWLEDGE_SERVICE in all)) all[KNOWLEDGE_SERVICE] = svc;
  if (!(EMBEDDER_SERVICE in all)) all[EMBEDDER_SERVICE] = new FakeEmbedder();
  const ctx = {
    getService: (name: string) => {
      if (!(name in all) || all[name] === undefined) throw new Error(`no service ${name}`);
      return all[name];
    },
    logger: {
      info: (m: string) => logs.push(['info', m]),
      warn: (m: string) => logs.push(['warn', m]),
      debug: () => undefined,
      error: () => undefined,
    },
  } as unknown as PluginContext;
  return { ctx, adapters, logs };
}

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-turso-plugin-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.doUnmock('@libsql/client');
  vi.resetModules();
});

describe('resolveStoreUrl', () => {
  it("defaults to knowledge.db under the project's .objectstack/data, beside the platform database", () => {
    expect(resolveStoreUrl({ projectRoot: '/srv/app', env: {} })).toEqual({
      url: 'file:/srv/app/.objectstack/data/knowledge.db',
      from: 'the default location',
    });
    expect(defaultStoreUrl('/srv/app')).toBe('file:/srv/app/.objectstack/data/knowledge.db');
  });

  it("refuses the platform's own database file, by name and by the platform's URL", () => {
    for (const url of ['file:/srv/app/.objectstack/data/objectstack.db', 'file:./.objectstack/data/dev.db']) {
      expect(resolveStoreUrl({ url, env: {} })).toMatchObject({ reason: expect.stringContaining("platform's own database file") });
    }
    expect(
      resolveStoreUrl({ url: 'file:/var/data/app.db', env: { OS_DATABASE_URL: 'sqlite:///var/data/app.db' } }),
    ).toMatchObject({ reason: expect.stringContaining("platform's own database file") });
    // Percent-encoded and differently cased spellings name the same file; a bare path is a platform URL too.
    for (const url of ['file:/srv/app/objectstack%2Edb', 'file:/srv/app/ObjectStack.db', 'file:/srv/app/%64ev.db']) {
      expect(resolveStoreUrl({ url, env: {} })).toMatchObject({ reason: expect.stringContaining("platform's own database file") });
    }
    expect(resolveStoreUrl({ url: 'file:/var/data/App.db', env: { OS_DATABASE_URL: '/var/data/app.db' } })).toMatchObject({
      reason: expect.stringContaining("platform's own database file"),
    });
    expect(resolveStoreUrl({ url: 'file:/var/data/%zz.db', env: {} })).toMatchObject({ reason: expect.stringContaining('not a valid file: URL') });
    expect(resolveStoreUrl({ url: 'file:/var/data/knowledge.db', env: { OS_DATABASE_URL: 'file:/var/data/app.db' } })).toEqual({
      url: 'file:/var/data/knowledge.db',
      from: 'the plugin option `url`',
    });
  });

  it('accepts :memory: and libsql:// URLs, refuses anything else', () => {
    expect(resolveStoreUrl({ url: ':memory:', env: {} })).toMatchObject({ url: ':memory:' });
    expect(resolveStoreUrl({ url: 'libsql://db.example.turso.io', env: {} })).toMatchObject({ url: 'libsql://db.example.turso.io' });
    expect(resolveStoreUrl({ url: 'postgres://x', env: {} })).toMatchObject({ reason: expect.any(String) });
  });
});

describe('KnowledgeTursoPlugin', () => {
  it('opens its own file under the project directory with WAL and a busy timeout, and registers a ready adapter', async () => {
    const root = tempDir();
    const { ctx, adapters, logs } = contextOf();
    const plugin = new KnowledgeTursoPlugin({ projectRoot: root, env: {} });
    await plugin.start(ctx);
    const adapter = adapters.get('turso')!;
    expect(adapter).toBeDefined();
    expect(await adapter.healthCheck!()).toMatchObject({ ok: true });
    expect(logs.filter(([level]) => level === 'warn')).toEqual([]);
    const { createClient } = await import('@libsql/client');
    const probe = createClient({ url: `file:${join(root, '.objectstack', 'data', 'knowledge.db')}` });
    expect((await probe.execute('PRAGMA journal_mode')).rows[0].journal_mode).toBe('wal');
    expect((await probe.execute("SELECT name FROM sqlite_master WHERE name = 'knowledge_generation'")).rows).toHaveLength(1);
    probe.close();
    await plugin.destroy();
    await plugin.destroy(); // a second call is a no-op
  });

  it("registers an adapter that answers SERVICE_UNAVAILABLE when given the platform's database file; boot goes on", async () => {
    const { ctx, adapters, logs } = contextOf();
    await new KnowledgeTursoPlugin({ url: `file:${join(tempDir(), 'objectstack.db')}`, env: {} }).start(ctx);
    const adapter = adapters.get('turso')!;
    expect(await adapter.healthCheck!()).toMatchObject({ ok: false });
    expect(logs.some(([level, m]) => level === 'warn' && m.includes("platform's own database file"))).toBe(true);
  });

  it('degrades to a store that says so when @libsql/client has no native build for the platform', async () => {
    vi.doMock('@libsql/client', () => {
      throw new Error("Cannot find module '@libsql/win32-arm64-msvc'");
    });
    vi.resetModules();
    const { KnowledgeTursoPlugin: Fresh } = await import('../plugin.js');
    const { ctx, adapters, logs } = contextOf();
    await new Fresh({ url: ':memory:', env: {} }).start(ctx);
    const adapter = adapters.get('turso')!;
    const err = await adapter
      .search('x', { source: { id: 's', label: 's', adapter: 'turso', source: { kind: 'object', object: 'o', contentFields: ['b'] } } as never, topK: 1 })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(logs.some(([level, m]) => level === 'warn' && m.includes('@libsql/client could not be loaded'))).toBe(true);
  });

  it('reads the kernel embedder at each call, so one registered after start is used', async () => {
    const services: Record<string, unknown> = { [EMBEDDER_SERVICE]: undefined };
    const { ctx, adapters } = contextOf(services);
    await new KnowledgeTursoPlugin({ url: ':memory:', env: {} }).start(ctx);
    const adapter = adapters.get('turso')!;
    expect(adapter.embedding).toBeUndefined();
    services[EMBEDDER_SERVICE] = new FakeEmbedder(32, 'late-model');
    expect(adapter.embedding).toEqual({ dimensions: 32, model: 'late-model' });
  });
});
