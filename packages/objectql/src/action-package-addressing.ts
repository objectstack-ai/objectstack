// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # An action is addressed by `(package, objectName, name)` (ADR-0150 D4, child E2)
 *
 * ADR-0150 D4 re-keys the action engine from `objectName:name` to
 * `(package, objectName, name)`, object-less actions under
 * `(package, global, name)`. This module holds the two halves of that key that
 * the engine (`engine-actions.ts`) and the router
 * (`@objectstack/runtime`'s `resolveRouteActionDeclaration`) share:
 *
 *  - **the handler's coordinate** (`actionHandlerCoordinate`, in
 *    `action-handler-coordinate.ts` so the lean `./core` entry the engine
 *    belongs to never reaches the resolver's `@objectstack/metadata-protocol`
 *    import, ADR-0076 D2): which package a registered handler belongs to;
 *  - **the declaration's holder** ({@link resolveActionByPackage}): which
 *    package's declaration a caller of package P means by a bare action name
 *    on an object, resolved by the ONE rule (ADR-0150 D3,
 *    {@link resolvePackageScopedName}) over the registry's `action` items that
 *    own that object.
 *
 * ⛔ It does not re-implement the rule. R's resolver keys the registry's
 * `(type, name)`, which is the object-less action's whole identity and leaves
 * the object-bound key to this child (its module doc). So the object half is
 * a VIEW of the registry ({@link actionOwnerScopedRegistry}): the same five
 * reads, answering only the items whose owner key
 * ({@link standaloneActionOwnerKey}, the router's own test) is the routed
 * object. Two packages' `approve` on two objects are then two names that never
 * meet, and the steps, the closure and the refusals are R's.
 */

import { GLOBAL_ACTION_OBJECT_KEY, isObjectLessActionKey, standaloneActionOwnerKey } from './action-governance.js';
import { ENVIRONMENT_ACTION_COORDINATE } from './action-handler-coordinate.js';
import {
  resolvePackageScopedName,
  type PackageScopedRegistry,
  type PackageScopedResolution,
} from './package-scoped-resolver.js';

/**
 * The registry, seen through one owner key: the `action` items of each holder
 * whose owner key is `ownerKey` (an object's name, or the object-less
 * {@link GLOBAL_ACTION_OBJECT_KEY}), and nothing else. Every other type, and
 * the package reads, pass through unchanged.
 */
export function actionOwnerScopedRegistry(registry: PackageScopedRegistry, ownerKey: string): PackageScopedRegistry {
  const objectLess = isObjectLessActionKey(ownerKey);
  const owns = (item: unknown): boolean => {
    if (item === null || item === undefined || typeof item !== 'object') return false;
    const owner = standaloneActionOwnerKey(item);
    return objectLess ? isObjectLessActionKey(owner) : owner === ownerKey;
  };
  return {
    getPackage: (id) => registry.getPackage(id),
    getAllPackages: () => registry.getAllPackages(),
    packageScopedHoldersOf: (type, name, callerPackageId, options) => {
      const holders = registry.packageScopedHoldersOf(type, name, callerPackageId, options);
      if (type !== 'action') return holders;
      return holders.filter((packageId) => owns(registry.getPackageScopedItem(type, name, packageId)));
    },
    getPackageScopedItem: <T>(type: string, name: string, packageId: string, member?: string) => {
      const item = registry.getPackageScopedItem<T>(type, name, packageId, member);
      return type !== 'action' || owns(item) ? item : undefined;
    },
    getEnvironmentScopedItem: <T>(type: string, name: string, member?: string) => {
      const item = registry.getEnvironmentScopedItem<T>(type, name, member);
      return type !== 'action' || owns(item) ? item : undefined;
    },
  };
}

/** What {@link resolveActionByPackage} is asked. */
export interface ActionPackageQuery {
  /** The routed object, or the object-less key (`global`, legacy `*`, none). */
  readonly objectName: string | undefined;
  /** The action's declarative name. */
  readonly actionName: string;
  /** The caller's package; omitted or `null` for a caller with no package. */
  readonly callerPackageId?: string | null;
}

/**
 * Which package's declaration `actionName` on `objectName` means to the
 * caller (ADR-0150 D3 over the D4 key): first among the declarations bound to
 * the routed object, then — when none is — among the object-less ones, the
 * order the router reaches a handler in (`actionHandlerObjectKeys`: the object
 * first, then `global`). A refusal of the first step is the answer; it never
 * falls through to the object-less holders.
 */
export function resolveActionByPackage<T = unknown>(
  registry: PackageScopedRegistry,
  query: ActionPackageQuery,
): PackageScopedResolution<T> {
  const ask = (ownerKey: string) => resolvePackageScopedName<T>(actionOwnerScopedRegistry(registry, ownerKey), {
    type: 'action',
    name: query.actionName,
    callerPackageId: query.callerPackageId ?? null,
  });
  if (isObjectLessActionKey(query.objectName)) return ask(GLOBAL_ACTION_OBJECT_KEY);
  const bound = ask(query.objectName as string);
  return bound.status === 'not-found' ? ask(GLOBAL_ACTION_OBJECT_KEY) : bound;
}

/**
 * The handler coordinate a resolution's holder registers under: a package
 * holder's package, the environment's own item the environment's slot.
 */
export function actionHolderCoordinate(resolution: Extract<PackageScopedResolution, { status: 'resolved' }>): string {
  return resolution.holder.kind === 'package' ? resolution.holder.packageId : ENVIRONMENT_ACTION_COORDINATE;
}
