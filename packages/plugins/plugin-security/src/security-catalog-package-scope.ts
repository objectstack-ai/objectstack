// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3/D4, epic #31527 child E3] The package scope the security
 * catalog reads permission sets through: `(package, name)`, resolved by the
 * ONE package-scoped resolver, `resolvePackageScopedName`
 * (`@objectstack/objectql`, child R).
 *
 * The catalog read lives in `@objectstack/core`, which cannot import ObjectQL,
 * so whoever binds a catalog to an engine hands this in
 * (`SecurityCatalogSources.packageScope`, core `security-catalog.ts`). It is a
 * thin adapter and nothing more:
 *
 *  - ⛔ it implements no resolution step of its own — every answer is the
 *    resolver's, or one of the registry's read-only package-scoped reads that
 *    the resolver itself reads (`packageScopedHoldersOf`,
 *    `getPackageScopedItem`, `getEnvironmentScopedItem`);
 *  - ⛔ it never falls back to the registry's by-name read (`getItem`), whose
 *    first-registered answer is the silent pick ADR-0150 retires;
 *  - a refusal keeps every candidate, described in the resolver's own words
 *    (`describePackageScopedHolder`).
 *
 * Positions and capabilities are not read here: positions stay one
 * environment-wide slot per name (ADR-0150 D7, ruled Q2 = A), and capabilities
 * are bucket 1.
 */

import {
  describePackageScopedHolder,
  resolvePackageScopedName,
  type PackageScopedRegistry,
} from '@objectstack/objectql';
import {
  createSecurityCatalogReader,
  type SecurityCatalogMetadataService,
  type SecurityCatalogPackageScope,
  type SecurityCatalogReader,
  type SecurityCatalogRegistry,
  type SecurityCatalogScopedOutcome,
} from '@objectstack/core';

/** The permission-set type, as the registry and the resolver spell it. */
const PERMISSION_SET_TYPE = 'permission' as const;

/**
 * The registry slice the scope reads: the resolver's own slice, plus the
 * artifact read that tells a package's shipped position from an
 * environment-authored row or overlay served under the same name.
 */
export type SecurityCatalogPackageScopeRegistry = PackageScopedRegistry & {
  getArtifactItem(type: string, name: string, currentPackageId?: string): unknown;
};

const REQUIRED_MEMBERS = [
  'getPackage',
  'getAllPackages',
  'packageScopedHoldersOf',
  'getPackageScopedItem',
  'getEnvironmentScopedItem',
  'getArtifactItem',
] as const;

/** Does `registry` carry every read the scope makes? */
export function isPackageScopeRegistry(registry: unknown): registry is SecurityCatalogPackageScopeRegistry {
  if (!registry || typeof registry !== 'object') return false;
  return REQUIRED_MEMBERS.every((member) => typeof (registry as Record<string, unknown>)[member] === 'function');
}

/**
 * The package scope over `registry` — ObjectQL's `SchemaRegistry`
 * (`engine.registry`) — or `undefined` when it lacks a read the scope makes,
 * which only a stand-in registry does; the caller then builds a by-name
 * catalog, which is right only for a registry holding one item per name.
 */
export function createSecurityCatalogPackageScope(registry: unknown): SecurityCatalogPackageScope | undefined {
  if (!isPackageScopeRegistry(registry)) return undefined;
  return {
    resolvePermissionSet(name, callerPackageId): SecurityCatalogScopedOutcome {
      const answer = resolvePackageScopedName(registry, { type: PERMISSION_SET_TYPE, name, callerPackageId });
      switch (answer.status) {
        case 'resolved':
          return {
            status: 'resolved',
            item: answer.item,
            holderPackageId: answer.holder.kind === 'package' ? answer.holder.packageId : null,
          };
        case 'not-found':
          return { status: 'not-found' };
        case 'refused':
          return {
            status: 'refused',
            reason: answer.reason,
            candidates: answer.candidates.map(describePackageScopedHolder),
            message: answer.message,
          };
      }
    },

    permissionSetHolders(name) {
      const out: Array<{ packageId: string | null; item: unknown }> = [];
      for (const packageId of registry.packageScopedHoldersOf(PERMISSION_SET_TYPE, name)) {
        const item = registry.getPackageScopedItem(PERMISSION_SET_TYPE, name, packageId);
        if (item !== undefined) out.push({ packageId, item });
      }
      const own = registry.getEnvironmentScopedItem(PERMISSION_SET_TYPE, name);
      if (own !== undefined) out.push({ packageId: null, item: own });
      return out;
    },

    isPackageItem(type, name, packageId, definition) {
      // The package's own shipped item is its composite slot, which the
      // artifact read answers prefer-local; a bare-slot row (an environment
      // item, an overlay, a `.custom` override) is a different object.
      return definition !== undefined && registry.getArtifactItem(type, name, packageId) === definition;
    },
  };
}

/**
 * The security catalog read over an engine registry and the metadata service,
 * with permission sets read by `(package, name)` — the ONE way this plugin
 * builds a catalog (`createSecurityCatalogReader`, `@objectstack/core`).
 * Throws exactly as that constructor does for a missing reader.
 */
export function createPackageScopedSecurityCatalogReader(registry: unknown, metadata: unknown): SecurityCatalogReader {
  const packageScope = createSecurityCatalogPackageScope(registry);
  return createSecurityCatalogReader({
    registry: registry as SecurityCatalogRegistry,
    metadata: metadata as SecurityCatalogMetadataService,
    ...(packageScope ? { packageScope } : {}),
  });
}
