// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One name, one package holder — the AI family: an agent and a skill
 * (maintainer ruling C on #30798, phase 1, the family's own change under
 * #30803 and the series' last; `bare-name-one-holder.ts` states the rule, the
 * holders and the cold boot). The data, request and flow families' pins are
 * `registry-bare-name-one-holder.test.ts`,
 * `registry-bare-name-one-holder-request-family.test.ts` and
 * `registry-bare-name-one-holder-flow-family.test.ts`; this file holds the same
 * matrix for the last two, and what is particular to them:
 *
 *  - both are registry types, judged at the engine's package door and the
 *    registry's item seam exactly as a picklist is; neither is bundled;
 *  - a `tool` shares a stack beside them and is NOT covered (ruling
 *    6688041914's nine types do not name it): two packages' same-named tools
 *    still install after the seal (CONTROL);
 *  - an agent and a skill are two types: one package's agent and another's
 *    skill under one name never meet (CONTROL).
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
  OVERRIDABLE_BASELINE_PACKAGES,
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

type AiType = 'agent' | 'skill';
const TYPES: AiType[] = ['agent', 'skill'];
const COLLECTION: Record<AiType | 'tool', string> = { agent: 'agents', skill: 'skills', tool: 'tools' };

/** A body each type's schema accepts, marked with `tag` in its `label`. */
const body = (type: AiType | 'tool', name: string, tag: string, extra: Record<string, unknown> = {}): Record<string, unknown> => {
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
const pkg = (id: string, decl: Partial<Record<AiType | 'tool', string[]>> = {}, extra: Record<string, unknown> = {}) => {
  const ns = id.split('.').pop()!;
  const out: Record<string, unknown> = { id, name: ns, namespace: ns, version: '1.0.0', type: 'app', objects: [itemObject(ns)], ...extra };
  for (const type of [...TYPES, 'tool'] as const) {
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
  it('the two join the list last, after the flow family; the registry types are every covered type but the function', () => {
    expect(BARE_NAME_ONE_HOLDER_TYPES).toEqual([
      'picklist', 'mapping', 'dataset',
      'api', 'action', 'function',
      'flow', 'webhook', 'connector', 'email_template',
      'agent', 'skill',
    ]);
    expect(BARE_NAME_REGISTRY_TYPES).toEqual(BARE_NAME_ONE_HOLDER_TYPES.filter((t) => t !== 'function'));
    for (const type of TYPES) {
      expect(bareNameTypeLabel(type)).toBe(type);
      expect(BUILT_IN_BARE_NAMES[type].size, type).toBe(0);
      expect(OVERRIDABLE_BASELINE_PACKAGES[type].size, type).toBe(0);
    }
  });

  it('a manifest declares each of the two by its collection, nested plugins included; a tool declares nothing', () => {
    const declared = declaredBareNames({
      id: 'com.acme.alpha',
      agents: [body('agent', 'a1', 'a')], skills: [body('skill', 's1', 'a')], tools: [body('tool', 't1', 'a')],
      plugins: [{ name: 'inner', skills: [body('skill', 's2', 'a')] }],
    });
    expect(declared.map((d) => `${d.type}/${d.name}`)).toEqual(['agent/a1', 'skill/s1', 'skill/s2']);
  });
});

describe.each(TYPES)('%s — after the cold boot, a second package declaring a name another package holds', (type) => {
  const name = `shared_${type}`;
  const label = (tag: string) => marker(body(type, name, tag));

  it('is refused at the package door, naming both packages and the rename, and leaves no record behind', async () => {
    const { registry, register } = await boot();
    expect(registry.bareNameHoldersAreSealed).toBe(true);
    expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();

    const err = await register(pkg('com.acme.beta', { [type]: [name] }));
    expectRefusal(err, 'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' }, `beta_${name}`);
    expect(err!.conflicts).toEqual([
      { type, name, incomingPackageId: 'com.acme.beta', existingHolder: { kind: 'package', packageId: 'com.acme.alpha' }, rename: `beta_${name}` },
    ]);
    expect(err!.message).toContain(`the ${bareNameTypeLabel(type)} "${name}"`);
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
      expect(warnings[0]).toContain(`the ${bareNameTypeLabel(type)} "${name}"`);
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

describe('what the AI family leaves alone', () => {
  it('CONTROL — two packages\' tools under one name both install after the seal: a tool is not covered', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.alpha', { tool: ['shared_tool'] }))).toBeUndefined();
    expect(await register(pkg('com.acme.beta', { tool: ['shared_tool'] }))).toBeUndefined();
    expect(registry.getPackage('com.acme.beta')).toBeDefined();
  });

  it('CONTROL — one package\'s agent and another\'s skill under one name are two types, never one conflict', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', { agent: ['shared_ai'] }))).toBeUndefined();
    expect(await register(pkg('com.acme.beta', { skill: ['shared_ai'] }))).toBeUndefined();
  });
});

describe('the refusal\'s reason names the consumers of the types it lists', () => {
  it('one sentence per refusal, naming only the types it carries', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', { agent: ['a1'], skill: ['s1'] }))).toBeUndefined();
    const err = await register(pkg('com.acme.beta', { agent: ['a1'], skill: ['s1'] }));
    expect(err!.conflicts!.map((c) => `${c.type}/${c.name}`)).toEqual(['agent/a1', 'skill/s1']);
    expect(err!.message).toContain(bareNameReason(['agent', 'skill']));
    expect(bareNameReason(['agent', 'skill'])).toMatch(
      /^An agent and a skill each hold one name per deployment: `\/meta\/agent\/NAME` serves one agent per name and an MCP client fetches a skill's prompt by its name, /,
    );
    expect(bareNameReason(['skill'])).toMatch(/^A skill holds one name per deployment: an MCP client fetches a skill's prompt by its name, /);
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
