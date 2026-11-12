// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One name, one package holder — the bare-name rule for a picklist, a mapping
 * and a dataset, at the engine's package door, at the registry's item seam and
 * at the cold boot (maintainer ruling C on #30798, phase 1;
 * `bare-name-one-holder.ts` states the rule, the holders and the cold boot).
 *
 * Why these three: a booted two-package measurement (#30803) found each one's
 * consumer resolving the bare name with no package — a field's `picklist`, an
 * import's `mappingName`, a dashboard's `datasetName` — so with two holders
 * every caller is served the first-registered one.
 *
 * The door under test is the real one: the `manifest` service ObjectQLPlugin
 * registers, which every package registration reaches through
 * `ObjectQL.registerApp` → `SchemaRegistry.installPackage`. The cold boot is
 * the real one too: a plugin registering packages in its `start()`, and the
 * engine plugin sealing at `kernel:bootstrapped`.
 *
 * Every refusal is asserted by its ADR-0112 envelope (`code` + `status`), by
 * the two holders it names and by the rename it carries; the prose is not
 * pinned beyond naming them.
 *
 * Ablations: the same registrations BEFORE the seal coexist — the doors judge
 * nothing until the cold boot has sealed — so every refusal below is the
 * seal's. Controls keep the refusal as narrow as the ruling: a package's own
 * name again, an environment registration over a package's name (the ADR-0005
 * overlay), a type the rule does not cover, a picklist extension.
 *
 * [ADR-0150 D2/D9, child B, #31700] All three have since narrowed to the
 * namespace (`NAMESPACE_SCOPED_BARE_NAME_TYPES`): the matrix below refuses a
 * second holder as a CO-OWNER of the first holder's namespace (a package of
 * namespace `alpha` that depends on `com.acme.alpha`), with the rename it gets
 * (`alpha_NAME`). "the narrowing" pins what changed: two namespaces' packages
 * each hold the name at every door and through the cold boot, while a
 * co-owner, a package with no namespace, the shareable namespaces and a
 * built-in name are still refused; and a `picklistExtensions` entry, whose
 * target resolves caller-less, is refused naming both holders of a name two
 * namespaces hold.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import {
  SchemaRegistry,
  NAMESPACE_CONFLICT_CODE,
  sealBareNameHoldersAtColdBoot,
  bareNameColdBootWarning,
} from './registry.js';
import { BARE_NAME_COLD_BOOT_MODE, BUILT_IN_BARE_NAMES } from './bare-name-one-holder.js';
import { resolvePackageScopedName } from './package-scoped-resolver.js';
import type { ObjectQL } from './engine.js';

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

type BareType = 'picklist' | 'mapping' | 'dataset';
const TYPES: BareType[] = ['picklist', 'mapping', 'dataset'];
const COLLECTION: Record<BareType, string> = { picklist: 'picklists', mapping: 'mappings', dataset: 'datasets' };

/** A body each type's schema accepts, marked with `tag`. */
const body = (type: BareType, name: string, tag: string): Record<string, unknown> => {
  switch (type) {
    case 'picklist':
      return { name, label: `${tag} list`, options: [{ label: `${tag} one`, value: `${tag}_one` }] };
    case 'mapping':
      return { name, label: `${tag} mapping`, sourceFormat: 'csv', targetObject: `${tag}_item`, fieldMapping: [{ source: 'Name', target: 'name' }] };
    case 'dataset':
      return {
        name, label: `${tag} dataset`, object: `${tag}_item`,
        dimensions: [{ name: 'note', label: 'Note', field: 'note', type: 'string' }],
        measures: [{ name: 'row_count', label: 'Count', aggregate: 'count' }],
      };
  }
};

/**
 * A flat package payload — the shape `AppPlugin.init` hands the manifest
 * service — whose namespace is its id's last segment, so the rename a refusal
 * carries is `<last segment>_<name>`.
 */
const pkg = (id: string, decl: Partial<Record<BareType, string[]>> = {}, extra: Record<string, unknown> = {}) => {
  const ns = id.split('.').pop()!;
  const out: Record<string, unknown> = { id, name: ns, namespace: ns, version: '1.0.0', type: 'app', ...extra };
  for (const type of TYPES) {
    const names = decl[type];
    if (names) out[COLLECTION[type]] = names.map((n) => body(type, n, ns));
  }
  return out;
};

/**
 * [#31700] A co-owner of `holder`'s namespace: it declares the namespace and
 * depends on `holder`, as the namespace gate requires. The rival a narrowed
 * type's matrix refuses: a package of another namespace is admitted now.
 */
const coOwner = (holder: string, id: string, decl: Partial<Record<BareType, string[]>> = {}, extra: Record<string, unknown> = {}) =>
  pkg(id, decl, { namespace: holder.split('.').pop()!, dependencies: { [holder]: '^1.0.0' }, ...extra });

/** The package that rivals `com.acme.alpha` for a name: a co-owner of its namespace (all three types have narrowed). */
const rival = (id: string, decl: Partial<Record<BareType, string[]>> = {}, extra: Record<string, unknown> = {}) =>
  coOwner('com.acme.alpha', id, decl, extra);

/** The rename a co-owner's refusal carries: the shared namespace prefixed. */
const renamed = (name: string) => `alpha_${name}`;

const caught = async (fn: () => unknown): Promise<Refusal | undefined> => {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
};

/** A plugin registering `manifests` in its `start()` — a package of the cold boot, before the seal. */
const bootPackages = (manifests: unknown[]) => ({
  name: 'test.bare-name.boot-packages',
  version: '1.0.0',
  dependencies: ['com.objectstack.engine.objectql'],
  init: async () => {},
  start: async (ctx: { getService<T>(name: string): T }) => {
    const manifest = ctx.getService<ManifestService>('manifest');
    for (const m of manifests) await manifest.register(m);
  },
});

const kernels: ObjectKernel[] = [];
const boot = async (atBoot: unknown[] = []) => {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  const warn = vi.spyOn((kernel as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger, 'warn');
  await kernel.use(new ObjectQLPlugin());
  if (atBoot.length > 0) await kernel.use(bootPackages(atBoot) as never);
  kernels.push(kernel);
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  ql.registry.logLevel = 'silent';
  const manifest = kernel.getService<ManifestService>('manifest');
  const bareNameWarnings = () =>
    warn.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith('Bare-name conflict at boot'));
  return { registry: ql.registry, register: (m: unknown) => caught(() => manifest.register(m)), bareNameWarnings };
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

it('the switch is "warn" until the maintainer rules on the cold boot (#30803)', () => {
  expect(BARE_NAME_COLD_BOOT_MODE).toBe('warn');
});

describe.each(TYPES)('%s — after the cold boot, a second package declaring a name another package holds', (type) => {
  const name = `shared_${type}`;

  it('is refused at the package door, naming both packages and the rename, and leaves no record behind', async () => {
    const { registry, register } = await boot();
    expect(registry.bareNameHoldersAreSealed).toBe(true);
    expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();

    const err = await register(rival('com.acme.beta', { [type]: [name] }));
    expectRefusal(err, 'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' }, renamed(name));
    expect(err!.conflicts).toEqual([
      { type, name, incomingPackageId: 'com.acme.beta', existingHolder: { kind: 'package', packageId: 'com.acme.alpha' }, rename: renamed(name) },
    ]);
    // Ahead of every mutation: no package record, no claim, no item.
    expect(registry.getPackage('com.acme.beta')).toBeUndefined();
    expect(registry.getItem<{ label: string }>(type, name)?.label).toBe(`alpha ${type === 'picklist' ? 'list' : type}`);
  });

  it('ABLATION — before the seal the same two registrations coexist (the doors judge nothing during a boot)', async () => {
    const registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    expect(registry.bareNameHoldersAreSealed).toBe(false);
    registry.installPackage(pkg('com.acme.alpha', { [type]: [name] }) as never, 'code');
    expect(await caught(() => registry.installPackage(rival('com.acme.beta', { [type]: [name] }) as never, 'code'))).toBeUndefined();
    registry.registerItem(type, body(type, name, 'alpha'), 'name', 'com.acme.alpha');
    expect(await caught(() => registry.registerItem(type, body(type, name, 'beta'), 'name', 'com.acme.beta'))).toBeUndefined();
    // …and once sealed, a third is refused at both doors.
    registry.sealBareNameHolders();
    expect(await caught(() => registry.installPackage(rival('com.acme.gamma', { [type]: [name] }) as never, 'code'))).toBeDefined();
    expect(await caught(() => registry.registerItem(type, body(type, name, 'gamma'), 'name', 'com.acme.gamma'))).toBeDefined();
  });

  it('the item seam refuses a package-bound registration over another package\'s name', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();
    const err = await caught(() => registry.registerItem(type, body(type, name, 'direct'), 'name', 'com.acme.direct'));
    expectRefusal(err, 'com.acme.direct', { kind: 'package', packageId: 'com.acme.alpha' });
    expect(registry.getItem(type, name, 'com.acme.direct')).toMatchObject({ label: expect.stringContaining('alpha') });
  });

  it('a nested plugin declares under its parent package, and is held to the same rule', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', {}, { plugins: [{ name: 'inner', [COLLECTION[type]]: [body(type, name, 'inner')] }] }))).toBeUndefined();
    const err = await register(rival('com.acme.beta', { [type]: [name] }));
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
    // The bare slot, with no package — what `sys_metadata` hydration and the
    // metadata write-through register, here over a package's name…
    expect(await caught(() => registry.registerItem(type, body(type, name, 'env'), 'name'))).toBeUndefined();
    // …and an environment-only name is no holder a package is refused against.
    registry.registerItem(type, body(type, `env_${type}`, 'env'), 'name');
    expect(await register(pkg('com.acme.beta', { [type]: [`env_${type}`] }))).toBeUndefined();
  });

  describe('the cold boot of a deployment that already holds the clash', () => {
    const atBoot = () => [pkg('com.acme.alpha', { [type]: [name] }), rival('com.acme.beta', { [type]: [name] })];

    it('boots, and warns once naming both holders and the rename (switch "warn")', async () => {
      const { registry, bareNameWarnings } = await boot(atBoot());
      expect(registry.bareNameHoldersAreSealed).toBe(true);
      const warnings = bareNameWarnings();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('com.acme.alpha');
      expect(warnings[0]).toContain('com.acme.beta');
      expect(warnings[0]).toContain(renamed(name));
      // Still served: the first-registered holder, as before the rule.
      expect(registry.getItem<{ label: string }>(type, name)?.label).toContain('alpha');
    });

    it('both holders keep their name across a reload; a third package is refused naming both', async () => {
      const { register } = await boot(atBoot());
      expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();
      expect(await register(rival('com.acme.beta', { [type]: [name] }))).toBeUndefined();
      const err = await register(rival('com.acme.gamma', { [type]: [name] }));
      expectRefusal(err, 'com.acme.gamma', { kind: 'package', packageId: 'com.acme.alpha' }, renamed(name));
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
      expectRefusal(err, 'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' }, renamed(name));
      expect(err!.message).toContain('The boot is refused');
    });
  });
});

describe('the cold boot\'s reading', () => {
  it('names every clash once, the served holder as the existing one, sorted by type then name', async () => {
    const registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    // [#31700] Two packages of one namespace (`beta` declares `alpha`'s): two
    // namespaces' holders are no clash since the narrowing.
    registry.installPackage(pkg('com.acme.alpha', { dataset: ['d1'], picklist: ['p2', 'p1'] }) as never, 'code');
    registry.installPackage(rival('com.acme.beta', { dataset: ['d1'], picklist: ['p1', 'p2'], mapping: ['m1'] }) as never, 'code');
    const warn = vi.fn();
    const conflicts = sealBareNameHoldersAtColdBoot(registry, 'warn', { warn });
    expect(conflicts.map((c) => `${c.type}/${c.name}: ${c.incomingPackageId} vs ${(c.existingHolder as Holder).packageId}`)).toEqual([
      'picklist/p1: com.acme.beta vs com.acme.alpha',
      'picklist/p2: com.acme.beta vs com.acme.alpha',
      'dataset/d1: com.acme.beta vs com.acme.alpha',
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(bareNameColdBootWarning(conflicts));
    expect(registry.bareNameHoldersAreSealed).toBe(true);
  });

  it('a boot with no clash seals and says nothing', async () => {
    const { registry, bareNameWarnings } = await boot([pkg('com.acme.alpha', { picklist: ['p1'] }), pkg('com.acme.beta', { picklist: ['p2'] })]);
    expect(registry.bareNameHoldersAreSealed).toBe(true);
    expect(bareNameWarnings()).toEqual([]);
  });

  it('an environment item under a package\'s name is no clash at the cold boot', async () => {
    const registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    registry.installPackage(pkg('com.acme.alpha', { picklist: ['p1'] }) as never, 'code');
    registry.registerItem('picklist', body('picklist', 'p1', 'env'), 'name');
    expect(sealBareNameHoldersAtColdBoot(registry, 'refuse')).toEqual([]);
  });
});

describe('the refusal reports, and only refuses, what the ruling covers', () => {
  it('every conflicting name is listed in one refusal, and a refused package claims none of its names', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', { picklist: ['p1'], mapping: ['m1'], dataset: ['d1'] }))).toBeUndefined();
    const err = await register(rival('com.acme.beta', { picklist: ['p1', 'free_list'], mapping: ['m1'], dataset: ['d1'] }));
    expect(err?.code).toBe(NAMESPACE_CONFLICT_CODE);
    expect(err!.conflicts!.map((c) => `${c.type}/${c.name}`)).toEqual(['picklist/p1', 'mapping/m1', 'dataset/d1']);
    expect(await register(pkg('com.acme.gamma', { picklist: ['free_list'] }))).toBeUndefined();
  });

  it('a package with no namespace is refused without a rename', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', { picklist: ['p1'] }))).toBeUndefined();
    const { namespace: _ns, ...bare } = pkg('com.acme.beta', { picklist: ['p1'] });
    const err = await register(bare);
    expectRefusal(err, 'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' });
    expect(err!.conflicts![0].rename).toBeUndefined();
  });

  it('a built-in name is refused to a package at the package door, naming the platform', async () => {
    const builtIns = BUILT_IN_BARE_NAMES.picklist as Set<string>;
    builtIns.add('platform_list');
    try {
      const { register } = await boot();
      const err = await register(pkg('com.acme.alpha', { picklist: ['platform_list'] }));
      expectRefusal(err, 'com.acme.alpha', { kind: 'built-in' }, 'alpha_platform_list');
    } finally {
      builtIns.delete('platform_list');
    }
  });

  it('CONTROL — a type the rule does not cover, shared by two packages, still coexists (ADR-0048 §3.4)', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.alpha', {}, { pages: [{ name: 'home', label: 'alpha home', type: 'app' }] }))).toBeUndefined();
    expect(await register(pkg('com.acme.beta', {}, { pages: [{ name: 'home', label: 'beta home', type: 'app' }] }))).toBeUndefined();
    expect(registry.getItem<{ label: string }>('page', 'home', 'com.acme.beta')?.label).toBe('beta home');
  });

  it('CONTROL — a picklist extension of another package\'s list is not a second holder', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.alpha', { picklist: ['p1'] }))).toBeUndefined();
    expect(await register(pkg('com.acme.beta', {}, {
      picklistExtensions: [{ extend: 'p1', options: [{ label: 'beta extra', value: 'beta_extra' }] }],
    }))).toBeUndefined();
    expect(registry.getPackage('com.acme.beta')).toBeDefined();
  });

  it('collisionPolicy "warn" does not downgrade it', async () => {
    const registry = new SchemaRegistry({ collisionPolicy: 'warn' });
    registry.logLevel = 'silent';
    registry.sealBareNameHolders();
    registry.installPackage(pkg('com.acme.alpha', { mapping: ['m1'] }) as never, 'code');
    const err = await caught(() => registry.installPackage(rival('com.acme.beta', { mapping: ['m1'] }) as never, 'code'));
    expectRefusal(err, 'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' }, renamed('m1'));
  });
});

/**
 * [ADR-0150 D2/D9, child B, #31700] The picklist family holds one name per
 * namespace. Every by-name reader of the three types resolves by
 * `(package, name)` first: a field's `picklist:` from the package that wrote
 * the reference (E6), the bare `/meta/picklist/NAME` (#32070), the import door
 * and the connector pull (#32071), the dataset query door and the dataset AI
 * tools (#32072). On main a second holder of another namespace was refused
 * here, naming the first.
 */
describe('the narrowing — the picklist family holds one name per namespace (ADR-0150 D2/D9, child B, #31700)', () => {
  describe.each(TYPES)('%s', (type) => {
    const name = `shared_${type}`;
    const labelOf = (tag: string) => `${tag} ${type === 'picklist' ? 'list' : type}`;

    it('two packages of two namespaces each install the name after the seal, and each holds its own item (BASE: the second was refused)', async () => {
      const { registry, register } = await boot();
      expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();
      expect(await register(pkg('com.acme.beta', { [type]: [name] }))).toBeUndefined();
      expect(registry.getPackage('com.acme.beta')).toBeDefined();
      expect(registry.getItem<{ label: string }>(type, name, 'com.acme.alpha')?.label).toBe(labelOf('alpha'));
      expect(registry.getItem<{ label: string }>(type, name, 'com.acme.beta')?.label).toBe(labelOf('beta'));
      expect(registry.packageScopedHoldersOf(type, name).sort()).toEqual(['com.acme.alpha', 'com.acme.beta']);
    });

    it('the item seam admits an installed package of another namespace', async () => {
      const { registry, register } = await boot();
      expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();
      expect(await register(pkg('com.acme.beta'))).toBeUndefined();
      expect(await caught(() => registry.registerItem(type, body(type, name, 'beta'), 'name', 'com.acme.beta'))).toBeUndefined();
    });

    it('a co-owner of the holder\'s namespace is still refused beside two namespaces\' holders, naming only its own namespace\'s holder', async () => {
      const { register } = await boot();
      expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();
      expect(await register(pkg('com.acme.beta', { [type]: [name] }))).toBeUndefined();
      const err = await register(coOwner('com.acme.alpha', 'com.acme.gamma', { [type]: [name] }));
      expectRefusal(err, 'com.acme.gamma', { kind: 'package', packageId: 'com.acme.alpha' }, renamed(name));
      expect(err!.conflicts!.map((c) => c.existingHolder)).toEqual([{ kind: 'package', packageId: 'com.acme.alpha' }]);
    });

    it('the cold boot of two namespaces\' holders boots with no bare-name warning, and the seal reports no clash', async () => {
      const { registry, bareNameWarnings } = await boot([pkg('com.acme.alpha', { [type]: [name] }), pkg('com.acme.beta', { [type]: [name] })]);
      expect(bareNameWarnings()).toEqual([]);
      expect(registry.sealBareNameHolders().filter((c) => c.type === type)).toEqual([]);
    });

    it('a bare read naming no package of the two-namespace name is refused naming both, never one picked (D3)', async () => {
      const { registry, register } = await boot();
      expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();
      expect(await register(pkg('com.acme.beta', { [type]: [name] }))).toBeUndefined();
      const resolution = resolvePackageScopedName(registry, { type, name, callerPackageId: null });
      expect(resolution.status).toBe('refused');
      expect(resolution.status === 'refused' ? resolution.candidates : []).toEqual([
        { kind: 'package', packageId: 'com.acme.alpha' },
        { kind: 'package', packageId: 'com.acme.beta' },
      ]);
    });
  });

  it('a package with no namespace is still refused beside a holder, and a holder with no namespace still refuses one', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', { mapping: ['m1'] }))).toBeUndefined();
    const { namespace: _a, ...bare } = pkg('com.acme.plain', { mapping: ['m1'] });
    expectRefusal(await register(bare), 'com.acme.plain', { kind: 'package', packageId: 'com.acme.alpha' });

    const other = await boot();
    const { namespace: _b, ...holder } = pkg('com.acme.plain', { dataset: ['d1'] });
    expect(await other.register(holder)).toBeUndefined();
    expectRefusal(await other.register(pkg('com.acme.beta', { dataset: ['d1'] })), 'com.acme.beta', { kind: 'package', packageId: 'com.acme.plain' });
  });

  it.each(['base', 'system', 'sys'])('two packages of the shareable namespace %s are still refused (not widened: D2 allows it, nothing asks it)', async (shared) => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.one', { picklist: ['p1'] }, { namespace: shared }))).toBeUndefined();
    expectRefusal(await register(pkg('com.acme.two', { picklist: ['p1'] }, { namespace: shared })), 'com.acme.two', { kind: 'package', packageId: 'com.acme.one' });
  });

  it('a built-in name is still refused to a package of any namespace', async () => {
    const builtIns = BUILT_IN_BARE_NAMES.dataset as Set<string>;
    builtIns.add('platform_dataset');
    try {
      const { register } = await boot();
      expectRefusal(await register(pkg('com.acme.beta', { dataset: ['platform_dataset'] })), 'com.acme.beta', { kind: 'built-in' }, 'beta_platform_dataset');
    } finally {
      builtIns.delete('platform_dataset');
    }
  });

  it('the census: the platform requests no picklist, mapping, dataset, API or function by a fixed name', () => {
    for (const type of ['picklist', 'mapping', 'dataset', 'api', 'function'] as const) expect([...BUILT_IN_BARE_NAMES[type]], type).toEqual([]);
  });

  /**
   * Narrowing (b), declared: a `picklistExtensions` entry's target is a
   * contribution judged caller-less (epic seat ruling X on #31678), and its
   * `extend` is a bare snake_case name. Once two namespaces hold the name it
   * extends, the target means two lists, so it is refused naming both, at the
   * install door after the boot and at the cold boot — never added to one of
   * them. On main the second holder was itself refused, so the extension met
   * one list.
   */
  describe('narrowing (b): an extension of a list two namespaces hold is refused naming both', () => {
    const extension = (id: string) => pkg(id, {}, { picklistExtensions: [{ extend: 'p1', options: [{ label: 'extra', value: 'extra' }] }] });

    it('at the install door after the boot: refused, both holders named, nothing registered', async () => {
      const { registry, register } = await boot();
      expect(await register(pkg('com.acme.alpha', { picklist: ['p1'] }))).toBeUndefined();
      expect(await register(pkg('com.acme.beta', { picklist: ['p1'] }))).toBeUndefined();
      const err = await register(extension('com.acme.gamma'));
      expect(err, 'the extension was refused').toBeDefined();
      expect(err!.message).toContain("extends picklist 'p1'");
      expect(err!.message).toContain('com.acme.alpha');
      expect(err!.message).toContain('com.acme.beta');
      expect(err!.message).toContain('resolves to no one list');
      expect(registry.getPackage('com.acme.gamma')).toBeUndefined();
      expect(registry.resolvePicklistOptions('p1', 'com.acme.alpha')?.map((o) => o.value)).toEqual(['alpha_one']);
    });

    it('at the cold boot: the boot is refused, both holders named', async () => {
      const err = await caught(() => boot([pkg('com.acme.alpha', { picklist: ['p1'] }), pkg('com.acme.beta', { picklist: ['p1'] }), extension('com.acme.gamma')]));
      expect(err, 'the boot was refused').toBeDefined();
      expect(err!.message).toContain("extends picklist 'p1'");
      expect(err!.message).toContain('com.acme.alpha');
      expect(err!.message).toContain('com.acme.beta');
    });

    it('CONTROL — the same extension of a list one package holds installs and adds its option', async () => {
      const { registry, register } = await boot();
      expect(await register(pkg('com.acme.alpha', { picklist: ['p1'] }))).toBeUndefined();
      expect(await register(extension('com.acme.gamma'))).toBeUndefined();
      expect(registry.resolvePicklistOptions('p1', 'com.acme.alpha')?.map((o) => o.value)).toEqual(['alpha_one', 'extra']);
    });
  });
});
