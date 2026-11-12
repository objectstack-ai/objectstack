// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One name, one package holder — the flow family: a flow, a webhook, a
 * connector and an email template (maintainer ruling C on #30798, phase 1,
 * the family's own change under #30803; `bare-name-one-holder.ts` states the
 * rule, the holders and the cold boot). The data family's pins are
 * `registry-bare-name-one-holder.test.ts`, the request family's
 * `registry-bare-name-one-holder-request-family.test.ts`; this file holds the
 * same matrix for the next four, and what is particular to them:
 *
 *  - all four are registry types, judged at the engine's package door and the
 *    registry's item seam exactly as a picklist is;
 *  - `email_template` is a BUNDLED type: the registry keys it
 *    `pkg:name@locale`, so the holder reading strips the member, the NAME is
 *    what is held, and two members of one package's bundle are one holder;
 *  - the email service's built-in templates are an overridable baseline
 *    (`OVERRIDABLE_BASELINE_PACKAGES`): that package neither holds a template
 *    name nor is refused one, so an app's override of `auth.welcome` keeps
 *    its contract (ADR-0131 D6/D10) while a second app's is refused.
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
  isOverridableBaseline,
} from './bare-name-one-holder.js';
import { PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE } from './package-scoped-resolver.js';
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

type FlowType = 'flow' | 'webhook' | 'connector' | 'email_template';
const TYPES: FlowType[] = ['flow', 'webhook', 'connector', 'email_template'];
const COLLECTION: Record<FlowType, string> = { flow: 'flows', webhook: 'webhooks', connector: 'connectors', email_template: 'emailTemplates' };

/** The email service's package, as `EmailServicePlugin.init` registers it (the overridable baseline). */
const EMAIL_SERVICE_PKG = 'com.objectstack.service.email';

/** A body each type's schema accepts, marked with `tag` in its `label`. */
const body = (type: FlowType, name: string, tag: string, extra: Record<string, unknown> = {}): Record<string, unknown> => {
  switch (type) {
    case 'flow':
      return { name, label: `${tag} flow`, type: 'autolaunched', status: 'active', nodes: [{ id: 'start', type: 'start', label: 'Start' }], edges: [], ...extra };
    case 'webhook':
      return { name, label: `${tag} webhook`, url: `https://hooks.example/${tag}/${name}`, method: 'POST', isActive: false, ...extra };
    case 'connector':
      return { name, label: `${tag} connector`, type: 'api', description: `${tag} connector`, enabled: false, ...extra };
    case 'email_template':
      return { name, label: `${tag} template`, locale: 'en-US', subject: `${tag} subject`, bodyHtml: `<p>${tag}</p>`, ...extra };
  }
};

/** The marker `body` wrote: the item's `label`. */
const marker = (item: unknown): string | undefined => (item as { label?: string } | undefined)?.label;

/** The package's own object, so a webhook or flow has something to bind to. */
const itemObject = (ns: string) => ({
  name: `${ns}_item`, label: `${ns} item`,
  fields: { name: { type: 'text', label: 'Name' } },
});

/**
 * A flat package payload — the shape `AppPlugin.init` hands the manifest
 * service — whose namespace is its id's last segment, so the rename a refusal
 * carries is `<last segment>_<name>`.
 */
const pkg = (id: string, decl: Partial<Record<FlowType, string[]>> = {}, extra: Record<string, unknown> = {}) => {
  const ns = id.split('.').pop()!;
  const out: Record<string, unknown> = { id, name: ns, namespace: ns, version: '1.0.0', type: 'app', objects: [itemObject(ns)], ...extra };
  for (const type of TYPES) {
    const names = decl[type];
    if (names) out[COLLECTION[type]] = [...((extra[COLLECTION[type]] as unknown[]) ?? []), ...names.map((n) => body(type, n, ns))];
  }
  return out;
};

/** Has `type`'s rule narrowed to the namespace (ADR-0150 child B: `email_template`, #31699)? */
const narrowed = (type: FlowType) => (NAMESPACE_SCOPED_BARE_NAME_TYPES as readonly string[]).includes(type);

/**
 * The package that rivals `com.acme.alpha` for a name of `type`: for a type
 * narrowed to the namespace, a co-owner of alpha's namespace (it declares
 * `alpha` and depends on alpha, as the namespace gate requires, and its object
 * carries the namespace's prefix); otherwise a package of its own namespace.
 */
const rival = (type: FlowType, id: string, decl: Partial<Record<FlowType, string[]>> = {}, extra: Record<string, unknown> = {}) => {
  if (!narrowed(type)) return pkg(id, decl, extra);
  const tag = id.split('.').pop()!;
  return pkg(id, decl, {
    namespace: 'alpha',
    objects: [itemObject(`alpha_${tag}`)],
    dependencies: { 'com.acme.alpha': '^1.0.0' },
    ...extra,
  });
};

/** The rename a refusal of `id`'s `name` of `type` carries: its namespace prefixed. */
const renameOf = (type: FlowType, id: string, name: string) => `${narrowed(type) ? 'alpha' : id.split('.').pop()}_${name}`;

/** The email service's own package payload, as its plugin registers it: a system plugin in the `sys` namespace. */
const emailServicePkg = (templates: Record<string, unknown>[]) => ({
  id: EMAIL_SERVICE_PKG, name: 'Email Service', version: '1.0.0', type: 'plugin', scope: 'system', namespace: 'sys',
  emailTemplates: templates,
});

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
  name: 'test.bare-name.flow-family.boot-packages',
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
  it('the four join the list after the request family; the registry types are every covered type but the function', () => {
    // The families after this one follow it (the AI family's file pins the whole list).
    expect(BARE_NAME_ONE_HOLDER_TYPES.slice(0, 10)).toEqual([
      'picklist', 'mapping', 'dataset',
      'api', 'action', 'function',
      'flow', 'webhook', 'connector', 'email_template',
    ]);
    expect(BARE_NAME_REGISTRY_TYPES).toEqual(BARE_NAME_ONE_HOLDER_TYPES.filter((t) => t !== 'function'));
    expect(bareNameTypeLabel('email_template')).toBe('email template');
    for (const type of ['flow', 'webhook', 'connector'] as const) expect(bareNameTypeLabel(type)).toBe(type);
  });

  it('a manifest declares each of the four by its collection, nested plugins included, a bundle once', () => {
    const declared = declaredBareNames({
      id: 'com.acme.alpha',
      flows: [body('flow', 'f1', 'a')], webhooks: [body('webhook', 'w1', 'a')], connectors: [body('connector', 'c1', 'a')],
      emailTemplates: [body('email_template', 'e1', 'a'), body('email_template', 'e1', 'a', { locale: 'zh-CN' })],
      plugins: [{ name: 'inner', flows: [body('flow', 'f2', 'a')] }],
    });
    expect(declared.map((d) => `${d.type}/${d.name}`)).toEqual([
      'flow/f1', 'webhook/w1', 'connector/c1', 'email_template/e1', 'email_template/e1', 'flow/f2',
    ]);
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

describe('connector — a descriptor and a provider-bound instance hold the name alike', () => {
  it('a second package\'s provider-bound instance under a held descriptor name is refused, and the reverse', async () => {
    const { register } = await boot();
    const instance = (tag: string) => body('connector', 'shared_conn', tag, { provider: 'rest', providerConfig: { baseUrl: `https://${tag}.example` }, auth: { type: 'none' }, enabled: true });
    expect(await register(pkg('com.acme.alpha', { connector: ['shared_conn'] }))).toBeUndefined();
    expectRefusal(
      await register(pkg('com.acme.beta', {}, { connectors: [instance('beta')] })),
      'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' }, 'beta_shared_conn',
    );
    expect(await register(pkg('com.acme.gamma', {}, { connectors: [{ ...instance('gamma'), name: 'live_conn' }] }))).toBeUndefined();
    expectRefusal(
      await register(pkg('com.acme.delta', { connector: ['live_conn'] })),
      'com.acme.delta', { kind: 'package', packageId: 'com.acme.gamma' }, 'delta_live_conn',
    );
  });
});

describe('email_template — the name holds the bundle, and the built-in templates are an overridable baseline', () => {
  const member = (tag: string, name: string, locale: string) => body('email_template', name, tag, { locale });

  it('two members of one package\'s bundle are one holder; a second package\'s member of that name is refused once', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.alpha', {}, { emailTemplates: [member('alpha', 'shared_tpl', 'en-US'), member('alpha', 'shared_tpl', 'zh-CN')] }))).toBeUndefined();
    expect(registry.getItem('email_template', 'shared_tpl', undefined, 'zh-CN')).toBeDefined();
    // One holder, so the package's own second registration passes…
    expect(await register(pkg('com.acme.alpha', {}, { emailTemplates: [member('alpha', 'shared_tpl', 'en-US'), member('alpha', 'shared_tpl', 'zh-CN')] }))).toBeUndefined();
    // …and another package's member — another locale — is one conflict, on the name. (Since the
    // type narrowed to the namespace, the rival is a co-owner of alpha's namespace.)
    const err = await register(rival('email_template', 'com.acme.beta', {}, { emailTemplates: [member('beta', 'shared_tpl', 'fr-FR')] }));
    expectRefusal(err, 'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' }, 'alpha_shared_tpl');
    expect(err!.conflicts).toHaveLength(1);
    expect(err!.conflicts![0].name).toBe('shared_tpl');
  });

  it('the item seam holds the name through a member key (`pkg:name@locale`), every member of a bundle alike', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.alpha', {}, { emailTemplates: [member('alpha', 'shared_tpl', 'zh-CN')] }))).toBeUndefined();
    expectRefusal(
      await caught(() => registry.registerItem('email_template', member('direct', 'shared_tpl', 'en-US'), 'name', 'com.acme.direct')),
      'com.acme.direct', { kind: 'package', packageId: 'com.acme.alpha' },
    );
    expectRefusal(
      await caught(() => registry.registerItem('email_template', member('direct', 'shared_tpl', 'ja-JP'), 'name', 'com.acme.direct')),
      'com.acme.direct', { kind: 'package', packageId: 'com.acme.alpha' },
    );
  });

  it('a holder is read from its member key alone (no claim): a package registering a bundle member through the registry directly holds the name', async () => {
    const registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    registry.sealBareNameHolders();
    // After the seal, alpha's first registration finds no holder and stores `com.acme.alpha:shared_tpl@zh-CN`.
    expect(await caught(() => registry.registerItem('email_template', member('alpha', 'shared_tpl', 'zh-CN'), 'name', 'com.acme.alpha'))).toBeUndefined();
    expect(registry.getPackage('com.acme.alpha'), 'no package record, so no claim: the slot is the only record').toBeUndefined();
    expectRefusal(
      await caught(() => registry.registerItem('email_template', member('direct', 'shared_tpl', 'en-US'), 'name', 'com.acme.direct')),
      'com.acme.direct', { kind: 'package', packageId: 'com.acme.alpha' },
    );
    // CONTROL — the same package's second member is its own bundle, not a second holder.
    expect(await caught(() => registry.registerItem('email_template', member('alpha', 'shared_tpl', 'en-US'), 'name', 'com.acme.alpha'))).toBeUndefined();
  });

  it('the cold boot reads a bundled clash from the member keys: two packages\' members of one name, registered directly, are one conflict on the name', () => {
    const registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    registry.registerItem('email_template', member('alpha', 'shared_tpl', 'en-US'), 'name', 'com.acme.alpha');
    registry.registerItem('email_template', member('alpha', 'shared_tpl', 'zh-CN'), 'name', 'com.acme.alpha');
    registry.registerItem('email_template', member('beta', 'shared_tpl', 'fr-FR'), 'name', 'com.acme.beta');
    registry.registerItem('flow', body('flow', 'own_flow', 'alpha'), 'name', 'com.acme.alpha');
    const conflicts = registry.sealBareNameHolders();
    expect(conflicts.map((c) => `${c.type}/${c.name}: ${c.incomingPackageId} vs ${(c.existingHolder as Holder).packageId}`)).toEqual([
      'email_template/shared_tpl: com.acme.beta vs com.acme.alpha',
    ]);
  });

  it('the vocabulary names the email service\'s package as the one baseline, for email templates only', () => {
    expect([...OVERRIDABLE_BASELINE_PACKAGES.email_template]).toEqual([EMAIL_SERVICE_PKG]);
    for (const type of BARE_NAME_ONE_HOLDER_TYPES) {
      if (type !== 'email_template') expect(OVERRIDABLE_BASELINE_PACKAGES[type].size, type).toBe(0);
    }
    expect(isOverridableBaseline('email_template', EMAIL_SERVICE_PKG)).toBe(true);
    expect(isOverridableBaseline('flow', EMAIL_SERVICE_PKG)).toBe(false);
    expect(isOverridableBaseline('email_template', 'com.acme.alpha')).toBe(false);
    expect(isOverridableBaseline('email_template', undefined)).toBe(false);
    expect(declaredBareNames(emailServicePkg([member('sys', 'auth.welcome', 'en-US')]))).toEqual([]);
    // The baseline is read by the package id the door judges (`artifactPackageId`: `id`, else `name`).
    expect(declaredBareNames({ name: EMAIL_SERVICE_PKG, emailTemplates: [member('sys', 'auth.welcome', 'en-US')] })).toEqual([]);
    expect(declaredBareNames({ name: 'com.acme.alpha', emailTemplates: [member('alpha', 'auth.welcome', 'en-US')] })).toEqual([
      { type: 'email_template', name: 'auth.welcome' },
    ]);
  });

  it('CONTROL — an app overriding a built-in template after the boot installs: the baseline holds nothing', async () => {
    const { registry, register } = await boot([emailServicePkg([member('sys', 'auth.password_reset', 'en-US'), member('sys', 'auth.password_reset', 'zh-CN')])]);
    expect(await register(pkg('com.acme.alpha', {}, { emailTemplates: [member('alpha', 'auth.password_reset', 'en-US')] }))).toBeUndefined();
    expect(registry.getArtifactItem<{ label: string }>('email_template', 'auth.password_reset', 'com.acme.alpha')?.label).toBe('alpha template');
    // …and a SECOND app's override is refused, naming the first app only — never the baseline. A name
    // the platform requests by spelling keeps one holder whatever the namespaces (#31699).
    const err = await register(pkg('com.acme.beta', {}, { emailTemplates: [member('beta', 'auth.password_reset', 'en-US')] }));
    expectRefusal(err, 'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' }, 'beta_auth.password_reset');
    expect(err!.conflicts).toHaveLength(1);
    expect(err!.message).not.toContain(EMAIL_SERVICE_PKG);
  });

  it('CONTROL — the baseline package is refused nothing: re-registering its templates over an app\'s override passes, at both doors', async () => {
    const { registry, register } = await boot([
      emailServicePkg([member('sys', 'auth.welcome', 'en-US')]),
      pkg('com.acme.alpha', {}, { emailTemplates: [member('alpha', 'auth.welcome', 'en-US')] }),
    ]);
    expect(await register(emailServicePkg([member('sys', 'auth.welcome', 'en-US')]))).toBeUndefined();
    expect(await caught(() => registry.registerItem('email_template', member('sys', 'auth.welcome', 'ja-JP'), 'name', EMAIL_SERVICE_PKG))).toBeUndefined();
  });

  it('CONTROL — the cold boot of the baseline beside an app\'s override is no clash', async () => {
    const { bareNameWarnings, registry } = await boot([
      emailServicePkg([member('sys', 'auth.welcome', 'en-US')]),
      pkg('com.acme.alpha', {}, { emailTemplates: [member('alpha', 'auth.welcome', 'en-US')] }),
    ]);
    expect(registry.bareNameHoldersAreSealed).toBe(true);
    expect(bareNameWarnings()).toEqual([]);
    const conflicts = registry.sealBareNameHolders();
    expect(conflicts).toEqual([]);
  });

  it('the cold boot of two apps overriding one built-in name warns, naming the two apps and never the baseline', async () => {
    const { bareNameWarnings } = await boot([
      emailServicePkg([member('sys', 'auth.password_reset', 'en-US')]),
      pkg('com.acme.alpha', {}, { emailTemplates: [member('alpha', 'auth.password_reset', 'en-US')] }),
      pkg('com.acme.beta', {}, { emailTemplates: [member('beta', 'auth.password_reset', 'zh-CN')] }),
    ]);
    const warnings = bareNameWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('the email template "auth.password_reset"');
    expect(warnings[0]).toContain('com.acme.alpha');
    expect(warnings[0]).toContain('com.acme.beta');
    expect(warnings[0]).not.toContain(EMAIL_SERVICE_PKG);
  });
});

describe('the narrowing — an email template holds one name per namespace (ADR-0150 D2/D9, child B, #31699)', () => {
  const type = 'email_template' as const;
  const name = 'shared_tpl';
  const member = (tag: string, n: string, locale: string) => body('email_template', n, tag, { locale });
  const ofBeta = (decl: Record<string, unknown>) => pkg('com.acme.beta', {}, decl);

  it('the switch holds email_template and webhook (#31699 PR 2), and neither flow nor connector', () => {
    expect(NAMESPACE_SCOPED_BARE_NAME_TYPES).toContain('email_template');
    expect(NAMESPACE_SCOPED_BARE_NAME_TYPES).toContain('webhook');
    for (const other of ['flow', 'connector'] as const) expect(narrowed(other), other).toBe(false);
  });

  it('two packages of two namespaces each install the name after the seal, and each holds its own bundle', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();
    expect(await register(pkg('com.acme.beta', { [type]: [name] }))).toBeUndefined();
    expect(registry.getPackage('com.acme.beta')).toBeDefined();
    const held = registry.listItems<{ _packageId?: string; label?: string; name?: string }>(type)
      .filter((item) => item.name === name)
      .map((item) => [item._packageId, marker(item)]);
    expect(held).toEqual([['com.acme.alpha', 'alpha template'], ['com.acme.beta', 'beta template']]);
  });

  it('the item seam admits an installed package of another namespace', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.alpha', { [type]: [name] }))).toBeUndefined();
    expect(await register(pkg('com.acme.beta'))).toBeUndefined();
    expect(await caught(() => registry.registerItem(type, member('beta', name, 'en-US'), 'name', 'com.acme.beta'))).toBeUndefined();
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

  it('a built-in name is still refused to a package of any namespace', async () => {
    const builtIns = BUILT_IN_BARE_NAMES.email_template as Set<string>;
    builtIns.add('platform_tpl');
    try {
      const { register } = await boot();
      expectRefusal(await register(pkg('com.acme.beta', { [type]: ['platform_tpl'] })), 'com.acme.beta', { kind: 'built-in' });
    } finally {
      builtIns.delete('platform_tpl');
    }
  });

  describe('a name the platform requests by its spelling keeps one holder per deployment, whatever the namespaces', () => {
    const RESET = 'auth.password_reset';

    it('the eight auth mails are the platform-requested email template names', () => {
      expect([...(PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE.email_template ?? [])].sort()).toEqual([
        'auth.account_invitation', 'auth.email_change_notice', 'auth.existing_account_sign_up', 'auth.invitation',
        'auth.magic_link', 'auth.password_reset', 'auth.two_factor_otp', 'auth.verify_email',
      ]);
      expect(bareNameHoldersMeet(type, 'alpha', 'beta', RESET)).toBe(true);
      expect(bareNameHoldersMeet(type, 'alpha', 'beta', name)).toBe(false);
    });

    it('a second app of another namespace overriding it is refused at the package door and the item seam, naming the first app only', async () => {
      const { registry, register } = await boot([emailServicePkg([member('sys', RESET, 'en-US')])]);
      expect(await register(pkg('com.acme.alpha', {}, { emailTemplates: [member('alpha', RESET, 'en-US')] }))).toBeUndefined();
      const err = await register(ofBeta({ emailTemplates: [member('beta', RESET, 'zh-CN')] }));
      expectRefusal(err, 'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' }, `beta_${RESET}`);
      expect(err!.message).not.toContain(EMAIL_SERVICE_PKG);
      expect(await register(pkg('com.acme.beta'))).toBeUndefined();
      expectRefusal(
        await caught(() => registry.registerItem(type, member('beta', RESET, 'zh-CN'), 'name', 'com.acme.beta')),
        'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' },
      );
    });

    it('the cold boot of two namespaces\' apps overriding it warns, naming both apps', async () => {
      const { bareNameWarnings } = await boot([
        emailServicePkg([member('sys', RESET, 'en-US')]),
        pkg('com.acme.alpha', {}, { emailTemplates: [member('alpha', RESET, 'en-US')] }),
        ofBeta({ emailTemplates: [member('beta', RESET, 'en-US')] }),
      ]);
      const warnings = bareNameWarnings();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(`the email template "${RESET}"`);
      expect(warnings[0]).toContain('com.acme.beta');
    });
  });

  describe('a bundle addition of another namespace is still its base\'s name, and is refused as before', () => {
    /** A dependent of alpha in its own namespace, adding `fr-FR` to alpha's `en-US`. */
    const dependent = (decl: Record<string, unknown> = { emailTemplates: [member('beta', name, 'fr-FR')] }) =>
      pkg('com.acme.beta', {}, { dependencies: { 'com.acme.alpha': '^1.0.0' }, ...decl });

    it('at the package door, naming the base', async () => {
      const { register } = await boot();
      expect(await register(pkg('com.acme.alpha', {}, { emailTemplates: [member('alpha', name, 'en-US')] }))).toBeUndefined();
      expectRefusal(await register(dependent()), 'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' }, `beta_${name}`);
    });

    it('at the item seam, naming the base', async () => {
      const { registry, register } = await boot();
      expect(await register(pkg('com.acme.alpha', {}, { emailTemplates: [member('alpha', name, 'en-US')] }))).toBeUndefined();
      expect(await register(dependent({}))).toBeUndefined();
      expectRefusal(
        await caught(() => registry.registerItem(type, member('beta', name, 'fr-FR'), 'name', 'com.acme.beta')),
        'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' },
      );
    });

    it('at the cold boot, reported against the base', () => {
      const registry = new SchemaRegistry();
      registry.logLevel = 'silent';
      registry.installPackage(pkg('com.acme.alpha', {}, { emailTemplates: [member('alpha', name, 'en-US')] }) as never, 'code');
      registry.installPackage(dependent() as never, 'code');
      expect(registry.sealBareNameHolders().map((c) => `${c.type}/${c.name}: ${c.incomingPackageId} vs ${(c.existingHolder as Holder).packageId}`)).toEqual([
        `email_template/${name}: com.acme.beta vs com.acme.alpha`,
      ]);
    });

    it('CONTROL — a dependent of another namespace shipping a member its base ships is its own template, and installs', async () => {
      const { register } = await boot();
      expect(await register(pkg('com.acme.alpha', {}, { emailTemplates: [member('alpha', name, 'en-US')] }))).toBeUndefined();
      expect(await register(dependent({ emailTemplates: [member('beta', name, 'en-US'), member('beta', name, 'fr-FR')] }))).toBeUndefined();
    });

    it('CONTROL — a package of another namespace that does not declare the holder adds nothing to it, and installs with any locale', async () => {
      const { register } = await boot();
      expect(await register(pkg('com.acme.alpha', {}, { emailTemplates: [member('alpha', name, 'en-US')] }))).toBeUndefined();
      expect(await register(ofBeta({ emailTemplates: [member('beta', name, 'fr-FR')] }))).toBeUndefined();
    });
  });

  it('[#31699 PR 2, FROM 422 TO admitted] a webhook has narrowed: a package of another namespace installs the name; a co-owner of the holder\'s namespace is still refused', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', { webhook: ['shared_webhook'] }))).toBeUndefined();
    expect(await register(pkg('com.acme.beta', { webhook: ['shared_webhook'] }))).toBeUndefined();
    expectRefusal(
      await register(rival('webhook', 'com.acme.alphamod', { webhook: ['shared_webhook'] })),
      'com.acme.alphamod', { kind: 'package', packageId: 'com.acme.alpha' },
    );
  });

  it.each(['flow', 'connector'] as const)('CONTROL — a %s has not narrowed: a package of another namespace is still refused its name', async (other) => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', { [other]: [`shared_${other}`] }))).toBeUndefined();
    expectRefusal(
      await register(pkg('com.acme.beta', { [other]: [`shared_${other}`] })),
      'com.acme.beta', { kind: 'package', packageId: 'com.acme.alpha' }, `beta_shared_${other}`,
    );
  });
});

describe('the refusal\'s reason names the consumers of the types it lists', () => {
  it('one sentence per refusal, naming only the types it carries', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.alpha', { flow: ['f1'], webhook: ['w1'], connector: ['c1'], email_template: ['e1'] }))).toBeUndefined();
    // A co-owner of alpha's namespace: it meets alpha for every type, the narrowed ones included.
    const err = await register(rival('email_template', 'com.acme.beta', { flow: ['f1'], webhook: ['w1'], connector: ['c1'], email_template: ['e1'] }));
    expect(err!.conflicts!.map((c) => `${c.type}/${c.name}`)).toEqual(['flow/f1', 'webhook/w1', 'connector/c1', 'email_template/e1']);
    expect(err!.message).toContain(bareNameReason(['flow', 'webhook', 'connector', 'email_template']));
    expect(bareNameReason(['flow', 'webhook', 'connector', 'email_template'])).toMatch(
      /^A flow, a webhook, a connector and an email template each hold one name per deployment: the automation engine arms one flow per name, the webhook dispatcher subscribes one declared webhook per name, /,
    );
    expect(bareNameReason(['email_template'])).toMatch(/^An email template holds one name per deployment: a send names its email template, /);
  });

  it('a built-in name is refused to a package at the package door, naming the platform', async () => {
    const builtIns = BUILT_IN_BARE_NAMES.flow as Set<string>;
    builtIns.add('platform_flow');
    try {
      const { register } = await boot();
      const err = await register(pkg('com.acme.alpha', { flow: ['platform_flow'] }));
      expectRefusal(err, 'com.acme.alpha', { kind: 'built-in' }, 'alpha_platform_flow');
    } finally {
      builtIns.delete('platform_flow');
    }
  });
});
