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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import { ObjectQL } from './engine.js';
import { isServedOverrideRowOf } from '@objectstack/metadata-protocol';
import { installedManifestsOf } from '@objectstack/metadata-core';

/** Nothing installed: the pair lookup reads no manifest while `appOf` is the identity. */
const NOTHING_INSTALLED = installedManifestsOf(undefined);

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
    // The plugin reads it through `getDefaultActionRunner()` (#4251); the
    // field stays so tests can swap or clear the runner directly.
    _defaultActionRunner: vi.fn((action: AnyRecord) =>
      action?.body ? async () => `ran:${action.name}` : undefined),
    getDefaultActionRunner(): unknown {
      return (this as AnyRecord)._defaultActionRunner;
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

  // [#21911, ADR-0096] The boot / resync read is platform plumbing with no
  // caller behind it: it carries the explicit system opt-in rather than
  // reaching the engine as a principal-less context. No singular rows, so all
  // three reads issue — the singular one, the legacy plural fallback and the
  // embedded-object read.
  it('reads sys_metadata with the explicit system opt-in on every read (#21911)', async () => {
    ql.find.mockResolvedValue([]);

    await (makePlugin(ql) as any).resyncAuthoredActions(makeCtx());

    const reads = ql.find.mock.calls.filter(([obj]: [string]) => obj === 'sys_metadata');
    expect(reads.map(([, q]: [string, AnyRecord]) => q?.where?.type)).toEqual(['action', 'actions', 'object']);
    for (const [, q] of reads) expect(q?.context).toEqual({ isSystem: true });
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

/**
 * [#30065, ADR-0146 D9 `action`] The handler half of conditions 1 and 2 for a
 * script action, on a real engine: a declared `.custom` override's body is
 * bound over the code package's handler, and removing the override binds the
 * code package's body again — in one resync each way. The base handler is
 * registered as AppPlugin registers a bundle's (`app:<id>`), and is never
 * re-registered by the test: what runs after the restore is the handler the
 * override was bound over.
 */
describe('[#30065] a declared .custom action override rebinds the body, and restoring it runs the base body', () => {
  const BASE = 'com.example.showcase';
  const PAIR = 'com.example.showcase.custom';
  const DEPENDENT = 'com.default.acme-custom';
  const OBJ = 'showcase_task';
  const ACT = 'showcase_task_close';
  const declared = { overrides: { package: BASE, basedOn: '1.0.0' } };

  function harness(opts: { baseBound?: boolean } = {}) {
    const ql = new ObjectQL();
    const artifact = {
      name: ACT, objectName: OBJ, type: 'script', label: 'SHIPPED',
      body: { language: 'js', source: 'return 1;' }, _packageId: BASE,
    };
    let registered = opts.baseBound !== false;
    vi.spyOn(ql.registry, 'getArtifactItem').mockImplementation(((type: string, name: string) =>
      registered && type === 'action' && name === ACT ? artifact : undefined) as any);
    ql.setDefaultActionRunner((action: AnyRecord) =>
      action?.body ? async () => `ran:${action.label}` : undefined);
    // What `bindAppArtifactHandlers` does for the base (AppPlugin at start, a
    // marketplace base's rehydrate at `kernel:ready`): register the manifest,
    // tear down its owner's handlers, and bind them again.
    const bindBase = (body = 'BASE BODY') => {
      registered = true;
      ql.removeActionsByPackage(`app:${BASE}`);
      ql.registerAction(OBJ, ACT, async () => `ran:${body}`, `app:${BASE}`);
    };
    if (registered) bindBase();
    let rows: AnyRecord[] = [];
    vi.spyOn(ql, 'find').mockImplementation((async (_obj: string, q: AnyRecord) =>
      q?.where?.type === 'action' ? rows : []) as any);
    const plugin = makePlugin(ql as unknown as AnyRecord);
    const resync = async (next: AnyRecord[]) => {
      rows = next;
      await (plugin as any).resyncAuthoredActions(makeCtx());
    };
    const run = () => ql.executeAction(OBJ, ACT, {});
    return { ql, resync, run, bindBase };
  }
  const overrideRow = (packageId: string, label: string, payload: AnyRecord = declared) =>
    actionRow(ACT, { package_id: packageId }, { label, ...payload });

  it('override, restore, run again: the base package body runs', async () => {
    const { resync, run } = harness();
    await expect(run()).resolves.toBe('ran:BASE BODY');

    await resync([overrideRow(PAIR, 'OVERRIDE')]);
    await expect(run()).resolves.toBe('ran:OVERRIDE');

    await resync([]);
    await expect(run()).resolves.toBe('ran:BASE BODY');
  });

  it('a base bound AFTER the override\'s resync (a marketplace base\'s rehydrate) slots beneath it: the override runs, and a restore runs the base body', async () => {
    // Boot order for an installed base: ObjectQLPlugin's `kernel:ready`
    // resync runs before the install plugin's rehydrate registers the base
    // and binds its handlers, and the rehydrate announces no reload.
    const { resync, run, bindBase } = harness({ baseBound: false });
    await resync([overrideRow(PAIR, 'OVERRIDE')]);
    await expect(run()).resolves.toBe('ran:OVERRIDE');
    bindBase();
    await expect(run()).resolves.toBe('ran:OVERRIDE');
    await resync([]);
    await expect(run()).resolves.toBe('ran:BASE BODY');
  });

  it('the base\'s handlers re-bound while the override is armed keep the override on top, and the restore runs the newly bound base body', async () => {
    const { resync, run, bindBase } = harness();
    await resync([overrideRow(PAIR, 'OVERRIDE')]);
    bindBase('REBOUND BASE BODY');
    await expect(run()).resolves.toBe('ran:OVERRIDE');
    await resync([overrideRow(PAIR, 'OVERRIDE')]);
    await expect(run()).resolves.toBe('ran:OVERRIDE');
    await resync([]);
    await expect(run()).resolves.toBe('ran:REBOUND BASE BODY');
  });

  it('before the base is registered, a pair row without the declaration, or a dependent\'s declaration, is no override: the base bound later replaces it', async () => {
    for (const row of [overrideRow(PAIR, 'UNDECLARED', {}), overrideRow(DEPENDENT, 'DEPENDENT')]) {
      const { resync, run, bindBase } = harness({ baseBound: false });
      await resync([row]);
      bindBase();
      await expect(run()).resolves.toBe('ran:BASE BODY');
    }
  });

  it('[#30542] before the base is registered, another base\'s declared override of the same key is replaced by the real base\'s handler, as every read declines it', async () => {
    // A row of `com.example.other`'s pair declaring that package, for the key
    // the real base ships: bound on its own declaration while no artifact is
    // registered, it is not the real base's override.
    const OTHER = 'com.example.other';
    const row = overrideRow(`${OTHER}.custom`, 'OTHER BASE', { overrides: { package: OTHER, basedOn: '1.0.0' } });
    const { ql, resync, run, bindBase } = harness({ baseBound: false });
    await resync([row]);
    await expect(run()).resolves.toBe('ran:OTHER BASE');
    const warn = vi.spyOn((ql as any).logger, 'warn');
    bindBase();
    await expect(run()).resolves.toBe('ran:BASE BODY');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toMatchObject({ package: `app:${BASE}`, replacedPackage: 'metadata-service' });
    // The reads judge the row against the real base by the one served-override
    // predicate, and decline it: the run now agrees with them.
    expect([isServedOverrideRowOf(row as any, BASE, NOTHING_INSTALLED), isServedOverrideRowOf(row as any, OTHER, NOTHING_INSTALLED)]).toEqual([false, true]);
    // The next resync judges the row against the registered artifact and
    // leaves the base's handler bound.
    await resync([row]);
    await expect(run()).resolves.toBe('ran:BASE BODY');
  });

  it('re-binding the armed override keeps the base beneath it, so a later restore still runs the base body', async () => {
    const { resync, run } = harness();
    await resync([overrideRow(PAIR, 'FIRST')]);
    await resync([overrideRow(PAIR, 'SECOND')]);
    await expect(run()).resolves.toBe('ran:SECOND');
    await resync([]);
    await expect(run()).resolves.toBe('ran:BASE BODY');
    await resync([overrideRow(PAIR, 'AGAIN')]);
    await expect(run()).resolves.toBe('ran:AGAIN');
  });

  it('a pair row without the declaration, and a dependent package\'s declaration, never bind over the base', async () => {
    const { resync, run } = harness();
    await resync([overrideRow(PAIR, 'UNDECLARED', {})]);
    await expect(run()).resolves.toBe('ran:BASE BODY');
    await resync([overrideRow(DEPENDENT, 'DEPENDENT')]);
    await expect(run()).resolves.toBe('ran:BASE BODY');
    await resync([overrideRow(PAIR, 'OTHER BASE', { overrides: { package: 'com.example.other', basedOn: '1.0.0' } })]);
    await expect(run()).resolves.toBe('ran:BASE BODY');
  });

  it('an override without a body leaves the base handler bound, and the resync counts it as handler-less', async () => {
    const { resync, run } = harness();
    await resync([overrideRow(PAIR, 'FLOW', { ...declared, type: 'flow', target: 'close_flow', body: undefined })]);
    await expect(run()).resolves.toBe('ran:BASE BODY');
  });

  it('[#30542] a registration with no package under an armed override replaces it and is warned, naming both owners', async () => {
    const ql = new ObjectQL();
    ql.registerAction(OBJ, ACT, async () => 'base', `app:${BASE}`);
    ql.registerActionOverride(OBJ, ACT, async () => 'override', 'metadata-service', BASE);
    const warn = vi.spyOn((ql as any).logger, 'warn');
    ql.registerAction(OBJ, ACT, async () => 'unpackaged');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toMatchObject({ objectName: OBJ, actionName: ACT, package: undefined, replacedPackage: 'metadata-service' });
    await expect(ql.executeAction(OBJ, ACT, {})).resolves.toBe('unpackaged');
  });

  it('the handler stack: removing the base under an armed override keeps the override, and removing both unbinds the name', async () => {
    const ql = new ObjectQL();
    ql.registerAction(OBJ, ACT, async () => 'base', `app:${BASE}`);
    ql.registerActionOverride(OBJ, ACT, async () => 'override', 'metadata-service');
    await expect(ql.executeAction(OBJ, ACT, {})).resolves.toBe('override');
    ql.removeActionsByPackage(`app:${BASE}`);
    await expect(ql.executeAction(OBJ, ACT, {})).resolves.toBe('override');
    ql.removeActionsByPackage('metadata-service');
    await expect(ql.executeAction(OBJ, ACT, {})).rejects.toThrow(/not found/);
    // An override bound where no handler is registered stands alone.
    ql.registerActionOverride(OBJ, ACT, async () => 'alone', 'metadata-service');
    await expect(ql.executeAction(OBJ, ACT, {})).resolves.toBe('alone');
    ql.removeActionsByPackage('metadata-service');
    await expect(ql.executeAction(OBJ, ACT, {})).rejects.toThrow(/not found/);
  });
});

/**
 * [#32990] On a booted kernel, the resync judges "artifact-shipped" against
 * each code package's own action of the name, by the object it owns, not by
 * the first package found under the bare name.
 *
 * The composition: package A ships a script action `approve` on its object,
 * package B ships one of the same name on its own, and the environment
 * authors its own script action `approve` on an object neither binds. The
 * route serves the environment's declaration there (#32751), and its
 * dispatch names no package, so it runs the handler the resync binds for
 * that object. The bare-name filter found A's (or B's) artifact and skipped
 * the row, so nothing ran there. Each holder binds its own handler now; a row
 * on an object a package's action owns stays that holder's customization
 * (ADR-0150 D4), whose handler stays the one that runs.
 *
 * Real: `ObjectKernel`, `ObjectQLPlugin` (its `kernel:ready` resync reads the
 * stored rows), `ObjectQL` and its `SchemaRegistry`, the manifest service.
 * Doubled: the driver (one row map per object) and what the runtime's
 * AppPlugin does at start: the default action runner, and each package's
 * handler bound under `app:PACKAGE`.
 */
describe('[#32990] the resync judges artifact-shipped by each holder\'s owner key, on a booted kernel', () => {
  const A = 'com.acme.alpha';
  const B = 'com.acme.beta';
  const PAIR_OF_B = `${B}.custom`;
  const ON_A = 'alpha_account';
  const ON_B = 'beta_contact';
  const ON_ENV = 'env_lead';

  const script = (label: string, objectName?: string, extra: AnyRecord = {}) => ({
    name: 'approve', label, type: 'script',
    ...(objectName !== undefined ? { objectName } : {}),
    body: { language: 'js', source: `return '${label}';` },
    ...extra,
  });
  const packageOf = (id: string, objectName: string, opts: { objectLess?: true } = {}) => {
    const ns = id.split('.').pop()!;
    return {
      id, name: ns, namespace: ns, version: '1.0.0', type: 'app',
      objects: [{ name: objectName, label: objectName, fields: { name: { name: 'name', label: 'Name', type: 'text' } } }],
      actions: [script(ns, opts.objectLess ? undefined : objectName)],
    };
  };
  const storedRow = (id: string, body: AnyRecord, packageId: string | null = null) => ({
    id, type: 'action', name: body.name, state: 'active', package_id: packageId, metadata: JSON.stringify(body),
  });

  function rowStoreDriver(rows: AnyRecord[]) {
    const matches = (row: AnyRecord, where: AnyRecord | undefined): boolean =>
      Object.entries(where ?? {}).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`row store driver: combinator ${k} is not implemented`);
        if (v !== null && typeof v === 'object') throw new Error(`row store driver: operator on ${k} is not implemented`);
        return row[k] === v;
      });
    return {
      name: 'row-store', version: '0.0.0', supports: {},
      async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async syncSchema() {},
      async find(object: string, ast: AnyRecord) {
        if (object !== 'sys_metadata') return [];
        const hits = rows.filter((r) => matches(r, ast?.where));
        const page = typeof ast?.limit === 'number' ? hits.slice(0, ast.limit) : hits;
        return page.map((r) => ({ ...r }));
      },
      async findOne(object: string, ast: AnyRecord) {
        return object === 'sys_metadata' ? rows.find((r) => matches(r, ast?.where)) ?? null : null;
      },
      async count(object: string, ast: AnyRecord) {
        return object === 'sys_metadata' ? rows.filter((r) => matches(r, ast?.where)).length : 0;
      },
      async create() { throw new Error('row store driver: no writes'); },
      async update() { throw new Error('row store driver: no writes'); },
      async delete() { throw new Error('row store driver: no writes'); },
    };
  }

  const kernels: ObjectKernel[] = [];
  afterEach(async () => {
    while (kernels.length) {
      const k = kernels.pop()!;
      if (k.getState() === 'running') await k.shutdown();
    }
  });

  /** Boot with `packages` registered in that order during the cold boot and `rows` stored; the `kernel:ready` resync binds. */
  async function boot(packages: AnyRecord[], rows: AnyRecord[], disabled: string[] = []): Promise<ObjectQL> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    kernels.push(kernel);
    await kernel.use({
      name: 'test.row-store', type: 'driver', version: '1.0.0',
      init: async (ctx: AnyRecord) => { ctx.registerService('driver.row-store', rowStoreDriver(rows)); },
    } as never);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use({
      name: 'test.app-plugin', version: '1.0.0',
      dependencies: ['com.objectstack.engine.objectql'],
      init: async () => {},
      start: async (ctx: AnyRecord) => {
        const ql = ctx.getService('objectql') as ObjectQL;
        ql.registry.logLevel = 'silent';
        ql.setDefaultActionRunner((action: AnyRecord) => (action?.body ? async () => `ran ${action.label}` : undefined));
        const manifest = ctx.getService('manifest') as { register(m: unknown): Promise<void> | void };
        for (const p of packages) {
          await manifest.register(structuredClone(p));
          for (const a of p.actions) ql.registerAction(a.objectName ?? 'global', a.name, async () => `ran ${a.label}`, `app:${p.id}`);
        }
        for (const id of disabled) ql.registry.disablePackage(id);
      },
    } as never);
    await kernel.bootstrap();
    return kernel.getService<ObjectQL>('objectql');
  }

  const ORDERS = [['A then B', [packageOf(A, ON_A), packageOf(B, ON_B)]], ['B then A', [packageOf(B, ON_B), packageOf(A, ON_A)]]] as const;
  const run = (ql: ObjectQL, object: string) => ql.executeAction(object, 'approve', {}).then((r) => r, (e: Error) => e.message);

  it('two holders and the environment\'s own action on an object neither binds: each runs its own body, in either registration order', async () => {
    for (const [order, packages] of ORDERS) {
      const ql = await boot([...packages], [storedRow('env-approve', script('env', ON_ENV))]);
      expect(await run(ql, ON_ENV), order).toBe('ran env');
      expect(await run(ql, ON_A), order).toBe('ran alpha');
      expect(await run(ql, ON_B), order).toBe('ran beta');
      expect(await ql.executeAction(ON_A, 'approve', {}, { packageId: A }), order).toBe('ran alpha');
      expect(await ql.executeAction(ON_B, 'approve', {}, { packageId: B }), order).toBe('ran beta');
    }
  });

  it('one holder and the environment\'s own action on another object: the environment\'s body runs there, the holder\'s on its own', async () => {
    const ql = await boot([packageOf(A, ON_A)], [storedRow('env-approve', script('env', ON_ENV))]);
    expect(await run(ql, ON_ENV)).toBe('ran env');
    expect(await run(ql, ON_A)).toBe('ran alpha');
  });

  it('CONTROL — a DISABLED holder registered after another still owns its object: the environment\'s row there binds nothing', async () => {
    const D = 'com.acme.delta';
    const ql = await boot([packageOf(A, ON_A), packageOf(D, ON_ENV)], [storedRow('env-approve', script('env', ON_ENV))], [D]);
    expect(await run(ql, ON_ENV)).toBe('ran delta');
  });

  it('CONTROL — a package-less row on an object a holder\'s action owns is that holder\'s customization: the holder\'s body keeps running, in either registration order', async () => {
    for (const [order, packages] of ORDERS) {
      const ql = await boot([...packages], [storedRow('env-on-b', script('env', ON_B))]);
      expect(await run(ql, ON_B), order).toBe('ran beta');
      expect(await run(ql, ON_A), order).toBe('ran alpha');
    }
  });

  it('CONTROL — an object-less action a package ships owns every object: a row on another object binds nothing', async () => {
    const ql = await boot([packageOf(A, ON_A, { objectLess: true })], [storedRow('env-approve', script('env', ON_ENV))]);
    expect(await run(ql, ON_ENV)).toBe(`Action 'approve' on object '${ON_ENV}' not found`);
    expect(await run(ql, 'global')).toBe('ran alpha');
  });

  it('the declared override of the holder registered SECOND binds over that holder\'s handler, in either registration order', async () => {
    const override = storedRow('pair-approve', script('override', ON_B, { overrides: { package: B, basedOn: '1.0.0' } }), PAIR_OF_B);
    for (const [order, packages] of ORDERS) {
      const ql = await boot([...packages], [override]);
      expect(await run(ql, ON_B), order).toBe('ran override');
      expect(await run(ql, ON_A), order).toBe('ran alpha');
    }
  });

  it('[review S1] two holders both shipping an object-less action: the declared override of B binds over B\'s handler, in either registration order', async () => {
    const override = storedRow('pair-approve', script('override', undefined, { overrides: { package: B, basedOn: '1.0.0' } }), PAIR_OF_B);
    const objectLess = [packageOf(A, ON_A, { objectLess: true }), packageOf(B, ON_B, { objectLess: true })];
    for (const [order, packages] of [['A then B', objectLess], ['B then A', [...objectLess].reverse()]] as const) {
      const ql = await boot([...packages], [override]);
      expect(await ql.executeAction('global', 'approve', {}, { packageId: B }), order).toBe('ran override');
      expect(await ql.executeAction('global', 'approve', {}, { packageId: A }), order).toBe('ran alpha');
    }
  });
});
