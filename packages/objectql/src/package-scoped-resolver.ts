// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # One answer to "which package's item does this bare name mean" (ADR-0150 D3)
 *
 * Behavioural and presentation metadata (ADR-0150 D1 buckets 2 and 3: flows,
 * actions, permission sets, pages, skills, …) is identified by
 * `(package, name)`. Every reader that later carries the package — the runtime
 * indexes (epic #31527 children E), the by-name doors (G), the stored
 * references (S) — resolves a bare name through THIS function, so no two
 * readers can drift into two rules. That drift is what phase 1 (#30803)
 * measured: first-registered wins in some readers, refusal in others.
 *
 * ⛔ Additive (child R, #31575): no reader calls it yet, phase 1's one-holder
 * refusal (`bare-name-one-holder.ts`) stays in force, and while it does no two
 * package holders of a covered name exist, so wiring a reader to this changes
 * no answer it gives today.
 *
 * ## The rule (ADR-0150 D3, as ruled)
 *
 * A caller that belongs to package P resolves a bare name to:
 *
 *  1. **P's own item** — its ADR-0005 overlay when one binds to it, else its
 *     composite slot (`SchemaRegistry.getPackageScopedItem`, the per-package
 *     overlay slot of D4);
 *  2. else **the unique holder in P's declared dependency closure** — P's
 *     `manifest.dependencies`, transitively (ADR-0141; the save door's own
 *     closure, `packageDependencyClosure` in `@objectstack/metadata-protocol`),
 *     plus every package of the reserved kernel namespace `sys` (D2), which
 *     this resolver adds itself: the save door's closure does not;
 *  3. else a **refusal that names every candidate**.
 *
 * A caller with no package (an environment item, a context-free door, an MCP
 * client) resolves against the whole environment: the environment's own item
 * first (ADR-0005 overlay precedence), else the unique package holder, else the
 * refusal naming every candidate (the doors map it to `409`, D5).
 *
 * **A package-less row that bears a package-held name is a customization,
 * never a second item** (ADR-0150 D3): it is the overlay of the one holder,
 * and the environment's own item is one whose name no package holds
 * (`SchemaRegistry.getEnvironmentScopedItem`). So it never makes a name
 * ambiguous, and it is never served beside the item it customizes.
 *
 * **Zero holders is not-found, never a refusal.** A refusal says "this name
 * means more than one thing here, or nothing you may reach"; not-found says the
 * name means nothing at all.
 *
 * ## The two red lines (epic #31527)
 *
 *  - **It never loosens.** There is no first-registered fallback, no
 *    environment-wide guess for a caller with a package (a holder outside P's
 *    closure is refused, never served), and no silent pick between two
 *    candidates of one step.
 *  - **Ambiguity is reported, never guessed.** Every refusal carries every
 *    candidate of the step that refused, in the holder vocabulary
 *    `bare-name-one-holder.ts` defines ({@link BareNameHolder},
 *    {@link describeBareNameHolder}), plus one holder kind this rule needs: the
 *    environment's own item.
 *
 * ## The exceptions (ADR-0150 D3, ruled)
 *
 *  - **Names the platform requests by spelling**
 *    ({@link PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE}; today the permission set
 *    `guest_portal`): the platform declares no dependency, so they resolve
 *    environment-wide whatever the caller, and keep ONE holder.
 *  - **Positions** are one environment-wide slot (D7, open question Q2). The
 *    type is not in {@link PACKAGE_SCOPED_TYPES}, and asking for it throws.
 *  - **An overridable baseline** (`OVERRIDABLE_BASELINE_PACKAGES`: the email
 *    service's built-in templates, ADR-0131 D6/D10) holds nothing while another
 *    reachable package holds the name — the vocabulary's own reading — and
 *    answers only when no other candidate of that step does.
 *
 * ## Holders from a store other than the registry (child R2, #31716)
 *
 * The rule reads three things about a name: which packages hold it, one
 * holder's item, and the environment's own item
 * ({@link PackageScopedHolderSource}). {@link resolvePackageScopedHolders}
 * runs the steps over a source the caller supplies, and
 * {@link resolvePackageScopedName} is that call over the registry's holders,
 * so the rule is written once. The other source is the engine's function
 * registry: a function is not a metadata type, so it resolves in the package
 * of the flow or action that names it (ADR-0150 D4's last row), over the
 * `(package, function)` pairs the engine keeps (`ObjectQL#functionHoldersOf`).
 * Same closure, same refusal, same baseline rule.
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

import { packageDependencyClosure } from '@objectstack/metadata-protocol';
import {
  describeBareNameHolder,
  isBareNameOneHolderType,
  isOverridableBaseline,
  type BareNameHolder,
} from './bare-name-one-holder.js';
import type { SchemaRegistry } from './registry.js';

/**
 * The metadata types addressed by `(package, name)` — ADR-0150 D1 buckets 2
 * and 3, as the registry spells them. `rag_pipeline` (bucket 3 in D1) has no
 * registry type since ADR-0049 retired the collection, so it is not listed;
 * `position` is environment-scoped (D7) and is not listed either.
 */
export const PACKAGE_SCOPED_TYPES = Object.freeze([
  // bucket 2
  'flow',
  'action',
  'hook',
  'job',
  'webhook',
  'mapping',
  'connector',
  'permission',
  'sharing_rule',
  'queue',
  'assignment_rule',
  'app',
  'page',
  'dashboard',
  'report',
  'dataset',
  'analytics_cube',
  'picklist',
  'email_template',
  'book',
  'api',
  // bucket 3
  'tool',
  'skill',
  'agent',
] as const);

/** A type addressed by `(package, name)` ({@link PACKAGE_SCOPED_TYPES}). */
export type PackageScopedType = (typeof PACKAGE_SCOPED_TYPES)[number];

/** Is `type` addressed by `(package, name)`? */
export function isPackageScopedType(type: unknown): type is PackageScopedType {
  return typeof type === 'string' && (PACKAGE_SCOPED_TYPES as readonly string[]).includes(type);
}

/**
 * The engine's function registry, as the resolver names its holders: not a
 * metadata type (so not in {@link PACKAGE_SCOPED_TYPES}), and resolved in its
 * referrer's package (ADR-0150 D4). Phase 1 spells the same registry the
 * same way (`BARE_NAME_ONE_HOLDER_TYPES`).
 */
export const ENGINE_FUNCTION_TYPE = 'function';

/** What the resolver resolves: a type addressed by `(package, name)`, or the engine's functions. */
export type PackageScopedResolvableType = PackageScopedType | typeof ENGINE_FUNCTION_TYPE;

/** Does the resolver resolve `type` ({@link PackageScopedResolvableType})? */
export function isPackageScopedResolvableType(type: unknown): type is PackageScopedResolvableType {
  return type === ENGINE_FUNCTION_TYPE || isPackageScopedType(type);
}

/**
 * Names the PLATFORM requests by spelling, per type (ADR-0150 D3 Exceptions):
 * they resolve environment-wide whatever the caller's package, and keep one
 * holder. The same list as `@objectstack/cli`'s `PLATFORM_REQUESTED_BARE_NAMES`,
 * keyed by registry type instead of stack collection: the public form doors'
 * submit context requests the permission set `guest_portal` by name
 * (`packages/rest/src/form-routes.ts`).
 */
export const PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE: Readonly<Partial<Record<PackageScopedType, readonly string[]>>> = Object.freeze({
  permission: Object.freeze(['guest_portal']),
});

/** Is `(type, name)` one the platform requests by spelling? */
export function isPlatformRequestedBareName(type: PackageScopedType, name: string): boolean {
  return PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE[type]?.includes(name) ?? false;
}

/**
 * The reserved kernel namespace (ADR-0150 D2; ADR-0028 TL;DR 5): every package
 * declaring it is in every caller's resolution closure (D3).
 */
export const KERNEL_NAMESPACE = 'sys';

/** The value `_packageId` carries for a row rehydrated from `sys_metadata`: not a package. */
const OVERLAY_PROVENANCE_SENTINEL = 'sys_metadata';

/**
 * Who holds a name under package addressing: a package (the vocabulary's own
 * {@link BareNameHolder}), or the environment's own item — an item authored in
 * this environment, in the implicit environment package (ADR-0150 D1 bucket 4).
 */
export type PackageScopedHolder =
  | Extract<BareNameHolder, { kind: 'package' }>
  | { readonly kind: 'environment' };

/** How a refusal names a holder. */
export function describePackageScopedHolder(holder: PackageScopedHolder): string {
  return holder.kind === 'environment'
    ? 'the environment (an item authored in this environment, bound to no package)'
    : describeBareNameHolder(holder);
}

/** How the resolved item was reached (ADR-0150 D3's steps). */
export type PackageScopedResolutionStep =
  /** the caller package's own item */
  | 'own'
  /** the unique holder in the caller's declared dependency closure (plus `sys`) */
  | 'closure'
  /** the environment's own item (a caller with no package) */
  | 'environment'
  /** the unique package holder in the environment (a caller with no package) */
  | 'unique-holder'
  /** an overridable baseline, reached because no other candidate of the step holds the name */
  | 'baseline';

/** Why a resolution refused. */
export type PackageScopedRefusalReason =
  /** two or more holders in the caller package's declared closure (plus `sys`) */
  | 'ambiguous-in-closure'
  /** two or more package holders in the environment, and the caller names no package */
  | 'ambiguous-in-environment'
  /** holders exist, and none is in the caller package's declared closure (plus `sys`) */
  | 'outside-closure';

/** A resolution's answer. */
export type PackageScopedResolution<T = unknown> =
  | {
      readonly status: 'resolved';
      readonly item: T;
      readonly holder: PackageScopedHolder;
      readonly via: PackageScopedResolutionStep;
    }
  | { readonly status: 'not-found' }
  | PackageScopedRefusal;

/** A refusal: every candidate named, and nothing picked. */
export interface PackageScopedRefusal {
  readonly status: 'refused';
  readonly reason: PackageScopedRefusalReason;
  readonly type: PackageScopedResolvableType;
  readonly name: string;
  /** The caller's package, or `null` for a caller with no package. */
  readonly callerPackageId: string | null;
  /** Every candidate of the step that refused, in the item store's order. */
  readonly candidates: readonly PackageScopedHolder[];
  /** One sentence naming the item, every candidate and what to do. */
  readonly message: string;
}

/** What the resolver is asked, over any holder source ({@link resolvePackageScopedHolders}). */
export interface PackageScopedHoldersQuery {
  readonly type: PackageScopedResolvableType;
  readonly name: string;
  /**
   * The package the caller belongs to; omitted, `null`, `''` or the
   * `sys_metadata` sentinel is a caller with no package.
   */
  readonly callerPackageId?: string | null;
}

/** What the resolver is asked, over the registry's holders ({@link resolvePackageScopedName}). */
export interface PackageScopedQuery extends PackageScopedHoldersQuery {
  readonly type: PackageScopedType;
  /** For a bundled type (`email_template`): one member, as `getItem` takes it. */
  readonly member?: string;
}

/**
 * Who holds a name, and their items: the three things ADR-0150 D3's steps
 * read, from whichever store keeps them — the registry
 * ({@link resolvePackageScopedName}), or a store the caller supplies (the
 * engine's function registry). Read only when a step needs it.
 */
export interface PackageScopedHolderSource<T = unknown> {
  /** Every package holding the name, each once, in the store's order. */
  readonly packageHolders: readonly string[];
  /**
   * A package holder's item: its own, with whatever binds to it. `undefined`
   * when it lacks what was asked (a bundle member), which answers not-found.
   */
  packageItem(packageId: string): T | undefined;
  /**
   * The environment's own item of the name — bound to no package — or
   * `undefined`. In the registry that is a package-less row under a name no
   * package holds (D4: over a held name, the row is the holder's overlay).
   */
  environmentItem(): T | undefined;
}

/**
 * A holder source over `(package, item)` pairs, a `null` package being the
 * environment's own item. The order of the pairs is the store's order, which
 * is the order every refusal names its candidates in.
 *
 * @throws {TypeError} when two pairs name one holder: a holder set holds each
 *   holder once, and the resolver never picks between two items of one holder.
 */
export function packageScopedHolderSource<T>(
  holdings: Iterable<readonly [packageId: string | null, item: T]>,
): PackageScopedHolderSource<T> {
  const items = new Map<string | null, T>();
  for (const [packageId, item] of holdings) {
    if (items.has(packageId)) {
      throw new TypeError(
        `[package-scoped-resolver] the holder set names ${packageId === null ? 'the environment' : `package "${packageId}"`} twice; ` +
        `a holder holds a name once (ADR-0150 D3).`,
      );
    }
    items.set(packageId, item);
  }
  const packageHolders = [...items.keys()].filter((id): id is string => id !== null);
  return Object.freeze({
    packageHolders: Object.freeze(packageHolders),
    packageItem: (packageId: string) => items.get(packageId),
    environmentItem: () => items.get(null),
  });
}

/** The registry slice the closure reads ({@link packageResolutionClosure}). */
export type PackageResolutionClosureRegistry = Pick<SchemaRegistry, 'getPackage' | 'getAllPackages'>;

/** The registry slice the resolver reads — every member of it, and no other. */
export type PackageScopedRegistry = Pick<
  SchemaRegistry,
  'getPackage' | 'getAllPackages' | 'packageScopedHoldersOf' | 'getPackageScopedItem' | 'getEnvironmentScopedItem'
>;

/** Is `packageId`'s item of `type` an overridable baseline (the vocabulary's predicate)? */
function isBaseline(type: PackageScopedResolvableType, packageId: string): boolean {
  return isBareNameOneHolderType(type) && isOverridableBaseline(type, packageId);
}

/** Every installed package of the reserved kernel namespace. */
function kernelPackages(registry: PackageResolutionClosureRegistry): string[] {
  const ids: string[] = [];
  for (const row of registry.getAllPackages()) {
    const manifest = (row as { manifest?: { id?: unknown; namespace?: unknown } } | undefined)?.manifest;
    if (manifest?.namespace === KERNEL_NAMESPACE && typeof manifest.id === 'string' && manifest.id !== '') ids.push(manifest.id);
  }
  return ids;
}

/**
 * The packages a caller of package `callerPackageId` may resolve a bare name
 * in (ADR-0150 D3 step 2): its declared dependency closure — the save door's
 * own ({@link packageDependencyClosure}) — plus every `sys` package. A caller
 * package the registry cannot produce declares nothing, so it reaches `sys`
 * only.
 */
export function packageResolutionClosure(registry: PackageResolutionClosureRegistry, callerPackageId: string): ReadonlySet<string> {
  const reach = new Set<string>(packageDependencyClosure(callerPackageId, registry)?.dependencies ?? []);
  for (const id of kernelPackages(registry)) reach.add(id);
  reach.delete(callerPackageId);
  return reach;
}

const packageHolder = (packageId: string): PackageScopedHolder => ({ kind: 'package', packageId });

function typeLabel(type: PackageScopedResolvableType): string {
  switch (type) {
    case 'api': return 'API';
    case 'email_template': return 'email template';
    case 'sharing_rule': return 'sharing rule';
    case 'assignment_rule': return 'assignment rule';
    case 'analytics_cube': return 'analytics cube';
    case 'permission': return 'permission set';
    default: return type;
  }
}

/**
 * The sentence a refusal carries: the item, why it refused, every candidate
 * (in the vocabulary's words) and the one thing a caller can do about it.
 */
export function packageScopedRefusalMessage(refusal: Omit<PackageScopedRefusal, 'message'>): string {
  const subject = `The ${typeLabel(refusal.type)} "${refusal.name}"`;
  const named = refusal.candidates.map(describePackageScopedHolder).join('; ');
  switch (refusal.reason) {
    case 'ambiguous-in-closure':
      return `${subject} is held by ${refusal.candidates.length} packages in the declared dependency closure of ` +
        `package "${refusal.callerPackageId}": ${named}. Nothing picks one of them: address it by its package.`;
    case 'ambiguous-in-environment':
      return `${subject} is held by ${refusal.candidates.length} packages in this environment and the caller names ` +
        `no package: ${named}. Nothing picks one of them: address it by its package.`;
    case 'outside-closure':
      return `${subject} is held outside the declared dependency closure of package "${refusal.callerPackageId}": ` +
        `${named}. Declare a dependency on the package that holds it (ADR-0141).`;
  }
}

function refuse(
  query: PackageScopedHoldersQuery,
  callerPackageId: string | null,
  reason: PackageScopedRefusalReason,
  candidates: readonly PackageScopedHolder[],
): PackageScopedRefusal {
  const base = { status: 'refused' as const, reason, type: query.type, name: query.name, callerPackageId, candidates };
  return { ...base, message: packageScopedRefusalMessage(base) };
}

/**
 * The one step of ADR-0150 D3 that picks among package holders: exactly one
 * candidate other than an overridable baseline answers; two or more refuse,
 * naming every one; none falls to the baselines by the same rule; `none` when
 * no candidate holds the name at all.
 */
function pickUnique(
  type: PackageScopedResolvableType,
  candidates: readonly string[],
): { kind: 'one'; packageId: string; baseline: boolean } | { kind: 'several'; packageIds: string[] } | { kind: 'none' } {
  const primary = candidates.filter((id) => !isBaseline(type, id));
  if (primary.length === 1) return { kind: 'one', packageId: primary[0], baseline: false };
  if (primary.length > 1) return { kind: 'several', packageIds: primary };
  const baselines = candidates.filter((id) => isBaseline(type, id));
  if (baselines.length === 1) return { kind: 'one', packageId: baselines[0], baseline: true };
  if (baselines.length > 1) return { kind: 'several', packageIds: baselines };
  return { kind: 'none' };
}

/** A package's item, as a resolution — or not-found when it lacks what was asked. */
function packageItem<T>(
  source: PackageScopedHolderSource<T>,
  packageId: string,
  via: PackageScopedResolutionStep,
): PackageScopedResolution<T> {
  const item = source.packageItem(packageId);
  return item === undefined ? { status: 'not-found' } : { status: 'resolved', item, holder: packageHolder(packageId), via };
}

/** A caller with no package, or a platform-requested name: the whole environment (ADR-0150 D3). */
function resolveEnvironmentWide<T>(
  query: PackageScopedHoldersQuery,
  callerPackageId: string | null,
  source: PackageScopedHolderSource<T>,
): PackageScopedResolution<T> {
  const environmentItem = source.environmentItem();
  if (environmentItem !== undefined) {
    return { status: 'resolved', item: environmentItem, holder: { kind: 'environment' }, via: 'environment' };
  }
  const pick = pickUnique(query.type, source.packageHolders);
  if (pick.kind === 'one') return packageItem<T>(source, pick.packageId, pick.baseline ? 'baseline' : 'unique-holder');
  if (pick.kind === 'several') return refuse(query, callerPackageId, 'ambiguous-in-environment', pick.packageIds.map(packageHolder));
  return { status: 'not-found' };
}

/**
 * Resolve a bare name by ADR-0150 D3 (module doc) over a holder set the
 * caller supplies — the engine's function registry, or any store that keeps
 * `(package, item)` pairs outside the registry. The closure is the registry's
 * ({@link packageResolutionClosure}); the holders and their items are the
 * source's. Writes nothing, and never throws for a name — only for a type the
 * resolver does not resolve ({@link PackageScopedResolvableType}), which is a
 * caller's programming error.
 *
 * @returns `resolved` with the item, its holder and the step that reached it;
 *   `not-found` when nothing holds the name; `refused` naming every candidate
 *   of the step that could not pick one.
 */
export function resolvePackageScopedHolders<T = unknown>(
  registry: PackageResolutionClosureRegistry,
  query: PackageScopedHoldersQuery,
  source: PackageScopedHolderSource<T>,
): PackageScopedResolution<T> {
  if (!isPackageScopedResolvableType(query.type)) {
    throw new TypeError(
      `[package-scoped-resolver] "${String(query.type)}" is not resolved by package (ADR-0150 D1, D4); ` +
      `positions are environment-scoped (D7) and objects keep their literal name (ADR-0129).`,
    );
  }
  const raw = query.callerPackageId;
  const callerPackageId = typeof raw === 'string' && raw !== '' && raw !== OVERLAY_PROVENANCE_SENTINEL ? raw : null;
  const holders = source.packageHolders;

  if (callerPackageId === null || (query.type !== ENGINE_FUNCTION_TYPE && isPlatformRequestedBareName(query.type, query.name))) {
    return resolveEnvironmentWide<T>(query, callerPackageId, source);
  }

  // Step 1 — the caller package's own item.
  if (holders.includes(callerPackageId)) return packageItem<T>(source, callerPackageId, 'own');

  // Step 2 — the unique holder in its declared closure, plus `sys`.
  const reach = packageResolutionClosure(registry, callerPackageId);
  const pick = pickUnique(query.type, holders.filter((id) => reach.has(id)));
  if (pick.kind === 'one') return packageItem<T>(source, pick.packageId, pick.baseline ? 'baseline' : 'closure');
  if (pick.kind === 'several') return refuse(query, callerPackageId, 'ambiguous-in-closure', pick.packageIds.map(packageHolder));

  // Step 3 — nothing reachable: a refusal naming every holder there is, or
  // not-found when there is none. ⛔ Never an environment-wide guess.
  const candidates: PackageScopedHolder[] = holders.map(packageHolder);
  if (source.environmentItem() !== undefined) candidates.push({ kind: 'environment' });
  if (candidates.length === 0) return { status: 'not-found' };
  return refuse(query, callerPackageId, 'outside-closure', candidates);
}

/**
 * Resolve a bare name by ADR-0150 D3 (module doc) over the registry's
 * holders: {@link resolvePackageScopedHolders} with the registry as the
 * source. Reads the registry, writes nothing, and never throws for a name —
 * only for a type that is not addressed by package
 * ({@link PACKAGE_SCOPED_TYPES}), which is a caller's programming error.
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
        ? 'the registry holds no function: resolve one over the engine\'s holders (resolvePackageScopedHolders, ADR-0150 D4).'
        : 'positions are environment-scoped (D7) and objects keep their literal name (ADR-0129).'),
    );
  }
  const { type, name, member } = query;
  return resolvePackageScopedHolders<T>(registry, query, {
    packageHolders: registry.packageScopedHoldersOf(type, name),
    packageItem: (packageId) => registry.getPackageScopedItem<T>(type, name, packageId, member),
    environmentItem: () => registry.getEnvironmentScopedItem<T>(type, name, member),
  });
}
