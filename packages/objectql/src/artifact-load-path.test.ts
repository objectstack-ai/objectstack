// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 D5 + D7 — the artifact load path registers the packages inside one
 * artifact in dependency-topological order, and an existing single-`manifest`
 * artifact still registers bit-identically through it.
 *
 * ## What the D5 pin here asserts, and why it is shaped this way
 *
 * ADR-0130 D5 asks for a BEHAVIOURAL pin — an artifact whose `packages` array is
 * deliberately ordered extension-before-base installs, and the extension is
 * verified present and in effect on the extended object — and forbids the pin
 * that only asserts the sorter returned a permutation, because that one stays
 * green on an implementation that computes the order and then never uses it.
 *
 * ⚠️ Measured while writing this pin, and recorded here because the next reader
 * needs it: on today's registry the "extension in effect" half does NOT by
 * itself discriminate the two implementations. `objectExtensions` register as
 * CONTRIBUTORS keyed by the target FQN (`SchemaRegistry.registerObject`,
 * `ownership: 'extend'`) and are folded at READ time in priority order
 * (`resolveObject` → `foldExtenders`), so the fold does not care which
 * contributor arrived first. Registering both orders and deep-diffing the whole
 * resulting registry state — merged objects, every contributor, every item
 * collection, namespace owners — produced exactly ONE difference: the order of
 * the package records themselves. So:
 *
 *  - the extension-in-effect assertion is kept, because it is D5's literal
 *    acceptance criterion and the property that must never regress; and
 *  - the assertion that DISCRIMINATES is on the registry's own installed-package
 *    sequence — real post-install registry state (the first item in D7's own
 *    comparison list), not the sorter's return value. An implementation that
 *    iterates `packages[]` directly writes those records in array order and this
 *    goes red; one that computes the order and never uses it does exactly that,
 *    which is the silent failure D5 exists to catch.
 *
 * ⛔ Do not "simplify" this file by asserting `resolvePluginOrder(...)` returned
 * `[base, extender]`. That is the assertion D5 rules out by name.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import { resolveArtifactPackageOrder } from './artifact-packages.js';
import type { ObjectQL } from './engine.js';
import type { IMetadataService } from '@objectstack/spec/contracts';

type ManifestService = { register(m: unknown): void | Promise<void> };

/**
 * Slot lookups are typed, never erased to `any`: the slot already returns its
 * contract, and this repo's `slot-lookup/no-any-assignment` rule exists because
 * every erasure found so far was hiding a real gap. `objectql` resolves to the
 * engine class here (this test lives inside that package, so the class type is
 * the local contract and carries the `registry` getter the pins read).
 */
const engineOf = (kernel: ObjectKernel): ObjectQL => kernel.getService<ObjectQL>('objectql');

/** One resolved object body, as far as these pins read it. */
type ResolvedObject = {
  fields?: Record<string, { type?: string; label?: string } | undefined>;
  _packageId?: string;
};

/** One package body, as far as these pins read it. */
type PackageBody = {
  id?: string;
  objects?: Array<{ name?: string }>;
  defaultDatasource?: string;
  scope?: string;
};

/**
 * The extended package: owns `crm_account`.
 *
 * Object bodies live INLINE on the package payload, which is what the load path
 * actually receives — `AppPlugin` flattens an artifact into
 * `{ ...bundle.manifest, ...bundle }` before calling `manifest.register()`, and
 * `ObjectQL.registerApp` reads `manifest.objects` as definitions.
 */
const basePackage = () => ({
  id: 'com.acme.crm',
  name: 'acme_crm',
  version: '1.0.0',
  type: 'app',
  namespace: 'crm',
  objects: [
    {
      name: 'crm_account',
      label: 'Account',
      fields: {
        name: { name: 'name', label: 'Name', type: 'text' },
      },
    },
  ],
});

/**
 * The extending package: adds a field to `crm_account`, which it does not own,
 * and declares that dependency the way ADR-0116 requires — in `dependencies`.
 *
 * Distinct namespaces on purpose: co-owning packages SHARING one namespace is
 * ADR-0130 D1/D3's install-gate relaxation, a separate change. This pin is about
 * ordering only and must not silently depend on that one having landed.
 */
const extenderPackage = () => ({
  id: 'com.acme.crm.cpq',
  name: 'acme_cpq',
  version: '1.0.0',
  type: 'module',
  namespace: 'cpq',
  dependencies: { 'com.acme.crm': '1.0.0' },
  objectExtensions: [
    {
      extend: 'crm_account',
      fields: {
        margin: { name: 'margin', label: 'Gross Margin', type: 'number' },
      },
    },
  ],
});

/** An artifact whose `packages` array is deliberately extension-BEFORE-base. */
const extenderFirstArtifact = () => ({
  packages: [{ manifest: extenderPackage() }, { manifest: basePackage() }],
});

/**
 * The artifact's OWN package records, in the order the registry stores them.
 *
 * Narrowed to the `com.acme.*` fixtures on purpose: a booted kernel installs its
 * own platform packages first (`com.objectstack.metadata-objects`), and an
 * assertion that included those would be pinning the kernel's boot composition
 * instead of this artifact's registration order.
 */
const artifactPackageIds = (ql: ObjectQL): string[] =>
  ql.registry
    .getAllPackages()
    .map((p) => p.manifest?.id)
    .filter((id: string) => typeof id === 'string' && id.startsWith('com.acme.'));

describe('ADR-0130 D5 — the load path registers artifact packages topologically', () => {
  let kernel: ObjectKernel;

  beforeEach(() => {
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  });

  afterEach(async () => {
    if (kernel.getState() === 'running') await kernel.shutdown();
  });

  it('installs an extension-before-base artifact, and the extension is in effect', async () => {
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();

    const manifest = kernel.getService('manifest') as ManifestService;
    await manifest.register(extenderFirstArtifact());

    const ql = engineOf(kernel);

    // (1) D5's literal acceptance criterion: the artifact installed, and the
    //     extension is present and in effect ON THE EXTENDED OBJECT — read the
    //     way every consumer reads it, through the resolved object.
    const account = ql.registry.resolveObject('crm_account') as ResolvedObject | undefined;
    expect(account).toBeDefined();
    expect(account?.fields?.margin).toBeDefined();
    expect(account?.fields?.margin?.type).toBe('number');
    expect(account?.fields?.margin?.label).toBe('Gross Margin');
    // The extended object still belongs to the package that owns it — an
    // extension contributes, it does not take ownership.
    expect(ql.registry.getObjectOwner('crm_account')?.packageId).toBe('com.acme.crm');

    // (2) The discriminating half: the load path REGISTERED in dependency order,
    //     not in array order. This is post-install registry state (D7's own
    //     first comparison item), not the sorter's return value.
    expect(artifactPackageIds(ql)).toEqual(['com.acme.crm', 'com.acme.crm.cpq']);
  });

  it('orders a three-package chain declared backwards in the array', async () => {
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();

    const pkg = (id: string, deps?: Record<string, string>) => ({
      id, name: id.replace(/\./g, '_'), version: '1.0.0', type: 'module',
      ...(deps ? { dependencies: deps } : {}),
    });

    const manifest = kernel.getService('manifest') as ManifestService;
    await manifest.register({
      packages: [
        { manifest: pkg('com.acme.c', { 'com.acme.b': '1.0.0' }) },
        { manifest: pkg('com.acme.b', { 'com.acme.a': '1.0.0' }) },
        { manifest: pkg('com.acme.a') },
      ],
    });

    expect(artifactPackageIds(engineOf(kernel))).toEqual(['com.acme.a', 'com.acme.b', 'com.acme.c']);
  });

  it('the extension reaches the metadata service too, on the extender-first artifact', async () => {
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();

    const manifest = kernel.getService('manifest') as ManifestService;
    await manifest.register(extenderFirstArtifact());

    // The bridge is what Studio / AI `describe_object` / `metadata.listObjects`
    // read. An artifact that installs but whose extension never reaches this
    // service is the same silent failure one layer out.
    const metadata = kernel.getService<IMetadataService>('metadata');
    const bridged = await metadata.getObject('crm_account') as ResolvedObject | undefined;
    expect(bridged).toBeDefined();
    expect(bridged?.fields?.margin?.type).toBe('number');
    expect(bridged?._packageId).toBe('com.acme.crm');
  });
});

describe('ADR-0130 D5 — the ordering behaviours are INHERITED from resolvePluginOrder', () => {
  // ⛔ Neither of these is re-adjudicated by the load path: they are
  // `resolvePluginOrder`'s own contract (ADR-0116), asserted here so a future
  // "quick local sort" cannot pass this suite.

  it('throws on a dependency cycle between two packages in one artifact', () => {
    expect(() =>
      resolveArtifactPackageOrder({
        packages: [
          { manifest: { id: 'com.acme.a', name: 'a', version: '1.0.0', type: 'module', dependencies: { 'com.acme.b': '1.0.0' } } },
          { manifest: { id: 'com.acme.b', name: 'b', version: '1.0.0', type: 'module', dependencies: { 'com.acme.a': '1.0.0' } } },
        ],
      }),
    ).toThrow(/Circular dependency/);
  });

  it('leaves a dependency on a package OUTSIDE the artifact to the installer', () => {
    // `manifest.dependencies` is a map of package ids to version ranges and its
    // own schema example is an external package (`@steedos/plugin-auth`). The
    // artifact is not the resolution scope for those, so an id that names no
    // sibling here is not an edge here — it is skipped, exactly as
    // `resolvePluginOrder` skips an absent optional dependency. Reading it as a
    // hard miss instead would refuse every artifact that depends on anything
    // outside itself, which D7 forbids.
    const ordered = resolveArtifactPackageOrder({
      packages: [
        { manifest: { id: 'com.acme.a', name: 'a', version: '1.0.0', type: 'module', dependencies: { '@steedos/plugin-auth': '^2.0.0' } } },
      ],
    }) as PackageBody[];
    expect(ordered.map((m) => m.id)).toEqual(['com.acme.a']);
  });

  it('preserves declared order for packages with no edges between them', () => {
    const ordered = resolveArtifactPackageOrder({
      packages: [
        { manifest: { id: 'com.acme.z', name: 'z', version: '1.0.0', type: 'module' } },
        { manifest: { id: 'com.acme.a', name: 'a', version: '1.0.0', type: 'module' } },
      ],
    }) as PackageBody[];
    expect(ordered.map((m) => m.id)).toEqual(['com.acme.z', 'com.acme.a']);
  });
});

describe('ADR-0130 D4 — the entry WRAPPER is refused from its one declaration', () => {
  // Rejection assertions carry the ADR-0112 envelope — `code` AND `status` —
  // never a bare "it throws": a bare throw assertion stays green on an
  // unrelated `Error` from somewhere else in the path.

  it('refuses an inlined manifest body written straight onto the array element', () => {
    let caught: (Error & { code?: string; status?: number }) | undefined;
    try {
      resolveArtifactPackageOrder({
        packages: [{ id: 'com.acme.a', name: 'a', version: '1.0.0', type: 'module' }],
      });
    } catch (e) { caught = e as Error & { code?: string; status?: number }; }
    expect(caught).toBeDefined();
    expect(caught?.code).toBe('INVALID_ARTIFACT_PACKAGE_ENTRY');
    expect(caught?.status).toBe(422);
    expect(caught?.message).toContain('packages[0]');
  });

  it('refuses the same package id twice rather than silently dropping one', () => {
    let caught: (Error & { code?: string; status?: number }) | undefined;
    try {
      resolveArtifactPackageOrder({
        packages: [
          { manifest: { id: 'com.acme.a', name: 'a', version: '1.0.0', type: 'module' } },
          { manifest: { id: 'com.acme.a', name: 'a-again', version: '1.0.0', type: 'module' } },
        ],
      });
    } catch (e) { caught = e as Error & { code?: string; status?: number }; }
    expect(caught).toBeDefined();
    expect(caught?.code).toBe('DUPLICATE_ARTIFACT_PACKAGE');
    expect(caught?.status).toBe(422);
  });

  it('accepts an assembled package body whose `objects` are definitions, not globs', () => {
    // The load path receives assembled payloads: `ManifestSchema.objects` is
    // `z.array(z.string())` (glob patterns), so a FULL body parse would refuse
    // exactly what this path exists to register. The wrapper is judged; the body
    // is the authoring door's job.
    const ordered = resolveArtifactPackageOrder({
      packages: [{ manifest: basePackage() }],
    }) as PackageBody[];
    expect(ordered).toHaveLength(1);
    expect(ordered[0].objects?.[0]?.name).toBe('crm_account');
  });

  it('hands back the caller\'s own body — no defaults applied, no keys stripped', () => {
    // A parsed clone would arrive carrying `defaultDatasource: 'default'` and
    // `scope: 'project'`, and would have dropped keys `ManifestSchema` does not
    // declare. Registering that instead of the authored body is what would make
    // the `packages` branch and the `manifest` branch disagree (D7).
    const body = basePackage();
    const ordered = resolveArtifactPackageOrder({ packages: [{ manifest: body }] }) as PackageBody[];
    expect(ordered[0]).toBe(body);
    expect(ordered[0].defaultDatasource).toBeUndefined();
    expect(ordered[0].scope).toBeUndefined();
  });
});

describe('ADR-0130 D7 — an existing single-`manifest` artifact registers bit-identically', () => {
  /**
   * The comparison is over REGISTRY STATE after install — the package record,
   * every object FQN, every `_packageId` stamp and the namespace-owner sets —
   * and not over the load path's return value, because state is what the DB, the
   * API and every read path see. D7 states it in exactly those terms.
   *
   * The reference side is a direct `engine.registerApp(payload)`: that IS the
   * single call the load path made before ADR-0130, so "unchanged" is measured
   * against the pre-change behaviour rather than against a second copy of the
   * new behaviour.
   */
  const snapshot = (ql: ObjectQL) => {
    const registry = ql.registry;
    const objects: Record<string, { body: unknown; packageId?: string; owner?: string; contributors: unknown[] }> = {};
    for (const fqn of registry.getAllObjects().map((o) => o.name).sort()) {
      const resolved = registry.resolveObject(fqn) as ResolvedObject | undefined;
      objects[fqn] = {
        body: resolved,
        packageId: resolved?._packageId,
        owner: registry.getObjectOwner(fqn)?.packageId,
        contributors: registry
          .getObjectContributors(fqn)
          .map((c) => ({ packageId: c.packageId, ownership: c.ownership, priority: c.priority, namespace: c.namespace })),
      };
    }
    return {
      packages: registry.getAllPackages().map((p) => ({
        id: p.manifest?.id,
        manifest: p.manifest,
        status: p.status,
        enabled: p.enabled,
      })),
      objectFqns: Object.keys(objects),
      objects,
      namespaces: ['crm', 'cpq', 'base'].map((ns) => [ns, registry.getNamespaceOwners(ns)]),
      types: registry.getRegisteredTypes().sort(),
    };
  };

  const bootKernel = async () => {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    return kernel;
  };

  it('produces the same registry state as the pre-ADR-0130 direct registerApp', async () => {
    const payload = basePackage();

    // Two IDENTICALLY booted kernels, so the platform packages a boot installs
    // are on both sides and the ONLY difference between them is which call
    // registers the artifact.
    const referenceKernel = await bootKernel();
    const loadPathKernel = await bootKernel();
    try {
      // The reference: the single `engine.registerApp(payload)` this load path
      // made before ADR-0130 — i.e. today's behaviour, not a second copy of the
      // new behaviour.
      const before = engineOf(referenceKernel);
      before.registerApp(payload);

      // The new load path, given the same single-`manifest` artifact.
      await (loadPathKernel.getService('manifest') as ManifestService).register(payload);
      const after = engineOf(loadPathKernel);

      const a = snapshot(before);
      const b = snapshot(after);

      // Named first so a failure reads as the fact that broke, not as a wall of
      // JSON: these are D7's four enumerated comparison points.
      expect(b.packages).toEqual(a.packages);
      expect(b.objectFqns).toEqual(a.objectFqns);
      expect(b.objectFqns.map((f) => b.objects[f].packageId))
        .toEqual(a.objectFqns.map((f) => a.objects[f].packageId));
      expect(b.namespaces).toEqual(a.namespaces);
      // …and then the whole of it, so a fifth thing that moves is not missed
      // just because D7 enumerated four.
      expect(b).toEqual(a);
    } finally {
      if (referenceKernel.getState() === 'running') await referenceKernel.shutdown();
      if (loadPathKernel.getState() === 'running') await loadPathKernel.shutdown();
    }
  });

  it('reads a bare manifest through the singular branch by reference, unchanged', () => {
    const payload = basePackage();
    const ordered = resolveArtifactPackageOrder(payload) as PackageBody[];
    expect(ordered).toHaveLength(1);
    // Identity, not deep equality: the D4 fallback must not copy, normalize or
    // re-validate the body every artifact built to date carries.
    expect(ordered[0]).toBe(payload);
  });
});
