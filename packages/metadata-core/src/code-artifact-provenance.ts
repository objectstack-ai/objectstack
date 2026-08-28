// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Does a code package ship this name?" — the ADR-0029 D9.6 provenance test.
 *
 * [#10062] Sunk here from `@objectstack/objectql`'s registry by the same
 * criterion as the write-verb dispatch predicates and the audit governance
 * table above it in `index.ts`: a second layer needs the answer, and the
 * reverse import would either close a cycle or make the consumer depend on the
 * whole data engine for one predicate.
 *
 * The second layer is `@objectstack/service-automation`'s ADR-0048 flow
 * precedence, which asks exactly this question to decide which contender for a
 * flow name wins. It reached it by importing `@objectstack/objectql` directly —
 * a package it does not declare — and because the shared tsup config
 * externalises only `dependencies`/`peerDependencies`, the bundler INLINED
 * objectql's implementation into `service-automation/dist/index.js`: a second
 * copy of another package's code, kept correct by build configuration alone.
 * `@objectstack/metadata-core` is the package both sides already declare and it
 * depends on neither, so the answer now has one home and one implementation.
 *
 * `objectql` re-exports `isCodeArtifactBody` from `registry.ts`, so its public
 * API is unchanged.
 */

/**
 * Is this registered item a TENANT-authored overlay rather than a code-shipped
 * artifact? (ADR-0010 `_provenance`: `'package'` for loader-introduced items,
 * `'org'` for tenant-authored.)
 *
 * `_packageId !== 'sys_metadata'` alone cannot answer it. That sentinel marks
 * one thing only — an overlay row bound to no package. A row that IS bound to
 * one is keyed by its real package id on BOTH sides that register it: the save
 * path (#4636 PR1) and the boot-time rehydration of `sys_metadata` (#4636 PR2).
 * Either way the key is `app.<slug>`, which is exactly what every code-shipped
 * item carries too, so the sentinel test cannot tell them apart. A tenant's own
 * overlay came back from a kernel rebuild looking like a code
 * artifact, and the protocol's overlay gate refused the next write to it with
 * `not_overridable` — an app the user had just built through Studio/AI became
 * permanently un-editable at the first kernel rebuild (cloud#970). Provenance is
 * the axis that actually distinguishes the two, so ask it.
 */
export function isTenantAuthored(item: unknown): boolean {
  return (item as { _provenance?: unknown } | null | undefined)?._provenance === 'org';
}

/**
 * [ADR-0029 D9.6] Is this registered body a CODE-shipped artifact?
 *
 * The exact test `SchemaRegistry.getArtifactItem` has always applied, factored
 * out so the object branch and the D9.8 hydration discriminator
 * (`SchemaRegistry.getPackagedObjectOwner`) cannot drift into two different
 * answers to one question — "does a code package ship this name?". Truthy
 * `_packageId`, not the `'sys_metadata'` rehydration sentinel, and not tenant
 * provenance.
 */
export function isCodeArtifactBody(item: unknown): boolean {
  const it = item as { _packageId?: unknown } | null | undefined;
  if (!it || !it._packageId || it._packageId === 'sys_metadata') return false;
  return !isTenantAuthored(it);
}
