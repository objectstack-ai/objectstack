// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A refused multi-package artifact leaves the running kernel as it was.
 *
 * ## What was wrong
 *
 * The engine's `manifest` service registers an artifact's packages one by one
 * (`registerApp`, in the order `resolveArtifactPackageEntries` gives). Each
 * `registerApp` puts back what ITS OWN body wrote when that body is refused,
 * but nothing put back the members registered before it: when a later member
 * was refused, the earlier members stayed registered in the running kernel —
 * package records, objects, apps, navigation contributions, kinds, datasource
 * definitions — while the install door answered `422` and wrote no ledger
 * entry, so a restart dropped them again. The same held for a refusal raised
 * by the artifact's residual (top-level items no body declares), which
 * registers after every body.
 *
 * ## What these pin
 *
 *  - a two-member artifact whose second member is refused — by a registry verb
 *    part-way (an object another package owns, an object name the first member
 *    also defines) or by a judge that reads the body alone (an item wearing
 *    another package's `_packageId`) — leaves NEITHER member registered, and
 *    the refusal keeps its code and status;
 *  - a refusal raised by the residual, after both members registered, leaves
 *    neither member registered;
 *  - an upgrade of an installed artifact whose second member is refused leaves
 *    the installed version of BOTH members serving, whole — the first
 *    member's `1.0.0`, not its refused `2.0.0`;
 *  - CONTROLS: a single-package refusal is answered exactly as before (same
 *    code, status and sentence as `registerApp` alone, nothing of it left);
 *    a clean two-member artifact registers both members.
 *
 * The artifacts arrive after `start()`, through the `manifest` service, the way
 * the marketplace install door hands them over.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import { ObjectQL } from './engine.js';

type ManifestService = { register(artifact: unknown, options?: { source?: 'code' | 'marketplace' }): Promise<void> };

const CORE = 'com.probe.suite.core';
const ADDON = 'com.probe.suite.addon';
const HOLDER = 'com.probe.holder';
const PREFIXES = ['suite_'];

const object = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  fields: { title: { type: 'text', label: 'Title' } },
  ...extra,
});

/** The first member: it writes into every registry and engine map `registerApp` reaches. */
const core = (version = '1.0.0', extra: Record<string, unknown> = {}) => ({
  id: CORE,
  name: 'suite_core',
  namespace: 'suitecore',
  version,
  type: 'app',
  objects: [object('suite_core_thing', { label: `core ${version}` })],
  apps: [{
    name: 'suite_core_app',
    label: 'Core',
    navigation: [{ id: 'nav_core', type: 'object', label: 'Core', objectName: 'suite_core_thing' }],
  }],
  pages: [{ name: `suite_core_page_${version.replace(/\./g, '_')}`, label: 'Core page', type: 'app' }],
  datasources: version === '1.0.0'
    ? [{ name: 'suite_ds', driver: 'memory', config: {} }]
    : [{ name: 'suite_ds', driver: 'sqlite', config: {} }, { name: 'suite_ds_new', driver: 'memory', config: {} }],
  navigationContributions: [{ app: 'holder_app', items: [{ id: `suite_nav_${version.replace(/\./g, '_')}`, type: 'url', label: 'Suite', url: '/suite' }] }],
  contributes: { kinds: [{ id: `suite.kind.${version}` }] },
  ...extra,
});

/** The second member, depending on the first, so it registers after it. */
const addon = (version = '1.0.0', extra: Record<string, unknown> = {}) => {
  const { objects = [], ...rest } = extra as { objects?: unknown[] };
  return {
    id: ADDON,
    name: 'suite_addon',
    namespace: 'suiteaddon',
    version,
    type: 'module',
    dependencies: { [CORE]: `^${version}` },
    objects: [object('suite_addon_thing', { label: `addon ${version}` }), ...objects],
    ...rest,
  };
};

const artifact = (members: unknown[], extra: Record<string, unknown> = {}) => ({
  id: 'com.probe.suite',
  version: (members[0] as { version: string }).version,
  packages: members.map((manifest) => ({ manifest })),
  ...extra,
});

/** What the kernel holds of the suite, read through public verbs. */
function trace(ql: ObjectQL) {
  const registry = ql.registry;
  const ours = (name: unknown) => typeof name === 'string' && PREFIXES.some((p) => name.startsWith(p));
  return {
    packages: [CORE, ADDON].map((id) => `${id}@${registry.getPackage(id)?.manifest?.version ?? '-'}`),
    objects: registry.getAllObjects()
      .filter((o: any) => ours(o.name))
      .map((o: any) => `${o.name}:${registry.getObjectOwner(o.name)?.packageId}:${o.label}`)
      .sort(),
    apps: registry.listItems('app').map((a: any) => a.name).filter(ours).sort(),
    pages: registry.listItems('page').map((p: any) => p.name).filter(ours).sort(),
    nav: registry.getAppNavContributions('holder_app').flatMap((c) => c.items.map((i: any) => `${c.packageId}:${i.id}`)),
    kinds: registry.getAllKinds().map((k) => k.id).filter((id) => id.startsWith('suite.')).sort(),
    datasources: ql.listDatasourceDefs().filter((d) => d.name.startsWith('suite_ds')).map((d) => `${d.name}:${d.driver}`).sort(),
    manifests: [CORE, ADDON].filter((id) => (ql as unknown as { manifests: Map<string, unknown> }).manifests.has(id)),
    manifestVersions: [CORE, ADDON].map((id) => (ql as unknown as { manifests: Map<string, { version?: string }> }).manifests.get(id)?.version ?? '-'),
    namespaces: ['suitecore', 'suiteaddon'].map((ns) => registry.getNamespaceOwner(ns) ?? '-'),
  };
}

const NOTHING = {
  packages: [`${CORE}@-`, `${ADDON}@-`],
  objects: [],
  apps: [],
  pages: [],
  nav: [],
  kinds: [],
  datasources: [],
  manifests: [],
  manifestVersions: ['-', '-'],
  namespaces: ['-', '-'],
};

const kernels: ObjectKernel[] = [];
afterEach(async () => {
  while (kernels.length) {
    const kernel = kernels.pop()!;
    if (kernel.getState() === 'running') await kernel.shutdown();
  }
});

/** A running kernel with the holder package registered; artifacts then arrive late, as an install does. */
async function boot(): Promise<{ ql: ObjectQL; manifest: ManifestService }> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
  kernels.push(kernel);
  await kernel.use(new ObjectQLPlugin());
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  ql.registry.logLevel = 'silent';
  const manifest = kernel.getService<ManifestService>('manifest');
  await manifest.register({
    id: HOLDER,
    name: 'holder',
    namespace: 'holder',
    version: '1.0.0',
    type: 'app',
    objects: [object('holder_thing', { label: 'Holder thing' })],
    apps: [{ name: 'holder_app', label: 'Holder', navigation: [] }],
  });
  return { ql, manifest };
}

async function refusal(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected the artifact to be refused');
}

/** Each way the second member is refused, with the code and status the refusal keeps. */
const ADDON_REFUSALS: Array<{ label: string; extra: Record<string, unknown>; code: string; status: number; says: string }> = [
  {
    label: 'an object another installed package owns (a registry verb, part-way)',
    extra: { objects: [object('holder_thing')] },
    code: 'OBJECT_OWNERSHIP_CONFLICT', status: 422, says: `Object "holder_thing" is already owned by package "${HOLDER}"`,
  },
  {
    label: 'an object name the first member also defines (the artifact\'s own conflict)',
    extra: { objects: [object('suite_core_thing')] },
    code: 'DUPLICATE_ARTIFACT_OBJECT_NAME', status: 422, says: 'Object name conflict inside one release artifact',
  },
  {
    label: 'a page wearing another package\'s `_packageId` (judged from the body alone)',
    extra: { pages: [{ name: 'suite_addon_page', label: 'Addon page', type: 'app', _packageId: HOLDER }] },
    code: 'VALIDATION_ERROR', status: 400, says: 'suite_addon_page',
  },
];

describe('a refused member of a multi-package artifact leaves no member of it registered', () => {
  for (const c of ADDON_REFUSALS) {
    it(`a fresh install whose second member is refused: ${c.label}`, async () => {
      const { ql, manifest } = await boot();

      const err = await refusal(() => manifest.register(artifact([core(), addon('1.0.0', c.extra)]), { source: 'marketplace' }));

      expect(err).toMatchObject({ code: c.code, status: c.status });
      expect(String(err?.message)).toContain(c.says);
      expect(trace(ql)).toEqual(NOTHING);
      // The holder is as it was.
      expect(ql.registry.getObjectOwner('holder_thing')?.packageId).toBe(HOLDER);
      expect((ql.registry.getObject('holder_thing') as any)?.label).toBe('Holder thing');
    });
  }

  it('a refusal the artifact\'s residual raises, after both members registered', async () => {
    const { ql, manifest } = await boot();

    const err = await refusal(() => manifest.register(
      artifact([core(), addon()], { views: [{ name: 'suite_residual_view', viewKind: 'list', config: {} }] }),
      { source: 'marketplace' },
    ));

    expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
    expect(trace(ql)).toEqual(NOTHING);
  });
});

describe('a refused upgrade of a multi-package artifact leaves the installed version of every member serving', () => {
  for (const c of ADDON_REFUSALS) {
    it(`the second member of 2.0.0 is refused: ${c.label}`, async () => {
      const { ql, manifest } = await boot();
      await manifest.register(artifact([core(), addon()]), { source: 'marketplace' });
      const before = trace(ql);
      expect(before.packages).toEqual([`${CORE}@1.0.0`, `${ADDON}@1.0.0`]);

      const err = await refusal(() => manifest.register(
        artifact([
          core('2.0.0', { objects: [object('suite_core_thing', { label: 'core 2.0.0' }), object('suite_core_new')] }),
          addon('2.0.0', c.extra),
        ]),
        { source: 'marketplace' },
      ));

      expect(err).toMatchObject({ code: c.code, status: c.status });
      expect(trace(ql)).toEqual(before);
      expect(trace(ql).manifestVersions).toEqual(['1.0.0', '1.0.0']);
      expect(trace(ql).datasources).toEqual(['suite_ds:memory']);
    });
  }
});

describe('CONTROLS', () => {
  it('a single-package refusal is answered as `registerApp` alone answers it, and leaves nothing of it', async () => {
    const body = () => core('1.0.0', { objects: [object('suite_core_thing'), object('holder_thing')] });
    const { ql, manifest } = await boot();

    const err = await refusal(() => manifest.register(body(), { source: 'marketplace' }));

    // The same refusal a bare engine raises for the same body over the same holder.
    const bare = new ObjectQL();
    bare.registry.logLevel = 'silent';
    bare.registerApp({ id: HOLDER, name: 'holder', namespace: 'holder', version: '1.0.0', objects: [object('holder_thing')] });
    let direct: any;
    try { bare.registerApp(body(), undefined, 'marketplace'); } catch (e) { direct = e; }
    expect(direct).toBeDefined();
    expect(err).toMatchObject({ code: direct.code, status: direct.status, message: direct.message });
    expect(err).toMatchObject({ code: 'OBJECT_OWNERSHIP_CONFLICT', status: 422 });
    expect(trace(ql)).toEqual(NOTHING);
  });

  it('a clean two-member artifact registers both members', async () => {
    const { ql, manifest } = await boot();

    await manifest.register(artifact([core(), addon()]), { source: 'marketplace' });

    expect(trace(ql)).toMatchObject({
      packages: [`${CORE}@1.0.0`, `${ADDON}@1.0.0`],
      objects: [`suite_addon_thing:${ADDON}:addon 1.0.0`, `suite_core_thing:${CORE}:core 1.0.0`],
      nav: [`${CORE}:suite_nav_1_0_0`],
      kinds: ['suite.kind.1.0.0'],
      datasources: ['suite_ds:memory'],
      manifests: [CORE, ADDON],
    });
  });
});
