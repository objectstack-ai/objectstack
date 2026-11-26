// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The plugin: where the store's file is by default, the platform's own
 * database file refused, WAL and the busy timeout on the file it opens, and a
 * platform with no native libSQL build degrading to a store that says so,
 * never a failed boot.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import type { IKnowledgeAdapter, IKnowledgeService } from '@objectstack/spec/contracts';
import { EMBEDDER_SERVICE, KNOWLEDGE_SERVICE } from '@objectstack/spec/contracts';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  KnowledgeTursoPlugin,
  dataDirectoryOf,
  defaultStoreUrl,
  requestBoundFor,
  resolveSettingsStoreUrl,
  resolveStoreUrl,
} from '../index.js';
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
    // SQLite's side files belong to their database.
    for (const url of ['file:/srv/app/objectstack.db-wal', 'file:/srv/app/dev.db-shm', 'file:/var/data/app.db-journal']) {
      expect(resolveStoreUrl({ url, env: { OS_DATABASE_URL: '/var/data/app.db' } })).toMatchObject({
        reason: expect.stringContaining("platform's own database file"),
      });
    }
    expect(resolveStoreUrl({ url: 'file:/var/data/knowledge.db', env: { OS_DATABASE_URL: 'file:/var/data/app.db' } })).toEqual({
      url: 'file:/var/data/knowledge.db',
      from: 'the plugin option `url`',
    });
  });

  it("refuses a link to the platform's file: the file it resolves to is compared", () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-turso-link-'));
    try {
      writeFileSync(join(dir, 'app.db'), '');
      symlinkSync(join(dir, 'app.db'), join(dir, 'knowledge.db'));
      symlinkSync(dir, join(dir, 'alias'));
      const env = { OS_DATABASE_URL: `file:${join(dir, 'app.db')}` };
      expect(resolveStoreUrl({ url: `file:${join(dir, 'knowledge.db')}`, env })).toMatchObject({ reason: expect.stringContaining("platform's own database file") });
      expect(resolveStoreUrl({ url: `file:${join(dir, 'alias', 'app.db')}`, env })).toMatchObject({ reason: expect.stringContaining("platform's own database file") });
      expect(resolveStoreUrl({ url: `file:${join(dir, 'alias', 'other.db')}`, env })).toMatchObject({ url: `file:${join(dir, 'alias', 'other.db')}` });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('bounds requests by default on a remote URL only', () => {
    expect(requestBoundFor('libsql://db.example.turso.io')).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(requestBoundFor('https://db.example.turso.io')).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(requestBoundFor('file:/srv/app/.objectstack/data/knowledge.db')).toBeUndefined();
    expect(requestBoundFor(':memory:')).toBeUndefined();
    expect(requestBoundFor('file:/srv/k.db', 250)).toBe(250);
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

/**
 * A store URL read from the `knowledge.turso_url` setting: written by an
 * operator through the settings page, so held to the project's data directory,
 * and refused when it carries a NUL byte before it reaches the libSQL client
 * (whose native library ends the process on one).
 */
describe('resolveSettingsStoreUrl', () => {
  const NUL = String.fromCharCode(0);

  it('refuses a NUL byte or another control character, in a setting and in the plugin option alike', () => {
    const root = tempDir();
    const inside = `file:${join(dataDirectoryOf(root), 'k.db')}`;
    for (const url of [`${inside}${NUL}`, `file:${dataDirectoryOf(root)}/k${NUL}.db`, `file:${dataDirectoryOf(root)}/k\t.db`, `libsql://db${NUL}.turso.io`, `:memory:${NUL}`]) {
      expect(resolveSettingsStoreUrl(url, { projectRoot: root, env: {} })).toMatchObject({
        reason: expect.stringContaining('NUL byte'),
      });
      expect(resolveStoreUrl({ url, projectRoot: root, env: {} })).toMatchObject({ reason: expect.stringContaining('NUL byte') });
    }
  });

  it('takes a file inside the data directory, and :memory: or a remote URL as they are', () => {
    const root = tempDir();
    const file = join(dataDirectoryOf(root), 'search', 'k.db');
    expect(resolveSettingsStoreUrl(`file:${file}`, { projectRoot: root, env: {} })).toEqual({
      url: `file:${file}`,
      from: 'the knowledge setting `turso_url`',
    });
    expect(resolveSettingsStoreUrl(':memory:', { projectRoot: root, env: {} })).toMatchObject({ url: ':memory:' });
    expect(resolveSettingsStoreUrl('libsql://db.example.turso.io', { projectRoot: root, env: {} })).toMatchObject({
      url: 'libsql://db.example.turso.io',
    });
  });

  it('refuses a file outside the data directory: elsewhere, by .., by a link, or the directory itself', () => {
    const root = tempDir();
    const data = dataDirectoryOf(root);
    mkdirSync(data, { recursive: true });
    const outside = tempDir();
    symlinkSync(outside, join(data, 'escape'));
    for (const url of [
      `file:${join(outside, 'k.db')}`,
      `file:${data}/../k.db`,
      `file:${join(root, '.objectstack', 'knowledge.db')}`,
      `file:${join(data, 'escape', 'k.db')}`,
      `file:${data}`,
    ]) {
      expect(resolveSettingsStoreUrl(url, { projectRoot: root, env: {} })).toMatchObject({
        reason: expect.stringContaining('outside the data directory'),
      });
    }
  });

  it("still refuses the platform's own database file inside the data directory", () => {
    const root = tempDir();
    expect(
      resolveSettingsStoreUrl(`file:${join(dataDirectoryOf(root), 'objectstack.db')}`, { projectRoot: root, env: {} }),
    ).toMatchObject({ reason: expect.stringContaining("platform's own database file") });
  });
});

/** A settings service answering saved `knowledge` values, as `SettingsService.get` resolves them. */
function settingsOf(saved: Record<string, string | undefined>, failure?: Error) {
  return {
    get: async (namespace: string, key: string) => {
      if (failure) throw failure;
      if (namespace !== 'knowledge') throw Object.assign(new Error('unknown'), { code: 'SETTINGS_UNKNOWN_NAMESPACE' });
      const value = saved[key];
      return value === undefined ? { value: undefined, source: 'default' } : { value, source: 'global' };
    },
  };
}

describe('KnowledgeTursoPlugin — the store URL from settings (urlFromSettings)', () => {
  it('opens the file a saved setting names inside the data directory', async () => {
    const root = tempDir();
    const file = join(dataDirectoryOf(root), 'saved.db');
    const { ctx, adapters } = contextOf({ settings: settingsOf({ turso_url: `file:${file}` }) });
    const plugin = new KnowledgeTursoPlugin({ projectRoot: root, env: {}, urlFromSettings: true });
    await plugin.start(ctx);
    expect(await adapters.get('turso')!.healthCheck!()).toMatchObject({ ok: true });
    expect(existsSync(file)).toBe(true);
    expect(existsSync(join(dataDirectoryOf(root), 'knowledge.db'))).toBe(false);
    await plugin.destroy();
  });

  it('nothing saved, no knowledge namespace or no settings service: the default file', async () => {
    for (const services of [{ settings: settingsOf({}) }, { settings: { get: async () => { throw Object.assign(new Error('x'), { code: 'SETTINGS_UNKNOWN_NAMESPACE' }); } } }, {}]) {
      const root = tempDir();
      const { ctx, adapters } = contextOf(services);
      const plugin = new KnowledgeTursoPlugin({ projectRoot: root, env: {}, urlFromSettings: true });
      await plugin.start(ctx);
      expect(await adapters.get('turso')!.healthCheck!()).toMatchObject({ ok: true });
      expect(existsSync(join(dataDirectoryOf(root), 'knowledge.db'))).toBe(true);
      await plugin.destroy();
    }
  });

  it('a saved URL with a NUL byte, or outside the data directory, never reaches the libSQL client', async () => {
    const createClient = vi.fn();
    vi.doMock('@libsql/client', () => ({ createClient }));
    vi.resetModules();
    const { KnowledgeTursoPlugin: Fresh } = await import('../plugin.js');
    const root = tempDir();
    for (const [url, reason] of [
      [`file:${join(dataDirectoryOf(root), 'k.db')}${String.fromCharCode(0)}x`, 'NUL byte'],
      [`file:${join(tempDir(), 'k.db')}`, 'outside the data directory'],
    ] as const) {
      const { ctx, adapters, logs } = contextOf({ settings: settingsOf({ turso_url: url }) });
      await new Fresh({ projectRoot: root, env: {}, urlFromSettings: true }).start(ctx);
      expect(await adapters.get('turso')!.healthCheck!()).toMatchObject({ ok: false });
      expect(logs.some(([level, m]) => level === 'warn' && m.includes(reason))).toBe(true);
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it('a settings read that fails opens nothing: the store says why', async () => {
    const root = tempDir();
    const { ctx, adapters, logs } = contextOf({ settings: settingsOf({}, new Error('database is locked')) });
    await new KnowledgeTursoPlugin({ projectRoot: root, env: {}, urlFromSettings: true }).start(ctx);
    expect(await adapters.get('turso')!.healthCheck!()).toMatchObject({ ok: false });
    expect(logs.some(([level, m]) => level === 'warn' && m.includes('database is locked'))).toBe(true);
    expect(existsSync(join(dataDirectoryOf(root), 'knowledge.db'))).toBe(false);
  });

  it('the plugin option `url` wins, and without urlFromSettings the settings are not read', async () => {
    const root = tempDir();
    const read = vi.fn(async () => ({ value: `file:${join(dataDirectoryOf(root), 'saved.db')}`, source: 'global' }));
    const { ctx, adapters } = contextOf({ settings: { get: read } });
    await new KnowledgeTursoPlugin({ url: ':memory:', env: {}, urlFromSettings: true, projectRoot: root }).start(ctx);
    await new KnowledgeTursoPlugin({ projectRoot: root, env: {} }).start(ctx);
    expect(read).not.toHaveBeenCalled();
    expect(adapters.get('turso')).toBeDefined();
  });
});
