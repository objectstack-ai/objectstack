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
  const ctx: any = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
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
  it('registers a SwappableStorageService as file-storage', async () => {
    const plugin = new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: await fs.mkdtemp(join(tmpdir(), 'oss-')) },
      registerRoutes: false,
    });
    const ctx = makeCtx();
    await plugin.init(ctx);
    const svc = ctx.getService<IStorageService>('file-storage');
    expect(svc).toBeInstanceOf(SwappableStorageService);
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
    const proxy = ctx.getService<SwappableStorageService>('file-storage');
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
    const proxy = ctx.getService<SwappableStorageService>('file-storage');
    const before = proxy.getInner();
    await ctx._flushReady();
    expect(proxy.getInner()).toBe(before);
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
    const proxy = ctx.getService<SwappableStorageService>('file-storage');
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
    const middlewares: Array<{ object?: string }> = [];
    ctx.registerService('objectql', {
      registerHook: (event: string, _fn: unknown, opts: any) => {
        expect(opts?.object).toBe('sys_attachment');
        hookEvents.push(event);
      },
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
