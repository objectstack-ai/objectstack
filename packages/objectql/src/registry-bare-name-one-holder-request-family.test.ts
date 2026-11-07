// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One name, one package holder — the request family: an API, an object-less
 * action and an engine function (maintainer ruling C on #30798, phase 1, the
 * family's own change under #30803; `bare-name-one-holder.ts` states the rule,
 * the holders and the cold boot). The data family's pins are
 * `registry-bare-name-one-holder.test.ts`; this file holds the same matrix for
 * the next three, and what is particular to them:
 *
 *  - `api` and the object-less `action` are registry types, judged at the
 *    engine's package door and the registry's item seam exactly as a picklist
 *    is;
 *  - an action BOUND to an object is not covered — it is keyed
 *    `objectName:name` from declaration to handler — so it neither holds a
 *    name nor is refused over one;
 *  - a function is not a registry item: the engine's function registry keeps
 *    one per name, and its one package door is the hook binder's bind
 *    (`bindHooksToEngine`, `opts.functions`), which the runtime makes under the
 *    owner `app:<packageId>`.
 *
 * Every refusal is asserted by its ADR-0112 envelope (`code` + `status`), the
 * two holders it names and the rename it carries.
 *
 * Ablations: the same registrations BEFORE the seal coexist, so every refusal
 * here is the seal's.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import {
  SchemaRegistry,
  NAMESPACE_CONFLICT_CODE,
  sealBareNameHoldersAtColdBoot,
} from './registry.js';
import { BUILT_IN_BARE_NAMES, bareNameReason, handlerOwnerPackageId } from './bare-name-one-holder.js';
import type { HookHandler, ObjectQL } from './engine.js';

type ManifestService = { register(m: unknown): void | Promise<void> };
type Holder = { kind: string; packageId?: string };
type Conflict = { type: string; name: string; incomingPackageId: string; existingHolder: Holder; rename?: string };
type Refusal = Error & {
  code?: string;
  status?: number;
  incomingPackageId?: string;
  existingHolder?: Holder;
  conflicts?: Conflict[];
};

type RequestType = 'api' | 'action';
const TYPES: RequestType[] = ['api', 'action'];
const COLLECTION: Record<RequestType, string> = { api: 'apis', action: 'actions' };

/** A body each type's schema accepts, marked with `tag`; an `action` here is object-less. */
const body = (type: RequestType, name: string, tag: string): Record<string, unknown> =>
  type === 'api'
    ? {
        name, summary: `${tag} api`, path: `/api/v1/apps/${tag}/${name}`, method: 'GET',
        type: 'object_operation', objectParams: { object: `${tag}_item`, operation: 'find' },
      }
    : { name, label: `${tag} action`, type: 'script', body: { language: 'js', source: `return '${tag}';`, capabilities: [] } };

/** The marker `body` wrote: an API's `summary` (its schema has no `label`), an action's `label`. */
const marker = (item: unknown): string | undefined =>
  (item as { label?: string; summary?: string } | undefined)?.label ?? (item as { summary?: string } | undefined)?.summary;

/** An action bound to `object`. */
const boundAction = (name: string, tag: string, object: string): Record<string, unknown> => ({ ...body('action', name, tag), objectName: object });

/** The package's own object, so a bound action has a target. */
const itemObject = (ns: string) => ({
  name: `${ns}_item`, label: `${ns} item`,
  fields: { name: { type: 'text', label: 'Name' } },
});

/**
 * A flat package payload — the shape `AppPlugin.init` hands the manifest
 * service — whose namespace is its id's last segment, so the rename a refusal
 * carries is `<last segment>_<name>`.
 */
const pkg = (id: string, decl: Partial<Record<RequestType, string[]>> = {}, extra: Record<string, unknown> = {}) => {
  const ns = id.split('.').pop()!;
  const out: Record<string, unknown> = { id, name: ns, namespace: ns, version: '1.0.0', type: 'app', objects: [itemObject(ns)], ...extra };
  for (const type of TYPES) {
    const names = decl[type];
    if (names) out[COLLECTION[type]] = [...((extra[COLLECTION[type]] as unknown[]) ?? []), ...names.map((n) => body(type, n, ns))];
  }
  return out;
};

const caught = async (fn: () => unknown): Promise<Refusal | undefined> => {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
};

/** A function a package's handlers bring: a distinct closure per call, so `resolveFunction`'s identity tells two holders apart. */
const fn = (tag: string): HookHandler => Object.assign(async () => {}, { tag });
/** The functions a package's handlers bring, as the runtime binds them: under `app:<packageId>`. */
const bindFunctions = (ql: ObjectQL, packageId: string, names: string[], tag = packageId.split('.').pop()!) =>
  ql.bindHooks([], { packageId: `app:${packageId}`, functions: Object.fromEntries(names.map((n) => [n, fn(tag)])) });

/** A plugin registering `manifests` (and binding `functions`) in its `start()` — a package of the cold boot, before the seal. */
const bootPackages = (manifests: unknown[], functions: Array<{ packageId: string; names: string[] }> = []) => ({
  name: 'test.bare-name.request-family.boot-packages',
  version: '1.0.0',
  dependencies: ['com.objectstack.engine.objectql'],
  init: async () => {},
  start: async (ctx: { getService<T>(name: string): T }) => {
    const manifest = ctx.getService<ManifestService>('manifest');
    for (const m of manifests) await manifest.register(m);
    const ql = ctx.getService<ObjectQL>('objectql');
    for (const f of functions) bindFunctions(ql, f.packageId, f.names);
  },
});

const kernels: ObjectKernel[] = [];
const boot = async (atBoot: unknown[] = [], functions: Array<{ packageId: string; names: string[] }> = []) => {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  const warn = vi.spyOn((kernel as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger, 'warn');
  await kernel.use(new ObjectQLPlugin());
  if (atBoot.length > 0 || functions.length > 0) await kernel.use(bootPackages(atBoot, functions) as never);
  kernels.push(kernel);
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  ql.registry.logLevel = 'silent';
  const manifest = kernel.getService<ManifestService>('manifest');
  const bareNameWarnings = () =>
    warn.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith('Bare-name conflict at boot'));
  return { ql, registry: ql.registry, register: (m: unknown) => caught(() => manifest.register(m)), bareNameWarnings };
};

afterEach(async () => {
  while (kernels.length) {
    const k = kernels.pop()!;
    if (k.getState() === 'running') await k.shutdown();
  }
});

/** The envelope, the two holders and the rename of one refusal. */
function expectRefusal(err: Refusal | undefined, incoming: string, holder: Holder, rename?: string) {
  expect(err, 'the registration was refused').toBeDefined();
  expect(err!.name).toBe('BareNameConflictError');
  expect(err!.code).toBe(NAMESPACE_CONFLICT_CODE);
  expect(err!.status).toBe(422);
  expect(err!.incomingPackageId).toBe(incoming);
  expect(err!.existingHolder).toEqual(holder);
  expect(err!.message).toContain(incoming);
  if (holder.packageId) expect(err!.message).toContain(holder.packageId);
  if (rename) {
    expect(err!.conflicts![0].rename).toBe(rename);
    expect(err!.message).toContain(rename);
  }
}

describe.each(TYPES)('%s — after the cold boot, a second package declaring a name another package holds', (type) => {
  const name = `shared_${type}`;
  const label = (tag: string) => `${tag} ${type}`;

  it('is refused at the package door, naming both packages and the rename, and leaves no record behind', async () => {
    const { registry, register } = await boot();
    expect(registry.bareNameHoldersAreSealed).toBe(true);
    expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();

    const err = await register(pkg('com.acme.beta', { [type]: [name] }));
    expectRefusal(err, 'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' }, `beta_${name}`);
    expect(err!.conflicts).toEqual([
      { type, name, incomingPackageId: 'com.acme.beta', existingHolder: { kind: 'package', packageId: 'com.acme.alpha' }, rename: `beta_${name}` },
    ]);
    expect(err!.message).toContain(type === 'api' ? `the API "${name}"` : `the object-less action "${name}"`);
    expect(registry.getPackage('com.acme.beta')).toBeUndefined();
    expect(marker(registry.getItem(type, name))).toBe(label('alpha'));
  });

  it('ABLATION — before the seal the same two registrations coexist (the doors judge nothing during a boot)', async () => {
    const registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    registry.installPackage(pkg('com.acme.alpha', { [type]: [name] }) as never, 'code');
    expect(await caught(() => registry.installPackage(pkg('com.acme.beta', { [type]: [name] }) as never, 'code'))).toBeUndefined();
    registry.registerItem(type, body(type, name, 'alpha'), 'name', 'com.acme.alpha');
    expect(await caught(() => registry.registerItem(type, body(type, name, 'beta'), 'name', 'com.acme.beta'))).toBeUndefined();
    registry.sealBareNameHolders();
    expect(await caught(() => registry.installPackage(pkg('com.acme.gamma', { [type]: [name] }) as never, 'code'))).toBeDefined();
    expect(await caught(() => registry.registerItem(type, body(type, name, 'gamma'), 'name', 'com.acme.gamma'))).toBeDefined();
  });

  it('the item seam refuses a package-bound registration over another package\'s name', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();
    const err = await caught(() => registry.registerItem(type, body(type, name, 'direct'), 'name', 'com.acme.direct'));
    expectRefusal(err, 'com.acme.direct', { kind: 'package', packageId: 'com.acme.alpha' });
    expect(marker(registry.getItem(type, name))).toBe(label('alpha'));
  });

  it('a nested plugin declares under its parent package, and is held to the same rule', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', {}, { plugins: [{ name: 'inner', [COLLECTION[type]]: [body(type, name, 'inner')] }] }))).toBeUndefined();
    const err = await register(pkg('com.acme.beta', { [type]: [name] }));
    expectRefusal(err, 'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' });
  });

  it('CONTROL — the same package registering its own name again is one holder, not two', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();
    expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();
  });

  it('uninstalling the holder releases the name', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();
    expect(registry.uninstallPackage('com.acme.alpha')).toBe(true);
    expect(await register(pkg('com.acme.beta', { [type]: [name] }))).toBeUndefined();
  });

  it('CONTROL — an environment registration (no package: the ADR-0005 overlay) is never judged, and never holds a name', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();
    expect(await caught(() => registry.registerItem(type, body(type, name, 'env'), 'name'))).toBeUndefined();
    registry.registerItem(type, body(type, `env_${type}`, 'env'), 'name');
    expect(await register(pkg('com.acme.beta', { [type]: [`env_${type}`] }))).toBeUndefined();
  });

  describe('the cold boot of a deployment that already holds the clash', () => {
    const atBoot = () => [pkg('com.acme.alpha', { [type]: [name] }), pkg('com.acme.beta', { [type]: [name] })];

    it('boots, and warns once naming both holders and the rename (switch "warn")', async () => {
      const { registry, bareNameWarnings } = await boot(atBoot());
      expect(registry.bareNameHoldersAreSealed).toBe(true);
      const warnings = bareNameWarnings();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('com.acme.alpha');
      expect(warnings[0]).toContain('com.acme.beta');
      expect(warnings[0]).toContain(`beta_${name}`);
      expect(warnings[0]).toContain('changes nothing about which holder each caller is served');
    });

    it('both holders keep their name across a reload; a third package is refused naming both', async () => {
      const { register } = await boot(atBoot());
      expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();
      expect(await register(pkg('com.acme.beta', { [type]: [name] }))).toBeUndefined();
      const err = await register(pkg('com.acme.gamma', { [type]: [name] }));
      expectRefusal(err, 'com.acme.gamma', { kind: 'package', packageId: 'com.acme.alpha' }, `gamma_${name}`);
      expect(err!.conflicts!.map((c) => c.existingHolder)).toEqual([
        { kind: 'package', packageId: 'com.acme.alpha' },
        { kind: 'package', packageId: 'com.acme.beta' },
      ]);
    });

    it('under the switch "refuse", the cold boot is refused with the doors\' envelope', async () => {
      const registry = new SchemaRegistry();
      registry.logLevel = 'silent';
      for (const m of atBoot()) registry.installPackage(m as never, 'code');
      const err = await caught(() => sealBareNameHoldersAtColdBoot(registry, 'refuse'));
      expectRefusal(err, 'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' }, `beta_${name}`);
      expect(err!.message).toContain('The boot is refused');
    });
  });
});

describe('action — only the object-less action holds its name', () => {
  it('CONTROL — two packages\' same-named actions bound to their own objects coexist (keyed objectName:name)', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', {}, { actions: [boundAction('mark_done', 'alpha', 'alpha_item')] }))).toBeUndefined();
    expect(await register(pkg('com.acme.beta', {}, { actions: [boundAction('mark_done', 'beta', 'beta_item')] }))).toBeUndefined();
  });

  it('CONTROL — a bound action is no holder of an object-less action\'s name, and is not refused over one', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', {}, { actions: [boundAction('run_it', 'alpha', 'alpha_item')] }))).toBeUndefined();
    expect(await register(pkg('com.acme.beta', { action: ['run_it'] }))).toBeUndefined();
    expect(await register(pkg('com.acme.gamma', {}, { actions: [boundAction('run_it', 'gamma', 'gamma_item')] }))).toBeUndefined();
    // …while a second OBJECT-LESS one is refused, naming the object-less holder only.
    const err = await register(pkg('com.acme.delta', { action: ['run_it'] }));
    expectRefusal(err, 'com.acme.delta', { kind: 'package', packageId: 'com.acme.beta' }, 'delta_run_it');
    expect(err!.conflicts).toHaveLength(1);
  });

  it('the item seam judges the object-less action and lets a bound one through', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.alpha', { action: ['run_it'] }))).toBeUndefined();
    expect(await caught(() => registry.registerItem('action', boundAction('run_it', 'direct', 'direct_item'), 'name', 'com.acme.direct'))).toBeUndefined();
    expectRefusal(
      await caught(() => registry.registerItem('action', body('action', 'run_it', 'direct'), 'name', 'com.acme.other')),
      'com.acme.other', { kind: 'package', packageId: 'com.acme.alpha' },
    );
  });
});

describe('function — the engine function registry, through the hook binder\'s bind', () => {
  it('the runtime\'s handler owner `app:<packageId>` is read as the package', () => {
    expect(handlerOwnerPackageId('app:com.acme.alpha')).toBe('com.acme.alpha');
    expect(handlerOwnerPackageId('metadata-service')).toBe('metadata-service');
    expect(handlerOwnerPackageId('app:')).toBe('app:');
  });

  it('after the cold boot, a bind bringing a function another package holds is refused naming both and the rename, and registers nothing', async () => {
    const { ql, register } = await boot();
    expect(await register(pkg('com.acme.alpha'))).toBeUndefined();
    expect(await register(pkg('com.acme.beta'))).toBeUndefined();
    bindFunctions(ql, 'com.acme.alpha', ['shared_fn']);
    const served = ql.resolveFunction('shared_fn');

    const err = await caught(() => bindFunctions(ql, 'com.acme.beta', ['shared_fn', 'beta_only_fn']));
    expectRefusal(err, 'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' }, 'beta_shared_fn');
    expect(err!.conflicts!.map((c) => `${c.type}/${c.name}`)).toEqual(['function/shared_fn']);
    expect(err!.message).toContain('the function "shared_fn"');
    // Ahead of every registration: neither function of the refused bind is registered.
    expect(ql.resolveFunction('shared_fn')).toBe(served);
    expect(ql.resolveFunctionEntry('shared_fn')?.packageId).toBe('app:com.acme.alpha');
    expect(ql.resolveFunction('beta_only_fn')).toBeUndefined();
  });

  it('ABLATION — before the seal the same two binds coexist, the last-registered served', async () => {
    const registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    expect(await caught(() => registry.claimBareNameFunctions('app:com.acme.alpha', ['shared_fn']))).toBeUndefined();
    expect(await caught(() => registry.claimBareNameFunctions('app:com.acme.beta', ['shared_fn']))).toBeUndefined();
    const conflicts = registry.sealBareNameHolders();
    expect(conflicts.map((c) => `${c.type}/${c.name}: ${c.incomingPackageId} vs ${(c.existingHolder as Holder).packageId}`)).toEqual([
      'function/shared_fn: com.acme.beta vs com.acme.alpha',
    ]);
    expectRefusal(
      await caught(() => registry.claimBareNameFunctions('app:com.acme.gamma', ['shared_fn'])),
      'com.acme.gamma', { kind: 'package', packageId: 'com.acme.alpha' },
    );
  });

  it('CONTROL — a package binding its own functions again (a hot reload) is one holder, not two', async () => {
    const { ql, register } = await boot();
    expect(await register(pkg('com.acme.alpha'))).toBeUndefined();
    bindFunctions(ql, 'com.acme.alpha', ['shared_fn']);
    expect(await caught(() => bindFunctions(ql, 'com.acme.alpha', ['shared_fn']))).toBeUndefined();
  });

  it('CONTROL — an owner-less bind is never judged, and holds nothing', async () => {
    const { ql, register } = await boot();
    expect(await register(pkg('com.acme.alpha'))).toBeUndefined();
    bindFunctions(ql, 'com.acme.alpha', ['shared_fn']);
    expect(await caught(() => ql.bindHooks([], { functions: { shared_fn: fn('anon'), anon_fn: fn('anon') } }))).toBeUndefined();
    expect(await caught(() => bindFunctions(ql, 'com.acme.beta', ['anon_fn']))).toBeUndefined();
  });

  it('CONTROL — an entry with no callable handler claims nothing', async () => {
    const { ql } = await boot();
    ql.bindHooks([], { packageId: 'app:com.acme.alpha', functions: { not_code: { effect: 'pure' } as never } });
    expect(await caught(() => bindFunctions(ql, 'com.acme.beta', ['not_code']))).toBeUndefined();
  });

  it('uninstalling the holder releases the name', async () => {
    const { ql, registry, register } = await boot();
    expect(await register(pkg('com.acme.alpha'))).toBeUndefined();
    bindFunctions(ql, 'com.acme.alpha', ['shared_fn']);
    expect(registry.uninstallPackage('com.acme.alpha')).toBe(true);
    expect(await caught(() => bindFunctions(ql, 'com.acme.beta', ['shared_fn']))).toBeUndefined();
  });

  describe('the cold boot of a deployment whose packages already bind one function name', () => {
    const atBoot = () => [pkg('com.acme.alpha'), pkg('com.acme.beta')];
    const binds = () => [
      { packageId: 'com.acme.alpha', names: ['shared_fn'] },
      { packageId: 'com.acme.beta', names: ['shared_fn'] },
    ];

    it('boots, and warns once naming both packages (not their handler owners) and the rename', async () => {
      const { ql, bareNameWarnings } = await boot(atBoot(), binds());
      const warnings = bareNameWarnings();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('the function "shared_fn"');
      expect(warnings[0]).toContain('package "com.acme.beta"');
      expect(warnings[0]).toContain('package "com.acme.alpha"');
      expect(warnings[0]).not.toContain('app:com.acme');
      expect(warnings[0]).toContain('beta_shared_fn');
      // Unchanged by the rule: the last-registered function is served.
      expect(ql.resolveFunctionEntry('shared_fn')?.packageId).toBe('app:com.acme.beta');
    });

    it('both keep binding their own function after the boot; a third package is refused naming both', async () => {
      const { ql } = await boot(atBoot(), binds());
      expect(await caught(() => bindFunctions(ql, 'com.acme.alpha', ['shared_fn']))).toBeUndefined();
      expect(await caught(() => bindFunctions(ql, 'com.acme.beta', ['shared_fn']))).toBeUndefined();
      const err = await caught(() => bindFunctions(ql, 'com.acme.gamma', ['shared_fn']));
      expect(err?.code).toBe(NAMESPACE_CONFLICT_CODE);
      expect(err!.conflicts!.map((c) => c.existingHolder)).toEqual([
        { kind: 'package', packageId: 'com.acme.alpha' },
        { kind: 'package', packageId: 'com.acme.beta' },
      ]);
    });
  });
});

describe('the refusal\'s reason names the consumers of the types it lists', () => {
  it('one sentence per refusal, naming only the types it carries', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', { api: ['a1'], action: ['r1'] }))).toBeUndefined();
    const err = await register(pkg('com.acme.beta', { api: ['a1'], action: ['r1'] }));
    expect(err!.conflicts!.map((c) => `${c.type}/${c.name}`)).toEqual(['api/a1', 'action/r1']);
    expect(err!.message).toContain(bareNameReason(['api', 'action']));
    expect(bareNameReason(['api', 'action'])).toMatch(/^An API and an object-less action each hold one name per deployment: /);
    expect(bareNameReason(['function'])).toMatch(/^A function holds one name per deployment: /);
  });

  it('a built-in name is refused to a package at the package door, naming the platform', async () => {
    const builtIns = BUILT_IN_BARE_NAMES.api as Set<string>;
    builtIns.add('platform_api');
    try {
      const { register } = await boot();
      const err = await register(pkg('com.acme.alpha', { api: ['platform_api'] }));
      expectRefusal(err, 'com.acme.alpha', { kind: 'built-in' }, 'alpha_platform_api');
    } finally {
      builtIns.delete('platform_api');
    }
  });
});
