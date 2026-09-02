// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 D1 + D3 — the install gate's co-ownership criterion, and the
 * object-name uniqueness check that may not ship without it.
 *
 * ## Why one file, and why the first test carries both halves
 *
 * D3 specifies this pair as a MACHINE constraint rather than an instruction,
 * because it is the only part of ADR-0130 that can reach customer data. Today's
 * namespace exclusivity is silently carrying a second guarantee — ADR-0048 §3.2
 * grounds it on "two packages with namespace `crm` both try to create
 * `crm_account` and the second fails at the DB" — so "no two packages share a
 * namespace" has been proxying for "no two packages define the same object
 * name". Relax the first without adding the second and two co-owning packages
 * defining `crm_account` produce a duplicate `CREATE TABLE`, or — driver
 * dependent — one package silently overwriting the other's table definition.
 *
 * So the first test is deliberately ONE `it` asserting ONE proposition: *given
 * the gate admits two co-owning packages, an artifact whose co-owners define the
 * same object name is refused at install.* Delete the refusal and its second
 * half goes red; revert the relaxation and its first half goes red. ⛔ Do not
 * "tidy" it into two independent tests — separable tests are exactly what would
 * let the relaxation ship alone, which is the outcome D3 exists to prevent.
 *
 * That test drives the REAL load path (`manifest.register()` on a booted
 * kernel), not `installPackage` with a hand-made scope, because the scope
 * threading is part of the change: an implementation that relaxes the gate but
 * never tells it which artifact a package arrived in would pass a hand-fed test
 * and fail on a real artifact.
 *
 * Rejection assertions carry the ADR-0112 envelope — `code` AND `status` —
 * never a bare "it throws": a bare throw assertion stays green against a driver
 * or a fixture that throws a plain `Error` for an unrelated reason, which is
 * precisely the failure this suite exists to catch.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import { SchemaRegistry, NamespaceConflictError, ArtifactObjectNameConflictError } from './registry.js';
import type { ObjectQL } from './engine.js';

type ManifestService = { register(m: unknown): void | Promise<void> };

const engineOf = (kernel: ObjectKernel): ObjectQL => kernel.getService<ObjectQL>('objectql');

/** The error shape every rejection assertion below reads. */
type Envelope = Error & { code?: string; status?: number };

/**
 * `manifest.register()` may reject or throw synchronously — a refusal raised by
 * `installPackage` propagates out of the non-async `register` before the promise
 * it would otherwise return exists. Catching both is the honest spelling; an
 * `await expect(...).rejects` assertion would MISS the synchronous throw and
 * report it as a test error instead of a refusal.
 */
const registerAndCatch = async (svc: ManifestService, artifact: unknown): Promise<Envelope | undefined> => {
  try {
    await svc.register(artifact);
    return undefined;
  } catch (e) {
    return e as Envelope;
  }
};

/** The package that owns `crm_account`, under namespace `crm`. */
const crmCore = () => ({
  id: 'com.acme.crm',
  name: 'acme_crm',
  version: '1.0.0',
  type: 'app',
  namespace: 'crm',
  objects: [
    { name: 'crm_account', label: 'Account', fields: { name: { name: 'name', label: 'Name', type: 'text' } } },
  ],
});

/**
 * A co-owning package: SAME namespace `crm`, different object. This is exactly
 * the shape today's gate refuses and D1 admits — two packages, one artifact, one
 * namespace.
 */
const crmBilling = () => ({
  id: 'com.acme.crm.billing',
  name: 'acme_crm_billing',
  version: '1.0.0',
  type: 'module',
  namespace: 'crm',
  objects: [
    { name: 'crm_invoice', label: 'Invoice', fields: { total: { name: 'total', label: 'Total', type: 'number' } } },
  ],
});

/** The same co-owner, but claiming the object name `com.acme.crm` already owns. */
const crmBillingColliding = () => ({
  ...crmBilling(),
  objects: [
    { name: 'crm_account', label: 'Account (billing)', fields: { balance: { name: 'balance', label: 'Balance', type: 'number' } } },
  ],
});

const artifactOf = (...manifests: unknown[]) => ({ packages: manifests.map((manifest) => ({ manifest })) });

const bootKernel = async () => {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  await kernel.use(new ObjectQLPlugin());
  await kernel.bootstrap();
  return kernel;
};

describe('ADR-0130 D1 + D3 — the gate relaxation and the object-name check are ONE change', () => {
  const kernels: ObjectKernel[] = [];

  const freshKernel = async () => {
    const k = await bootKernel();
    kernels.push(k);
    return k;
  };

  afterEach(async () => {
    while (kernels.length) {
      const k = kernels.pop()!;
      if (k.getState() === 'running') await k.shutdown();
    }
  });

  it('THE PAIRING GATE — given the gate admits same-artifact co-owners, an artifact whose co-owners define the same object name is REFUSED at install', async () => {
    // ── Half 1 (D1): the relaxation. Two packages, one artifact, one namespace.
    // Today's gate refuses this outright; joint delivery in one artifact IS the
    // co-ownership declaration, so it must now install.
    const admitting = await freshKernel();
    const admitted = await registerAndCatch(
      admitting.getService('manifest') as ManifestService,
      artifactOf(crmCore(), crmBilling()),
    );
    expect(admitted).toBeUndefined();

    const ql = engineOf(admitting);
    expect(ql.registry.getPackage('com.acme.crm')).toBeDefined();
    expect(ql.registry.getPackage('com.acme.crm.billing')).toBeDefined();
    // Both are owners of the namespace — co-ownership, not a transfer.
    expect(ql.registry.getNamespaceOwners('crm').sort())
      .toEqual(['com.acme.crm', 'com.acme.crm.billing']);
    // …and each owns its own object.
    expect(ql.registry.getObjectOwner('crm_account')?.packageId).toBe('com.acme.crm');
    expect(ql.registry.getObjectOwner('crm_invoice')?.packageId).toBe('com.acme.crm.billing');

    // ── Half 2 (D3): the refusal the relaxation may not ship without. The SAME
    // co-ownership, with both packages defining `crm_account`.
    const refusing = await freshKernel();
    const refused = await registerAndCatch(
      refusing.getService('manifest') as ManifestService,
      artifactOf(crmCore(), crmBillingColliding()),
    );

    expect(refused).toBeDefined();
    // ADR-0112 envelope — never a bare `toThrow()`.
    expect(refused?.code).toBe('DUPLICATE_ARTIFACT_OBJECT_NAME');
    expect(refused?.status).toBe(422);
    // D3: the error names BOTH packages and the object.
    expect(refused?.message).toContain('com.acme.crm');
    expect(refused?.message).toContain('com.acme.crm.billing');
    expect(refused?.message).toContain('crm_account');
    expect(refused).toBeInstanceOf(ArtifactObjectNameConflictError);
  });

  it('refuses whichever co-owner claims the name second, in either declared order', async () => {
    // The refusal is a property of the artifact, not of the array slot. With no
    // dependency edges the loader preserves declared order, so this artifact
    // installs the colliding package FIRST and the refusal names the roles the
    // other way round. An implementation that only looked at "the last one in"
    // would still be wrong for one of these two.
    const kernel = await freshKernel();
    const refused = await registerAndCatch(
      kernel.getService('manifest') as ManifestService,
      artifactOf(crmBillingColliding(), crmCore()),
    );
    expect(refused?.code).toBe('DUPLICATE_ARTIFACT_OBJECT_NAME');
    expect(refused?.status).toBe(422);
    const err = refused as ArtifactObjectNameConflictError;
    expect(err.objectName).toBe('crm_account');
    expect(err.existingPackageId).toBe('com.acme.crm.billing');
    expect(err.incomingPackageId).toBe('com.acme.crm');
  });

  it('still refuses two packages from DIFFERENT artifacts that share a namespace', async () => {
    // The relaxation is co-ownership, not permission. Two single-package
    // artifacts registered separately are two deliveries by (as far as the
    // runtime can observe) two publishers, and the ADR-0048 gate stands.
    const kernel = await freshKernel();
    const svc = kernel.getService('manifest') as ManifestService;

    expect(await registerAndCatch(svc, crmCore())).toBeUndefined();
    const refused = await registerAndCatch(svc, crmBilling());

    expect(refused).toBeInstanceOf(NamespaceConflictError);
    const err = refused as NamespaceConflictError;
    expect(err.namespace).toBe('crm');
    expect(err.existingPackageId).toBe('com.acme.crm');
    expect(err.incomingPackageId).toBe('com.acme.crm.billing');
    // Nothing half-applied: the refused package is not recorded.
    expect(engineOf(kernel).registry.getPackage('com.acme.crm.billing')).toBeUndefined();
  });

  it('leaves NOTHING behind when it refuses — no package record, no namespace claim, the sitting definition untouched', async () => {
    // D3 item 3: the check is install-time, ahead of any DDL. Its observable
    // consequence at this layer is that the refused package never reaches the
    // registry at all — the refusal lands before every mutation `installPackage`
    // makes, so there is no half-applied install to unwind and no second
    // definition of `crm_account` for a driver to reconcile.
    const kernel = await freshKernel();
    const refused = await registerAndCatch(
      kernel.getService('manifest') as ManifestService,
      artifactOf(crmCore(), crmBillingColliding()),
    );
    expect(refused?.code).toBe('DUPLICATE_ARTIFACT_OBJECT_NAME');

    const registry = engineOf(kernel).registry;
    expect(registry.getPackage('com.acme.crm.billing')).toBeUndefined();
    expect(registry.getNamespaceOwners('crm')).toEqual(['com.acme.crm']);
    // The sitting owner's definition is exactly its own — not merged with, and
    // not replaced by, the refused package's body.
    expect(registry.getObjectOwner('crm_account')?.packageId).toBe('com.acme.crm');
    const account = registry.resolveObject('crm_account') as { label?: string; fields?: Record<string, unknown> } | undefined;
    expect(account?.label).toBe('Account');
    expect(account?.fields?.balance).toBeUndefined();
  });
});

describe('ADR-0130 D1 — the relaxation does not widen the same-id reinstall exemption', () => {
  /**
   * The negative half, and the reason this suite exists in the shape it does.
   *
   * Today's gate admits `owner === manifest.id` — a package reinstalling or
   * reloading itself. Widening the namespace predicate to "co-owner within one
   * artifact" must NOT widen that exemption too: being delivered alongside a
   * package must never become the right to overwrite it. Co-ownership shares a
   * NAMESPACE; it does not share an identity, a package record, or an object.
   */
  let registry: SchemaRegistry;

  const scopeOf = (...ids: string[]) => ({ packageIds: ids });

  beforeEach(() => {
    registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    registry.logLevel = 'silent';
  });

  /**
   * Install a package the way `registerApp` does — the package record, then its
   * owned objects through the registry's own primitive with the same arguments
   * `registerApp` passes.
   */
  const install = (manifest: ReturnType<typeof crmCore>, scope?: { packageIds: string[] }) => {
    registry.installPackage(manifest as never, undefined, scope);
    for (const obj of manifest.objects ?? []) {
      registry.registerObject(obj as never, manifest.id, manifest.namespace, 'own');
    }
  };

  it('a co-owner does not take over the package record, the namespace, or the object it shares a namespace with', () => {
    const scope = scopeOf('com.acme.crm', 'com.acme.crm.billing');
    install(crmCore(), scope);
    install(crmBilling(), scope);

    // The sitting package's record is still ITS manifest, not the co-owner's.
    expect(registry.getPackage('com.acme.crm')?.manifest?.name).toBe('acme_crm');
    expect(registry.getPackage('com.acme.crm.billing')?.manifest?.name).toBe('acme_crm_billing');
    // The namespace gained an owner; it did not change hands.
    expect(registry.getNamespaceOwners('crm').sort())
      .toEqual(['com.acme.crm', 'com.acme.crm.billing']);
    // The object stays with the package that declared it.
    expect(registry.getObjectOwner('crm_account')?.packageId).toBe('com.acme.crm');
  });

  it('a DIFFERENT id in the same artifact gains no right to redefine an installed co-owner\'s object', () => {
    const scope = scopeOf('com.acme.crm', 'com.acme.crm.billing');
    install(crmCore(), scope);

    let caught: Envelope | undefined;
    try {
      registry.installPackage(crmBillingColliding() as never, undefined, scope);
    } catch (e) { caught = e as Envelope; }

    expect(caught?.code).toBe('DUPLICATE_ARTIFACT_OBJECT_NAME');
    expect(caught?.status).toBe(422);
    expect(registry.getPackage('com.acme.crm.billing')).toBeUndefined();
  });

  it('still admits a package reinstalling ITSELF, with or without an artifact scope', () => {
    // The exemption the relaxation must leave exactly as wide as it was: same
    // id, so same package, so a reload — including a reload arriving from a
    // different artifact, which is what a version upgrade is.
    install(crmCore(), scopeOf('com.acme.crm'));
    expect(() => registry.installPackage(crmCore() as never, undefined, scopeOf('com.acme.crm'))).not.toThrow();
    expect(() => registry.installPackage(crmCore() as never)).not.toThrow();
    expect(() => registry.installPackage(crmCore() as never, undefined, scopeOf('com.acme.crm', 'com.acme.crm.billing')))
      .not.toThrow();
  });

  it('does not refuse an object name claimed from OUTSIDE the artifact — that is the namespace gate\'s question', () => {
    // Scope discipline, pinned: D3's refusal covers what D1 admitted, and
    // nothing else. A stranger claiming a name it does not co-own is refused by
    // the ADR-0048 gate (same namespace) or by `registerObject`'s own ownership
    // rule (different namespace) — both unchanged by this card, and neither one
    // this refusal's to pre-empt.
    install(crmCore(), scopeOf('com.acme.crm'));
    const stranger = { ...crmBillingColliding(), id: 'com.other.suite', namespace: 'other' };

    let caught: Envelope | undefined;
    try {
      registry.installPackage(stranger as never, undefined, scopeOf('com.other.suite'));
    } catch (e) { caught = e as Envelope; }

    expect(caught).toBeUndefined();
    expect(registry.getPackage('com.other.suite')).toBeDefined();
  });

  it('is NOT downgraded by OS_METADATA_COLLISION=warn', () => {
    // `collisionPolicy: 'warn'` is ADR-0048's escape hatch for a deliberate
    // NAMESPACE migration. It was never a licence to let two definitions of one
    // object name through: that is the outcome ADR-0130 D3 calls the only one in
    // this design that can damage customer data, and the DB would refuse it
    // anyway — later, and less legibly. So the object-name refusal is hard.
    const warnReg = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'warn' });
    warnReg.logLevel = 'silent';
    const scope = scopeOf('com.acme.crm', 'com.acme.crm.billing');
    const base = crmCore();
    warnReg.installPackage(base as never, undefined, scope);
    for (const obj of base.objects) warnReg.registerObject(obj as never, base.id, base.namespace, 'own');

    let caught: Envelope | undefined;
    try {
      warnReg.installPackage(crmBillingColliding() as never, undefined, scope);
    } catch (e) { caught = e as Envelope; }

    expect(caught?.code).toBe('DUPLICATE_ARTIFACT_OBJECT_NAME');
    expect(caught?.status).toBe(422);
  });
});
