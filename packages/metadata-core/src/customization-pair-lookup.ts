// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The customization pair of a package, looked up through the App that carries
 * it — the one place every "which pair customizes this package?" question is
 * answered.
 *
 * The customization unit is the App (ruling record 6691022506 on ADR-0146 D3):
 * one pair per App, `<app id>.custom`, never one per member package. An App is
 * the `type: app` package and the `type: module` / `plugin` packages its
 * artifact brings (ADR-0019 D1–D4; ADR-0130 D1/D6: one artifact, one version).
 * So the pair of a package is the pair of its App:
 *
 *     pairOf(base) = customizationPackageId(appOf(base))
 *
 * The id rule itself stays in `@objectstack/spec/kernel`
 * (`customizationPackageId`, `<base>.custom`). What lives here is the lookup
 * in front of it, so that moving the unit from "the package" to "its App"
 * changes {@link appOf} and nothing else. A caller asking for the pair of a
 * package calls {@link pairOf} or {@link isPairOf}, ⛔ never
 * `customizationPackageId(base)` / `isCustomizationPairOf(pair, base)`
 * directly. The parse direction (is this id a pair, and of which base —
 * `customizationBasePackageId`, `isCustomizationPackage`) is unaffected and
 * stays with the spec helpers.
 *
 * Today {@link appOf} is the identity: every package is its own App for
 * customization, so {@link pairOf} answers exactly what
 * `customizationPackageId` answers, refusals included. Resolving a member
 * package to the App whose artifact brought it is the ensure door's change
 * (ADR-0146 D3 as amended), not this module's.
 *
 * Why this package: every caller that asks the question —
 * `@objectstack/metadata-protocol`, `@objectstack/objectql`,
 * `@objectstack/service-automation`, `@objectstack/service-datasource`,
 * `@objectstack/runtime` — already declares `@objectstack/metadata-core`, and
 * it depends on none of them; `service-datasource` declares neither
 * `metadata-protocol` nor `objectql`. The same criterion that sank the write
 * dispatch predicates and the code-artifact provenance test here.
 */

import {
  customizationPackageId,
  type CustomizationDerivation,
  type CustomizationPackageIdRefusal,
} from '@objectstack/spec/kernel';

/**
 * The App that carries `packageId` for customization: the id whose pair holds
 * every customization of `packageId`'s items.
 *
 * Today the identity — every package is its own App for this purpose. The
 * lookup is the seam the App-unit ruling moves; its callers never assume the
 * identity.
 */
export function appOf(packageId: string): string {
  return packageId;
}

/**
 * The paired customization package of `base`: the pair of the App that carries
 * it, or the refusal `customizationPackageId` names (`base_id_missing`,
 * `base_is_customization_package`, `base_id_invalid`).
 */
export function pairOf(base: unknown): CustomizationDerivation<CustomizationPackageIdRefusal> {
  return customizationPackageId(typeof base === 'string' && base.length > 0 ? appOf(base) : base);
}

/**
 * Whether `pairId` is THE paired customization package of `base` — the only
 * package that declares an override of `base`'s items (ADR-0146, ruling A on
 * its amendment card).
 */
export function isPairOf(pairId: unknown, base: unknown): boolean {
  const pair = pairOf(base);
  return pair.ok && pair.value === pairId;
}
