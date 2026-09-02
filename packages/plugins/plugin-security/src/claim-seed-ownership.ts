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
 *
 * ## [#14530] One PREDICATE write per unowned shape, never a write per row
 *
 * This used to scan each object twice at `limit: 10_000` and then issue one
 * **single-id** `update` per matched id — up to 20 000 writes for one object.
 * Every one of those is a full engine write (middleware chain, validation,
 * hook dispatch, driver round trip), and the batch existed only in this loop,
 * where nothing downstream could see it: plugin-sharing's `rule-hooks.ts`
 * already routes a write whose row set exceeds `RULE_RECOMPUTE_ROW_CAP` into
 * one set-based revoke plus one queued `evaluateAllRulesForObject`, but that
 * branch reads ONE write's row set, and each of these writes legitimately
 * carried a single row. Batching in the caller is what lets the machinery
 * already built for this shape do its job — no change to `plugin-sharing`.
 *
 * The two scans are gone with the loop. The predicates they resolved are the
 * predicates the writes now carry, one write each, so the matched set is
 * unchanged row for row: `owner_id IS NULL`, then `owner_id = usr_system`.
 * They stay two narrow writes rather than one `OR`/`IN` predicate for the
 * reason the scans were two — driver portability — and they remain disjoint in
 * this order, because the first write leaves `adminUserId` (never `usr_system`,
 * refused above) where the NULLs were.
 *
 * The count reported per object is the affected-row count the predicate write
 * resolves (#4639), not a length this function counted for itself.
 *
 * ### The bound moved, and it did not get smaller
 *
 * A predicate write carries no `limit`, so nothing here truncates at 10 000 any
 * more. What bounds it now is the engine's own ceiling: a predicate write on an
 * object carrying `beforeUpdate`/`afterUpdate` hooks — which every object does,
 * objectql's own audit-stamp builtin is registered on `'*'` — is REFUSED whole
 * above `MAX_BULK_PER_ROW_HOOK_ROWS` (10 000), because those hooks are
 * contracted to fire per matched row. So the reachable population per predicate
 * per run is the same 10 000 the scan limit allowed; what changed is that
 * exceeding it is now LOUD (the engine's refusal names the count, the ceiling
 * and both routes out, and this function logs it per object) instead of a
 * silent partial claim of the first 10 000 rows.
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

/**
 * "Unowned", as two driver-portable predicates rather than one `OR`/`IN`.
 *
 * Order is load-bearing: the NULL write lands `adminUserId` — which cannot be
 * `usr_system` (refused at the top of {@link claimSeedOwnership}) — so the two
 * matched sets stay disjoint and their counts sum without double-counting a row.
 */
const UNOWNED_PREDICATES: readonly Record<string, unknown>[] = [
  { owner_id: null },
  { owner_id: SystemUserId.SYSTEM },
];

function hasOwnerField(schema: ServiceObject): boolean {
  const fields: any = (schema as any)?.fields;
  if (!fields) return false;
  if (Array.isArray(fields)) {
    return fields.some((f) => f?.name === 'owner_id');
  }
  return Object.prototype.hasOwnProperty.call(fields, 'owner_id');
}

/**
 * The affected-row count a predicate write resolved, or `undefined` when the
 * result is not one.
 *
 * `IDataDriver.updateMany` is contracted to resolve the affected row count and
 * `ObjectQL.update` passes it through for a `multi: true` write (#4639). A
 * result that is not a non-negative integer has not met that contract, so this
 * says "unknown" rather than inventing a `0` — the engine's own reader of the
 * same value (`eventMatchedCount`, which declines to publish a bulk event on
 * exactly this input) makes the same call, for the same reason: the rows very
 * likely WERE written, and reporting none of them is a false statement, not a
 * conservative one.
 */
function affectedRowCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return undefined;
  return value;
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
 * and re-owns the unowned rows as `isSystem` with one predicate write per
 * {@link UNOWNED_PREDICATES} entry. Returns a per-object summary.
 */
export async function claimSeedOwnership(
  ql: any,
  adminUserId: string,
  options: ClaimOwnershipOptions = {},
): Promise<{ object: string; count: number }[]> {
  const logger = options.logger;
  if (!adminUserId || adminUserId === SystemUserId.SYSTEM) return [];
  // Only `update` is required now that the scans are gone: this function asks
  // the engine for exactly one capability, so the guard names exactly that one.
  if (!ql || typeof ql.update !== 'function') return [];
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

    let updated = 0;
    for (const where of UNOWNED_PREDICATES) {
      try {
        const affected = await ql.update(
          schema.name,
          { owner_id: adminUserId },
          { where, multi: true, context: SYSTEM_CTX },
        );
        const count = affectedRowCount(affected);
        if (count === undefined) {
          logger?.warn?.(
            `[security] claimSeedOwnership could not read an affected-row count for ${schema.name} ` +
              '— the rows were re-owned but this run cannot say how many',
            { object: schema.name, where, result: typeof affected },
          );
          continue;
        }
        updated += count;
      } catch (e) {
        // Best-effort per predicate, exactly as the per-id loop was: one
        // predicate that cannot land must not cost the object its other one,
        // nor any later object. The rows stay unowned and the next run — boot,
        // the bootstrap replay, or `meta resync` — claims them, because the
        // predicate is still true of them.
        logger?.warn?.(
          `[security] claimSeedOwnership failed for ${schema.name}; those rows stay unowned ` +
            'and the next run will claim them',
          { object: schema.name, where, error: (e as Error).message },
        );
      }
    }
    if (updated > 0) results.push({ object: schema.name, count: updated });
  }

  if (results.length > 0) {
    const total = results.reduce((s, r) => s + r.count, 0);
    logger?.info?.(`[security] handed ${total} seeded record(s) to first admin ${adminUserId}`, {
      breakdown: results,
    });
  }
  return results;
}
