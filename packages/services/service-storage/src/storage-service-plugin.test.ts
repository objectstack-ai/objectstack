// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IStorageService } from '@objectstack/spec/contracts';
import { StorageServicePlugin } from './storage-service-plugin.js';
import { SwappableStorageService } from './swappable-storage-service.js';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { S3StorageAdapter } from './s3-storage-adapter.js';
import { LOCAL_ROOT_SHARED_ENV, MULTI_REPLICA_LOCAL_STORAGE_REFUSAL } from './multi-replica-local-root.js';

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

// The real service resolves every key to a full `ResolvedSettingValue`
// (`{ value, source, … }`) — a fake that dropped `source` would model the
// exact defect #5536 fixed. Default `'global'` = an admin-saved row, which is
// what every pre-existing test here meant; the `sources` overrides pin the
// schema-default (`'default'`) and missing-source (`null` → key omitted)
// shapes per key.
function makeFakeSettings(
  initialValues: Record<string, any>,
  initialSources?: Record<string, string | null>,
) {
  let values = { ...initialValues };
  const sources = initialSources;
  const subs: Array<(ns: string) => void> = [];
  const actions = new Map<string, (input: any) => Promise<any>>();
  return {
    set values(v: Record<string, any>) { values = v; },
    get values() { return values; },
    createClient: (_ns: string) => ({}),
    getNamespace: async (_ns: string) => ({
      values: Object.fromEntries(Object.entries(values).map(([k, v]) => {
        const src = sources && k in sources ? sources[k] : 'global';
        return [k, src === null ? { value: v } : { value: v, source: src }];
      })),
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
    // Plain call with a cast, not `getService<T>(...)` — the fake ctx's
    // getService is untyped, and each type-argument call adds a frozen-debt
    // TS2347 to this package's shrink-only type-check ledger.
    const svc = ctx.getService('storage') as IStorageService;
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

  // #5536 control: an admin-saved row (`source: 'global'`, the fake's
  // default) is "configured" under BOTH the old value-presence criterion and
  // the new authored-source one — behaviour must stay byte-identical.
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
    const proxy = ctx.getService('storage') as SwappableStorageService;
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
    const proxy = ctx.getService('storage') as SwappableStorageService;
    const before = proxy.getInner();
    await ctx._flushReady();
    expect(proxy.getInner()).toBe(before);
  });

  // ── #5536: only an AUTHORED value may move the backing store ─────────────
  //
  // The two criteria — old "any value non-empty" and new
  // "source !== 'default'" — AGREE whenever an admin actually saved a value,
  // so the tests below sit deliberately on the disagreement: a non-empty
  // value whose source says nobody authored it.

  it('keeps the constructor adapter when every value is a schema default (#5536)', async () => {
    const dirA = await fs.mkdtemp(join(tmpdir(), 'oss-default-'));
    const plugin = new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: dirA },
      registerRoutes: false,
    });
    const ctx = makeCtx();
    // Non-empty values (the manifest defaults) that nobody ever authored:
    // the old "value present" criterion read this as configured and swapped
    // the deployment's adapter to the schema default; `source: 'default'`
    // says no one made that decision.
    const settings = makeFakeSettings(
      { adapter: 'local', local_root: './.objectstack/data/uploads', max_upload_mb: 100 },
      { adapter: 'default', local_root: 'default', max_upload_mb: 'default' },
    );
    ctx.registerService('settings', settings);

    await plugin.init(ctx);
    await plugin.start(ctx);
    const proxy = ctx.getService('storage') as SwappableStorageService;
    const before = proxy.getInner();
    await ctx._flushReady();
    expect(proxy.getInner()).toBe(before);
    expect(ctx._logs.warn.join('\n')).not.toContain('adapter swapped');
  });

  it('an authored save that touched no adapter key does not open the swap gate (#5536)', async () => {
    // The criterion is per-decision, exactly as plugin-email applies it per
    // key: an admin who saved only the upload limit did not author the
    // schema-default adapter, so the constructor's store stays.
    const dirA = await fs.mkdtemp(join(tmpdir(), 'oss-limits-'));
    const plugin = new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: dirA },
      registerRoutes: false,
    });
    const ctx = makeCtx();
    const settings = makeFakeSettings(
      { adapter: 'local', local_root: './.objectstack/data/uploads', max_upload_mb: 50 },
      { adapter: 'default', local_root: 'default', max_upload_mb: 'global' },
    );
    ctx.registerService('settings', settings);

    await plugin.init(ctx);
    await plugin.start(ctx);
    const proxy = ctx.getService('storage') as SwappableStorageService;
    const before = proxy.getInner();
    await ctx._flushReady();
    expect(proxy.getInner()).toBe(before);
  });

  it('a snapshot with no source at all lands on the no-swap side (#5536 reverse control)', async () => {
    // An un-upgraded / non-conforming settings implementation that omits
    // `source` must land on the conservative side, and the conservative side
    // here is the one that does NOT move the backing store on unattributable
    // authorship: files stay reachable through the adapter the deployment
    // declared, and a real admin save (which always carries `source`) can
    // still trigger the swap via the subscription.
    const dirA = await fs.mkdtemp(join(tmpdir(), 'oss-nosrc-a-'));
    const dirB = await fs.mkdtemp(join(tmpdir(), 'oss-nosrc-b-'));
    const plugin = new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: dirA },
      registerRoutes: false,
    });
    const ctx = makeCtx();
    const settings = makeFakeSettings(
      { adapter: 'local', local_root: dirB },
      { adapter: null, local_root: null },
    );
    ctx.registerService('settings', settings);

    await plugin.init(ctx);
    await plugin.start(ctx);
    const proxy = ctx.getService('storage') as SwappableStorageService;
    const before = proxy.getInner();
    await ctx._flushReady();
    expect(proxy.getInner()).toBe(before);
  });

  // ── #4096: the swap decision, and what it says out loud ──────────────────
  //
  // The old value-presence gate (now the #5536 authored gate) was true on
  // every boot once an admin save had persisted the namespace, so this used
  // to rebuild and swap the adapter unconditionally and warn that "existing
  // files were NOT migrated" — about a swap from an adapter to an
  // identically-configured one, on a healthy server, forever.

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
    const proxy = ctx.getService('storage') as SwappableStorageService;
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
    const sysFileHookEvents: string[] = [];
    const middlewares: Array<{ object?: string }> = [];
    ctx.registerService('objectql', {
      registerHook: (event: string, _fn: unknown, opts: any) => {
        // File-reference ownership (ADR-0104 D3 wave 2) registers GLOBALLY —
        // any object may declare a file-class field. The create-side guard of
        // sys_file's storage-owned columns is scoped to sys_file. Everything
        // else is scoped to sys_attachment.
        if (opts?.object === undefined) {
          globalHookEvents.push(event);
          return;
        }
        if (opts?.object === 'sys_file') {
          sysFileHookEvents.push(event);
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

    // Lifecycle hooks (afterDelete/afterInsert, plus afterUpdate since #10171
    // gave the update verb its detach leg) + access hooks
    // (beforeInsert/beforeUpdate/beforeDelete; commit da891e0ef added the update verb)
    // — see attachment-lifecycle.ts and attachment-access-hooks.ts.
    //
    // [#10240] There is exactly ONE `beforeDelete` here, and it is the access
    // guard's. The lifecycle module used to register a second one purely to
    // stash file ids for its `afterDelete` — a hand-off a predicate delete
    // silently dropped, because per-row dispatch gives each row a fresh
    // context per phase (#5574). The id now comes from `ctx.previous`, so the
    // registration has no work left and is gone; a second `beforeDelete`
    // reappearing here means the stash mechanism came back with it.
    //
    // The second `beforeInsert`/`beforeUpdate` pair is the file half of the
    // write gate (`installAttachmentFileReferenceGate`): the `file_id` a row
    // names must be a file its caller may open.
    expect(hookEvents.sort()).toEqual([
      'afterDelete',
      'afterInsert',
      'afterUpdate',
      'beforeDelete',
      'beforeInsert',
      'beforeInsert',
      'beforeUpdate',
      'beforeUpdate',
    ]);
    // The storage-owned columns' create-side guard
    // (sys-file-storage-owned-columns.ts): one `beforeInsert`, nothing else.
    expect(sysFileHookEvents).toEqual(['beforeInsert']);
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

  // [#21729] The ruling's pairing: the alternate match that relieves the
  // platform's delete floor is contributed TOGETHER with the gate that judges
  // it — where the gate is installed, and nowhere else.
  it('contributes the delete-floor alternate exactly once, beside the gate it defers to', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'oss-floor-alt-'));
    const plugin = new StorageServicePlugin({ adapter: 'local', local: { rootDir: dir }, registerRoutes: false });
    const ctx = makeCtx();
    const order: string[] = [];
    ctx.registerService('objectql', {
      registerHook: (event: string, _fn: unknown, opts: any) => {
        if (opts?.object === 'sys_attachment' && event === 'beforeDelete') order.push('gate');
      },
      getObject: () => undefined,
      registerMiddleware: () => {},
      find: async () => [],
      findOne: async () => null,
      update: async () => ({}),
    });
    const contributions: unknown[][] = [];
    ctx.registerService('security', {
      contributeOwnershipFloorAlternates: (...args: unknown[]) => {
        order.push('alternate');
        contributions.push(args);
      },
    });

    await plugin.init(ctx);
    await plugin.start(ctx);
    await ctx._flushReady();

    expect(contributions).toEqual([
      [
        'com.objectstack.service.storage',
        [{ name: 'sys_attachment_parent_editor_delete', object: 'sys_attachment', operation: 'delete', using: 'id != null' }],
      ],
    ]);
    // The gate is installed first; the relief never exists without it.
    expect(order).toEqual(['gate', 'alternate']);
  });

  it('contributes nothing where the gate is not installed (an engine with no hook seam)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'oss-floor-alt-nogate-'));
    const plugin = new StorageServicePlugin({ adapter: 'local', local: { rootDir: dir }, registerRoutes: false });
    const ctx = makeCtx();
    // An engine the gate cannot be installed on — no `registerHook`.
    ctx.registerService('objectql', { find: async () => [], findOne: async () => null });
    const contribute = { calls: 0 };
    ctx.registerService('security', {
      contributeOwnershipFloorAlternates: () => {
        contribute.calls += 1;
      },
    });

    await plugin.init(ctx);
    await plugin.start(ctx);
    await ctx._flushReady();

    expect(contribute.calls).toBe(0);
  });

  // Every member's attachment grant (read and create on sys_attachment) is
  // contributed only once ALL THREE attachment row gates are in place — the
  // write rule, the read-visibility middleware and the download door's
  // parent-record check — after the last of them, and never on a kernel that
  // lacks one (maintainer ruling; `attachment-member-grant.ts`).
  describe("the members' attachment grant, contributed beside the three row gates", () => {
    const MEMBER_SET = {
      name: 'storage_attachment_member',
      objects: { sys_attachment: { allowRead: true, allowCreate: true } },
    };

    async function bootWith(engine: Record<string, unknown>, opts: { auth?: boolean } = {}) {
      const dir = await fs.mkdtemp(join(tmpdir(), 'oss-member-grant-'));
      const plugin = new StorageServicePlugin({ adapter: 'local', local: { rootDir: dir }, registerRoutes: false });
      const ctx = makeCtx();
      const order: string[] = [];
      const contributions: unknown[][] = [];
      ctx.registerService('objectql', {
        find: async () => [],
        findOne: async () => null,
        update: async () => ({}),
        getObject: () => undefined,
        ...engine,
      });
      if (opts.auth !== false) ctx.registerService('auth', { api: {} });
      ctx.registerService('security', {
        contributeOwnershipFloorAlternates: () => {},
        contributePlatformBaselineSet: (...args: unknown[]) => {
          order.push('grant');
          contributions.push(args);
          return { name: 'storage_attachment_member', joined: true };
        },
      });
      await plugin.init(ctx);
      await plugin.start(ctx);
      await ctx._flushReady();
      return { ctx, order, contributions };
    }

    const gateHook = (order: string[]) => (event: string, _fn: unknown, opts: any) => {
      if (opts?.object === 'sys_attachment' && event === 'beforeInsert') order.push('write rule');
    };

    it('contributes the set exactly once, after the write rule and the read-visibility middleware', async () => {
      const order: string[] = [];
      const booted = await bootWith({
        registerHook: gateHook(order),
        registerMiddleware: (_fn: unknown, opts: any) => {
          if (opts?.object === 'sys_attachment') order.push('read visibility');
        },
      });
      expect(booted.contributions).toEqual([['com.objectstack.service.storage', expect.objectContaining(MEMBER_SET)]]);
      // The grant comes last; it never exists without the gates before it.
      expect([...order, ...booted.order]).toEqual(['write rule', 'write rule', 'read visibility', 'grant']);
      expect(booted.ctx._logs.warn.filter((w: string) => w.includes('NOT granted attachments'))).toEqual([]);
    });

    it('an engine without the middleware seam: no read-visibility gate, so no grant — said at warn', async () => {
      const booted = await bootWith({ registerHook: () => {} });
      expect(booted.contributions).toEqual([]);
      const warned = booted.ctx._logs.warn.filter((w: string) => w.includes('NOT granted attachments'));
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain('read-visibility');
    });

    it('a kernel without an auth service: no download check binds, so no grant — said at warn', async () => {
      const booted = await bootWith({ registerHook: () => {}, registerMiddleware: () => {} }, { auth: false });
      expect(booted.contributions).toEqual([]);
      const warned = booted.ctx._logs.warn.filter((w: string) => w.includes('NOT granted attachments'));
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain("download door's parent-record check");
    });

    it('an engine without the hook seam: no write rule, so no grant — said at warn', async () => {
      const booted = await bootWith({ registerMiddleware: () => {} });
      expect(booted.contributions).toEqual([]);
      const warned = booted.ctx._logs.warn.filter((w: string) => w.includes('NOT granted attachments'));
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain('write rule');
    });
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

// cloud#3814: several replicas declared over the redis cluster driver may not
// serve uploads from an unshared local root. The adapter in use is decided at
// `kernel:ready` (settings swap S3 in there), so every case boots through it.
describe('StorageServicePlugin: local root under declared replicas (cloud#3814)', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  /** Several replicas declared; `OS_EXPECT_MULTI_NODE` cleared so only the count speaks. */
  function declareReplicas(): void {
    vi.stubEnv('OS_EXPECT_MULTI_NODE', '');
    vi.stubEnv('OS_CLUSTER_REPLICAS', '3');
  }

  function undeclared(): void {
    vi.stubEnv('OS_EXPECT_MULTI_NODE', '');
    vi.stubEnv('OS_CLUSTER_REPLICAS', '');
  }

  async function bootLocal(opts: { driver?: string; settings?: ReturnType<typeof makeFakeSettings> } = {}) {
    const plugin = new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: await fs.mkdtemp(join(tmpdir(), 'oss-replicas-')) },
      registerRoutes: false,
    });
    const ctx = makeCtx();
    if (opts.driver !== undefined) ctx.registerService('cluster', { driver: opts.driver });
    if (opts.settings) ctx.registerService('settings', opts.settings);
    await plugin.init(ctx);
    await plugin.start(ctx);
    return { plugin, ctx, proxy: ctx.getService('storage') as SwappableStorageService };
  }

  /** `storage` settings selecting S3, pinned by env the way `OS_STORAGE_ADAPTER=s3` pins them. */
  function s3Settings() {
    const values = { adapter: 's3', s3_bucket: 'uploads', s3_region: 'us-east-1' };
    return makeFakeSettings(values, { adapter: 'env', s3_bucket: 'env', s3_region: 'env' });
  }

  it('refuses the boot on a local root with no shared-root declaration, naming the S3 settings and the switch', async () => {
    declareReplicas();
    vi.stubEnv(LOCAL_ROOT_SHARED_ENV, '');
    const { ctx } = await bootLocal({ driver: 'redis' });

    const boot = ctx._flushReady();
    await expect(boot).rejects.toThrow(MULTI_REPLICA_LOCAL_STORAGE_REFUSAL);
    await expect(boot).rejects.toThrow(/OS_STORAGE_ADAPTER=s3/);
    await expect(boot).rejects.toThrow(new RegExp(`${LOCAL_ROOT_SHARED_ENV}=true`));
  });

  it('boots on a local root the operator declares shared', async () => {
    declareReplicas();
    vi.stubEnv(LOCAL_ROOT_SHARED_ENV, ' TRUE ');
    const { ctx, proxy } = await bootLocal({ driver: 'redis' });

    await expect(ctx._flushReady()).resolves.toBeUndefined();
    expect(proxy.getInner()).toBeInstanceOf(LocalStorageAdapter);
  });

  it('boots when the storage settings select S3', async () => {
    declareReplicas();
    vi.stubEnv(LOCAL_ROOT_SHARED_ENV, '');
    const { ctx, proxy } = await bootLocal({ driver: 'redis', settings: s3Settings() });

    await expect(ctx._flushReady()).resolves.toBeUndefined();
    expect(proxy.getInner()).toBeInstanceOf(S3StorageAdapter);
  });

  // CONTROLS: R3 — outside the declaration nothing changes. Green before and
  // after the change by construction; ⛔ not ablation evidence.
  it.each([
    ['no replicas declared, redis driver', undeclared, 'redis'],
    ['replicas declared, memory driver', declareReplicas, 'memory'],
    ['replicas declared, no cluster service', declareReplicas, undefined],
  ] as const)('CONTROL: boots on a local root — %s', async (_name, env, driver) => {
    env();
    vi.stubEnv(LOCAL_ROOT_SHARED_ENV, '');
    const { ctx, proxy } = await bootLocal({ driver });

    await expect(ctx._flushReady()).resolves.toBeUndefined();
    expect(proxy.getInner()).toBeInstanceOf(LocalStorageAdapter);
  });

  it('refuses a settings change onto a local root and keeps the S3 adapter serving', async () => {
    declareReplicas();
    vi.stubEnv(LOCAL_ROOT_SHARED_ENV, '');
    const settings = s3Settings();
    const { ctx, proxy } = await bootLocal({ driver: 'redis', settings });
    await ctx._flushReady();
    const s3 = proxy.getInner();
    expect(s3).toBeInstanceOf(S3StorageAdapter);

    settings.values = { adapter: 'local', local_root: await fs.mkdtemp(join(tmpdir(), 'oss-replicas-swap-')) };
    settings._emit('storage');
    await vi.waitFor(() => expect(ctx._logs.error.join('\n')).toContain(MULTI_REPLICA_LOCAL_STORAGE_REFUSAL));

    expect(proxy.getInner()).toBe(s3);
  });

  it('applies a settings change onto a local root the operator declares shared', async () => {
    declareReplicas();
    vi.stubEnv(LOCAL_ROOT_SHARED_ENV, 'true');
    const settings = s3Settings();
    const { ctx, proxy } = await bootLocal({ driver: 'redis', settings });
    await ctx._flushReady();
    const s3 = proxy.getInner();

    settings.values = { adapter: 'local', local_root: await fs.mkdtemp(join(tmpdir(), 'oss-replicas-swap-')) };
    settings._emit('storage');
    await vi.waitFor(() => expect(proxy.getInner()).toBeInstanceOf(LocalStorageAdapter));

    expect(proxy.getInner()).not.toBe(s3);
    expect(ctx._logs.error).toEqual([]);
  });
});
