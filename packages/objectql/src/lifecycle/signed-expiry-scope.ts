// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { isTenantAuthored } from '@objectstack/metadata-core';

/**
 * [ADR-0154 D8] The registry surface {@link takesSignedExpiry} asks. Each
 * member is optional so a double that models only `getAllObjects` stays a
 * legal registry: such a registry cannot answer, and the answer is then "no".
 */
export interface SignedExpiryRegistryLike {
  /** `SchemaRegistry.getPackagedObjectOwner`: the code-shipped `own` contributor of a name, if any. */
  getPackagedObjectOwner?(name: string): { packageId?: string } | undefined;
  /** `SchemaRegistry.getObjectOwner`: the `own` contributor of a name. */
  getObjectOwner?(name: string): { packageId?: string; definition?: unknown } | undefined;
  /** `SchemaRegistry.getPackage`: an installed package and the source it was installed from. */
  getPackage?(id: string): { source?: unknown } | undefined;
}

/**
 * [ADR-0154 D8] Whether `object`, a sealed object as the registry resolves it,
 * takes the signed expiry and its retention floor.
 *
 * Signed expiry covers objects whose lifecycle is declared in packaged
 * metadata. The answer is yes only when the registry says so positively:
 *
 * - the resolved definition is not tenant-authored (ADR-0010
 *   `_provenance: 'org'`, which a tenant layer over a packaged owner also
 *   carries, ADR-0029 D9.2); and
 * - its owner is a code-shipped contributor of an installed package whose
 *   source is `code` or `marketplace`, or a plain registration from code
 *   (an owner with no package at all).
 *
 * Everything else — an object created at runtime, an owner under a package
 * id no installed package answers (the `metadata-service` and `sys_metadata`
 * keys among them), a registry that cannot be asked — keeps the row-cutoff
 * retention sweep, as before signed expiry existed. A miss therefore falls on
 * that sweep, never on a signed expiry.
 *
 * Shared by the lifecycle service's routing, the audit plugin's floors and the
 * sealer's own expiry, so the three cannot disagree on one object.
 */
export function takesSignedExpiry(
  registry: SignedExpiryRegistryLike | undefined,
  object: { name: string },
): boolean {
  if (!registry || isTenantAuthored(object)) return false;
  const packaged = typeof registry.getPackagedObjectOwner === 'function'
    ? registry.getPackagedObjectOwner(object.name)
    : undefined;
  if (packaged) {
    if (typeof packaged.packageId !== 'string' || typeof registry.getPackage !== 'function') return false;
    const source = registry.getPackage(packaged.packageId)?.source;
    return source === 'code' || source === 'marketplace';
  }
  const owner = typeof registry.getObjectOwner === 'function' ? registry.getObjectOwner(object.name) : undefined;
  return owner !== undefined && owner.packageId === undefined && !isTenantAuthored(owner.definition);
}
