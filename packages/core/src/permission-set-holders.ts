// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D2/D9, #31698] Two package holders of one PERMISSION SET name.
 *
 * A permission set is identified by `(package, name)` (ADR-0150 D2), so two
 * packages may each hold a set of one name once their namespaces give the two
 * sets two addresses — the namespace narrowing of the one-holder rule (D9).
 * This module is the ONE predicate that judges such a pair. Both doors that
 * admit a set's name ask it, and nothing else spells it:
 *
 *  - the install gate (`@objectstack/objectql` registry: the package door and
 *    the item seam of the security-catalog name rule);
 *  - the metadata save door (`@objectstack/metadata-protocol`,
 *    `permissionSetNameCollisionRefusal`: a save, publish or restore).
 *
 * Stricter than the sibling `namespacedHoldersMeet` (`@objectstack/spec`),
 * which the other narrowed types read, in two ways (the card's Q2 = A and the
 * epic's stance on the platform's names):
 *
 *  1. a holder in a SHAREABLE platform namespace (`base`, `system`, `sys`)
 *     meets every holder: the platform's sets are what grants and anchors name
 *     by bare spelling across the deployment, so none gets a second holder;
 *  2. a name the platform requests by spelling ({@link isPlatformRequestedBareName},
 *     `guest_portal`) keeps one holder, whatever the namespaces.
 *
 * Otherwise as the sibling: a package with no namespace has no address of its
 * own, and two packages of one namespace (its co-owners) share one.
 */

import { isPlatformRequestedBareName } from './package-scoped-resolution.js';

/**
 * The namespaces any number of packages may share by design (ADR-0048 Phase 1
 * — the registry's `isShareableNamespace`: the FQN-exempt reserved namespaces
 * plus the kernel's `sys`). Spelt here because `@objectstack/core` may not
 * import the registry; `protocol-permission-set-name-registry-reading.test.ts` holds the
 * two equal.
 */
export const PERMISSION_SET_SHARED_NAMESPACES: ReadonlySet<string> = Object.freeze(new Set(['base', 'system', 'sys'])) as ReadonlySet<string>;

/**
 * Do an incoming package and a package already holding the permission-set
 * `name` MEET — so that the incoming one is refused as a second holder?
 *
 * They do NOT meet (both may hold the name, each its own set) only when both
 * declare a namespace, neither namespace is shareable, the two differ, and the
 * name is not one the platform requests by spelling. Judges package holders
 * alone: the environment's own set and a built-in name are refused by each
 * door as before, whatever this answers.
 */
export function permissionSetHoldersMeet(
  incomingNamespace: string | undefined,
  holderNamespace: string | undefined,
  name: string,
): boolean {
  if (isPlatformRequestedBareName('permission', name)) return true;
  if (!incomingNamespace || !holderNamespace) return true;
  if (PERMISSION_SET_SHARED_NAMESPACES.has(incomingNamespace) || PERMISSION_SET_SHARED_NAMESPACES.has(holderNamespace)) return true;
  return incomingNamespace === holderNamespace;
}
