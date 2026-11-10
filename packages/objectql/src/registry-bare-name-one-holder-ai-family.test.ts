// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One name, one package holder — the AI family: an agent and a skill
 * (maintainer ruling C on #30798, phase 1, the family's own change under
 * #30803 and the series' last; `bare-name-one-holder.ts` states the rule, the
 * holders and the cold boot). The data, request and flow families' pins are
 * `registry-bare-name-one-holder.test.ts`,
 * `registry-bare-name-one-holder-request-family.test.ts` and
 * `registry-bare-name-one-holder-flow-family.test.ts`; this file holds the same
 * matrix for the last two, and for a `tool`, which joined after them in its
 * own change (#31414: every reader of a tool names it with no package), and
 * what is particular to them:
 *
 *  - all three are registry types, judged at the engine's package door and the
 *    registry's item seam exactly as a picklist is; none is bundled;
 *  - an agent, a skill and a tool are three types: one package's item of one
 *    and another's of another under one name never meet (CONTROL);
 *  - two packages' tools under different names both install (CONTROL).
 *
 * [ADR-0150 D2/D9, child B, #31701] `agent` and `skill` have narrowed to the
 * namespace (`NAMESPACE_SCOPED_BARE_NAME_TYPES`): the matrix below refuses
 * their second holder as a CO-OWNER of the first holder's namespace (a
 * package of namespace `alpha` that depends on `com.acme.alpha`), and a
 * `tool`'s as a package of another namespace, as before. "the narrowing" pins
 * what changed: two namespaces' packages each hold the name, at every door and
 * through the cold boot, while a co-owner, a package with no namespace and a
 * built-in name are still refused.
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
import {
  BARE_NAME_ONE_HOLDER_TYPES,
  BARE_NAME_REGISTRY_TYPES,
  BUILT_IN_BARE_NAMES,
  NAMESPACE_SCOPED_BARE_NAME_TYPES,
  OVERRIDABLE_BASELINE_PACKAGES,
  bareNameHoldersMeet,
  bareNameReason,
  bareNameTypeLabel,
  declaredBareNames,
} from './bare-name-one-holder.js';
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

type AiType = 'agent' | 'skill' | 'tool';
const TYPES: AiType[] = ['agent', 'skill', 'tool'];
const COLLECTION: Record<AiType, string> = { agent: 'agents', skill: 'skills', tool: 'tools' };

/** A body each type's schema accepts, marked with `tag` in its `label`. */
const body = (type: AiType, name: string, tag: string, extra: Record<string, unknown> = {}): Record<string, unknown> => {
  switch (type) {
    case 'agent':
      return { name, label: `${tag} agent`, role: `${tag} role`, instructions: `${tag} agent instructions`, ...extra };
    case 'skill':
      return { name, label: `${tag} skill`, description: `${tag} skill`, instructions: `${tag} skill instructions`, tools: [], ...extra };
    case 'tool':
      return { name, label: `${tag} tool`, description: `${tag} tool`, parameters: { type: 'object', properties: {} }, ...extra };
  }
};

/** The marker `body` wrote: the item's `label`. */
const marker = (item: unknown): string | undefined => (item as { label?: string } | undefined)?.label;

/** The package's own object. */
const itemObject = (ns: string) => ({
  name: `${ns}_item`, label: `${ns} item`,
  fields: { name: { type: 'text', label: 'Name' } },
});

/**
 * A flat package payload — the shape `AppPlugin.init` hands the manifest
 * service — whose namespace is its id's last segment, so the rename a refusal
 * carries is `<last segment>_<name>`.
 */
const pkg = (id: string, decl: Partial<Record<AiType, string[]>> = {}, extra: Record<string, unknown> = {}) => {
  const ns = id.split('.').pop()!;
  const out: Record<string, unknown> = { id, name: ns, namespace: ns, version: '1.0.0', type: 'app', objects: [itemObject(ns)], ...extra };
  for (const type of TYPES) {
    const names = decl[type];
    if (names) out[COLLECTION[type]] = [...((extra[COLLECTION[type]] as unknown[]) ?? []), ...names.map((n) => body(type, n, ns))];
  }
  return out;
};

/** Has `type`'s rule narrowed to the namespace (child B)? */
const narrowed = (type: AiType) => (NAMESPACE_SCOPED_BARE_NAME_TYPES as readonly string[]).includes(type);

/**
 * The package that rivals `com.acme.alpha` for a name of `type`: for a type
 * narrowed to the namespace, a co-owner of alpha's namespace (it declares
 * `alpha` and depends on alpha, as the namespace gate requires, and its object
 * carries the namespace's prefix); otherwise a package of its own namespace.
 */
const rival = (type: AiType, id: string, decl: Partial<Record<AiType, string[]>> = {}, extra: Record<string, unknown> = {}) => {
  if (!narrowed(type)) return pkg(id, decl, extra);
  const tag = id.split('.').pop()!;
  return pkg(id, decl, {
    namespace: 'alpha',
    objects: [itemObject(`alpha_${tag}`)],
    dependencies: { 'com.acme.alpha': '^1.0.0' },
    ...extra,
  });
};

/** The rename a refusal of `id`'s `name` carries: its namespace prefixed. */
const renameOf = (type: AiType, id: string, name: string) => `${narrowed(type) ? 'alpha' : id.split('.').pop()}_${name}`;

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
  name: 'test.bare-name.ai-family.boot-packages',
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

describe('the covered types, in family order', () => {
  it('the AI family joins after the flow family, and a tool after it, last; the registry types are every covered type but the function', () => {
    expect(BARE_NAME_ONE_HOLDER_TYPES).toEqual([
      'picklist', 'mapping', 'dataset',
      'api', 'action', 'function',
      'flow', 'webhook', 'connector', 'email_template',
      'agent', 'skill',
      'tool',
    ]);
    expect(BARE_NAME_REGISTRY_TYPES).toEqual(BARE_NAME_ONE_HOLDER_TYPES.filter((t) => t !== 'function'));
    for (const type of TYPES) {
      expect(bareNameTypeLabel(type)).toBe(type);
      expect(BUILT_IN_BARE_NAMES[type].size, type).toBe(0);
      expect(OVERRIDABLE_BASELINE_PACKAGES[type].size, type).toBe(0);
    }
  });

  it('a manifest declares each of the three by its collection, nested plugins included', () => {
    const declared = declaredBareNames({
      id: 'com.acme.alpha',
      agents: [body('agent', 'a1', 'a')], skills: [body('skill', 's1', 'a')], tools: [body('tool', 't1', 'a')],
      plugins: [{ name: 'inner', skills: [body('skill', 's2', 'a')], tools: [body('tool', 't2', 'a')] }],
    });
    expect(declared.map((d) => `${d.type}/${d.name}`)).toEqual(['agent/a1', 'skill/s1', 'tool/t1', 'skill/s2', 'tool/t2']);
  });
});

describe.each(TYPES)('%s — after the cold boot, a second package declaring a name another package holds', (type) => {
  const name = `shared_${type}`;
  const label = (tag: string) => marker(body(type, name, tag));

  it('is refused at the package door, naming both packages and the rename, and leaves no record behind', async () => {
    const { registry, register } = await boot();
    expect(registry.bareNameHoldersAreSealed).toBe(true);
    expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();

    const err = await register(rival(type, 'com.acme.beta', { [type]: [name] }));
    expectRefusal(err, 'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' }, renameOf(type, 'com.acme.beta', name));
    expect(err!.conflicts).toEqual([
      { type, name, incomingPackageId: 'com.acme.beta', existingHolder: { kind: 'package', packageId: 'com.acme.alpha' }, rename: renameOf(type, 'com.acme.beta', name) },
    ]);
    expect(err!.message).toContain(`the ${bareNameTypeLabel(type)} "${name}"`);
    expect(registry.getPackage('com.acme.beta')).toBeUndefined();
    expect(marker(registry.getItem(type, name))).toBe(label('alpha'));
  });

  it('ABLATION — before the seal the same two registrations coexist (the doors judge nothing during a boot)', async () => {
    const registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    registry.installPackage(pkg('com.acme.alpha', { [type]: [name] }) as never, 'code');
    expect(await caught(() => registry.installPackage(rival(type, 'com.acme.beta', { [type]: [name] }) as never, 'code'))).toBeUndefined();
    registry.registerItem(type, body(type, name, 'alpha'), 'name', 'com.acme.alpha');
    expect(await caught(() => registry.registerItem(type, body(type, name, 'beta'), 'name', 'com.acme.beta'))).toBeUndefined();
    registry.sealBareNameHolders();
    expect(await caught(() => registry.installPackage(rival(type, 'com.acme.gamma', { [type]: [name] }) as never, 'code'))).toBeDefined();
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
    const err = await register(rival(type, 'com.acme.beta', { [type]: [name] }));
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
    const atBoot = () => [pkg('com.acme.alpha', { [type]: [name] }), rival(type, 'com.acme.beta', { [type]: [name] })];

    it('boots, and warns once naming both holders and the rename (switch "warn")', async () => {
      const { registry, bareNameWarnings } = await boot(atBoot());
      expect(registry.bareNameHoldersAreSealed).toBe(true);
      const warnings = bareNameWarnings();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(`the ${bareNameTypeLabel(type)} "${name}"`);
      expect(warnings[0]).toContain('com.acme.alpha');
      expect(warnings[0]).toContain('com.acme.beta');
      expect(warnings[0]).toContain(renameOf(type, 'com.acme.beta', name));
      expect(warnings[0]).toContain('changes nothing about which holder each caller is served');
    });

    it('both holders keep their name across a reload; a third package is refused naming both', async () => {
      const { register } = await boot(atBoot());
      expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();
      expect(await register(rival(type, 'com.acme.beta', { [type]: [name] }))).toBeUndefined();
      const err = await register(rival(type, 'com.acme.gamma', { [type]: [name] }));
      expectRefusal(err, 'com.acme.gamma', { kind: 'package', packageId: 'com.acme.alpha' }, renameOf(type, 'com.acme.gamma', name));
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
      expectRefusal(err, 'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' }, renameOf(type, 'com.acme.beta', name));
      expect(err!.message).toContain('The boot is refused');
    });
  });
});

describe('the narrowing — agent and skill hold one name per namespace (ADR-0150 D2/D9, child B)', () => {
  const NARROWED = ['agent', 'skill'] as const;

  it('the switch holds agent and skill (and, since #31697, the object-less action), and no other covered type', () => {
    const narrowedTypes: readonly string[] = [...NARROWED, 'action'];
    expect(NAMESPACE_SCOPED_BARE_NAME_TYPES).toEqual(narrowedTypes);
    for (const type of BARE_NAME_ONE_HOLDER_TYPES) {
      // A type that has not narrowed meets every holder, namespaces or not.
      expect(bareNameHoldersMeet(type, 'alpha', 'beta'), type).toBe(narrowedTypes.includes(type) ? false : true);
      expect(bareNameHoldersMeet(type, 'alpha', 'alpha'), type).toBe(true);
      expect(bareNameHoldersMeet(type, undefined, 'beta'), type).toBe(true);
      expect(bareNameHoldersMeet(type, 'alpha', undefined), type).toBe(true);
    }
  });

  describe.each(NARROWED)('%s', (type) => {
    const name = `shared_${type}`;

    it('two packages of two namespaces each install the name after the seal, and each holds its own item', async () => {
      const { registry, register } = await boot();
      expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();
      expect(await register(pkg('com.acme.beta', { [type]: [name] }))).toBeUndefined();
      expect(registry.getPackage('com.acme.beta')).toBeDefined();
      const held = registry.listItems<{ _packageId?: string; label?: string }>(type)
        .filter((item) => (item as { name?: string }).name === name)
        .map((item) => [item._packageId, marker(item)]);
      expect(held).toEqual([['com.acme.alpha', marker(body(type, name, 'alpha'))], ['com.acme.beta', marker(body(type, name, 'beta'))]]);
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
      const err = await register(rival(type, 'com.acme.gamma', { [type]: [name] }));
      expectRefusal(err, 'com.acme.gamma', { kind: 'package', packageId: 'com.acme.alpha' }, `alpha_${name}`);
      expect(err!.conflicts!.map((c) => c.existingHolder)).toEqual([{ kind: 'package', packageId: 'com.acme.alpha' }]);
    });

    it('a package with no namespace is still refused beside a holder, and a holder with no namespace still refuses one', async () => {
      const { register } = await boot();
      expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();
      const bare = pkg('com.acme.plain', { [type]: [name] });
      delete bare.namespace;
      expectRefusal(await register(bare), 'com.acme.plain', { kind: 'package', packageId: 'com.acme.alpha' });

      const other = await boot();
      const holder = pkg('com.acme.plain', { [type]: [name] });
      delete holder.namespace;
      expect(await other.register(holder)).toBeUndefined();
      expectRefusal(await other.register(pkg('com.acme.beta', { [type]: [name] })), 'com.acme.beta', { kind: 'package', packageId: 'com.acme.plain' });
    });

    it.each(['base', 'system', 'sys'])('two packages of the shareable namespace %s are still refused (not widened: D2 allows it, nothing asks it)', async (shared) => {
      const { register } = await boot();
      const one = pkg('com.acme.one', { [type]: [name] }, { namespace: shared, objects: [itemObject(`${shared}_one`)] });
      const two = pkg('com.acme.two', { [type]: [name] }, { namespace: shared, objects: [itemObject(`${shared}_two`)] });
      expect(await register(one)).toBeUndefined();
      expectRefusal(await register(two), 'com.acme.two', { kind: 'package', packageId: 'com.acme.one' });
    });

    it('the cold boot of two namespaces\' holders boots with no bare-name warning, and the seal reports no clash', async () => {
      const { registry, bareNameWarnings } = await boot([pkg('com.acme.alpha', { [type]: [name] }), pkg('com.acme.beta', { [type]: [name] })]);
      expect(bareNameWarnings()).toEqual([]);
      expect(registry.sealBareNameHolders().filter((c) => c.type === type)).toEqual([]);
    });

    it('the cold boot of two namespaces\' holders and a co-owner reports the co-owner against its own namespace\'s holder only', async () => {
      const registry = new SchemaRegistry();
      registry.logLevel = 'silent';
      for (const m of [
        pkg('com.acme.alpha', { [type]: [name] }),
        pkg('com.acme.beta', { [type]: [name] }),
        rival(type, 'com.acme.gamma', { [type]: [name] }),
      ]) registry.installPackage(m as never, 'code');
      expect(registry.sealBareNameHolders()).toEqual([
        { type, name, incomingPackageId: 'com.acme.gamma', existingHolder: { kind: 'package', packageId: 'com.acme.alpha' }, rename: `alpha_${name}` },
      ]);
    });

    it('a built-in name is still refused to a package of any namespace', async () => {
      const builtIns = BUILT_IN_BARE_NAMES[type] as Set<string>;
      builtIns.add(`platform_${type}`);
      try {
        const { register } = await boot();
        expectRefusal(await register(pkg('com.acme.beta', { [type]: [`platform_${type}`] })), 'com.acme.beta', { kind: 'built-in' });
      } finally {
        builtIns.delete(`platform_${type}`);
      }
    });
  });

  it('CONTROL — a tool has not narrowed: a package of another namespace is still refused its name', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', { tool: ['shared_tool'] }))).toBeUndefined();
    expectRefusal(await register(pkg('com.acme.beta', { tool: ['shared_tool'] })), 'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' }, 'beta_shared_tool');
  });
});

describe('what the AI family leaves alone', () => {
  it('CONTROL — two packages\' tools under different names both install after the seal, and each serves its own', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.alpha', { tool: ['alpha_tool'] }))).toBeUndefined();
    expect(await register(pkg('com.acme.beta', { tool: ['beta_tool'] }))).toBeUndefined();
    expect(registry.getPackage('com.acme.beta')).toBeDefined();
    expect(marker(registry.getItem('tool', 'alpha_tool'))).toBe('alpha tool');
    expect(marker(registry.getItem('tool', 'beta_tool'))).toBe('beta tool');
  });

  it('CONTROL — one package\'s agent and another\'s skill under one name are two types, never one conflict', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', { agent: ['shared_ai'] }))).toBeUndefined();
    expect(await register(pkg('com.acme.beta', { skill: ['shared_ai'] }))).toBeUndefined();
  });

  it('CONTROL — a tool under the name another package\'s skill or agent holds is another type, never one conflict', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', { skill: ['shared_ai'], agent: ['shared_ai'] }))).toBeUndefined();
    expect(await register(pkg('com.acme.beta', { tool: ['shared_ai'] }))).toBeUndefined();
  });

  it('CONTROL — one package declaring a skill and a tool under one name installs: one holder', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', { skill: ['shared_ai'], tool: ['shared_ai'] }))).toBeUndefined();
    expect(await register(pkg('com.acme.alpha', { skill: ['shared_ai'], tool: ['shared_ai'] }))).toBeUndefined();
  });
});

describe('the refusal\'s reason names the consumers of the types it lists', () => {
  it('one sentence per refusal, naming only the types it carries', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', { agent: ['a1'], skill: ['s1'] }))).toBeUndefined();
    const err = await register(rival('agent', 'com.acme.beta', { agent: ['a1'], skill: ['s1'] }));
    expect(err!.conflicts!.map((c) => `${c.type}/${c.name}`)).toEqual(['agent/a1', 'skill/s1']);
    expect(err!.message).toContain(bareNameReason(['agent', 'skill']));
    expect(bareNameReason(['agent', 'skill'])).toMatch(
      /^An agent and a skill each hold one name per deployment: `\/meta\/agent\/NAME` serves one agent per name and an MCP client fetches a skill's prompt by its name, /,
    );
    expect(bareNameReason(['skill'])).toMatch(/^A skill holds one name per deployment: an MCP client fetches a skill's prompt by its name, /);
    expect(bareNameReason(['tool'])).toMatch(/^A tool holds one name per deployment: a skill's `tools` and an MCP client name a tool, /);
  });

  it('a built-in name is refused to a package at the package door, naming the platform', async () => {
    const builtIns = BUILT_IN_BARE_NAMES.skill as Set<string>;
    builtIns.add('platform_skill');
    try {
      const { register } = await boot();
      const err = await register(pkg('com.acme.alpha', { skill: ['platform_skill'] }));
      expectRefusal(err, 'com.acme.alpha', { kind: 'built-in' }, 'alpha_platform_skill');
    } finally {
      builtIns.delete('platform_skill');
    }
  });
});
