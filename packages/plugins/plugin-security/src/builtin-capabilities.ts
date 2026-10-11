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
 * ## The one adapter, and why it lives at the call site
 *
 * `bootstrapDeclaredCapabilities` and `readDeclaredCapabilityContext`
 * (`declared-capability-context.ts`) read the registry's capabilities as PACKAGE declarations. Handed the curated
 * declarations too, the seeder would refuse each one as a package hijacking a
 * curated name (one false `capability_platform_name_refused` line per name,
 * every boot), and both would stop falling back to the metadata service on a
 * registry that holds no package declaration. The seeders are retired, not
 * edited (ADR-0131 cutover), so the plugin hands that seeder an engine view
 * without this plugin's own curated declarations
 * ({@link withoutPlatformCapabilityDeclarations}), and the context read drops
 * the same items ({@link withoutPlatformCapabilityItems}); both readers then
 * see exactly what they saw before. The view goes with the seeder.
 *
 * ## What a declaration here carries
 *
 * `name`, `label`, `description` and `scope` — the curated fields, each of
 * which `CapabilityDeclarationSchema` declares. Activation stays on the
 * catalog row.
 */

import { PLATFORM_CAPABILITIES, PLATFORM_CAPABILITY_NAMES, type PlatformCapability } from '@objectstack/spec/security';
import { SECURITY_PLUGIN_ID } from './manifest.js';

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

/**
 * Is `item` this plugin's own declaration of a curated capability — a curated
 * name stamped with this plugin's package id? Exact match on both. Another
 * package's item under a curated name is not, so it still reaches the readers
 * (and their refusal) as before.
 */
export function isPlatformCapabilityDeclaration(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const { name, _packageId } = item as { name?: unknown; _packageId?: unknown };
  return _packageId === SECURITY_PLUGIN_ID && typeof name === 'string' && PLATFORM_CAPABILITY_NAMES.has(name);
}

/** Read `prop` off `target`, binding a method to `target` itself. */
function forward(target: object, prop: PropertyKey): unknown {
  const value = Reflect.get(target, prop, target);
  return typeof value === 'function' ? value.bind(target) : value;
}

/**
 * The engine as the declared-capability seeder must see it: every member is
 * the engine's own, except that its registry lists no capability this plugin
 * declared from the curated list ({@link isPlatformCapabilityDeclaration}).
 * Every other type, and every other capability, is listed as the registry
 * lists it. An engine without a listing registry is returned as it is.
 */
export function withoutPlatformCapabilityDeclarations<T>(engine: T): T {
  const registry = (engine as { registry?: unknown } | null | undefined)?.registry;
  if (!engine || typeof engine !== 'object' || !registry || typeof registry !== 'object'
    || typeof (registry as { listItems?: unknown }).listItems !== 'function') {
    return engine;
  }
  const registryView = new Proxy(registry, {
    get(target, prop) {
      if (prop !== 'listItems') return forward(target, prop);
      return (type: string, ...rest: unknown[]) => {
        const items = (target as { listItems(type: string, ...rest: unknown[]): unknown }).listItems(type, ...rest);
        return type === 'capability' && Array.isArray(items)
          ? items.filter((item) => !isPlatformCapabilityDeclaration(item))
          : items;
      };
    },
  });
  return new Proxy(engine as object, {
    get(target, prop) {
      return prop === 'registry' ? registryView : forward(target, prop);
    },
  }) as T;
}

/** Drop this plugin's own curated declarations from a list of capability declarations. */
export function withoutPlatformCapabilityItems<T>(items: readonly T[]): T[] {
  return items.filter((item) => !isPlatformCapabilityDeclaration(item));
}
