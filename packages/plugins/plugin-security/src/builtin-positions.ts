// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The platform's built-in positions — the identity names (ADR-0068 D2, plus
 * `org_external`, ruling 6355206139) and the two audience anchors (ADR-0090
 * D5/D9) — declared ONCE, as position metadata this plugin owns.
 *
 * ## One list, one home
 *
 * {@link securityBuiltinPositions} is the only place the built-ins are listed.
 * `SecurityPlugin.init` declares them to the engine registry
 * ({@link registerBuiltinPositions}), under this plugin's package id, so the
 * security catalog read (`createSecurityCatalogReader`, `@objectstack/core`)
 * and the metadata door (`GET /api/v1/meta/position`) list them beside every
 * other declared position (ADR-0131 D2: built-ins and audience anchors are
 * declared metadata). The declaration is their one home: no boot step writes a
 * `sys_position` row for them — the built-in and declared position seeders are
 * retired (ADR-0131 D2, C3 stage 6a). Rows an earlier boot wrote stay on an
 * existing database until the upgrade ceremony removes them (C7).
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
 * That provenance is also what keeps the built-ins un-repurposable at the metadata
 * door: a packaged item of a type with no organization overlay (`position`) is
 * refused an in-place `PUT /api/v1/meta/position/:name` there, as the
 * platform's packaged permission sets are.
 *
 * ## What a declaration here does NOT carry
 *
 * Identity and display: `name`, `label`, `description`. Activation is the
 * activation ledger's (`sys_metadata_activation`), and provenance is the
 * owning package the registry stamps. The
 * sources of truth behind the identity names — `sys_member.role` for the
 * `org_*` trio, the unscoped `admin_full_access` grant for `platform_admin` —
 * are untouched: these remain a projection.
 *
 * ## The one binding a declaration here carries: `everyone`'s baseline
 *
 * [ADR-0090 D5, ADR-0131 D3/D4] The `everyone` anchor distributes the
 * deployment's baseline sets — the app's `isDefault` set composed with the
 * platform's `member_default` — in its definition's `permissionSets`, which
 * the authorization resolver reads. The plugin declares it
 * ({@link declareEveryoneBaseline}) in `init()` with the fail-closed reading of
 * the high-privilege check, so a boot that composes the plugin for its
 * declarations only holds it too, and again at `kernel:ready`, once the stack's
 * declared capabilities that check reads are in, with the accepted package
 * defaults.
 *
 * ## The other binding: `org_external`'s own baseline
 *
 * [Ruling 6355206139, letter B, stage 1, E1/E4] A holder of the `external`
 * organization role projects to `org_external` and does NOT hold `everyone`
 * (`resolveUserAuthzGrants`, `@objectstack/core`), so none of the deployment's
 * defaults above reach it. What does is the one set its identity position
 * names, statically — `external_default`, its own identity rows and nothing of
 * the member directory. No other built-in names a set.
 */

import {
  AUDIENCE_ANCHOR_POSITIONS,
  BUILTIN_IDENTITY_METADATA,
  BUILTIN_IDENTITY_NAMES,
  BUILTIN_IDENTITY_ORG_EXTERNAL,
  EVERYONE_POSITION,
  GUEST_POSITION,
} from '@objectstack/spec';
import { EXTERNAL_DEFAULT_PERMISSION_SET } from './objects/default-permission-sets.js';

/** One built-in position declaration: identity and display, and `org_external`'s static binding (module doc). */
export interface BuiltinPositionDeclaration {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly permissionSets?: readonly string[];
}

/** [Ruling 6355206139 E4] The static bindings a built-in identity carries — `org_external`'s alone (module doc). */
const BUILTIN_IDENTITY_BINDINGS: Readonly<Record<string, readonly string[]>> = {
  [BUILTIN_IDENTITY_ORG_EXTERNAL]: Object.freeze([EXTERNAL_DEFAULT_PERMISSION_SET]),
};

/**
 * [ADR-0090 D5/D9] The display text of the two audience anchors. `everyone` —
 * implicit for every authenticated member; its bindings are the tenant's
 * default grants, and a high-privilege set is refused there (ADR-0090 D5).
 * `guest` — implicit for unauthenticated principals; its bindings face the
 * strictest checks: named objects only, read-mostly, never a wildcard
 * (ADR-0090 D9). Both are system-managed and undeletable like the identity rows.
 *
 * The `label` and `description` are admin copy: Setup's Positions page lists
 * them. The decision ids stay here in the docblock, never in the strings
 * (`objects/admin-copy-vocabulary.test.ts` holds every built-in position to
 * that). A `sys_position` row a retired seeder stamped with the older text
 * keeps it until the upgrade ceremony deletes it as a seeded mirror (module
 * doc); no reader shows a row's description — the page lists these
 * declarations (`builtin-positions.boot.test.ts`, existing-database scenarios).
 */
const AUDIENCE_ANCHOR_METADATA: Readonly<Record<(typeof AUDIENCE_ANCHOR_POSITIONS)[number], { label: string; description: string }>> = {
  [EVERYONE_POSITION]: {
    label: 'Everyone',
    description:
      'Built-in audience anchor: every authenticated member holds this position implicitly. Permission sets bound to it are the default grants for the tenant. High-privilege sets cannot be bound here.',
  },
  [GUEST_POSITION]: {
    label: 'Guest',
    description:
      'Built-in audience anchor: unauthenticated principals hold this position implicitly and exclusively. Bindings face the strictest checks — named objects only, read-mostly, never a wildcard.',
  },
};

/**
 * The built-in positions, identity names first, then the audience anchors —
 * the order the built-in seeder has always written them in.
 */
export const securityBuiltinPositions: readonly BuiltinPositionDeclaration[] = Object.freeze([
  ...BUILTIN_IDENTITY_NAMES.map((name) =>
    Object.freeze({
      name,
      ...BUILTIN_IDENTITY_METADATA[name],
      ...(BUILTIN_IDENTITY_BINDINGS[name] ? { permissionSets: BUILTIN_IDENTITY_BINDINGS[name] } : {}),
    }),
  ),
  ...AUDIENCE_ANCHOR_POSITIONS.map((name) => Object.freeze({ name, ...AUDIENCE_ANCHOR_METADATA[name] })),
]);

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
 * Declare the built-in positions to the engine registry, owned by
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
    target.registerItem(
      'position',
      { ...declaration, ...(declaration.permissionSets ? { permissionSets: [...declaration.permissionSets] } : {}) },
      'name',
      packageId,
    );
  }
  return securityBuiltinPositions.length;
}

/**
 * [ADR-0090 D5, ADR-0131 D3/D4] Declare the `everyone` anchor again, owned by
 * `packageId`, now naming `sets` — the deployment's baseline — in its
 * `permissionSets` (module doc). The same package re-registering its own item
 * replaces it.
 *
 * @returns whether it was declared — `false` when `registry` cannot register.
 */
export function declareEveryoneBaseline(registry: unknown, packageId: string, sets: readonly string[]): boolean {
  const target = registry as Partial<BuiltinPositionRegistry> | null | undefined;
  if (!target || typeof target.registerItem !== 'function') return false;
  const everyone = securityBuiltinPositions.find((p) => p.name === EVERYONE_POSITION)!;
  target.registerItem('position', { ...everyone, permissionSets: [...sets] }, 'name', packageId);
  return true;
}
