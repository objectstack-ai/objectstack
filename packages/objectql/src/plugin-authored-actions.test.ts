// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Runtime-authored action re-sync (#2605 item 1).
 *
 * Actions authored in the Studio persist as `action` sys_metadata rows (or
 * embedded in authored `object` rows' `actions[]`), but `engine.executeAction`
 * only ever dispatched handlers registered from the app bundle at boot — a
 * published action was stored + listed but never executable, before or after
 * a restart. `ObjectQLPlugin.resyncAuthoredActions` registers them from the
 * rows themselves at `kernel:ready`, on `metadata:reloaded`, and on protocol
 * metadata mutations, through the engine's default action runner (installed
 * at boot by the runtime's AppPlugin). These tests exercise the re-sync
 * against a mocked engine — sandbox execution of `body` itself is covered by
 * @objectstack/runtime tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';

type AnyRecord = Record<string, any>;

function makeQlMock(overrides: AnyRecord = {}) {
  return {
    registerAction: vi.fn(),
    removeActionsByPackage: vi.fn(),
    find: vi.fn(async () => []),
    registry: {
      getArtifactItem: vi.fn(() => undefined),
    },
    // Default action runner as the runtime installs it: body → handler.
    _defaultActionRunner: vi.fn((action: AnyRecord) =>
      action?.body ? async () => `ran:${action.name}` : undefined),
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

const actionRow = (name: string, extra: AnyRecord = {}, payload: AnyRecord = {}) => ({
  type: 'action',
  name,
  state: 'active',
  metadata: JSON.stringify({
    name,
    label: name,
    objectName: 'showcase_task',
    type: 'script',
    body: { language: 'js', source: 'return 42;' },
    ...payload,
  }),
  ...extra,
});

describe('ObjectQLPlugin.resyncAuthoredActions (#2605)', () => {
  let ql: AnyRecord;

  beforeEach(() => {
    ql = makeQlMock();
  });

  it('registers active sys_metadata action rows under packageId metadata-service', async () => {
    ql.find.mockImplementation(async (_obj: string, q: AnyRecord) =>
      q?.where?.type === 'action' ? [actionRow('issue_license')] : []);
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredActions(makeCtx());

    expect(ql.removeActionsByPackage).toHaveBeenCalledWith('metadata-service');
    expect(ql.registerAction).toHaveBeenCalledTimes(1);
    const [objectKey, name, handler, packageId] = ql.registerAction.mock.calls[0];
    expect(objectKey).toBe('showcase_task');
    expect(name).toBe('issue_license');
    expect(packageId).toBe('metadata-service');
    await expect(handler({})).resolves.toBe('ran:issue_license');
  });

  it('registers object-less actions under the global key', async () => {
    ql.find.mockImplementation(async (_obj: string, q: AnyRecord) =>
      q?.where?.type === 'action'
        ? [actionRow('export_all', {}, { objectName: undefined })]
        : []);
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredActions(makeCtx());

    expect(ql.registerAction.mock.calls[0][0]).toBe('global');
  });

  it('registers actions embedded in authored object rows, attaching the object name', async () => {
    ql.find.mockImplementation(async (_obj: string, q: AnyRecord) => {
      if (q?.where?.type === 'object') {
        return [{
          type: 'object',
          name: 'ops_ticket',
          state: 'active',
          metadata: JSON.stringify({
            name: 'ops_ticket',
            label: 'Ticket',
            actions: [
              { name: 'escalate', type: 'script', body: { language: 'js', source: 'return 1;' } },
              { name: 'open_url', type: 'url', target: 'https://example.com' }, // bodyless → skipped
            ],
          }),
        }];
      }
      return [];
    });
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredActions(makeCtx());

    expect(ql.registerAction).toHaveBeenCalledTimes(1);
    const [objectKey, name] = ql.registerAction.mock.calls[0];
    expect(objectKey).toBe('ops_ticket');
    expect(name).toBe('escalate');
  });

  it('filters out artifact-shipped actions (registered by AppPlugin) to prevent clobbering', async () => {
    ql.registry.getArtifactItem.mockImplementation((type: string, name: string) =>
      type === 'action' && name === 'convert_lead' ? { name } : undefined);
    ql.find.mockImplementation(async (_obj: string, q: AnyRecord) =>
      q?.where?.type === 'action'
        ? [actionRow('authored_action'), actionRow('convert_lead')]
        : []);
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredActions(makeCtx());

    expect(ql.registerAction).toHaveBeenCalledTimes(1);
    expect(ql.registerAction.mock.calls[0][1]).toBe('authored_action');
  });

  it('filters actions embedded in a PACKAGED object artifact (object-editor overlay of a bundle object)', async () => {
    ql.registry.getArtifactItem.mockImplementation((type: string, name: string) =>
      type === 'object' && name === 'crm_lead'
        ? { name, _packageId: 'com.example.crm', actions: [{ name: 'convert' }] }
        : undefined);
    // The authored overlay of crm_lead carries a copy of the packaged action
    // plus a genuinely new one — only the new one may register.
    ql.find.mockImplementation(async (_obj: string, q: AnyRecord) => {
      if (q?.where?.type === 'object') {
        return [{
          type: 'object', name: 'crm_lead', state: 'active',
          metadata: JSON.stringify({
            name: 'crm_lead',
            actions: [
              { name: 'convert', type: 'script', body: { language: 'js', source: 'x' } },
              { name: 'authored_extra', type: 'script', body: { language: 'js', source: 'y' } },
            ],
          }),
        }];
      }
      return [];
    });
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredActions(makeCtx());

    expect(ql.registerAction).toHaveBeenCalledTimes(1);
    expect(ql.registerAction.mock.calls[0][1]).toBe('authored_extra');
  });

  it('unions metadata-service actions with DB rows; the DB row wins by object:name', async () => {
    const metadataService = {
      loadMany: vi.fn(async (type: string) =>
        type === 'action'
          ? [
              { name: 'fs_action', objectName: 'showcase_task', body: { language: 'js', source: 'a' } },
              { name: 'edited_action', objectName: 'showcase_task', body: { language: 'js', source: 'stale' } },
            ]
          : []),
    };
    ql.find.mockImplementation(async (_obj: string, q: AnyRecord) =>
      q?.where?.type === 'action' ? [actionRow('edited_action')] : []);
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredActions(makeCtx({ metadata: metadataService }));

    const registeredNames = ql.registerAction.mock.calls.map((c: any[]) => c[1]).sort();
    expect(registeredNames).toEqual(['edited_action', 'fs_action']);
    const runnerInputs = ql._defaultActionRunner.mock.calls.map((c: any[]) => c[0]);
    const edited = runnerInputs.find((a: AnyRecord) => a.name === 'edited_action');
    expect(edited.body.source).toBe('return 42;'); // fresh DB body replaced the stale service copy
  });

  it('tears the package set down (and registers nothing) when the last authored action was deleted', async () => {
    ql.find.mockResolvedValue([]);
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredActions(makeCtx());

    expect(ql.removeActionsByPackage).toHaveBeenCalledWith('metadata-service');
    expect(ql.registerAction).not.toHaveBeenCalled();
  });

  it('is a no-op when neither source is readable (never tears down on a failed read)', async () => {
    ql.find.mockRejectedValue(new Error('no such table: sys_metadata'));
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredActions(makeCtx()); // no metadata service either

    expect(ql.removeActionsByPackage).not.toHaveBeenCalled();
    expect(ql.registerAction).not.toHaveBeenCalled();
  });

  it('skips bodyless actions without registering a handler', async () => {
    ql.find.mockImplementation(async (_obj: string, q: AnyRecord) =>
      q?.where?.type === 'action'
        ? [actionRow('flow_action', {}, { type: 'flow', target: 'my_flow', body: undefined })]
        : []);
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredActions(makeCtx());

    expect(ql.registerAction).not.toHaveBeenCalled();
  });

  it('warns (and registers nothing) when no default action runner is installed', async () => {
    ql._defaultActionRunner = undefined;
    ql.find.mockImplementation(async (_obj: string, q: AnyRecord) =>
      q?.where?.type === 'action' ? [actionRow('orphan_action')] : []);
    const plugin = makePlugin(ql);
    const ctx = makeCtx();

    await (plugin as any).resyncAuthoredActions(ctx);

    expect(ql.registerAction).not.toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no default action runner'),
      expect.anything(),
    );
  });

  it('falls back to legacy plural rows when no singular rows exist', async () => {
    ql.find.mockImplementation(async (_obj: string, q: AnyRecord) => {
      if (q?.where?.type === 'actions') return [actionRow('legacy_plural_action', { type: 'actions' })];
      return [];
    });
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredActions(makeCtx());

    expect(ql.registerAction.mock.calls[0][1]).toBe('legacy_plural_action');
  });

  it('skips malformed rows without dropping the rest', async () => {
    ql.find.mockImplementation(async (_obj: string, q: AnyRecord) =>
      q?.where?.type === 'action'
        ? [{ type: 'action', name: 'broken', state: 'active', metadata: '{not json' }, actionRow('good_action')]
        : []);
    const plugin = makePlugin(ql);

    await (plugin as any).resyncAuthoredActions(makeCtx());

    expect(ql.registerAction).toHaveBeenCalledTimes(1);
    expect(ql.registerAction.mock.calls[0][1]).toBe('good_action');
  });
});

describe('ObjectQLPlugin protocol-mutation subscription (#2605)', () => {
  it('re-syncs authored actions on action AND object mutations (skips drafts and hooks)', async () => {
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
    const resyncActions = vi
      .spyOn(plugin as any, 'resyncAuthoredActions')
      .mockResolvedValue(undefined);
    const resyncHooks = vi
      .spyOn(plugin as any, 'resyncAuthoredHooks')
      .mockResolvedValue(undefined);

    (protocol as any).emitMetadataMutation({ type: 'action', name: 'a1', state: 'active' });
    expect(resyncActions).toHaveBeenCalledTimes(1);

    // Object rows embed actions[] — an object edit re-syncs actions too.
    (protocol as any).emitMetadataMutation({ type: 'object', name: 'o1', state: 'active' });
    expect(resyncActions).toHaveBeenCalledTimes(2);

    // Drafts are not live — no re-sync.
    (protocol as any).emitMetadataMutation({ type: 'action', name: 'a1', state: 'draft' });
    expect(resyncActions).toHaveBeenCalledTimes(2);

    // Hook mutations churn the hook bind, not the action set.
    (protocol as any).emitMetadataMutation({ type: 'hook', name: 'h1', state: 'active' });
    expect(resyncActions).toHaveBeenCalledTimes(2);
    expect(resyncHooks).toHaveBeenCalledTimes(1);

    // Deletes re-sync (teardown).
    (protocol as any).emitMetadataMutation({ type: 'action', name: 'a1', state: 'deleted' });
    expect(resyncActions).toHaveBeenCalledTimes(3);
  });
});
