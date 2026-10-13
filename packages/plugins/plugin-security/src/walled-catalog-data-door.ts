// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3] The walled catalog refusal at the DATA door: a non-system
 * insert, update or delete on `sys_position`, `sys_permission_set` or
 * `sys_capability`, under a posture that enforces an organization wall, by a
 * caller who is not the platform operator, is refused `403 PERMISSION_DENIED`.
 *
 * ## Why the data door needs it
 *
 * ADR-0131 D3: "Shared-DB multi-tenant (`group` / `isolated`): tenant admins
 * cannot create or edit catalog items … Creation through Setup or the API is
 * refused". Setup writes the catalog through these three objects. Under a wall
 * the stock organization administrator is already refused there by its own
 * grants (the anti-escalation deny in `objects/default-permission-sets.ts`),
 * but any other organization-scoped principal whose sets admit the table was
 * not:
 *
 * - a `sys_permission_set` write is redirected into the environment ledger
 *   (`createPermissionSetWriteThrough`, ADR-0094 D3) in every posture, so an
 *   organization-scoped principal created an ENVIRONMENT permission set every
 *   organization resolves by name — measured on a booted walled stack;
 * - a `sys_position` write landed as a row of the writer's organization, a
 *   position with no registry home (the `single`-only write-through stands
 *   down under a wall) — measured in this package's harness.
 *
 * The verdict and its sentence are the metadata door's own
 * (`walledCatalogWriteVerdict`, `@objectstack/metadata-core`), so the data
 * door and the `/meta` doors refuse the same callers with the same words.
 *
 * ## Where it runs
 *
 * Registered AFTER the security middleware, so it runs INSIDE it: a caller who
 * may not write the table at all keeps its CRUD refusal and learns nothing
 * here. Registered BEFORE the permission-set write-through, so a refused write
 * is never translated into a metadata save.
 *
 * ## What it does not judge
 *
 * - **Assignments.** `sys_user_position` and `sys_user_permission_set` rows
 *   are organization rows in every posture (ADR-0131 D3); an organization's
 *   administrators keep assigning the catalog to their own members.
 * - **System writes** (`isSystem`): the seeders, the package door, migrations.
 * - **The platform operator** (the ADR-0095 `PLATFORM_ADMIN` rung on the
 *   context). A hand-built context that carries no rung is not the operator.
 * - **`single`**: inert; the organization is the environment.
 */

import { walledCatalogWriteVerdict } from '@objectstack/metadata-core';
import type { TenancyPosture } from '@objectstack/spec/security';
import { PermissionDeniedError } from './errors.js';

/** The catalog objects this guard judges, and the metadata type each one writes. */
export const WALLED_CATALOG_OBJECT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  sys_position: 'position',
  sys_permission_set: 'permission',
  sys_capability: 'capability',
});

/** The engine operations that change a catalog row. */
const WRITE_OPERATIONS: ReadonlySet<string> = new Set(['insert', 'update', 'delete']);

export interface WalledCatalogDataDoorDeps {
  /** The deployment's effective tenancy posture, as the security plugin resolved it. */
  getPosture: () => TenancyPosture | undefined;
}

/** The engine middleware. Registered once per catalog object (see {@link WALLED_CATALOG_OBJECT_TYPES}). */
export function createWalledCatalogDataDoorRefusal(
  deps: WalledCatalogDataDoorDeps,
): (opCtx: any, next: () => Promise<void>) => Promise<void> {
  return async (opCtx: any, next: () => Promise<void>): Promise<void> => {
    const object = opCtx?.object;
    const type = typeof object === 'string' ? WALLED_CATALOG_OBJECT_TYPES[object] : undefined;
    if (!type || !WRITE_OPERATIONS.has(opCtx?.operation)) return next();
    const context = opCtx?.context ?? {};
    const verdict = walledCatalogWriteVerdict({
      type,
      tenancyPosture: deps.getPosture(),
      isSystem: context.isSystem === true,
      callerPosture: context.posture,
    });
    if (!verdict.allowed) {
      throw new PermissionDeniedError(verdict.message, { operation: opCtx.operation, object });
    }
    return next();
  };
}
