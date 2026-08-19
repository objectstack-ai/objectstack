// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IStorageService, StorageFileInfo } from '@objectstack/spec/contracts';
import { StorageServicePlugin } from './storage-service-plugin';
import { SwappableStorageService } from './swappable-storage-service';

/**
 * Plugin-level integration test exercising the settings live-wire.
 * Uses a hand-rolled fake PluginContext + fake settings service rather
 * than booting a real kernel — service-storage has no driver / settings
 * deps and we want this test to stay cheap.
 */

function makeCtx() {
  const services = new Map<string, any>();
  const hooks: Array<() => Promise<void> | void> = [];
  // Captured so tests can assert on what a boot SAID, not just what it built —
  // #4096 is entirely about a warning that should not have been emitted.
  const logs: { info: string[]; warn: string[]; error: string[] } = { info: [], warn: [], error: [] };
  const ctx: any = {
    logger: {
      info: (m: string) => { logs.info.push(String(m)); },
      warn: (m: string) => { logs.warn.push(String(m)); },
      error: (m: string) => { logs.error.push(String(m)); },
    },
    _logs: logs,
    registerService: (name: string, svc: any) => { services.set(name, svc); },
    getService: <T>(name: string): T => {
      const s = services.get(name);
      if (!s) throw new Error(`service '${name}' not registered`);
      return s as T;
    },
    hook: (event: string, fn: () => Promise<void> | void) => {
      if (event === 'kernel:ready') hooks.push(fn);
    },
    _services: services,
    _flushReady: async () => { for (const h of hooks) await h(); },
  };
  return ctx;
}

function makeFakeSettings(initialValues: Record<string, any>) {
  let values = { ...initialValues };
  const subs: Array<(ns: string) => void> = [];
  const actions = new Map<string, (input: any) => Promise<any>>();
  return {
    set values(v: Record<string, any>) { values = v; },
    get values() { return values; },
    createClient: (_ns: string) => ({}),
    getNamespace: async (_ns: string) => ({
      values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v }])),
    }),
    subscribe: (ns: string, fn: () => void) => { subs.push((n) => { if (n === ns) fn(); }); },
    registerAction: (ns: string, id: string, fn: (input: any) => Promise<any>) => {
      actions.set(`${ns}/${id}`, fn);
    },
    _emit: (ns: string) => subs.forEach((s) => s(ns)),
    _runAction: async (ns: string, id: string, input: any) => {
      const fn = actions.get(`${ns}/${id}`);
      if (!fn) throw new Error(`no action ${ns}/${id}`);
      return await fn(input);
    },
  };
}

describe('StorageServicePlugin: settings live-wire', () => {
  it('registers a SwappableStorageService as storage', async () => {
    const plugin = new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: await fs.mkdtemp(join(tmpdir(), 'oss-')) },
      registerRoutes: false,
    });
    const ctx = makeCtx();
    await plugin.init(ctx);
    const svc = ctx.getService<IStorageService>('storage');
    expect(svc).toBeInstanceOf(SwappableStorageService);
  });

  // The alias-equivalence pin for the #9683 rename (maintainer ruling
  // 2026-08-18): `storage` is canonical, `file-storage` stays accepted as a
  // deprecated alias within v17, and both spellings MUST resolve the same
  // instance — anything else would fork the slot into two services.
  it('registers the deprecated file-storage alias as the SAME instance (#9683)', async () => {
    const plugin = new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: await fs.mkdtemp(join(tmpdir(), 'oss-')) },
      registerRoutes: false,
    });
    const ctx = makeCtx();
    await plugin.init(ctx);
    // Plain calls with casts, not `getService<T>(...)` — the fake ctx's
    // getService is untyped, and each type-argument call adds a frozen-debt
    // TS2347 to this package's shrink-only type-check ledger.
    const canonical = ctx.getService('storage') as IStorageService;
    const alias = ctx.getService('file-storage') as IStorageService;
    expect(alias).toBeInstanceOf(SwappableStorageService);
    expect(alias).toBe(canonical);
  });

  it('swaps the inner adapter when storage settings change', async () => {
    const dirA = await fs.mkdtemp(join(tmpdir(), 'oss-a-'));
    const dirB = await fs.mkdtemp(join(tmpdir(), 'oss-b-'));

    const plugin = new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: dirA },
      registerRoutes: false,
    });
    const ctx = makeCtx();
    const settings = makeFakeSettings({ adapter: 'local', local_root: dirB });
    ctx.registerService('settings', settings);

    await plugin.init(ctx);
    await plugin.start(ctx);
    const proxy = ctx.getService<SwappableStorageService>('storage');
    const innerBefore = proxy.getInner();

    await ctx._flushReady();

    const innerAfter = proxy.getInner();
    expect(innerAfter).not.toBe(innerBefore);

    // The new adapter should point at dirB — verify by writing through
    // the proxy and checking the file lands in dirB.
    await proxy.upload('hello.txt', Buffer.from('world'));
    const onDisk = await fs.readFile(join(dirB, 'hello.txt'));
    expect(onDisk.toString()).toBe('world');
  });

  it('keeps the constructor adapter when settings has no values yet', async () => {
    const dirA = await fs.mkdtemp(join(tmpdir(), 'oss-keep-'));
    const plugin = new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: dirA },
      registerRoutes: false,
    });
    const ctx = makeCtx();
    const settings = makeFakeSettings({}); // no persisted values
    ctx.registerService('settings', settings);

    await plugin.init(ctx);
    await plugin.start(ctx);
    const proxy = ctx.getService<SwappableStorageService>('storage');
    const before = proxy.getInner();
    await ctx._flushReady();
    expect(proxy.getInner()).toBe(before);
  });

  // ── #4096: the swap decision, and what it says out loud ──────────────────
  //
  // `hasAny` is true on every boot once the settings service has persisted its
  // own defaults, so this used to rebuild and swap the adapter unconditionally
  // and warn that "existing files were NOT migrated" — about a swap from an
  // adapter to an identically-configured one, on a healthy server, forever.

  it('neither swaps nor warns when persisted settings match the running adapter', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'oss-same-'));
    const plugin = new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: dir },
      registerRoutes: false,
    });
    const ctx = makeCtx();
    // Exactly what the settings namespace holds after it persists its defaults:
    // values present (so `hasAny` is true) and identical to what is running.
    ctx.registerService('settings', makeFakeSettings({ adapter: 'local', local_root: dir }));

    await plugin.init(ctx);
    await plugin.start(ctx);
    const proxy = ctx.getService('storage') as SwappableStorageService;
    const before = proxy.getInner();

    await ctx._flushReady();

    expect(proxy.getInner()).toBe(before);
    expect(ctx._logs.warn.join('\n')).not.toContain('adapter swapped');
  });

  it('treats an implicit local root and its explicit default as the same store', async () => {
    // The real boot shape: the host leaves `local.rootDir` unset while the
    // settings namespace persists the schema default, so the two spellings of
    // one location must not read as a move.
    const plugin = new StorageServicePlugin({ adapter: 'local', registerRoutes: false });
    const ctx = makeCtx();
    ctx.registerService('settings', makeFakeSettings({ adapter: 'local', local_root: './storage' }));

    await plugin.init(ctx);
    await plugin.start(ctx);
    const proxy = ctx.getService('storage') as SwappableStorageService;
    const before = proxy.getInner();

    await ctx._flushReady();

    expect(proxy.getInner()).toBe(before);
    expect(ctx._logs.warn.join('\n')).not.toContain('adapter swapped');
  });

  it('still warns when the backing store really moves', async () => {
    // The guard has to survive the fix: Local → another root strands whatever
    // the old one held, and that is the whole point of the message.
    const dirA = await fs.mkdtemp(join(tmpdir(), 'oss-move-a-'));
    const dirB = await fs.mkdtemp(join(tmpdir(), 'oss-move-b-'));
    const plugin = new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: dirA },
      registerRoutes: false,
    });
    const ctx = makeCtx();
    ctx.registerService('settings', makeFakeSettings({ adapter: 'local', local_root: dirB }));

    await plugin.init(ctx);
    await plugin.start(ctx);
    await ctx._flushReady();

    const warned = ctx._logs.warn.join('\n');
    expect(warned).toContain('adapter swapped');
    expect(warned).toContain('were NOT migrated');
  });

  it('warns again on a later real move, having stayed quiet for the no-op', async () => {
    // The verdict is per-swap state, so a quiet boot must not disarm the next
    // genuine migration.
    const dir = await fs.mkdtemp(join(tmpdir(), 'oss-seq-'));
    const moved = await fs.mkdtemp(join(tmpdir(), 'oss-seq-moved-'));
    const plugin = new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: dir },
      registerRoutes: false,
    });
    const ctx = makeCtx();
    const settings = makeFakeSettings({ adapter: 'local', local_root: dir });
    ctx.registerService('settings', settings);

    await plugin.init(ctx);
    await plugin.start(ctx);
    await ctx._flushReady();
    expect(ctx._logs.warn.join('\n')).not.toContain('adapter swapped');

    settings.values = { adapter: 'local', local_root: moved };
    settings._emit('storage');
    await new Promise((r) => setTimeout(r, 20));

    expect(ctx._logs.warn.join('\n')).toContain('adapter swapped');
  });

  it('registers a working storage/test action handler that round-trips a probe blob', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'oss-probe-'));
    const plugin = new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: dir },
      registerRoutes: false,
    });
    const ctx = makeCtx();
    const settings = makeFakeSettings({ adapter: 'local', local_root: dir });
    ctx.registerService('settings', settings);

    await plugin.init(ctx);
    await plugin.start(ctx);
    await ctx._flushReady();

    const result = await settings._runAction('storage', 'test', {
      values: { adapter: 'local', local_root: dir },
    });
    expect(result.ok).toBe(true);
    expect(result.severity).toBe('info');
    // Probe file should be cleaned up
    const left = await fs.readdir(join(dir, '__objectstack_probe__')).catch(() => []);
    expect(left).toEqual([]);
  });

  it('storage/test reports the underlying error on failure', async () => {
    const plugin = new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: await fs.mkdtemp(join(tmpdir(), 'oss-err-')) },
      registerRoutes: false,
    });
    const ctx = makeCtx();
    const settings = makeFakeSettings({});
    ctx.registerService('settings', settings);

    await plugin.init(ctx);
    await plugin.start(ctx);
    await ctx._flushReady();

    // S3 with bogus config — buildAdapterFromValues throws on missing
    // bucket/region.
    const result = await settings._runAction('storage', 'test', {
      values: { adapter: 's3', s3_bucket: '', s3_region: '' },
    });
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('error');
  });

  it('does not bind to settings when bindToSettings=false', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'oss-nobind-'));
    const plugin = new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: dir },
      registerRoutes: false,
      bindToSettings: false,
    });
    const ctx = makeCtx();
    const settings = makeFakeSettings({ adapter: 'local', local_root: '/other' });
    ctx.registerService('settings', settings);

    await plugin.init(ctx);
    await plugin.start(ctx);
    const proxy = ctx.getService<SwappableStorageService>('storage');
    const before = proxy.getInner();
    await ctx._flushReady();
    expect(proxy.getInner()).toBe(before); // no swap
  });
});

describe('StorageServicePlugin: sys_file orphan lifecycle wiring (#2755)', () => {
  it('installs sys_attachment hooks and registers the sys_file reap guard at kernel:ready', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'oss-lifecycle-'));
    const plugin = new StorageServicePlugin({ adapter: 'local', local: { rootDir: dir }, registerRoutes: false });
    const ctx = makeCtx();

    const hookEvents: string[] = [];
    const globalHookEvents: string[] = [];
    const middlewares: Array<{ object?: string }> = [];
    ctx.registerService('objectql', {
      registerHook: (event: string, _fn: unknown, opts: any) => {
        // File-reference ownership (ADR-0104 D3 wave 2) registers GLOBALLY —
        // any object may declare a file-class field. Everything else is
        // scoped to sys_attachment.
        if (opts?.object === undefined) {
          globalHookEvents.push(event);
          return;
        }
        expect(opts?.object).toBe('sys_attachment');
        hookEvents.push(event);
      },
      getObject: () => undefined,
      registerMiddleware: (_fn: unknown, opts: any) => {
        middlewares.push({ object: opts?.object });
      },
      find: async () => [],
      findOne: async () => null,
      update: async () => ({}),
    });
    const guards: Array<{ object: string; guard: unknown }> = [];
    ctx.registerService('lifecycle', {
      registerReapGuard: (object: string, guard: unknown) => guards.push({ object, guard }),
    });

    await plugin.init(ctx);
    await plugin.start(ctx);
    await ctx._flushReady();

    // Lifecycle hooks (beforeDelete/afterDelete/afterInsert) + access hooks
    // (beforeInsert/beforeDelete) — see attachment-lifecycle.ts and
    // attachment-access-hooks.ts.
    expect(hookEvents.sort()).toEqual([
      'afterDelete',
      'afterInsert',
      'beforeDelete',
      'beforeDelete',
      'beforeInsert',
    ]);
    // Field-reference ownership: claim/copy on write, release on delete
    // (file-reference-lifecycle.ts). Registered without an object filter.
    expect(globalHookEvents.sort()).toEqual([
      'afterDelete',
      'afterInsert',
      'afterUpdate',
      'beforeDelete',
      'beforeInsert',
      'beforeUpdate',
    ]);
    // Two reap guards: sys_file (#2755) + sys_upload_session multipart-abort (#2970).
    expect(guards.map((g) => g.object).sort()).toEqual(['sys_file', 'sys_upload_session']);
    expect(guards.every((g) => typeof g.guard === 'function')).toBe(true);
    // Read-visibility middleware registered on sys_attachment (#2970 item 1).
    expect(middlewares).toEqual([{ object: 'sys_attachment' }]);
  });

  it('degrades silently on a bare kernel (no engine, no lifecycle service)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'oss-bare-'));
    const plugin = new StorageServicePlugin({ adapter: 'local', local: { rootDir: dir }, registerRoutes: false });
    const ctx = makeCtx();

    await plugin.init(ctx);
    await plugin.start(ctx);
    await expect(ctx._flushReady()).resolves.toBeUndefined();
  });
});

// Fresh-datastore attestation (#3438, ADR-0104) moved to PlatformObjectsPlugin
// with the sys_migration registration it belongs to (#4243) — its tests live in
// @objectstack/platform-objects (src/plugin.test.ts).
