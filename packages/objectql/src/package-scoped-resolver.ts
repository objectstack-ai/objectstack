// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # One answer to "which package's item does this bare name mean" (ADR-0150 D3) — objectql's adapters
 *
 * Behavioural and presentation metadata (ADR-0150 D1 buckets 2 and 3: flows,
 * actions, permission sets, pages, skills, …) is identified by
 * `(package, name)`. Every reader that later carries the package — the runtime
 * indexes (epic #31527 children E), the by-name doors (G), the stored
 * references (S) — resolves a bare name through ONE rule, so no two readers
 * can drift into two rules. That drift is what phase 1 (#30803) measured:
 * first-registered wins in some readers, refusal in others.
 *
 * ## Where the rule is, and what this module adds (child R2, #31716)
 *
 * The rule itself — D3's three steps over a holder set and a closure the
 * caller supplies, its refusal and the vocabulary that refusal is written in —
 * is `resolvePackageScopedHolders` in `@objectstack/core`
 * (`package-scoped-resolution.ts`; its module doc states the rule, the two red
 * lines and the exceptions). The closure is `packageResolutionClosure` in
 * `@objectstack/metadata-core`: the caller's declared dependency closure, the
 * save door's own walk, plus every `sys` package. Both sit where every reader
 * reaches them, objectql's lean `./core` entry included (ADR-0076 D2), and
 * this module re-exports both under the names child R published.
 *
 * This module is the two objectql adapters over that rule, each the rule's
 * call with the holders of one store and the closure from that one walk:
 *
 *  - {@link resolvePackageScopedName} — the registry's holders: a package's
 *    item in its composite slot with its ADR-0005 overlay when one binds to
 *    it (`SchemaRegistry.getPackageScopedItem`, the per-package overlay slot of
 *    D4), and the environment's own item (`getEnvironmentScopedItem`);
 *  - {@link resolvePackageScopedFunction} — the engine's function registry: a
 *    function is not a metadata type, so it resolves in the package of the
 *    flow whose `script` node names it (D4's last row), over the per-package
 *    function holders the engine keeps (`ObjectQL#functionHoldersOf`).
 *
 * **A package-less row that bears a package-held name is a customization,
 * never a second item** (ADR-0150 D3): it is the overlay of the one holder,
 * and the environment's own item is one whose name no package holds
 * (`SchemaRegistry.getEnvironmentScopedItem`). So it never makes a name
 * ambiguous, and it is never served beside the item it customizes.
 *
 * ## What it deliberately does not do
 *
 *  - ⛔ Wire any reader, retire or narrow any phase-1 refusal, or change any
 *    spec (child R's scope, and R2's: the function callers are a later
 *    child's).
 *  - ⛔ Address an object-bound action by `(package, objectName, name)`: it
 *    resolves the registry's `(type, name)` key, which is the object-less
 *    action's whole identity; the object-bound key is child E2's.
 *  - ⛔ Address an object or any other bucket-1 type: their names are literal
 *    and global (ADR-0129).
 */

import {
  ENGINE_FUNCTION_TYPE,
  PACKAGE_SCOPED_TYPES,
  PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE,
  describePackageScopedHolder,
  isPackageScopedResolvableType,
  isPackageScopedType,
  isPlatformRequestedBareName,
  packageScopedHolderSource,
  packageScopedRefusalMessage,
  resolvePackageScopedHolders,
  type PackageScopedHoldersQuery,
  type PackageScopedResolution,
  type PackageScopedType,
} from '@objectstack/core';
import { KERNEL_NAMESPACE, packageResolutionClosure } from '@objectstack/metadata-core';
import type { ObjectQL } from './engine.js';
import type { FunctionEntry } from './engine-top-level.js';
import type { SchemaRegistry } from './registry.js';

// Child R's published names — now the rule's (`@objectstack/core`) and the
// walk's (`@objectstack/metadata-core`) own — and R2's additions to them.
export {
  ENGINE_FUNCTION_TYPE,
  KERNEL_NAMESPACE,
  PACKAGE_SCOPED_TYPES,
  PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE,
  describePackageScopedHolder,
  isPackageScopedResolvableType,
  isPackageScopedType,
  isPlatformRequestedBareName,
  packageResolutionClosure,
  packageScopedHolderSource,
  packageScopedRefusalMessage,
  resolvePackageScopedHolders,
};
export type {
  PackageResolutionClosureOf,
  PackageScopedHolder,
  PackageScopedHolderSource,
  PackageScopedHoldersQuery,
  PackageScopedRefusal,
  PackageScopedRefusalReason,
  PackageScopedResolution,
  PackageScopedResolutionStep,
  PackageScopedResolvableType,
  PackageScopedType,
} from '@objectstack/core';
export type { PackageClosureRegistry } from '@objectstack/metadata-core';

/** What {@link resolvePackageScopedName} is asked. */
export interface PackageScopedQuery extends PackageScopedHoldersQuery {
  readonly type: PackageScopedType;
  /** For a bundled type (`email_template`): one member, as `getItem` takes it. */
  readonly member?: string;
  /**
   * [#32183] Judge over every holder, a disabled package's included — the
   * read a DURABLE judgment takes (a backfill binding a stored row, the
   * stored-reference report), so its answer never moves with a reversible
   * disable. Omitted, a disabled package holds no name: the served holders
   * ({@link SchemaRegistry.packageScopedHoldersOf}), which every door reads.
   */
  readonly includeDisabledPackages?: boolean;
}

/** The registry slice the registry adapter reads — every member of it, and no other. */
export type PackageScopedRegistry = Pick<
  SchemaRegistry,
  'getPackage' | 'getAllPackages' | 'packageScopedHoldersOf' | 'getPackageScopedItem' | 'getEnvironmentScopedItem'
>;

/**
 * Resolve a bare name by ADR-0150 D3 over the registry's holders: the rule
 * (`resolvePackageScopedHolders`) with the registry as the holder source and
 * the caller's closure from the one walk ({@link packageResolutionClosure}).
 * Reads the registry, writes nothing, and never throws for a name — only for
 * a type that is not addressed by package ({@link PACKAGE_SCOPED_TYPES}),
 * which is a caller's programming error.
 *
 * @returns `resolved` with the item, its holder and the step that reached it;
 *   `not-found` when nothing holds the name; `refused` naming every candidate
 *   of the step that could not pick one.
 */
export function resolvePackageScopedName<T = unknown>(
  registry: PackageScopedRegistry,
  query: PackageScopedQuery,
): PackageScopedResolution<T> {
  if (!isPackageScopedType(query.type)) {
    throw new TypeError(
      `[package-scoped-resolver] "${String(query.type)}" is not addressed by (package, name) (ADR-0150 D1); ` +
      (query.type === ENGINE_FUNCTION_TYPE
        ? 'the registry holds no function: resolvePackageScopedFunction resolves one over the engine\'s holders (ADR-0150 D4).'
        : 'positions are environment-scoped (D7) and objects keep their literal name (ADR-0129).'),
    );
  }
  const { type, name, member } = query;
  return resolvePackageScopedHolders<T>(
    query,
    {
      // The caller's own holding counts for its step 1 even as a bundle
      // addition, and even when its package is disabled.
      packageHolders: registry.packageScopedHoldersOf(type, name, query.callerPackageId,
        query.includeDisabledPackages === true ? { includeDisabledPackages: true } : undefined),
      packageItem: (packageId) => registry.getPackageScopedItem<T>(type, name, packageId, member),
      environmentItem: () => registry.getEnvironmentScopedItem<T>(type, name, member),
    },
    (callerPackageId) => packageResolutionClosure(registry, callerPackageId),
  );
}

/** What {@link resolvePackageScopedFunction} is asked: a function's name, and the package of the flow naming it. */
export interface PackageScopedFunctionQuery {
  readonly name: string;
  /**
   * The package of the flow whose `script` node names the function (the
   * package whose own body is armed under the flow's name); omitted, `null`,
   * `''` or the `sys_metadata` sentinel is a caller with no package.
   */
  readonly callerPackageId?: string | null;
}

/** The engine slice the function adapter reads — every member of it, and no other. */
export type PackageScopedFunctionEngine = Pick<ObjectQL, 'registry' | 'functionHoldersOf'>;

/**
 * Resolve the function a flow's `script` node names, in the package of that
 * flow (ADR-0150 D4's last row): the rule (`resolvePackageScopedHolders`)
 * with the engine's per-package function holders (`ObjectQL#functionHoldersOf`)
 * and the caller's closure from the one walk ({@link packageResolutionClosure}
 * over the engine's registry). An owner-less registration is the platform's
 * item — code a plugin or the host registers, never an item authored in the
 * environment — so it is in every caller's reach, like `sys` (ADR-0150 D2):
 * a package caller holding none itself counts it beside its closure's
 * holders. Writes nothing, never throws for a name.
 *
 * [#32073] Read by the flow `script` node, through the automation service's
 * function bridge (service-automation `function-package-scope.ts`), with the
 * calling flow's armed package as the caller. An action `target` is no
 * reader: it names a handler key in the action registry, which E2 resolves
 * by package, never a registered function. `resolveFunction` /
 * `resolveFunctionEntry` keep answering the one last-registered function per
 * name for any other caller.
 */
export function resolvePackageScopedFunction(
  engine: PackageScopedFunctionEngine,
  query: PackageScopedFunctionQuery,
): PackageScopedResolution<Readonly<FunctionEntry>> {
  const registry = engine.registry;
  return resolvePackageScopedHolders(
    { type: ENGINE_FUNCTION_TYPE, name: query.name, callerPackageId: query.callerPackageId },
    engine.functionHoldersOf(query.name),
    (callerPackageId) => packageResolutionClosure(registry, callerPackageId),
  );
}
