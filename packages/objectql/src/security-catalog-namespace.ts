// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One name, one holder — the security catalog's namespace rule, and the
 * vocabulary {@link SchemaRegistry}'s refusal of a second holder is written in.
 *
 * ## The rule
 *
 * The three security catalog types — positions, permission sets and
 * capabilities — each hold ONE namespace per deployment. A package whose
 * position, permission set or capability bears a name that an installed
 * package, the environment catalog or a built-in already holds is refused at
 * registration, and the refusal names both holders. (Maintainer ruling Q4 = A
 * on #15196, record 6050490870.)
 *
 * Why these three and nothing else: an assignment carries a BARE name with no
 * package context (ADR-0131 D4) — a user holds the position `sales_manager`,
 * not "package X's `sales_manager`" — so for the security catalog a shared name
 * is a real ambiguity: which definition grants would depend on registration
 * order. Measured before this rule, on a booted kernel with two packages
 * sharing one name per type: the by-name read resolved the permission set and
 * the capability to the FIRST-registered package and the position to the
 * LAST-registered one. For every other metadata type ADR-0048 §3.4's
 * coexistence stands: a caller there carries its own package, and package-scoped
 * resolution disambiguates. This module is that narrowing, and only it.
 *
 * ## The holders
 *
 *  - **a package** — a name another installed package declares (its claim,
 *    recorded at install, or an item it registered under its own id, or the
 *    stored override it bound to itself);
 *  - **the environment catalog** — an item authored in this environment rather
 *    than shipped by a package: the registry's bare slot carrying no
 *    `_packageId`;
 *  - **a built-in** — {@link BUILT_IN_SECURITY_CATALOG_NAMES}.
 *
 * ## The cold boot
 *
 * At a cold boot every package registers (the kernel's first phase) BEFORE the
 * environment catalog hydrates from `sys_metadata` (`ObjectQLPlugin.start`), so
 * neither door above can see an environment-held name then: the stored row
 * arrives second, in the bare slot. Once hydration has run and before any other
 * plugin starts, the engine plugin asks the registry for every package-held
 * position and permission-set name the environment catalog also holds
 * ({@link ENVIRONMENT_HELD_SECURITY_CATALOG_TYPES}), and one such name refuses the
 * boot with this rule's envelope, naming both holders. So a cold boot, a hot
 * install and an artifact boot answer alike. (Maintainer ruling, letter A on
 * #22307, record 6063176077; ADR-0048 addendum N.3.)
 *
 * The environment's item is read as what it is — a bare-slot item, whatever
 * package envelope hydration grafted onto it. At a cold boot the stored row is
 * hydrated after the package registered, so the protocol's artifact-protection
 * merge stamps it with that package's `_packageId`, and a stamp alone would read
 * it as the package's own definition. Only a registration with no package ever
 * writes the bare slot.
 *
 * ## What it deliberately does not judge
 *
 *  - ⛔ An environment-catalog save over a package-held name. The ruling covers
 *    installing or registering a PACKAGE, not a metadata author's save; that
 *    path keeps its own answers (a packaged permission set is already locked
 *    against an in-place edit, `403`). A bare-slot registration — what every
 *    `sys_metadata` hydration and write-through performs — carries no package
 *    and is never refused here: the hydration write stays unjudged as a write,
 *    and the boot check above judges the PACKAGE's claim against it.
 *  - ⛔ A downgrade. `OS_METADATA_COLLISION=warn` softens the ADR-0048 Phase 1
 *    namespace gate only; no ruling extends it to this refusal.
 *  - The same package registering its own name again — an idempotent reload, a
 *    re-install, a hot reload — is one holder, not two.
 */

import type { SecurityCatalogType } from '@objectstack/core';
import { AUDIENCE_ANCHOR_POSITIONS, BUILTIN_IDENTITY_NAMES } from '@objectstack/spec/identity';
import { PLATFORM_CAPABILITY_NAMES } from '@objectstack/spec/security';

/** The three catalog types the rule covers, in the order a refusal lists them. */
export const SECURITY_CATALOG_NAMESPACE_TYPES: readonly SecurityCatalogType[] = Object.freeze([
  'position',
  'permission',
  'capability',
]);

/** Is `type` one of the three security catalog types (as the registry keys it)? */
export function isSecurityCatalogType(type: unknown): type is SecurityCatalogType {
  return typeof type === 'string' && (SECURITY_CATALOG_NAMESPACE_TYPES as readonly string[]).includes(type);
}

/**
 * The stack collection each type is declared under — the keys the engine's
 * manifest seam and the two in-memory registrars read (`positions`,
 * `permissions`, `capabilities`).
 */
const COLLECTION_KEY: Readonly<Record<SecurityCatalogType, string>> = Object.freeze({
  position: 'positions',
  permission: 'permissions',
  capability: 'capabilities',
});

/**
 * The names the platform itself holds, whichever package registers first.
 *
 *  - `position` — the four built-in identity names (ADR-0068 D2) and the two
 *    audience anchors (ADR-0090 D5/D9).
 *  - `capability` — the curated platform capabilities (ADR-0066 D1), seeded by
 *    `plugin-security` and registered by no package.
 *  - `permission` — none here. The platform's permission sets are DECLARED by
 *    `plugin-security` on its own manifest (configurable through its
 *    `defaultPermissionSets` option), so they reach the registry as that
 *    package's items and are held by it like any other package's; a static
 *    list here would either refuse `plugin-security` its own sets or drift
 *    from what a deployment configured.
 *
 * Applied at the package door ({@link declaredSecurityCatalogNames}'s caller),
 * never at the registry's own item seam: the platform declares these names to
 * the registry itself, under its own package id, and that declaration is the
 * built-in holder's own registration — never a second holder. So the item seam
 * asks it only whether another PACKAGE holds the name. It does not ask the
 * environment catalog: an environment item under a built-in name exists only
 * where an environment save went over the platform's name, which is outside
 * the ruling, and it is hydrated before the platform declares.
 */
export const BUILT_IN_SECURITY_CATALOG_NAMES: Readonly<Record<SecurityCatalogType, ReadonlySet<string>>> = Object.freeze({
  position: new Set<string>([...BUILTIN_IDENTITY_NAMES, ...AUDIENCE_ANCHOR_POSITIONS]),
  permission: new Set<string>(),
  capability: new Set<string>(PLATFORM_CAPABILITY_NAMES),
});

/**
 * The catalog types the environment catalog can hold, which are the ones the
 * cold-boot check reads (module doc, "The cold boot"): the metadata-type registry
 * declares `position` and `permission` `allowRuntimeCreate: true`, so an
 * environment can author either. A `capability` is code-only
 * (`allowRuntimeCreate: false`): the runtime metadata API refuses to create one,
 * so the environment catalog holds none.
 */
export const ENVIRONMENT_HELD_SECURITY_CATALOG_TYPES: readonly SecurityCatalogType[] = Object.freeze([
  'position',
  'permission',
]);

/** Who holds a security catalog name (module doc, "The holders"). */
export type SecurityCatalogHolder =
  | { readonly kind: 'package'; readonly packageId: string }
  | { readonly kind: 'environment' }
  | { readonly kind: 'built-in' };

/** One `(type, name)` a package declares. */
export interface DeclaredSecurityCatalogName {
  readonly type: SecurityCatalogType;
  readonly name: string;
}

/**
 * The name an item is registered under — the engine seam's own derivation for
 * a non-view collection (`resolveMetadataItemName`: `name`, else `id`). An
 * item with neither is skipped there, so it claims nothing here.
 */
function itemName(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const { name, id } = item as { name?: unknown; id?: unknown };
  if (typeof name === 'string' && name !== '') return name;
  if (typeof id === 'string' && id !== '') return id;
  return undefined;
}

/**
 * Every `(type, name)` a manifest declares, read from the SAME sources the
 * engine's registration seams read: the manifest's own collections and each
 * nested `plugins[]` entry's (a nested plugin contributes under its parent
 * package — `ObjectQL.registerPlugin`), one level deep, arrays only.
 *
 * `positions` is read like the other two collections. The engine's collection
 * loop registers a package's positions under the package
 * (`ObjectQL.registerApp`), and the in-memory registrars (`AppPlugin`'s
 * security block, the artifact door) register them for the very same package;
 * the package's claim covers them either way.
 *
 * ⚠️ A non-array `permissions` is skipped, not misread: at the manifest stage
 * that key is the ADR-0025 capability GRANT (`{ services, hooks, … }`), not a
 * list of permission sets.
 */
export function declaredSecurityCatalogNames(manifest: unknown): DeclaredSecurityCatalogName[] {
  const out: DeclaredSecurityCatalogName[] = [];
  const read = (source: unknown) => {
    if (!source || typeof source !== 'object') return;
    for (const type of SECURITY_CATALOG_NAMESPACE_TYPES) {
      const items = (source as Record<string, unknown>)[COLLECTION_KEY[type]];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const name = itemName(item);
        if (name !== undefined) out.push({ type, name });
      }
    }
  };
  read(manifest);
  const plugins = (manifest as { plugins?: unknown } | null | undefined)?.plugins;
  if (Array.isArray(plugins)) for (const plugin of plugins) read(plugin);
  return out;
}

/** How a refusal names a catalog type. */
export function securityCatalogTypeLabel(type: SecurityCatalogType): string {
  return type === 'permission' ? 'permission set' : type;
}

/** How a refusal names a holder. */
export function describeSecurityCatalogHolder(holder: SecurityCatalogHolder): string {
  switch (holder.kind) {
    case 'package':
      return `package "${holder.packageId}"`;
    case 'environment':
      return 'the environment catalog (an item authored in this environment, not shipped by a package)';
    case 'built-in':
      return 'the platform, as a built-in name no package can declare';
  }
}

/** A stable identity for de-duplicating holders. */
export function securityCatalogHolderKey(holder: SecurityCatalogHolder): string {
  return holder.kind === 'package' ? `package:${holder.packageId}` : holder.kind;
}
