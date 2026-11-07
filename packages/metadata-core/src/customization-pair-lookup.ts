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
 * the only record of which App a member belongs to. {@link appOf} reads it the
 * way ADR-0146 D3 merge question 11 says: a `type: 'app'` package is its own
 * App; any other package's App is the installed `type: 'app'` package it
 * declares in `manifest.dependencies`, directly or through its declared
 * parents; a package that declares none is its own unit. A kernel package
 * (scope `system` / `cloud`) is not resolved here: its pair would be the
 * platform pair, which no door creates in this version (ruling record
 * 6691217245), so it keeps the per-package answer its legacy pair is served
 * under (merge question 12).
 *
 * Two questions, kept apart:
 *
 *   - {@link pairOf} — where a customization of the package LANDS: its App's
 *     pair. Every door that writes or names "the pair" asks it.
 *   - {@link isPairOf} / {@link pairsOf} — which packages' rows ARE the
 *     package's customizations: its App's pair and, while one is installed,
 *     the per-package pair an earlier version created for it (`<base>.custom`
 *     of a member — ADR-0146 D3 merge question 12: such a pair is served as it
 *     is until the migration ceremony re-identifies it, so nothing a customer
 *     built goes dark on upgrade). Every read that serves or lists a package's
 *     customizations asks these.
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
  isCustomizationPackage,
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
 * The manifest scopes of a kernel package — the platform's own (`system`) and
 * the control plane's (`cloud`). The same list as
 * `@objectstack/metadata-protocol`'s `READ_ONLY_PACKAGE_SCOPES`, which depends
 * on this package and so cannot be imported here; a pin in that package holds
 * the two equal.
 */
const KERNEL_PACKAGE_SCOPES: readonly string[] = ['system', 'cloud'];

/** Why {@link appOf} names no App: the package reaches several, and its namespace picks none or more than one. */
export type AppOfRefusal = 'no_single_app';

/** Why {@link pairOf} names no pair: the id rule's refusal, or {@link AppOfRefusal}. */
export type PairOfRefusal = CustomizationPackageIdRefusal | AppOfRefusal;

function isKernelManifest(manifest: AppLookupManifest): boolean {
  return typeof manifest.scope === 'string' && KERNEL_PACKAGE_SCOPES.includes(manifest.scope);
}

function declaredDependencyIds(manifest: AppLookupManifest): string[] {
  const dependencies = manifest.dependencies;
  if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) return [];
  return Object.keys(dependencies);
}

/**
 * The installed `type: 'app'` packages `manifest` declares, directly — or,
 * when it declares none directly, through the closure of its declared
 * dependencies (ADR-0146 D3 merge question 11): each package visited once, so
 * a cycle ends; the walk stops at an App (an App's own dependencies are
 * another App's business, ADR-0141 D1); a kernel package or a package not
 * installed is skipped.
 */
function declaredApps(packageId: string, manifest: AppLookupManifest, installed: InstalledManifestLookup): string[] {
  const isApp = (id: string): boolean => {
    const m = installed(id);
    return m !== undefined && m.type === 'app' && !isKernelManifest(m);
  };
  const direct = declaredDependencyIds(manifest).filter(isApp);
  if (direct.length > 0) return direct;
  const apps: string[] = [];
  const visited = new Set<string>([packageId]);
  const queue = declaredDependencyIds(manifest);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const m = installed(id);
    if (m === undefined || isKernelManifest(m)) continue;
    if (m.type === 'app') {
      apps.push(id);
      continue;
    }
    queue.push(...declaredDependencyIds(m));
  }
  return apps;
}

/**
 * The App that carries `packageId` for customization — the id whose pair
 * holds every customization of `packageId`'s items — read through
 * `installed` (the registry the caller serves), or `undefined` when the
 * package reaches several Apps and its namespace picks no single one of them
 * (ADR-0146 D3 merge question 11: the readable verdict, never a guess and
 * never an id prefix).
 *
 * | package | App |
 * |:--|:--|
 * | not installed, or a pair id | itself |
 * | `type: 'app'` | itself |
 * | a kernel package (scope `system` / `cloud`) | itself — see the module header |
 * | declares one installed App, directly or through its declared parents | that App |
 * | declares several | the one holding the package's namespace; none or several ⇒ `undefined` |
 * | declares none | itself — its own unit |
 */
export function appOf(packageId: string, installed: InstalledManifestLookup): string | undefined {
  const manifest = installed(packageId);
  if (manifest === undefined || isCustomizationPackage(packageId)) return packageId;
  if (manifest.type === 'app' || isKernelManifest(manifest)) return packageId;
  const apps = declaredApps(packageId, manifest, installed);
  if (apps.length === 0) return packageId;
  if (apps.length === 1) return apps[0];
  const namespace = manifest.namespace;
  const holding = apps.filter((id) => typeof namespace === 'string' && installed(id)?.namespace === namespace);
  return holding.length === 1 ? holding[0] : undefined;
}

/**
 * The paired customization package of `base` — where a customization of its
 * items lands: the pair of the App that carries it, or the refusal
 * `customizationPackageId` names (`base_id_missing`,
 * `base_is_customization_package`, `base_id_invalid`), or `no_single_app`
 * ({@link appOf}).
 */
export function pairOf(base: unknown, installed: InstalledManifestLookup): CustomizationDerivation<PairOfRefusal> {
  if (typeof base !== 'string' || base.length === 0) return customizationPackageId(base);
  const own = customizationPackageId(base);
  if (!own.ok) return own;
  const app = appOf(base, installed);
  if (app === undefined) return { ok: false, reason: 'no_single_app' };
  return customizationPackageId(app);
}

/**
 * Every package whose rows are `base`'s customizations: its App's pair
 * ({@link pairOf}) first, then — while it is installed and is not that pair —
 * the per-package pair `<base>.custom` an earlier version created for a
 * member (ADR-0146 D3 merge question 12: served as it is until the migration
 * ceremony re-identifies it). Empty when `base` has no pair of either kind.
 */
export function pairsOf(base: unknown, installed: InstalledManifestLookup): string[] {
  const pairs: string[] = [];
  const pair = pairOf(base, installed);
  if (pair.ok) pairs.push(pair.value);
  const legacy = customizationPackageId(base);
  if (legacy.ok && !pairs.includes(legacy.value) && installed(legacy.value) !== undefined) pairs.push(legacy.value);
  return pairs;
}

/**
 * Whether `pairId` is a paired customization package of `base` — a package
 * that may declare an override of `base`'s items (ADR-0146, ruling A on its
 * amendment card): one of {@link pairsOf}.
 */
export function isPairOf(pairId: unknown, base: unknown, installed: InstalledManifestLookup): boolean {
  return typeof pairId === 'string' && pairsOf(base, installed).includes(pairId);
}
