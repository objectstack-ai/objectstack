// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * claimOrgSeedOwnership — hand an organization's seeded records to its owner.
 *
 * The multi-tenant twin of plugin-security's `claimSeedOwnership` (single-tenant
 * first-admin handoff). Seeded rows land `owner_id = NULL` (the author leaves it
 * unset and `cel`os.user.id`` resolves to NULL at seed time, since the owning
 * admin does not exist yet). In multi-tenant mode those rows are scoped to an
 * org by the per-org replay, but their `owner_id` stays NULL
 * — so "My" views, owner reports and owner notifications are empty for the org's
 * members until ownership is assigned.
 *
 * This runs when the org's owner is established (e.g. `ensureDefaultOrganization`
 * binds the platform admin as the default org's `owner`) and assigns
 * `owner_id = ownerUserId` to that org's NULL-owned rows. It never writes
 * `organization_id`: an organization-less row is the organization-ownership
 * ceremony's to attribute, not this plugin's (ADR-0131 D10).
 *
 * Scoped to a single org (`organization_id = organizationId`) so it never
 * touches another tenant's rows. Idempotent: only NULL-owned rows are updated.
 * `managedBy` and `sys_*` tables are skipped.
 *
 * ## [#23354] Only the rows the org's seed replay wrote (ADR-0138 D1)
 *
 * A NULL owner is not a seed row's mark: a guest-written row and a public
 * form's intake keep no owner on purpose (ADR-0138 D1 item 5), and no stored
 * column tells them apart. So this re-owns a NULL-owner row only when the
 * organization's per-org seed replay reported landing on it — the
 * `seed-settlement` contract's `seededRecordIds(object, organizationId)`, bound
 * by the caller ({@link ClaimOwnershipOptions.seededRecordIds}): the predicate
 * is `organization_id = org AND owner_id IS NULL AND id IN (seeded ids)`, one
 * per chunk of {@link CLAIM_CHUNK_IDS} ids. It is the selector its single-tenant
 * twin `claimSeedOwnership` takes. Without a reading it re-owns nothing.
 *
 * The reading covers the replay that ran in THIS process, and the host keeps
 * only the most recent one. That is the shape of the call: the owner bind runs
 * in the same call that created the organization, right after its replay. An
 * organization that existed before this process (a bind retried on a later
 * boot) has no reading, and its NULL-owner rows keep no owner — the record's
 * empty state, never a guest's row handed over.
 *
 * ## [#23008] The claim dispatches no automation
 *
 * Re-owning a seed row is attribution, the step that completes the seed, not a
 * user event, so every write runs under {@link CLAIM_WRITE_CTX} — the same
 * context its single-tenant twin `claimSeedOwnership` adopted (#22067). The
 * engine reads `skipAutomations` in two places: the hook dispatch skips every
 * hook bound FROM METADATA (an app's lifecycle hooks), and it implies
 * `skipTriggers`, so the record-change trigger dispatches no flow — no approval
 * opens and no notification goes out for the claim. Hooks plugins register in
 * code carry no metadata binding and still run on every claimed row: the audit
 * writer, capability gates and the sharing projection. The opt-out never
 * bypasses audit or sharing (#2922).
 *
 * The real-engine half of this is `claim-org-seed-ownership-dispatch.pin.test.ts`.
 *
 * ## [#23054] Predicate writes, until no seeded owner-less row is left
 *
 * This used to read each object's owner-less ids ONCE, at `limit: 10_000`, and
 * then issue one single-id `update` per id. Nothing re-read, so on an object
 * with more than 10 000 owner-less rows in the organization the pass claimed
 * the first 10 000 and stopped, and nothing ever ran it again: the ADR-0093 D7
 * once-gate (`createEnsureDefaultOrganizationOnce`) decides the owner bind,
 * and the seed handoff that follows it, exactly once. Measured on a real
 * `ObjectQL` over `SqliteWasmDriver`: 10 500 owner-less rows, one pass, 10 000
 * owned, 500 owner-less for good.
 *
 * Every write is now a predicate write, `multi: true`, over one chunk of the
 * seeded ids: `{ organization_id, owner_id: null, id: { $in: chunk } }`. The
 * predicate is the claim's whole selection rule, so the write matches exactly
 * the rows it selects, with no read; every chunk is written, so no seeded row
 * is left past any cap. A predicate write fires `beforeUpdate`/`afterUpdate`
 * per matched row (ADR-0058, bulk-write addendum D6), and the engine refuses
 * one WHOLE above {@link MAX_BULK_PER_ROW_HOOK_ROWS} matched rows — so a chunk
 * holds at most {@link CLAIM_CHUNK_IDS} ids, half that ceiling, and can never
 * match enough rows to be refused. (#23054 answered that refusal with a page
 * read and a retry; a write whose `IN` list is bounded below the ceiling has
 * none to answer, so the paging went with the unbounded predicate.) Half, not
 * all of it, because the `IN` list binds one parameter per id and a driver's
 * bound-parameter limit is a question about statement width.
 *
 * `count` in the result is the SUM of the affected-row counts every write
 * resolved, never a length this function counted for itself.
 *
 * ⚠️ The unit of failure is the write. A per-id loop lost only the row whose
 * write threw; a predicate write that a hook or a validation rule refuses
 * writes nothing, so that chunk stays owner-less and the warning says so. The
 * next chunk and the next object are still claimed. The twin made the same
 * trade.
 */

import type { ServiceObject } from '@objectstack/spec/data';
import { MAX_BULK_PER_ROW_HOOK_ROWS } from '@objectstack/spec/data';

import type { OrgScopingEngine } from './org-scoping-engine.js';

interface ClaimOwnershipOptions {
  logger?: {
    info: (message: string, meta?: Record<string, any>) => void;
    warn: (message: string, meta?: Record<string, any>) => void;
  };
  /**
   * [#23354] The ids of the rows this organization's seed replay landed on,
   * per object — the `seed-settlement` contract's `seededRecordIds`, already
   * bound to the organization by the caller. It is this claim's whole
   * selection: a NULL-owner row it does not name keeps no owner (ADR-0138 D1).
   * `undefined` means no host publishes a reading, and nothing is re-owned.
   */
  seededRecordIds?: ((objectName: string) => readonly string[]) | undefined;
}

/**
 * The context of the claim's WRITE (`reown`): system-elevated, with
 * metadata-bound automation off. See "The claim dispatches no automation"
 * above.
 *
 * `skipAutomations` alone, never a narrower flag. It is the spec's one spelling
 * of "skip metadata hooks AND record-change flows, keep code-registered hooks"
 * (`ExecutionContext`, `@objectstack/spec/kernel`), and `skipTriggers` alone
 * would leave the app's metadata hooks firing on every claimed row.
 *
 * A plain literal: `pnpm check:tenant-audit-census` reads `isSystem` off it
 * statically and does not see through a `satisfies` wrapper.
 *
 * It does not move the per-row hook ceiling: the engine counts the matched rows
 * whenever ANY hook covers the object, without consulting the flag, and
 * code-registered hooks still run per row under it — which is why a chunk is
 * bounded below that ceiling ({@link CLAIM_CHUNK_IDS}).
 */
const CLAIM_WRITE_CTX = { isSystem: true, skipAutomations: true };

/**
 * Seeded ids one claim write carries in its `IN` list.
 *
 * Derived from the engine's per-row hook ceiling, never a free literal, so it
 * moves with the number that would refuse the write: a chunk of this many ids
 * matches at most this many rows, half the ceiling, so the engine never
 * refuses a claim write for its size. The other half is the margin for a
 * driver's bound-parameter limit, which the `IN` list spends one per id.
 */
const CLAIM_CHUNK_IDS = Math.floor(MAX_BULK_PER_ROW_HOOK_ROWS / 2);

/**
 * The affected-row count a predicate write resolved, or `undefined` when the
 * result is not one.
 *
 * `IDataDriver.updateMany` resolves the affected row count and `ObjectQL.update`
 * passes it through for a `multi: true` write. Anything that is not a
 * non-negative integer is "unknown", never `0`: the rows very likely were
 * written, and reporting none of them would be a false statement.
 */
function affectedRowCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return undefined;
  return value;
}

/**
 * Re-own the rows one chunk's predicate matches, in one write. Returns the
 * affected-row count it resolved.
 *
 * Never throws. Best-effort per chunk, as the per-id loop was per row: a chunk
 * that cannot be claimed must not cost a later chunk or a later object its
 * claim. An unreadable count is warned as unknown and counts nothing, because
 * this function never adds a number it cannot attest.
 */
async function claimChunk(
  reown: (where: Record<string, unknown>) => Promise<unknown>,
  objectName: string,
  organizationId: string,
  where: Record<string, unknown>,
  logger: ClaimOwnershipOptions['logger'],
): Promise<number> {
  const ids = (where.id as { $in: readonly string[] }).$in.length;
  const at = { object: objectName, organizationId, ids };
  try {
    const count = affectedRowCount(await reown(where));
    if (count === undefined) {
      logger?.warn?.(
        `[org-scoping] claimOrgSeedOwnership could not read an affected-row count for ${objectName} ` +
          `in org ${organizationId}: the seeded rows were re-owned but this run cannot say how many`,
        at,
      );
      return 0;
    }
    return count;
  } catch (e) {
    logger?.warn?.(
      `[org-scoping] claimOrgSeedOwnership failed for ${objectName} in org ${organizationId}: ` +
        `the ${ids} seeded row(s) of this write stay owner-less`,
      { ...at, error: (e as Error).message },
    );
    return 0;
  }
}

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
 *   (d) have rows the org's seed replay landed on ({@link ClaimOwnershipOptions.seededRecordIds}),
 * and re-owns the org's unowned seeded rows as `isSystem` with
 * `skipAutomations`, in one predicate write per chunk of
 * {@link CLAIM_CHUNK_IDS} seeded ids. Returns a per-object summary whose
 * `count` is the sum of every write's affected-row count.
 */
export async function claimOrgSeedOwnership(
  ql: OrgScopingEngine,
  organizationId: string,
  ownerUserId: string,
  options: ClaimOwnershipOptions = {},
): Promise<{ object: string; count: number }[]> {
  const logger = options.logger;
  if (!organizationId || !ownerUserId) return [];
  if (!ql || typeof ql.update !== 'function') return [];
  const registry = ql.registry;
  if (!registry || typeof registry.getAllObjects !== 'function') {
    logger?.warn?.('[org-scoping] claimOrgSeedOwnership: registry unavailable');
    return [];
  }

  const schemas: ServiceObject[] = registry.getAllObjects();
  const results: { object: string; count: number }[] = [];
  const seededRecordIds = options.seededRecordIds;
  if (typeof seededRecordIds !== 'function') {
    // Said once, because "handed 0" and "could not name the seed's rows" are
    // different facts and only the first is silent.
    logger?.info?.(
      `[org-scoping] claimOrgSeedOwnership handed no row of org ${organizationId} to owner ${ownerUserId}: ` +
        'no seed host on this kernel publishes the rows its replay landed on, and an unowned row this ' +
        'claim cannot name as seeded keeps no owner (ADR-0138 D1)',
      { organizationId },
    );
    return results;
  }

  for (const schema of schemas) {
    if (!schema?.name) continue;
    if ((schema as any).managedBy) continue;
    if (schema.name.startsWith('sys_')) continue;
    // Both columns are required: owner_id to assign, organization_id to scope.
    if (!hasField(schema, 'owner_id') || !hasField(schema, 'organization_id')) continue;
    const seededIds = seededRecordIds(schema.name);
    if (seededIds.length === 0) continue;

    // Bound HERE, where `schema.name` is a literal argument at the call site:
    // `pnpm check:tenant-audit-census` records a write whose object argument is
    // a parameter as `undecidable`, so binding here keeps the census's row for
    // this file what it was.
    const reown = (where: Record<string, unknown>) => ql.update(
      schema.name,
      { owner_id: ownerUserId },
      { where, multi: true, context: CLAIM_WRITE_CTX },
    );

    let updated = 0;
    for (let at = 0; at < seededIds.length; at += CLAIM_CHUNK_IDS) {
      const where = {
        organization_id: organizationId,
        owner_id: null,
        id: { $in: seededIds.slice(at, at + CLAIM_CHUNK_IDS) },
      };
      updated += await claimChunk(reown, schema.name, organizationId, where, logger);
    }
    if (updated > 0) results.push({ object: schema.name, count: updated });
  }

  if (results.length > 0) {
    const total = results.reduce((s, r) => s + r.count, 0);
    logger?.info?.(`[org-scoping] handed ${total} seeded row(s) of org ${organizationId} to owner ${ownerUserId}`, {
      breakdown: results,
    });
  }
  return results;
}
