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
 * per chunk of {@link CLAIM_PAGE_ROWS} ids. It is the selector its single-tenant
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
 * ## [#23054] PAGED predicate writes, until no owner-less row is left
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
 * It now takes the shape its single-tenant twin `claimSeedOwnership` took in
 * #14530 and #14719, measured to fit here before it was adopted (the doors are
 * the two `OrgScopingEngine` already names, and the engine carries
 * `skipAutomations` onto every per-row context of a predicate write):
 *
 *  - **One predicate write for the whole set.** `owner_id = ownerUserId` where
 *    `{ organization_id: organizationId, owner_id: null, id: { $in: chunk } }`,
 *    as `multi: true` — one write per chunk of {@link CLAIM_PAGE_ROWS} seeded
 *    ids (#23354; see "Only the rows the org's seed replay wrote" above). The
 *    predicate is the claim's whole selection rule, so the write matches
 *    exactly the rows it selects, without a read and without a cap. That is the
 *    path every organization takes in practice, and it issues no read at all.
 *  - **A page off the top when the engine refuses that write.** A predicate
 *    write fires `beforeUpdate`/`afterUpdate` per matched row (ADR-0058,
 *    bulk-write addendum D6), and above {@link MAX_BULK_PER_ROW_HOOK_ROWS}
 *    matched rows the engine refuses it WHOLE, nothing written. Every object
 *    carries such hooks in practice (objectql's own audit stamp is registered
 *    on `'*'`, and `skipAutomations` leaves code-registered hooks running), so
 *    an object past the ceiling is refused on exactly the size this card is
 *    about. The refusal is answered by reading one page of ids
 *    ({@link CLAIM_PAGE_ROWS}) and re-owning that page, then trying the whole
 *    set again; each page shrinks what is left until one write carries it.
 *
 * The page write keeps the whole predicate and narrows its `id IN` to the page
 * (a subset of the chunk the page was read under), rather than writing the
 * page by id alone as the twin does: between the page
 * read and its write a row can be claimed by someone else, and this function's
 * two promises are "only owner-less rows" and "only this organization's rows".
 * A page write narrowed to nothing by that race re-owns 0 rows, which stops the
 * pass loudly rather than re-reading the same page forever.
 *
 * `count` in the result is the SUM of the affected-row counts every write
 * resolved, never a length this function counted for itself.
 *
 * ⚠️ The unit of failure moved from the row to the write. A per-id loop lost
 * only the row whose write threw; a predicate write that a hook or a
 * validation rule refuses writes nothing, so the whole object (or the page)
 * stays owner-less and the warning says so. The twin made the same trade.
 */

import type { ServiceObject } from '@objectstack/spec/data';
import { BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE, MAX_BULK_PER_ROW_HOOK_ROWS } from '@objectstack/spec/data';

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
 * The context of the claim's page READ (`readPage`, the over-ceiling fallback
 * only): system-elevated, nothing more.
 *
 * The flag stays off the read on purpose. A read starts no record-change flow,
 * and a metadata-bound `beforeFind` hook is an app's read-filter seam: keeping
 * it in force keeps a page equal to what every other system read of that
 * object sees. The selection itself is the WRITE's predicate, so a page only
 * decides which rows go first, never which rows are claimed.
 */
const SYSTEM_CTX = { isSystem: true };

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
 * A plain literal, like {@link SYSTEM_CTX}: `pnpm check:tenant-audit-census`
 * reads `isSystem` off it statically and does not see through a `satisfies`
 * wrapper.
 *
 * It does not move the per-row hook ceiling: the engine counts the matched rows
 * whenever ANY hook covers the object, without consulting the flag, and
 * code-registered hooks still run per row under it.
 */
const CLAIM_WRITE_CTX = { isSystem: true, skipAutomations: true };

/**
 * Rows one fallback page takes off the top of an over-ceiling predicate.
 *
 * Derived from the engine's per-row hook ceiling, never a free literal, so it
 * moves with the number that refuses the whole-set write. Half of it is the
 * margin the twin measured: the page write sends an `id IN (…)` list, and a
 * driver's bound-parameter limit is a question about statement width, not
 * hook fan-out.
 */
const CLAIM_PAGE_ROWS = Math.floor(MAX_BULK_PER_ROW_HOOK_ROWS / 2);

/**
 * Fallback pages one object may take before this function gives up on it.
 *
 * Termination does not depend on this: a page that re-owns rows makes them stop
 * matching the predicate, so what is left strictly shrinks, and a page that
 * re-owns none stops the pass. The belt is for a driver that reports an
 * affected count for rows it did not write, where the alternative is a
 * bootstrap that never finishes. Hitting it is reported, never silent.
 */
const MAX_CLAIM_PAGES = 1_000;

/**
 * Is this the engine's per-row hook budget refusal (ADR-0058 D6)?
 *
 * The code is imported from the contract that defines it, so a rename breaks
 * the build instead of quietly turning the paged fallback off. Every other
 * failure is somebody else's and is rethrown.
 */
function isPerRowHookBudgetRefusal(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE;
}

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

/** Ids from a `find` result: `ObjectQL.find` resolves a bare array. */
function idsFrom(rows: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(rows)) return out;
  for (const r of rows) if (r?.id) out.push(String(r.id));
  return out;
}

/**
 * The two engine calls the claim makes on ONE object, already bound to it.
 *
 * Bound by the caller, where `schema.name` is a literal argument at the call
 * site: `pnpm check:tenant-audit-census` records a write whose object argument
 * is a parameter as `undecidable`, so binding here keeps the census's row for
 * this file what it was.
 */
interface ObjectClaimIo {
  /** Re-own every row `where` matches, under {@link CLAIM_WRITE_CTX}; resolves the affected-row count. */
  reown: (where: Record<string, unknown>) => Promise<unknown>;
  /** At most one page of ids the claim's predicate `where` still matches. */
  readPage: (where: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Re-own every row `unowned` matches: one write for the whole set, and a page
 * off the top whenever the engine refuses that write for its per-row hook
 * budget. Returns the sum of the affected-row counts every write resolved.
 *
 * Never throws. Best-effort per object, as the per-id loop was: an object that
 * cannot be claimed must not cost any later object its claim, and the pages it
 * already re-owned stay counted, because those rows WERE written.
 */
async function claimUnowned(
  io: ObjectClaimIo,
  objectName: string,
  organizationId: string,
  unowned: Record<string, unknown>,
  logger: ClaimOwnershipOptions['logger'],
): Promise<number> {
  const at = { object: objectName, organizationId };
  let total = 0;
  try {
    for (let page = 0; page < MAX_CLAIM_PAGES; page += 1) {
      try {
        const whole = affectedRowCount(await io.reown(unowned));
        if (whole === undefined) {
          logger?.warn?.(
            `[org-scoping] claimOrgSeedOwnership could not read an affected-row count for ${objectName} ` +
              `in org ${organizationId}: the rows were re-owned but this run cannot say how many`,
            { ...at, page },
          );
          return total;
        }
        return total + whole;
      } catch (e) {
        if (!isPerRowHookBudgetRefusal(e)) throw e;
      }

      // Refused whole: more rows than one write may fan per-row hooks over.
      const ids = idsFrom(await io.readPage(unowned));
      if (ids.length === 0) {
        logger?.warn?.(
          `[org-scoping] claimOrgSeedOwnership could not page ${objectName} in org ${organizationId}: the write ` +
            'was refused as over-sized but the read found no owner-less row to page; those rows stay owner-less',
          { ...at, page },
        );
        return total;
      }

      const count = affectedRowCount(await io.reown({ ...unowned, id: { $in: ids } }));
      if (count === undefined) {
        logger?.warn?.(
          `[org-scoping] claimOrgSeedOwnership could not read an affected-row count for a page of ${objectName} ` +
            `in org ${organizationId}: the page was re-owned but this run cannot say how many, and paging stops here`,
          { ...at, page },
        );
        return total;
      }
      if (count === 0) {
        // The read found rows and the write moved none of them. Reading the
        // same predicate again would return the same page forever, so stop,
        // loudly: "could not claim these" is not "there was nothing here".
        logger?.warn?.(
          `[org-scoping] claimOrgSeedOwnership read ${ids.length} owner-less row(s) of ${objectName} ` +
            `in org ${organizationId} but re-owned none of them; those rows stay owner-less`,
          { ...at, page, matched: ids.length },
        );
        return total;
      }
      total += count;
    }
    logger?.warn?.(
      `[org-scoping] claimOrgSeedOwnership stopped after ${MAX_CLAIM_PAGES} page(s) on ${objectName} ` +
        `in org ${organizationId}; owner-less rows may remain`,
      { ...at, pages: MAX_CLAIM_PAGES },
    );
    return total;
  } catch (e) {
    logger?.warn?.(
      `[org-scoping] claimOrgSeedOwnership failed for ${objectName} in org ${organizationId} after ` +
        `re-owning ${total} row(s); its remaining owner-less rows stay owner-less`,
      { ...at, claimed: total, error: (e as Error).message },
    );
    return total;
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
 * `skipAutomations`, in one predicate write per chunk of seeded ids, paging
 * that write only when the engine refuses it for its per-row hook budget.
 * Returns a per-object summary whose `count` is the sum of every write's
 * affected-row count.
 */
export async function claimOrgSeedOwnership(
  ql: OrgScopingEngine,
  organizationId: string,
  ownerUserId: string,
  options: ClaimOwnershipOptions = {},
): Promise<{ object: string; count: number }[]> {
  const logger = options.logger;
  if (!organizationId || !ownerUserId) return [];
  if (!ql || typeof ql.update !== 'function' || typeof ql.find !== 'function') return [];
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

    // Bound HERE, where `schema.name` is a literal argument at the call site;
    // see {@link ObjectClaimIo}.
    const io: ObjectClaimIo = {
      reown: (where) => ql.update(
        schema.name,
        { owner_id: ownerUserId },
        { where, multi: true, context: CLAIM_WRITE_CTX },
      ),
      readPage: (where) => ql.find(
        schema.name,
        { where, limit: CLAIM_PAGE_ROWS, fields: ['id'] },
        { context: SYSTEM_CTX },
      ),
    };

    let updated = 0;
    for (let at = 0; at < seededIds.length; at += CLAIM_PAGE_ROWS) {
      const unowned = {
        organization_id: organizationId,
        owner_id: null,
        id: { $in: seededIds.slice(at, at + CLAIM_PAGE_ROWS) },
      };
      updated += await claimUnowned(io, schema.name, organizationId, unowned, logger);
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
