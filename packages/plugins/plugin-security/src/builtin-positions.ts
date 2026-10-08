// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The platform's built-in positions — the four identity names (ADR-0068 D2) and
 * the two audience anchors (ADR-0090 D5/D9) — declared ONCE, as position
 * metadata this plugin owns.
 *
 * ## One list, two consumers
 *
 * {@link securityBuiltinPositions} is the only place the six are listed:
 *
 *  1. `SecurityPlugin.start` declares them to the engine registry
 *     ({@link registerBuiltinPositions}), under this plugin's package id, so
 *     the security catalog read (`createSecurityCatalogReader`,
 *     `@objectstack/core`) and the metadata door (`GET /api/v1/meta/position`)
 *     list them beside every other declared position (ADR-0131 D2: built-ins
 *     and audience anchors are declared metadata — the C3 slice the C2
 *     execution card pulls forward).
 *  2. `bootstrapBuiltinRoles` seeds their `sys_position` rows from this same
 *     list, exactly as it seeded them from its own code list before: the same
 *     names, the same organizations, `managed_by: 'platform'`, `active: true`,
 *     `is_default: false`.
 *
 * And one exclusion: `bootstrapDeclaredPositions` skips every name here
 * ({@link isBuiltinPositionName}). It seeds from the security catalog read,
 * which lists the six now that they are declared; taken there, they would get
 * a copy without the `platform` provenance ahead of the built-in pass, which
 * then restamps it. The exclusion is by name, so an environment-stored
 * definition that shadows one of the six at read is skipped as well.
 *
 * ## Why the engine registry, and not the manifest's `positions` key
 *
 * The manifest registration carries `permissions` into the engine registry,
 * but a manifest `positions` key reaches no reader: the engine's stack-collection
 * loop has no `positions` entry (a waived row in `check:stack-collection-maps`),
 * and `ManifestSchema` declares no such key. Measured: `registerApp` with a
 * `positions` and a `permissions` list registers the permission set under the
 * package's id and no position at all; on a booted showcase a `positions` list
 * on this plugin's manifest left the engine registry, the metadata service, the
 * metadata door and the catalog read without a single one of its names. So the
 * declarations go to the registry by the registry's own seam (`registerItem`),
 * with this plugin as the owning package — the provenance the manifest stamps
 * on the platform's permission sets.
 *
 * That provenance is also what keeps the six un-repurposable at the metadata
 * door: a packaged item of a type with no organization overlay (`position`) is
 * refused an in-place `PUT /api/v1/meta/position/:name` there, as the
 * platform's packaged permission sets are.
 *
 * ## What a declaration here does NOT carry
 *
 * Only identity and display: `name`, `label`, `description` — what
 * `PositionSchema` declares and what the rows have always been stamped with.
 * Activation (`active`), the default flag (`is_default`) and provenance
 * (`managed_by`) stay on the catalog ROW; the six bind no permission set in
 * their definition (the binding stays on its junction rows until the position
 * definition can carry it). The sources of truth behind the identity names —
 * `sys_member.role` for the `org_*` trio, the unscoped `admin_full_access`
 * grant for `platform_admin` — are untouched: these remain a projection.
 */

import {
  AUDIENCE_ANCHOR_POSITIONS,
  BUILTIN_IDENTITY_METADATA,
  BUILTIN_IDENTITY_NAMES,
  EVERYONE_POSITION,
  GUEST_POSITION,
} from '@objectstack/spec';

/** One built-in position declaration: identity and display only (module doc). */
export interface BuiltinPositionDeclaration {
  readonly name: string;
  readonly label: string;
  readonly description: string;
}

/**
 * [ADR-0090 D5/D9] The display text of the two audience anchors. `everyone` —
 * implicit for every authenticated member; its bindings are the tenant's
 * default grants. `guest` — implicit for unauthenticated principals. Both are
 * system-managed and undeletable like the identity rows.
 */
const AUDIENCE_ANCHOR_METADATA: Readonly<Record<(typeof AUDIENCE_ANCHOR_POSITIONS)[number], { label: string; description: string }>> = {
  [EVERYONE_POSITION]: {
    label: 'Everyone',
    description:
      'Built-in audience anchor: every authenticated member holds this position implicitly. Permission sets bound to it are the default grants for the tenant (ADR-0090 D5). High-privilege sets cannot be bound here.',
  },
  [GUEST_POSITION]: {
    label: 'Guest',
    description:
      'Built-in audience anchor: unauthenticated principals hold this position implicitly and exclusively. Bindings face the strictest checks — named objects only, read-mostly, never a wildcard (ADR-0090 D9).',
  },
};

/**
 * The six built-in positions, identity names first, then the audience anchors —
 * the order the built-in seeder has always written them in.
 */
export const securityBuiltinPositions: readonly BuiltinPositionDeclaration[] = Object.freeze([
  ...BUILTIN_IDENTITY_NAMES.map((name) => Object.freeze({ name, ...BUILTIN_IDENTITY_METADATA[name] })),
  ...AUDIENCE_ANCHOR_POSITIONS.map((name) => Object.freeze({ name, ...AUDIENCE_ANCHOR_METADATA[name] })),
]);

const BUILTIN_POSITION_NAMES: ReadonlySet<string> = new Set(securityBuiltinPositions.map((p) => p.name));

/** Is `name` one of the six built-in positions this plugin declares? Exact match. */
export function isBuiltinPositionName(name: unknown): boolean {
  return typeof name === 'string' && BUILTIN_POSITION_NAMES.has(name);
}

/**
 * The engine registry's registration seam, as this module uses it — ObjectQL's
 * `SchemaRegistry` satisfies it as it stands. Not on the engine's published
 * registry view, which is read-only; the manifest registration calls the same
 * method for the platform's permission sets.
 */
export interface BuiltinPositionRegistry {
  registerItem(type: string, item: Record<string, unknown>, keyField: string, packageId?: string): void;
}

/**
 * Declare the six built-in positions to the engine registry, owned by
 * `packageId` (the plugin passes its own `SECURITY_PLUGIN_ID`). Each
 * registration gets a fresh copy: the registry stamps provenance onto the
 * object it is handed, and the list above is shared.
 *
 * @returns how many were registered — 0 when `registry` cannot register
 *   anything, which the caller reports (absence is loud).
 */
export function registerBuiltinPositions(registry: unknown, packageId: string): number {
  const target = registry as Partial<BuiltinPositionRegistry> | null | undefined;
  if (!target || typeof target.registerItem !== 'function') return 0;
  for (const declaration of securityBuiltinPositions) {
    target.registerItem('position', { ...declaration }, 'name', packageId);
  }
  return securityBuiltinPositions.length;
}
