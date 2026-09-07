// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * claimOrphanOrgRows — assign seed-loaded records to the first organization.
 *
 * Seeds (`defineSeed`) are inserted by `SeedLoaderService` using
 * `{ context: { isSystem: true } }`, which intentionally bypasses
 * SecurityPlugin's `organization_id` auto-fill. As a result, in
 * multi-tenant mode every seed row lands with `organization_id = NULL`.
 *
 * That's correct for **cross-tenant metadata** — `sys_permission_set`
 * rows, default roles, etc. (objects whose schema has `managedBy` set)
 * — but for **business-domain seeds** (CRM `lead`, `account`, `contact`,
 * …) it means the rows are invisible to anyone bound to an organization
 * (the default `tenant_isolation` RLS policy
 * `organization_id = current_user.organization_id` filters them out).
 *
 * This helper runs **once**, on first-organization creation, and
 * back-fills `organization_id` on every orphaned (`organization_id IS
 * NULL`) seed row of every user-defined object that declares the
 * column. Result: out of the box, the freshly registered owner sees the
 * shipped demo data scoped to their first org — no manual claim step.
 *
 * Idempotent: a no-op once an organization-tagged row exists, and
 * `managedBy` schemas (`sys_*` better-auth/platform tables) are always
 * skipped so cross-tenant defaults stay cross-tenant.
 */

import type { ServiceObject } from '@objectstack/spec/data';

interface ClaimOptions {
  logger?: {
    info: (message: string, meta?: Record<string, any>) => void;
    warn: (message: string, meta?: Record<string, any>) => void;
  };
}

const SYSTEM_CTX = { isSystem: true };

function hasOrganizationField(schema: ServiceObject): boolean {
  const fields: any = (schema as any)?.fields;
  if (!fields) return false;
  if (Array.isArray(fields)) {
    return fields.some((f) => f?.name === 'organization_id');
  }
  return Object.prototype.hasOwnProperty.call(fields, 'organization_id');
}

/**
 * Assign every orphaned seed row to `organizationId`.
 *
 * Walks `ql.registry.getAllObjects()`, filters to schemas that
 *   (a) are not `managedBy` (skip sys_/auth/platform tables),
 *   (b) declare an `organization_id` field,
 * and runs an `update(where: { organization_id: null }, patch: {
 * organization_id: organizationId })` against each as `isSystem`.
 *
 * Returns a per-object summary `{ object, count }[]`.
 */
export async function claimOrphanOrgRows(
  ql: any,
  organizationId: string,
  options: ClaimOptions = {},
): Promise<{ object: string; count: number }[]> {
  const logger = options.logger;
  if (!ql || typeof ql.update !== 'function' || typeof ql.find !== 'function') {
    return [];
  }
  const registry = (ql as any).registry;
  if (!registry || typeof registry.getAllObjects !== 'function') {
    logger?.warn?.('[org-scoping] claimOrphanOrgRows: registry unavailable');
    return [];
  }

  const schemas: ServiceObject[] = registry.getAllObjects();
  const results: { object: string; count: number }[] = [];

  for (const schema of schemas) {
    if (!schema?.name) continue;
    if ((schema as any).managedBy) continue;
    // Defense in depth: any platform-namespaced object (`sys_*`) is
    // off-limits for tenant claim regardless of `managedBy`. Platform
    // tables that should be tenant-scoped are inserted with an explicit
    // `organization_id` by the code that owns them, so they will never
    // be orphans here.
    if (schema.name.startsWith('sys_')) continue;
    if (!hasOrganizationField(schema)) continue;

    try {
      const orphans = await ql.find(
        schema.name,
        { where: { organization_id: null }, limit: 10_000, fields: ['id'] },
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
          await ql.update(
            schema.name,
            { id: row.id, organization_id: organizationId },
            { context: SYSTEM_CTX },
          );
          updated += 1;
        } catch (e) {
          logger?.warn?.(`[org-scoping] claim failed for ${schema.name}:${row.id}`, {
            error: (e as Error).message,
          });
        }
      }
      if (updated > 0) {
        results.push({ object: schema.name, count: updated });
      }
    } catch (e) {
      logger?.warn?.(`[org-scoping] claim scan failed for ${schema.name}`, {
        error: (e as Error).message,
      });
    }
  }

  if (results.length > 0) {
    const total = results.reduce((s, r) => s + r.count, 0);
    logger?.info?.(`[org-scoping] claimed ${total} orphan seed row(s) for organization ${organizationId}`, {
      breakdown: results,
    });
  }
  return results;
}
