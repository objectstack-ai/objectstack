// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * claimOrgSeedOwnership — hand an organization's seeded records to its owner.
 *
 * The multi-tenant twin of plugin-security's `claimSeedOwnership` (single-tenant
 * first-admin handoff). Seeded rows land `owner_id = NULL` (the author leaves it
 * unset and `cel`os.user.id`` resolves to NULL at seed time, since the owning
 * admin does not exist yet). In multi-tenant mode those rows are scoped to an
 * org by `claimOrphanOrgRows` / per-org replay, but their `owner_id` stays NULL
 * — so "My" views, owner reports and owner notifications are empty for the org's
 * members until ownership is assigned.
 *
 * This runs when the org's owner is established (e.g. `ensureDefaultOrganization`
 * binds the platform admin as the default org's `owner`) and assigns
 * `owner_id = ownerUserId` to that org's NULL-owned rows — the ownership
 * companion to `claimOrphanOrgRows`'s `organization_id` back-fill.
 *
 * Scoped to a single org (`organization_id = organizationId`) so it never
 * touches another tenant's rows. Idempotent: only NULL-owned rows are updated.
 * `managedBy` and `sys_*` tables are skipped.
 */

import type { ServiceObject } from '@objectstack/spec/data';

interface ClaimOwnershipOptions {
  logger?: {
    info: (message: string, meta?: Record<string, any>) => void;
    warn: (message: string, meta?: Record<string, any>) => void;
  };
}

const SYSTEM_CTX = { isSystem: true };

function hasField(schema: ServiceObject, field: string): boolean {
  const fields: any = (schema as any)?.fields;
  if (!fields) return false;
  if (Array.isArray(fields)) return fields.some((f) => f?.name === field);
  return Object.prototype.hasOwnProperty.call(fields, field);
}

/**
 * Assign `owner_id = ownerUserId` to every NULL-owned seed row of `organizationId`.
 *
 * Walks `ql.registry.getAllObjects()`, filters to schemas that
 *   (a) are not `managedBy` (skip sys_/auth/platform tables),
 *   (b) are not `sys_*`-namespaced,
 *   (c) declare BOTH `owner_id` and `organization_id`,
 * and updates the org's unowned rows as `isSystem`. Returns a per-object summary.
 */
export async function claimOrgSeedOwnership(
  ql: any,
  organizationId: string,
  ownerUserId: string,
  options: ClaimOwnershipOptions = {},
): Promise<{ object: string; count: number }[]> {
  const logger = options.logger;
  if (!organizationId || !ownerUserId) return [];
  if (!ql || typeof ql.update !== 'function' || typeof ql.find !== 'function') return [];
  const registry = (ql as any).registry;
  if (!registry || typeof registry.getAllObjects !== 'function') {
    logger?.warn?.('[org-scoping] claimOrgSeedOwnership: registry unavailable');
    return [];
  }

  const schemas: ServiceObject[] = registry.getAllObjects();
  const results: { object: string; count: number }[] = [];

  for (const schema of schemas) {
    if (!schema?.name) continue;
    if ((schema as any).managedBy) continue;
    if (schema.name.startsWith('sys_')) continue;
    // Both columns are required: owner_id to assign, organization_id to scope.
    if (!hasField(schema, 'owner_id') || !hasField(schema, 'organization_id')) continue;

    try {
      const orphans = await ql.find(
        schema.name,
        { where: { organization_id: organizationId, owner_id: null }, limit: 10_000, fields: ['id'] },
        { context: SYSTEM_CTX },
      );
      const list: any[] = Array.isArray(orphans)
        ? orphans
        : Array.isArray(orphans?.records)
          ? orphans.records
          : [];
      if (list.length === 0) continue;

      let updated = 0;
      for (const row of list) {
        if (!row?.id) continue;
        try {
          await ql.update(schema.name, { id: row.id, owner_id: ownerUserId }, { context: SYSTEM_CTX });
          updated += 1;
        } catch (e) {
          logger?.warn?.(`[org-scoping] claimOrgSeedOwnership failed for ${schema.name}:${row.id}`, {
            error: (e as Error).message,
          });
        }
      }
      if (updated > 0) results.push({ object: schema.name, count: updated });
    } catch (e) {
      logger?.warn?.(`[org-scoping] claimOrgSeedOwnership scan failed for ${schema.name}`, {
        error: (e as Error).message,
      });
    }
  }

  if (results.length > 0) {
    const total = results.reduce((s, r) => s + r.count, 0);
    logger?.info?.(`[org-scoping] handed ${total} seeded row(s) of org ${organizationId} to owner ${ownerUserId}`, {
      breakdown: results,
    });
  }
  return results;
}
