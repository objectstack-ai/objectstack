// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The plugin: where the store's file is by default, the platform's own
 * database file refused, WAL and the busy timeout on the file it opens, and a
 * platform with no native libSQL build degrading to a store that says so,
 * never a failed boot.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
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
  const hooks = new Map<string, Array<() => unknown>>();
  /** Fire a hook as the kernel does: its handlers in registration order, each awaited. */
  const fire = async (name: string): Promise<void> => {
    for (const handler of hooks.get(name) ?? []) await handler();
  };
  const ctx = {
    getService: (name: string) => {
      if (!(name in all) || all[name] === undefined) throw new Error(`no service ${name}`);
      return all[name];
    },
    hook: (name: string, handler: () => unknown) => {
      hooks.set(name, [...(hooks.get(name) ?? []), handler]);
    },
    logger: {
      info: (m: string) => logs.push(['info', m]),
      warn: (m: string) => logs.push(['warn', m]),
      debug: () => undefined,
      error: () => undefined,
    },
  } as unknown as PluginContext;
  return { ctx, adapters, logs, fire };
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

  it('a state directory (OS_HOME, os start --home) moves the data directory with the platform database', () => {
    expect(dataDirectoryOf('/srv/app', '/var/lib/os')).toBe('/var/lib/os/data');
    expect(dataDirectoryOf('/srv/app', '~/os-home')).toBe(join(homedir(), 'os-home', 'data'));
    expect(dataDirectoryOf('/srv/app', '  ')).toBe('/srv/app/.objectstack/data');
    expect(resolveStoreUrl({ projectRoot: '/srv/app', stateDir: '/var/lib/os', env: {} })).toEqual({
      url: 'file:/var/lib/os/data/knowledge.db',
      from: 'the default location',
    });
    // A settings URL is held to that directory, and the app's own is outside it.
    const home = tempDir();
    const app = tempDir();
    expect(resolveSettingsStoreUrl(`file:${join(home, 'data', 'saved.db')}`, { projectRoot: app, stateDir: home, env: {} })).toMatchObject({
      url: `file:${join(home, 'data', 'saved.db')}`,
    });
    expect(
      resolveSettingsStoreUrl(`file:${join(dataDirectoryOf(app), 'saved.db')}`, { projectRoot: app, stateDir: home, env: {} }),
    ).toMatchObject({ reason: expect.stringContaining('outside the data directory') });
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
      .search('x', { source: { name: 's', label: 's', adapter: 'turso', source: { kind: 'object', object: 'o', content: ['b'] } } as never, topK: 1 })
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

  it('hands vectorIndexThreshold to its adapter: a complete build at the threshold makes the approximate index', async () => {
    const root = tempDir();
    const { ctx, adapters } = contextOf();
    const plugin = new KnowledgeTursoPlugin({ projectRoot: root, env: {}, vectorIndexThreshold: 3, vectorIndexOverfetch: 10 });
    await plugin.start(ctx);
    const adapter = adapters.get('turso')!;
    const source = { name: 'notes', label: 'n', adapter: 'turso', source: { kind: 'object', object: 'o', content: ['b'] } } as never;
    const build = { source, reason: 'manual', index: { fingerprint: 'fp:1', recipeHash: 'rh:1' } } as never;
    await adapter.beginBuild!(build);
    await adapter.upsert(['oak table', 'pine chair', 'elm desk'].map((content, i) => ({ id: `d${i}`, sourceId: 'notes', content })), build);
    await adapter.completeBuild!(build);
    const { createClient } = await import('@libsql/client');
    const probe = createClient({ url: `file:${join(root, '.objectstack', 'data', 'knowledge.db')}` });
    expect((await probe.execute("SELECT name FROM sqlite_master WHERE name = 'knowledge_notes_g1-vec'")).rows).toHaveLength(1);
    probe.close();
    await plugin.destroy();
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

  it('refuses a percent-encoded control character too: libSQL decodes the path it opens', () => {
    const root = tempDir();
    const data = dataDirectoryOf(root);
    for (const url of [
      `file:${data}/k%00.db`,
      `file:${data}/k%0a.db`,
      `file:${data}/k%0A.db`,
      `file:${data}/k.db%7f`,
      `file://${data}/k%00.db`,
      'libsql://db.turso.io/%00',
    ]) {
      expect(resolveSettingsStoreUrl(url, { projectRoot: root, env: {} })).toMatchObject({
        reason: expect.stringContaining('percent-encoded'),
      });
      expect(resolveStoreUrl({ url, projectRoot: root, env: {} })).toMatchObject({ reason: expect.stringContaining('percent-encoded') });
    }
    // The control: an escape that decodes to an ordinary character names a file, and one
    // encoded twice is the text `%00`, which libSQL decodes once and opens as a name.
    for (const name of ['k%20v.db', 'k%2500.db']) {
      expect(resolveSettingsStoreUrl(`file:${data}/${name}`, { projectRoot: root, env: {} })).toMatchObject({ url: `file:${data}/${name}` });
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

/**
 * A settings service answering saved `knowledge` values as `SettingsService.get`
 * resolves them — and, as the real one does, only once its data engine is
 * bound: until `bound` is set a saved value reads as the manifest default.
 * It serves a `knowledge` page the plugin's init() contributes the Turso group
 * to, as the knowledge service's page is on a real boot.
 */
function settingsOf(saved: Record<string, string | undefined>, failure?: Error) {
  let page = { namespace: 'knowledge', specifiers: [] as Array<{ key?: string; id?: string }> };
  const settings = {
    bound: false,
    reads: 0,
    getManifest: () => page,
    registerManifest: (m: typeof page) => { page = m; },
    registerAction: () => undefined,
    get: async (namespace: string, key: string) => {
      settings.reads += 1;
      if (failure) throw failure;
      if (namespace !== 'knowledge') throw Object.assign(new Error('unknown'), { code: 'SETTINGS_UNKNOWN_NAMESPACE' });
      const value = settings.bound ? saved[key] : undefined;
      return value === undefined ? { value: undefined, source: 'default' } : { value, source: 'global' };
    },
  };
  return settings;
}

/**
 * A boot as the kernel runs one: init(), start(), then the settings service's
 * own `kernel:ready` bind, then `kernel:bootstrapped`.
 */
async function boot(
  plugin: { init(ctx: PluginContext): Promise<void>; start(ctx: PluginContext): Promise<void> },
  { ctx, fire }: { ctx: PluginContext; fire: (name: string) => Promise<void> },
  settings?: { bound: boolean },
): Promise<void> {
  await plugin.init(ctx);
  await plugin.start(ctx);
  if (settings) settings.bound = true;
  await fire('kernel:bootstrapped');
}

describe('KnowledgeTursoPlugin — the store URL from settings (urlFromSettings)', () => {
  it('opens the file a saved setting names inside the data directory', async () => {
    const root = tempDir();
    const file = join(dataDirectoryOf(root), 'saved.db');
    const settings = settingsOf({ turso_url: `file:${file}` });
    const host = contextOf({ settings });
    const plugin = new KnowledgeTursoPlugin({ projectRoot: root, env: {}, urlFromSettings: true });
    await boot(plugin, host, settings);
    expect(await host.adapters.get('turso')!.healthCheck!()).toMatchObject({ ok: true });
    expect(existsSync(file)).toBe(true);
    expect(existsSync(join(dataDirectoryOf(root), 'knowledge.db'))).toBe(false);
    await plugin.destroy();
  });

  it('reads the settings at kernel:bootstrapped, never in init() or start(): mounted from start(), open once the boot completes', async () => {
    const root = tempDir();
    const file = join(dataDirectoryOf(root), 'saved.db');
    const settings = settingsOf({ turso_url: `file:${file}` });
    const { ctx, adapters, logs, fire } = contextOf({ settings });
    const plugin = new KnowledgeTursoPlugin({ projectRoot: root, env: {}, urlFromSettings: true });
    await plugin.init(ctx);
    await plugin.start(ctx);
    // The settings service has not bound its data engine yet: nothing is read,
    // nothing is opened, and the adapter is mounted and says it is not ready.
    expect(settings.reads).toBe(0);
    expect(existsSync(dataDirectoryOf(root))).toBe(false);
    const pending = adapters.get('turso')!;
    expect(pending).toBeDefined();
    const err = await pending
      .search('x', { source: { name: 's', label: 's', adapter: 'turso', source: { kind: 'object', object: 'o', content: ['b'] } } as never, topK: 1 })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(logs).toEqual([]);

    settings.bound = true;
    await fire('kernel:bootstrapped');
    expect(settings.reads).toBeGreaterThan(0);
    expect(await adapters.get('turso')!.healthCheck!()).toMatchObject({ ok: true });
    expect(existsSync(file)).toBe(true);
    expect(existsSync(join(dataDirectoryOf(root), 'knowledge.db'))).toBe(false);
    expect(logs.filter(([level]) => level === 'warn')).toEqual([]);
    await plugin.destroy();
  });

  it('nothing saved, no knowledge namespace or no settings service: the default file', async () => {
    const unknown = { bound: false, get: async () => { throw Object.assign(new Error('x'), { code: 'SETTINGS_UNKNOWN_NAMESPACE' }); } };
    for (const settings of [settingsOf({}), unknown, undefined]) {
      const root = tempDir();
      const host = contextOf(settings === undefined ? {} : { settings });
      const plugin = new KnowledgeTursoPlugin({ projectRoot: root, env: {}, urlFromSettings: true });
      await boot(plugin, host, settings);
      expect(await host.adapters.get('turso')!.healthCheck!()).toMatchObject({ ok: true });
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
      [`file:${join(dataDirectoryOf(root), 'k%00.db')}`, 'percent-encoded'],
      [`file:${join(dataDirectoryOf(root), 'k%0a.db')}`, 'percent-encoded'],
      [`file:${join(tempDir(), 'k.db')}`, 'outside the data directory'],
    ] as const) {
      const settings = settingsOf({ turso_url: url });
      const host = contextOf({ settings });
      await boot(new Fresh({ projectRoot: root, env: {}, urlFromSettings: true }), host, settings);
      expect(await host.adapters.get('turso')!.healthCheck!()).toMatchObject({ ok: false });
      expect(host.logs.some(([level, m]) => level === 'warn' && m.includes(reason))).toBe(true);
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it('an auth token with a control character never reaches the libSQL client, saved or given; the reason never quotes it', async () => {
    const createClient = vi.fn((): never => {
      throw new Error('refused by the double');
    });
    vi.doMock('@libsql/client', () => ({ createClient }));
    vi.resetModules();
    const { KnowledgeTursoPlugin: Fresh, acceptsAuthToken } = await import('../plugin.js');
    const root = tempDir();
    const inside = `file:${join(dataDirectoryOf(root), 'k.db')}`;
    const refused = [`secret${String.fromCharCode(0)}tail`, 'secret-tail\n', 'secret\r\ntail', `secret${String.fromCharCode(0x7f)}tail`];
    for (const token of refused) {
      expect(acceptsAuthToken(token)).toBe(false);
      // The settings door, on a remote URL and on a file; then the plugin option.
      for (const url of ['libsql://tenant.example.turso.io', inside]) {
        const settings = settingsOf({ turso_url: url, turso_auth_token: token });
        const host = contextOf({ settings });
        await boot(new Fresh({ projectRoot: root, env: {}, urlFromSettings: true }), host, settings);
        expect(await host.adapters.get('turso')!.healthCheck!()).toMatchObject({ ok: false });
        expect(host.logs.some(([level, m]) => level === 'warn' && m.includes('auth token') && m.includes('control character'))).toBe(true);
        expect(host.logs.some(([, m]) => m.includes('secret'))).toBe(false);
      }
      const host = contextOf();
      await boot(new Fresh({ url: 'libsql://tenant.example.turso.io', authToken: token, env: {} }), host);
      expect(await host.adapters.get('turso')!.healthCheck!()).toMatchObject({ ok: false });
      expect(host.logs.some(([level, m]) => level === 'warn' && m.includes('auth token'))).toBe(true);
    }
    expect(createClient).not.toHaveBeenCalled();
    expect(existsSync(dataDirectoryOf(root))).toBe(false);

    // Controls: a token as tokens are, and one with a percent escape (the
    // client never decodes this option, so `%00` is three characters), reach
    // the client as written.
    for (const token of ['eyJhbGciOiJFZERTQSJ9.e30.c2ln', 'a%00b']) {
      expect(acceptsAuthToken(token)).toBe(true);
      const settings = settingsOf({ turso_url: 'libsql://tenant.example.turso.io', turso_auth_token: token });
      const host = contextOf({ settings });
      await boot(new Fresh({ projectRoot: root, env: {}, urlFromSettings: true }), host, settings);
      expect(createClient).toHaveBeenLastCalledWith(expect.objectContaining({ authToken: token }));
    }
    expect(createClient).toHaveBeenCalledTimes(2);
    expect(acceptsAuthToken(undefined)).toBe(true);
  });

  it('a settings read that fails opens nothing: the store says why', async () => {
    const root = tempDir();
    const settings = settingsOf({}, new Error('database is locked'));
    const host = contextOf({ settings });
    await boot(new KnowledgeTursoPlugin({ projectRoot: root, env: {}, urlFromSettings: true }), host, settings);
    expect(await host.adapters.get('turso')!.healthCheck!()).toMatchObject({ ok: false });
    expect(host.logs.some(([level, m]) => level === 'warn' && m.includes('database is locked'))).toBe(true);
    expect(existsSync(join(dataDirectoryOf(root), 'knowledge.db'))).toBe(false);
  });

  it('the plugin option `url` wins, and without urlFromSettings the settings are not read', async () => {
    const root = tempDir();
    const read = vi.fn(async () => ({ value: `file:${join(dataDirectoryOf(root), 'saved.db')}`, source: 'global' }));
    const host = contextOf({ settings: { get: read } });
    await boot(new KnowledgeTursoPlugin({ url: ':memory:', env: {}, urlFromSettings: true, projectRoot: root }), host);
    await boot(new KnowledgeTursoPlugin({ projectRoot: root, env: {} }), host);
    expect(read).not.toHaveBeenCalled();
    expect(host.adapters.get('turso')).toBeDefined();
  });
});
