// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # A package's declared dependency closure — the one walk (ADR-0141, ADR-0150 D3)
 *
 * Every reader that asks "which packages may package P reach" reads this
 * module, so no two can disagree:
 *
 *  - the save door's write scope (`resolveWritePackageScope` in
 *    `@objectstack/metadata-protocol`) and the runtime authoring gate
 *    (`@objectstack/lint` `runtime`), which judge what a write by P may
 *    reference ({@link packageDependencyClosure}, {@link resolvePackageClosure});
 *  - Studio's object pickers, which offer what the gate admits
 *    ({@link resolvePackageClosure} over the served package list);
 *  - the package-scoped resolution rule (`resolvePackageScopedHolders` in
 *    `@objectstack/core`, ADR-0150 D3 step 2), which resolves a bare name in
 *    P's closure plus the `sys` packages ({@link packageResolutionClosure}).
 *
 * ## Why it lives here (epic #31527, child R2)
 *
 * The walk started in `@objectstack/lint` and the App-pair widening in
 * `@objectstack/metadata-protocol`. ADR-0076 D2 keeps metadata-protocol out
 * of objectql's lean `./core` entry, where the resolution rule's first readers
 * sit (the registry, the engine's action and function registries), so they
 * could not read the closure. This package is already a dependency of lint,
 * metadata-protocol and objectql, is in the lean entry's admitted set, holds
 * the pair lookup the widening reads, and depends on nothing but
 * `@objectstack/spec`, so hosting the walk here adds no package edge. Lint and
 * metadata-protocol re-export what moved, under the same names.
 */

import { customizationBasePackageId } from '@objectstack/spec/kernel';
import { installedManifestsOf, pairOf } from './customization-pair-lookup.js';

/**
 * The value `_packageId` carries for a row rehydrated from `sys_metadata`
 * rather than delivered by a package — not a package id, so the walk reads it
 * as "unpackaged" rather than as a package nobody declared a dependency on.
 */
const OVERLAY_PROVENANCE_SENTINEL = 'sys_metadata';

/**
 * The package closure a write by `packageId` is judged against (#9612): the
 * package and the transitive closure of the `dependencies` its manifest
 * declares, read through `getPackage` — the host's package registry on the
 * server (`resolveWritePackageScope` in `@objectstack/metadata-protocol`), the
 * served package list in Studio, whose object pickers offer what this closure
 * admits. ONE walk for both, so the picker and the publish gate cannot
 * disagree about what a package may reference.
 *
 * Answers `undefined` — narrow nothing — for no package id, the
 * `sys_metadata` sentinel (an overlay row, not a package), and a package
 * `getPackage` cannot produce: its manifest is the only declaration of what it
 * may reference, and narrowing without it would be narrowing on nothing.
 *
 * A declared dependency `getPackage` cannot produce is still IN the closure:
 * the package declared it, so an object stamped with it is reachable by
 * declaration. Only the transitive walk stops there.
 *
 * Pure. A `getPackage` that throws propagates; the caller decides what an
 * unreadable registry means (the server answers `undefined`).
 */
export function resolvePackageClosure(
  packageId: string | null | undefined,
  getPackage: (id: string) => { manifest?: unknown } | undefined,
): { packageId: string; dependencies: string[] } | undefined {
  if (typeof packageId !== 'string' || packageId === '' || packageId === OVERLAY_PROVENANCE_SENTINEL) return undefined;
  if (!getPackage(packageId)) return undefined;

  const dependencies = new Set<string>();
  const frontier = [packageId];
  while (frontier.length > 0) {
    const current = frontier.pop() as string;
    const manifest = getPackage(current)?.manifest as { dependencies?: Record<string, unknown> } | undefined;
    const declared = manifest?.dependencies;
    if (!declared || typeof declared !== 'object') continue;
    for (const dep of Object.keys(declared)) {
      if (dep === packageId || dependencies.has(dep)) continue;
      dependencies.add(dep);
      frontier.push(dep);
    }
  }
  return { packageId, dependencies: [...dependencies] };
}

/** The registry slice the closure reads: a package by id, and every installed package. */
export interface PackageClosureRegistry {
  getPackage?: (id: string) => { manifest?: unknown } | undefined;
  getAllPackages?: () => ReadonlyArray<{ manifest?: unknown }>;
}

/**
 * [ADR-0146 D3, ruling record 6691022506] The write closure of an App's pair:
 * `closure` — the pair and what it declares, the App — widened, when it
 * declares its App, by every other installed package whose pair it is (`pairOf`)
 * and their own declared closures. A customization of any package of the App
 * lands in the App's pair, and the pair declares only the App (its range is
 * the App's), so the members it overrides and extends are reached through the
 * App's membership, not through a dependency the pair would have to restate
 * for every module the App delivers. Any other package's closure is returned
 * as it is.
 */
export function widenPairClosureToAppMembers(
  closure: { packageId: string; dependencies: string[] },
  registry: PackageClosureRegistry | undefined,
): { packageId: string; dependencies: string[] } {
  const pairId = closure.packageId;
  const appId = customizationBasePackageId(pairId);
  // Members are reached THROUGH the App: a pair that does not declare its
  // App (an installed copy that dropped the dependency) is widened by
  // nothing, and the App itself is only ever in the closure by declaration.
  if (appId === null || !closure.dependencies.includes(appId)) return closure;
  if (!registry || typeof registry.getPackage !== 'function' || typeof registry.getAllPackages !== 'function') return closure;
  const installed = installedManifestsOf(registry as { getPackage(id: string): { manifest?: unknown } | undefined });
  const getPackage = (id: string) => registry.getPackage!.call(registry, id);
  const dependencies = new Set(closure.dependencies);
  for (const row of registry.getAllPackages.call(registry)) {
    const id = (row?.manifest as { id?: unknown } | undefined)?.id;
    if (typeof id !== 'string' || id === pairId || id === appId || dependencies.has(id)) continue;
    const pair = pairOf(id, installed);
    if (!pair.ok || pair.value !== pairId) continue;
    dependencies.add(id);
    for (const dep of resolvePackageClosure(id, getPackage)?.dependencies ?? []) {
      if (dep !== pairId) dependencies.add(dep);
    }
  }
  return { packageId: pairId, dependencies: [...dependencies] };
}

/**
 * [#31575, ADR-0150 D3, ADR-0141] Package `packageId`'s DECLARED dependency
 * closure, read from `registry`: the package itself and every package its
 * manifest's `dependencies` name, transitively ({@link resolvePackageClosure}),
 * with an App's pair widened by the App's members
 * ({@link widenPairClosureToAppMembers}). The one implementation: the save
 * door's write scope is this call inside a silent `catch`, and the
 * package-scoped resolution rule's closure is this plus the `sys` packages
 * ({@link packageResolutionClosure}).
 *
 * Answers `undefined` exactly where the walk does — no package id, the
 * `sys_metadata` sentinel, a package `registry` cannot produce — and for a
 * registry with no `getPackage` (a metadata-only test double). Each reader
 * decides what `undefined` means for it: the save door narrows nothing, the
 * resolver reaches nothing beyond the caller's own items and `sys`.
 *
 * ⛔ It does NOT add the `sys` kernel namespace ADR-0150 D3 puts in a
 * resolution closure: the save door's scope stays as it was.
 *
 * A `getPackage` that throws propagates; the caller decides what an unreadable
 * registry means.
 */
export function packageDependencyClosure(
  packageId: string | null | undefined,
  registry: PackageClosureRegistry | undefined,
): { packageId: string; dependencies: string[] } | undefined {
  const getPackage = registry?.getPackage;
  if (typeof getPackage !== 'function') return undefined;
  const closure = resolvePackageClosure(packageId, (id) => getPackage.call(registry, id));
  return closure === undefined ? undefined : widenPairClosureToAppMembers(closure, registry);
}

/**
 * The reserved kernel namespace (ADR-0150 D2; ADR-0028 TL;DR 5): every package
 * declaring it is in every caller's resolution closure (D3).
 */
export const KERNEL_NAMESPACE = 'sys';

/** Every installed package of the reserved kernel namespace. */
function kernelPackages(registry: PackageClosureRegistry): string[] {
  const ids: string[] = [];
  if (typeof registry.getAllPackages !== 'function') return ids;
  for (const row of registry.getAllPackages.call(registry)) {
    const manifest = (row as { manifest?: { id?: unknown; namespace?: unknown } } | undefined)?.manifest;
    if (manifest?.namespace === KERNEL_NAMESPACE && typeof manifest.id === 'string' && manifest.id !== '') ids.push(manifest.id);
  }
  return ids;
}

/**
 * The packages a caller of package `callerPackageId` may resolve a bare name
 * in (ADR-0150 D3 step 2): its declared dependency closure — the save door's
 * own ({@link packageDependencyClosure}) — plus every `sys` package, the
 * caller itself excluded. A caller package the registry cannot produce
 * declares nothing, so it reaches `sys` only. Every host of the resolution
 * rule (`resolvePackageScopedHolders`) supplies its closure from this one call.
 */
export function packageResolutionClosure(registry: PackageClosureRegistry, callerPackageId: string): ReadonlySet<string> {
  const reach = new Set<string>(packageDependencyClosure(callerPackageId, registry)?.dependencies ?? []);
  for (const id of kernelPackages(registry)) reach.add(id);
  reach.delete(callerPackageId);
  return reach;
}
