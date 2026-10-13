// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Runtime-authored hook re-sync (#2588).
 *
 * Hooks authored in the Studio persist as `sys_metadata` rows that the
 * metadata service never surfaces on env-scoped kernels, so the boot bind
 * misses them entirely. `ObjectQLPlugin.resyncAuthoredHooks` re-binds them
 * from the rows themselves at `kernel:ready` and on `metadata:reloaded`.
 * These tests exercise that logic against a mocked engine — the sandbox
 * execution of `body` itself is covered by @objectstack/runtime tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';

type AnyRecord = Record<string, any>;

function makeQlMock(overrides: AnyRecord = {}) {
  return {
    bindHooks: vi.fn(),
    unregisterHooksByPackage: vi.fn(),
    find: vi.fn(async () => []),
    registry: {
      getArtifactItem: vi.fn(() => undefined),
    },
    ...overrides,
  };
}

function makeCtx(services: AnyRecord = {}) {
  return {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getService: vi.fn((name: string) => {
      if (name in services) return services[name];
      throw new Error(`service '${name}' not registered`);
    }),
    hook: vi.fn(),
  } as AnyRecord;
}

function makePlugin(ql: AnyRecord) {
  return new ObjectQLPlugin({ ql: ql as unknown as ObjectQL });
}

const hookRow = (name: string, extra: AnyRecord = {}) => ({
  type: 'hook',
  name,
  state: 'active',
  metadata: JSON.stringify({
    name,
    object: 'showcase_task',
    events: ['beforeUpdate'],
    body: { language: 'js', source: "ctx.input.assignee = 'HOOKED';" },
    priority: 10,
  }),
  ...extra,
});

describe('ObjectQLPlugin.resyncAuthoredHooks (#2588)', () => {
  let ql: AnyRecord;

  beforeEach(() => {
    ql = makeQlMock();
  });

  it('binds active sys_metadata hook rows under packageId metadata-service', async () => {
    ql.find.mockImplementation(async (obj: string, q: AnyRecord) =>
      q?.where?.type === 'hook' ? [hookRow('rebind_probe_hook')] : []);
    const plugin = makePlugin(ql);
    const ctx = makeCtx();

    await (plugin as any).resyncAuthoredHooks(ctx);

    expect(ql.bindHooks).toHaveBeenCalledTimes(1);
    const [hooks, opts] = ql.bindHooks.mock.calls[0];
    expect(opts).toEqual({ packageId: 'metadata-service' });
    expect(hooks).toHaveLength(1);
    expect(hooks[0].name).toBe('rebind_probe_hook');
    expect(hooks[0].body?.source).toContain('HOOKED');
  });

  it('grafts the row package_id as _packageId onto the parsed hook', async () => {
    ql.find.mockImplementation(async (_obj: string, q: AnyRecord) =>
      q?.where?.type === 'hook' ? [hookRow('h1', { package_id: 'com.example.ops' })] : []);
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredHooks(makeCtx());

    const [hooks] = ql.bindHooks.mock.calls[0];
    expect(hooks[0]._packageId).toBe('com.example.ops');
  });

  it('filters out artifact-shipped hooks (bound by AppPlugin) to prevent double execution', async () => {
    ql.registry.getArtifactItem.mockImplementation((_type: string, name: string) =>
      name === 'showcase_normalize_task_title' ? { name } : undefined);
    ql.find.mockImplementation(async (_obj: string, q: AnyRecord) =>
      q?.where?.type === 'hook'
        ? [hookRow('authored_hook'), hookRow('showcase_normalize_task_title')]
        : []);
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredHooks(makeCtx());

    const [hooks] = ql.bindHooks.mock.calls[0];
    expect(hooks.map((h: AnyRecord) => h.name)).toEqual(['authored_hook']);
  });

  it('unions metadata-service hooks with DB rows; the DB row wins by name', async () => {
    const metadataService = {
      loadMany: vi.fn(async (type: string) =>
        type === 'hook'
          ? [
              { name: 'fs_hook', object: 'a', events: ['beforeInsert'], handler: 'fn_a' },
              { name: 'edited_hook', object: 'a', events: ['beforeInsert'], handler: 'stale' },
            ]
          : []),
    };
    ql.find.mockImplementation(async (_obj: string, q: AnyRecord) =>
      q?.where?.type === 'hook'
        ? [hookRow('edited_hook'), hookRow('new_authored_hook')]
        : []);
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredHooks(makeCtx({ metadata: metadataService }));

    const [hooks] = ql.bindHooks.mock.calls[0];
    const names = hooks.map((h: AnyRecord) => h.name).sort();
    expect(names).toEqual(['edited_hook', 'fs_hook', 'new_authored_hook']);
    const edited = hooks.find((h: AnyRecord) => h.name === 'edited_hook');
    expect(edited.handler).toBeUndefined(); // fresh DB body replaced the stale service copy
    expect(edited.body?.source).toContain('HOOKED');
  });

  it('tears down all bindings when the last authored hook row was deleted', async () => {
    ql.find.mockResolvedValue([]);
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredHooks(makeCtx());

    // Zero rows is a legitimate state. bindHooksToEngine early-returns on an
    // empty list BEFORE its unregister step, so the resync must tear the
    // package set down explicitly or the deleted hook keeps firing.
    expect(ql.bindHooks).not.toHaveBeenCalled();
    expect(ql.unregisterHooksByPackage).toHaveBeenCalledWith('metadata-service');
  });

  it('is a no-op when neither source is readable (never tears down on a failed read)', async () => {
    ql.find.mockRejectedValue(new Error('no such table: sys_metadata'));
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredHooks(makeCtx()); // no metadata service either

    expect(ql.bindHooks).not.toHaveBeenCalled();
  });

  it('falls back to legacy plural rows when no singular rows exist', async () => {
    ql.find.mockImplementation(async (_obj: string, q: AnyRecord) => {
      if (q?.where?.type === 'hooks') return [hookRow('legacy_plural_hook', { type: 'hooks' })];
      return [];
    });
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredHooks(makeCtx());

    const [hooks] = ql.bindHooks.mock.calls[0];
    expect(hooks.map((h: AnyRecord) => h.name)).toEqual(['legacy_plural_hook']);
  });

  it('skips malformed rows without dropping the rest', async () => {
    ql.find.mockImplementation(async (_obj: string, q: AnyRecord) =>
      q?.where?.type === 'hook'
        ? [{ type: 'hook', name: 'broken', state: 'active', metadata: '{not json' }, hookRow('good_hook')]
        : []);
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredHooks(makeCtx());

    const [hooks] = ql.bindHooks.mock.calls[0];
    expect(hooks.map((h: AnyRecord) => h.name)).toEqual(['good_hook']);
  });

  // [#21911, ADR-0096] The boot / resync read carries the explicit system
  // opt-in rather than reaching the engine as a principal-less context. No
  // singular rows, so the legacy plural fallback issues too.
  it('reads sys_metadata with the explicit system opt-in on every read (#21911)', async () => {
    ql.find.mockResolvedValue([]);

    await (makePlugin(ql) as any).resyncAuthoredHooks(makeCtx());

    const reads = ql.find.mock.calls.filter(([obj]: [string]) => obj === 'sys_metadata');
    expect(reads.map(([, q]: [string, AnyRecord]) => q?.where?.type)).toEqual(['hook', 'hooks']);
    for (const [, q] of reads) expect(q?.context).toEqual({ isSystem: true });
  });
});

describe('ObjectQLPlugin protocol-mutation subscription (#2588)', () => {
  it('re-syncs authored hooks when a hook row mutation lands (skips drafts and other types)', async () => {
    const ql = makeQlMock({ registerApp: vi.fn(), setDatasourceMapping: vi.fn() });
    const plugin = new ObjectQLPlugin({ ql: ql as unknown as ObjectQL, environmentId: 'env_t' });
    const registered = new Map<string, any>();
    const ctx = {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerService: vi.fn((name: string, svc: any) => registered.set(name, svc)),
      getService: vi.fn(() => { throw new Error('none'); }),
    } as AnyRecord;

    await (plugin as any).init(ctx);

    const protocol = registered.get('protocol');
    expect(protocol).toBeDefined();
    const resync = vi
      .spyOn(plugin as any, 'resyncAuthoredHooks')
      .mockResolvedValue(undefined);

    (protocol as any).emitMetadataMutation({ type: 'hook', name: 'h1', state: 'active' });
    expect(resync).toHaveBeenCalledTimes(1);

    // Drafts are not live — no rebind.
    (protocol as any).emitMetadataMutation({ type: 'hook', name: 'h1', state: 'draft' });
    expect(resync).toHaveBeenCalledTimes(1);

    // Other metadata types don't churn the hook bindings.
    (protocol as any).emitMetadataMutation({ type: 'view', name: 'v1', state: 'active' });
    expect(resync).toHaveBeenCalledTimes(1);

    // Deletes rebind (teardown).
    (protocol as any).emitMetadataMutation({ type: 'hook', name: 'h1', state: 'deleted' });
    expect(resync).toHaveBeenCalledTimes(2);
  });
});

describe('ObjectQLPlugin boot bind artifact filter (#2588)', () => {
  it('excludes artifact-shipped hooks from the metadata-service boot bind', async () => {
    const ql = makeQlMock({
      registry: {
        getArtifactItem: vi.fn((_type: string, name: string) =>
          name === 'artifact_hook' ? { name } : undefined),
        registerItem: vi.fn(),
      },
      registerFunction: vi.fn(),
    });
    const metadataService = {
      loadMany: vi.fn(async (type: string) =>
        type === 'hook'
          ? [
              { name: 'artifact_hook', object: 'a', events: ['beforeInsert'], body: { language: 'js', source: 'x' }, _packageId: 'com.example.app' },
              { name: 'authored_hook', object: 'a', events: ['beforeInsert'], body: { language: 'js', source: 'y' } },
            ]
          : []),
    };
    const plugin = makePlugin(ql);

    await (plugin as any).loadMetadataFromService(metadataService, makeCtx());

    expect(ql.bindHooks).toHaveBeenCalledTimes(1);
    const [hooks, opts] = ql.bindHooks.mock.calls[0];
    expect(opts).toEqual({ packageId: 'metadata-service' });
    expect(hooks.map((h: AnyRecord) => h.name)).toEqual(['authored_hook']);
  });
});
