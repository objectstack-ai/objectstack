// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The platform's curated capabilities (ADR-0066 D1) — declared as `capability`
 * metadata this plugin owns, so the security catalog's one home (ADR-0131 D3)
 * holds them.
 *
 * ## One list, not a copy
 *
 * The curated list lives in `@objectstack/spec` ({@link PLATFORM_CAPABILITIES}),
 * where the authoring lint and the one-holder rule (`@objectstack/objectql`,
 * `security-catalog-namespace.ts`) already read it. This module declares that
 * same list to the engine registry and keeps no list of its own:
 *
 *  1. `SecurityPlugin.start` registers each curated capability as a
 *     `capability` item under this plugin's package id
 *     ({@link registerBuiltinCapabilities}), so the security catalog read
 *     (`createSecurityCatalogReader`, `@objectstack/core`) and the metadata door
 *     (`GET /api/v1/meta/capability`) list them beside every package-declared
 *     capability, and `GET /api/v1/meta/capability/:name` answers each one's
 *     definition.
 *  2. `bootstrapSystemCapabilities` keeps seeding their `sys_capability` rows
 *     from the same spec list, unchanged. Nothing here writes a row.
 *
 * ## Why the engine registry's item seam, and not the manifest
 *
 * The engine's stack-collection loop does decompose a manifest `capabilities`
 * collection, but the PACKAGE door in front of it (`SchemaRegistry`'s
 * install-time refusal) refuses a package declaring a built-in name, and the
 * curated names are exactly the built-in capability names. The item seam
 * (`registerItem` with a package id) is where the platform declares its own
 * built-in names: it asks only whether another package holds the name. The
 * built-in positions (`builtin-positions.ts`) take the same seam for the same
 * reason. Existing `sys_capability` rows are rows, not registry holders, so a
 * database the seeder already populated registers the same as a fresh one.
 *
 * ## Beside the package declarations
 *
 * The registry lists these beside every package-declared capability, and
 * `readDeclaredCapabilityContext` (`declared-capability-context.ts`) hands
 * them to the anchor predicates with the rest: the predicates' platform floor
 * (`@objectstack/spec/security`, `high-privilege.ts`) keeps a curated name
 * high-privilege whoever declares it, so they excuse nothing there.
 *
 * ## What a declaration here carries
 *
 * `name`, `label`, `description` and `scope` — the curated fields, each of
 * which `CapabilityDeclarationSchema` declares. Activation stays on the
 * catalog row.
 */

import { PLATFORM_CAPABILITIES, type PlatformCapability } from '@objectstack/spec/security';

/**
 * The engine registry's registration seam, as this module uses it — ObjectQL's
 * `SchemaRegistry` satisfies it as it stands.
 */
export interface BuiltinCapabilityRegistry {
  registerItem(type: string, item: Record<string, unknown>, keyField: string, packageId?: string): void;
}

/** One curated capability declaration — the spec's own entry (module doc). */
export type BuiltinCapabilityDeclaration = PlatformCapability;

/** The curated capabilities this plugin declares: the spec list itself. */
export const securityBuiltinCapabilities: readonly BuiltinCapabilityDeclaration[] = PLATFORM_CAPABILITIES;

/**
 * Declare the curated capabilities to the engine registry, owned by
 * `packageId` (the plugin passes its own `SECURITY_PLUGIN_ID`). Each
 * registration gets a fresh copy of the four curated fields: the registry
 * stamps provenance onto the object it is handed, and the spec list is shared.
 *
 * @returns how many were registered — 0 when `registry` cannot register
 *   anything, which the caller reports (absence is loud).
 */
export function registerBuiltinCapabilities(registry: unknown, packageId: string): number {
  const target = registry as Partial<BuiltinCapabilityRegistry> | null | undefined;
  if (!target || typeof target.registerItem !== 'function') return 0;
  for (const { name, label, description, scope } of securityBuiltinCapabilities) {
    target.registerItem('capability', { name, label, description, scope }, 'name', packageId);
  }
  return securityBuiltinCapabilities.length;
}
