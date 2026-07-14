// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * claimSeedOwnership — hand seeded business records to the first platform admin.
 *
 * Seed data is loaded during app-plugin `start()`, which runs BEFORE any human
 * user exists (the login admin is minted later, on `kernel:ready`). So seeded
 * rows land with `owner_id = NULL` (the author left it unset — the correct,
 * mistake-proof default) or `owner_id = usr_system` (the deterministic seed
 * identity bound to `os.user`). Either way the record is owned by nobody a
 * human can log in as, so owner-keyed UX — "My" views, owner reports, owner
 * notifications — is empty out of the box.
 *
 * This helper runs **once**, right after `bootstrapPlatformAdmin` promotes the
 * first human user to platform admin, and transfers ownership of those orphan
 * rows to that admin. It is the ownership twin of org-scoping's
 * `claimOrphanOrgRows` (which back-fills `organization_id`): walk every
 * user-authored object that declares the canonical `owner_id` column, and
 * re-own the rows that no human owns yet.
 *
 * Mistake-proof by construction: authors write plain seed records (no
 * `owner_id`), and the platform — not the author — performs the handoff. There
 * is nothing to remember and nothing to mistype.
 *
 * Idempotent: only NULL / `usr_system`-owned rows are touched, so once a real
 * admin owns them a re-run is a no-op. `managedBy` and `sys_*` tables are
 * skipped (their ownership, if any, is platform-controlled).
 */

import type { ServiceObject } from '@objectstack/spec/data';
import { SystemUserId } from '@objectstack/spec/system';

interface ClaimOwnershipOptions {
  logger?: {
    info: (message: string, meta?: Record<string, any>) => void;
    warn: (message: string, meta?: Record<string, any>) => void;
  };
}

const SYSTEM_CTX = { isSystem: true };

function hasOwnerField(schema: ServiceObject): boolean {
  const fields: any = (schema as any)?.fields;
  if (!fields) return false;
  if (Array.isArray(fields)) {
    return fields.some((f) => f?.name === 'owner_id');
  }
  return Object.prototype.hasOwnProperty.call(fields, 'owner_id');
}

/**
 * Re-own every orphan seed row (owner_id NULL or usr_system) to `adminUserId`.
 *
 * Walks `ql.registry.getAllObjects()`, filters to schemas that
 *   (a) are not `managedBy` (skip sys_/auth/platform tables),
 *   (b) are not `sys_*`-namespaced,
 *   (c) are not `external` (federated remote-table bindings — read-only, DDL
 *       forbidden, and their `owner_id` is not ours to reassign),
 *   (d) declare an `owner_id` field,
 * and updates the unowned rows as `isSystem`. Returns a per-object summary.
 */
export async function claimSeedOwnership(
  ql: any,
  adminUserId: string,
  options: ClaimOwnershipOptions = {},
): Promise<{ object: string; count: number }[]> {
  const logger = options.logger;
  if (!adminUserId || adminUserId === SystemUserId.SYSTEM) return [];
  if (!ql || typeof ql.update !== 'function' || typeof ql.find !== 'function') {
    return [];
  }
  const registry = (ql as any).registry;
  if (!registry || typeof registry.getAllObjects !== 'function') {
    logger?.warn?.('[security] claimSeedOwnership: registry unavailable');
    return [];
  }

  const schemas: ServiceObject[] = registry.getAllObjects();
  const results: { object: string; count: number }[] = [];

  for (const schema of schemas) {
    if (!schema?.name) continue;
    if ((schema as any).managedBy) continue;
    if (schema.name.startsWith('sys_')) continue;
    // External (federated) objects bind to a remote table on another datasource
    // (ADR-0015): reads are remapped, DDL is forbidden, and writes need a double
    // opt-in. Their `owner_id` — if the remote even has the column — is not the
    // platform's to reassign, and the remote table may not be provisioned when
    // this runs at boot (e.g. a fixture that seeds later), so a scan errors with
    // "no such table". Skip them entirely.
    if ((schema as any).external) continue;
    if (!hasOwnerField(schema)) continue;

    try {
      // Unowned = owner_id NULL (author left it unset) OR usr_system (seed
      // identity). Two narrow scans keep the where-clauses driver-portable
      // instead of relying on an OR/IN predicate.
      const seen = new Set<string>();
      const ids: string[] = [];
      for (const where of [{ owner_id: null }, { owner_id: SystemUserId.SYSTEM }]) {
        const rows = await ql.find(
          schema.name,
          { where, limit: 10_000, fields: ['id'] },
          { context: SYSTEM_CTX },
        );
        const list: any[] = Array.isArray(rows)
          ? rows
          : Array.isArray(rows?.records)
            ? rows.records
            : [];
        for (const r of list) {
          if (r?.id && !seen.has(r.id)) {
            seen.add(r.id);
            ids.push(r.id);
          }
        }
      }
      if (ids.length === 0) continue;

      let updated = 0;
      for (const id of ids) {
        try {
          await ql.update(
            schema.name,
            { id, owner_id: adminUserId },
            { context: SYSTEM_CTX },
          );
          updated += 1;
        } catch (e) {
          logger?.warn?.(`[security] claimSeedOwnership failed for ${schema.name}:${id}`, {
            error: (e as Error).message,
          });
        }
      }
      if (updated > 0) results.push({ object: schema.name, count: updated });
    } catch (e) {
      logger?.warn?.(`[security] claimSeedOwnership scan failed for ${schema.name}`, {
        error: (e as Error).message,
      });
    }
  }

  if (results.length > 0) {
    const total = results.reduce((s, r) => s + r.count, 0);
    logger?.info?.(`[security] handed ${total} seeded record(s) to first admin ${adminUserId}`, {
      breakdown: results,
    });
  }
  return results;
}
