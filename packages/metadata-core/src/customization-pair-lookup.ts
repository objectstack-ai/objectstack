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
 * Every question carries the caller's {@link InstalledManifestLookup} — the
 * installed manifests of the registry it serves ({@link installedManifestsOf}),
 * the only record of which App a member belongs to. Today {@link appOf} reads
 * none of it and is the identity: every package is its own App for
 * customization, so {@link pairOf} answers exactly what
 * `customizationPackageId` answers, refusals included. Resolving a member
 * package to its App from that lookup is the next change (ADR-0146 D3 as
 * amended, merge question 11), and it lands in {@link appOf} alone because
 * every caller already hands the lookup in.
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
 * What the App lookup may read of an installed package: its manifest's
 * `type`, `scope`, `namespace` and `dependencies` — the declarations the
 * registry holds (ADR-0146 D3 as amended, merge question 11: nothing in the
 * tree persists which artifact delivered a package, so the App of a package
 * is read from what the installed packages declare).
 */
export interface AppLookupManifest {
  readonly type?: unknown;
  readonly scope?: unknown;
  readonly namespace?: unknown;
  readonly dependencies?: unknown;
}

/**
 * The installed manifest of a package id, or `undefined` when no package of
 * that id is installed — a registry's `getPackage(id)?.manifest`. Every
 * caller of {@link appOf}, {@link pairOf} and {@link isPairOf} passes the
 * lookup of the registry it serves; {@link installedManifestsOf} builds one.
 */
export type InstalledManifestLookup = (packageId: string) => AppLookupManifest | undefined;

/** A registry, as far as {@link installedManifestsOf} reads it. */
export interface InstalledPackageSource {
  getPackage?(id: string): { readonly manifest?: unknown } | undefined;
}

/** The lookup of a registry holding nothing: every package is absent. */
const NOTHING_INSTALLED: InstalledManifestLookup = () => undefined;

/**
 * The {@link InstalledManifestLookup} over `registry`'s installed packages. A
 * missing registry (or one without `getPackage`) holds nothing, so every
 * package reads as absent — and an absent package is its own unit, which is
 * what a lookup with no registry to read can truthfully answer.
 */
export function installedManifestsOf(registry: InstalledPackageSource | null | undefined): InstalledManifestLookup {
  if (!registry || typeof registry.getPackage !== 'function') return NOTHING_INSTALLED;
  return (packageId) => {
    const manifest = registry.getPackage!(packageId)?.manifest;
    return typeof manifest === 'object' && manifest !== null ? (manifest as AppLookupManifest) : undefined;
  };
}

/**
 * The App that carries `packageId` for customization: the id whose pair holds
 * every customization of `packageId`'s items, read through `installed` (the
 * registry the caller serves).
 *
 * Today the identity — every package is its own App for this purpose, and
 * `installed` is not read yet. The lookup is the seam the App-unit ruling
 * moves; its callers never assume the identity, and each already hands it the
 * registry it will read.
 */
export function appOf(packageId: string, installed: InstalledManifestLookup): string {
  void installed;
  return packageId;
}

/**
 * The paired customization package of `base`: the pair of the App that carries
 * it, or the refusal `customizationPackageId` names (`base_id_missing`,
 * `base_is_customization_package`, `base_id_invalid`).
 */
export function pairOf(base: unknown, installed: InstalledManifestLookup): CustomizationDerivation<CustomizationPackageIdRefusal> {
  return customizationPackageId(typeof base === 'string' && base.length > 0 ? appOf(base, installed) : base);
}

/**
 * Whether `pairId` is THE paired customization package of `base` — the only
 * package that declares an override of `base`'s items (ADR-0146, ruling A on
 * its amendment card).
 */
export function isPairOf(pairId: unknown, base: unknown, installed: InstalledManifestLookup): boolean {
  const pair = pairOf(base, installed);
  return pair.ok && pair.value === pairId;
}
