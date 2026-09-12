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
 * This helper runs right after `bootstrapPlatformAdmin` promotes the first human
 * user to platform admin, and transfers ownership of those orphan rows to that
 * admin. It is the ownership twin of org-scoping's `claimOrphanOrgRows` (which
 * back-fills `organization_id`): walk every user-authored object that declares
 * the canonical `owner_id` column, and re-own the rows that no human owns yet.
 *
 * ## ⚠️ It is NOT a single pass, and cannot be
 *
 * The promotion instant is not the moment the seed is done. `AppPlugin` races
 * its inline seed against `OS_INLINE_SEED_BUDGET_MS` (default 8 s) and continues
 * an over-budget bundle IN THE BACKGROUND so it does not block kernel start — so
 * for any non-trivial app the seeder is *guaranteed* to still be writing while a
 * promotion-time pass walks the registry. Registry order and seed order are
 * unrelated, so which objects a single pass misses is arbitrary, deterministic
 * per app, and permanent: nothing re-ran the claim, and the missed rows stayed
 * `owner_id IS NULL` forever — invisible to every `readScope: 'own'` grant and
 * answering 403 on every write at `modifyAllRecords: false`.
 *
 * A claim on admin promotion that races a seeder the platform itself deferred
 * cannot be correct as a single pass. `security-plugin.ts` therefore re-runs
 * this helper on `app:seeded` — the published settle signal for exactly that
 * background continuation — and every pass reports whether its own reading was
 * final ({@link reportClaimPass}).
 *
 * Mistake-proof by construction: authors write plain seed records (no
 * `owner_id`), and the platform — not the author — performs the handoff. There
 * is nothing to remember and nothing to mistype.
 *
 * Idempotent: only NULL / `usr_system`-owned rows are touched, so once a real
 * admin owns them a re-run is a no-op. `managedBy` and `sys_*` tables are
 * skipped (their ownership, if any, is platform-controlled).
 *
 * ## [#14530] PAGED predicate writes, never a write per row
 *
 * This used to scan each object twice at `limit: 10_000` and then issue one
 * **single-id** `update` per matched id — up to 20 000 writes for one object.
 * Every one of those is a full engine write (middleware chain, validation, hook
 * dispatch, driver round trip), and the batch existed only in this loop, where
 * nothing downstream could see it: plugin-sharing's `rule-hooks.ts` already
 * routes a write whose row set exceeds its recompute cap (1 000) into one
 * set-based revoke plus one queued `evaluateAllRulesForObject`, but that branch
 * reads ONE write's row set, and each of these writes legitimately carried a
 * single row. Batching in the caller is what lets machinery already built for
 * this shape do its job — with no change to `plugin-sharing`.
 *
 * The unit of work is now the SET, not the row: one predicate write per unowned
 * shape (`owner_id IS NULL`, then `owner_id = usr_system`), so the matched set
 * is the same set the old two-scan rule resolved — row for row — while the
 * write count stops scaling with N. The predicates stay two narrow writes rather
 * than one `OR`/`IN` for the reason the old scans were two (driver
 * portability), and they stay disjoint in this order, because the NULL pass
 * lands `adminUserId` — never `usr_system`, that target is refused at the top of
 * this function.
 *
 * ### …and a paged fallback, because one write cannot always carry the set
 *
 * A predicate write carries no `limit`, so "one write per object" is the whole
 * story right up until the object is large — and then it is refused on exactly
 * the objects that need it most. `beforeUpdate`/`afterUpdate` hooks are
 * contracted to fire PER MATCHED ROW on a predicate write (ADR-0058, bulk-write
 * addendum D6), so the engine refuses one **whole** — nothing written — above
 * {@link MAX_BULK_PER_ROW_HOOK_ROWS}; every object carries such hooks in
 * practice, since objectql's own audit-stamp builtin is registered on `'*'`.
 * Measured: 21 000 unowned rows re-owned **nothing at all**, where the
 * pre-#14530 loop re-owned 10 000 of them. This function decides `owner_id`,
 * which is a record-access field, so "the object was not claimed" is a
 * permission outcome, not an observability detail.
 *
 * So the refusal — a declared, total, nothing-written verdict whose own message
 * names pagination as the remedy — is answered by taking one page of ids off the
 * top ({@link CLAIM_PAGE_ROWS}) and trying the whole set again. Each page
 * shrinks what is left until one write can carry it, and the pass ends on a
 * whole-set write rather than on a count of pages.
 *
 * ⚠️ The order is not cosmetic. Paging unconditionally was measured 13× SLOWER
 * on the sizes every real install has: an `id IN (…)` page is evaluated by
 * `InMemoryDriver` as a linear scan of the id list PER ROW
 * (`memory-matcher.ts`, `target.includes(value)`), so a paged claim is
 * quadratic there, where the natural predicate is linear. 5 000 rows: 528 ms
 * whole-set versus 5 865 ms always-paged, same engine, same driver, same row
 * set. The page is therefore what the engine's refusal buys, not the default.
 *
 * The page size is derived from that ceiling rather than chosen: half of it
 * leaves room for a driver's own bound-parameter limits and for the ceiling
 * being the engine's answer to a different question, while staying well above
 * plugin-sharing's 1 000-row recompute cap — so a page is still large enough to
 * take the trailing-batch branch rather than N per-row recomputes.
 */

import type { ServiceObject } from '@objectstack/spec/data';
import { BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE, MAX_BULK_PER_ROW_HOOK_ROWS } from '@objectstack/spec/data';
import { SystemUserId } from '@objectstack/spec/system';
import type { SeedSettlementSnapshot } from '@objectstack/spec/contracts';

interface ClaimOwnershipOptions {
  logger?: {
    info: (message: string, meta?: Record<string, any>) => void;
    warn: (message: string, meta?: Record<string, any>) => void;
  };
  /**
   * The seed pipeline's tally at the moment this pass starts, read through the
   * published `seed-settlement` contract — `undefined` when no seed pipeline is
   * registered on this kernel.
   *
   * This is what makes the pass's own report FALSIFIABLE; see
   * {@link reportClaimPass} for why a pass that cannot say this is a detector
   * that reports success for the one failure it exists to catch.
   */
  seedSettlement?: SeedSettlementSnapshot | undefined;
}

const SYSTEM_CTX = { isSystem: true };

/**
 * Rows a single fallback page takes off the top of an over-ceiling predicate.
 *
 * Derived from the engine's per-row hook ceiling, never a free literal: that
 * ceiling is what refuses an over-sized predicate write, so the page size has to
 * move with it. Half of it is the margin — a driver's bound-parameter limit
 * applies to the `id IN (…)` list this sends, and the ceiling answers a question
 * about hook fan-out rather than about statement width. Still far above
 * plugin-sharing's 1 000-row recompute cap, so a full page is seen as a batch by
 * the trailing-batch branch instead of being recomputed row by row.
 */
const CLAIM_PAGE_ROWS = Math.floor(MAX_BULK_PER_ROW_HOOK_ROWS / 2);

/**
 * Fallback pages one predicate may take before this function gives up on it.
 *
 * Termination does not depend on this: a page that re-owns rows makes them stop
 * matching the predicate, so what is left strictly shrinks and reaches a size
 * one write can carry, and a page that re-owns none breaks out below. The belt
 * exists for the one shape that reasoning does not cover — a driver that reports
 * an affected count for rows it did not write — where the alternative is a boot
 * that never finishes. Hitting it is reported loudly, never silently.
 */
const MAX_CLAIM_PAGES = 1_000;

/**
 * Is this the engine's per-row hook budget refusal (ADR-0058 D6)?
 *
 * The code is imported from the contract that defines it rather than spelled
 * here, so a rename breaks the build instead of quietly turning the paged
 * fallback off — which would put this pass back to claiming NOTHING on exactly
 * the objects the fallback exists for. Every other failure is somebody else's
 * and is rethrown.
 */
function isPerRowHookBudgetRefusal(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE;
}

/**
 * "Unowned", as two driver-portable predicates rather than one `OR`/`IN`.
 *
 * Order is load-bearing: the NULL pass lands `adminUserId` — which cannot be
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
 * Ids from a `find` result.
 *
 * `ObjectQL.find` resolves a BARE array — driven against a real engine over a
 * real `SqlDriver` through this module's own paging fallback, the only path that
 * reaches here (`engine-find-bare-array.pin.test.ts`). It is driven rather than
 * read off `IDataEngine.find`'s declared `Promise<any[]>` because a declared
 * type is not proof: this repo also has a `find()` that resolves an envelope.
 * The `{ records }` limb this carried was dead.
 */
function idsFrom(rows: any): string[] {
  const list: any[] = Array.isArray(rows) ? rows : [];
  const out: string[] = [];
  for (const r of list) if (r?.id) out.push(String(r.id));
  return out;
}

/**
 * The two engine calls this pass makes on ONE object, already bound to it.
 *
 * Bound by the caller rather than reached through an `objectName` parameter, and
 * that is load-bearing beyond taste: `pnpm check:tenant-audit-census` reads
 * every engine write call site statically, and a write whose object argument is
 * a parameter is recorded `undecidable` — the census's word for "this pass no
 * longer says which table it writes". Spelling `schema.name` AT the call site
 * keeps the census's answer about this file exactly what it was before the
 * paging fallback existed, with no ledger row degraded to buy a green gate.
 */
interface ObjectWriter {
  /** Re-own every row a predicate matches; resolves the affected-row count. */
  reown: (predicate: Record<string, unknown>) => Promise<unknown>;
  /** At most one page of ids the predicate still matches. */
  readPage: (predicate: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Re-own every row matching one unowned predicate.
 *
 * One write for the whole set; a page off the top and another attempt whenever
 * the engine refuses that write for its per-row hook budget. Returns the SUM of
 * the affected-row counts every write in the pass resolved — never a length this
 * function counted for itself, and never just the last write's.
 */
async function claimPredicate(
  io: ObjectWriter,
  objectName: string,
  where: Record<string, unknown>,
  logger: ClaimOwnershipOptions['logger'],
): Promise<number> {
  const { reown, readPage } = io;
  let total = 0;
  for (let page = 0; page < MAX_CLAIM_PAGES; page += 1) {
    // The whole remaining set in ONE write — the shape this card is about, and
    // the one that runs on every install small enough for it (which is all of
    // them, in practice). No read at all on this path.
    try {
      const whole = affectedRowCount(await reown(where));
      if (whole === undefined) {
        logger?.warn?.(
          `[security] claimSeedOwnership could not read an affected-row count for ${objectName} ` +
            '— the rows were re-owned but this run cannot say how many',
          { object: objectName, where, page },
        );
        return total;
      }
      return total + whole;
    } catch (e) {
      if (!isPerRowHookBudgetRefusal(e)) throw e;
    }

    // Refused whole: more rows than one write may fan per-row hooks over.
    // Take a page off the top by id and try the whole set again — the remainder
    // shrinks by a page each time until a single write can carry it.
    const ids = idsFrom(await readPage(where));
    if (ids.length === 0) {
      // The write refused for being over the ceiling and the read found nothing
      // to page: the two disagree, so stop rather than retry the same pair.
      logger?.warn?.(
        `[security] claimSeedOwnership could not page ${objectName}: the write refused as ` +
          'over-sized but the predicate matched no rows to page; those rows stay unowned',
        { object: objectName, where, page },
      );
      return total;
    }

    const affected = await reown({ id: { $in: ids } });
    const count = affectedRowCount(affected);
    if (count === undefined) {
      // "Unknown", never "none": the page very likely WAS re-owned, so this
      // neither adds a number it cannot attest nor re-reads a predicate whose
      // state it does not know. What is already counted stays counted.
      logger?.warn?.(
        `[security] claimSeedOwnership could not read an affected-row count for ${objectName} ` +
          '— the page was re-owned but this run cannot say how many, and paging stops here',
        { object: objectName, where, page, result: typeof affected },
      );
      return total;
    }
    if (count === 0) {
      // The read found rows and the write moved none of them: a write-scoping
      // middleware narrowed the set to nothing. Re-reading the same predicate
      // would return the same page forever, so stop — loudly, because "we
      // could not claim these" is not the same as "there was nothing here".
      logger?.warn?.(
        `[security] claimSeedOwnership matched ${ids.length} unowned row(s) on ${objectName} ` +
          'but re-owned none of them; those rows stay unowned',
        { object: objectName, where, page, matched: ids.length },
      );
      return total;
    }
    total += count;
  }
  logger?.warn?.(
    `[security] claimSeedOwnership stopped after ${MAX_CLAIM_PAGES} fallback page(s) on ${objectName}; ` +
      'unowned rows may remain and the next run will claim them',
    { object: objectName, where, pages: MAX_CLAIM_PAGES },
  );
  return total;
}

/**
 * Say what this pass did AND whether its reading was FINAL — once, always.
 *
 * ## Why "claimed nothing" used to be unsayable
 *
 * This function used to report only when it had re-owned at least one row, so a
 * pass that walked every eligible object and matched nothing logged NOTHING at
 * all. That silence is the shape the ordering defect hid behind: the claim ran
 * while the platform's own seeder was still writing in the background
 * (`OS_INLINE_SEED_BUDGET_MS`), matched the rows that happened to have landed,
 * and the rows that had not yet landed were never seen by anything. Its own
 * failure paths — the per-object `claimSeedOwnership failed for …`, the paging
 * warnings, the affected-count warnings — cannot fire on that shape, because
 * from the claim's point of view there was simply nothing to match. So a boot
 * that left rows permanently ownerless and a boot with nothing to do produced
 * BYTE-IDENTICAL evidence, and the banner was clean either way.
 *
 * ## What makes the two distinguishable
 *
 * Not the count — "claimed 0 of 0" is the same number in both. The discriminator
 * is whether a seed source was still WRITING when the pass ran, which is exactly
 * what the published `seed-settlement` contract answers
 * ({@link SeedSettlementSnapshot}). It is the same distinction AGENTS.md's
 * startup-registry rule draws: reading a store that is still filling is fine,
 * but recording "there was nothing here" as a VERDICT, when the same boot can
 * still contradict it, is the defect.
 *
 * So every pass says which of three things it is:
 *
 *  - **provisional** (`inFlight > 0`) — a seed source is still writing, so this
 *    pass is a reading and not a verdict. Rows that land after it are NOT
 *    covered by it. `warn`, because at the moment the line is printed those rows
 *    are unowned and nothing else about the boot looks wrong; the re-run on
 *    `app:seeded` is a promise, not yet a fact.
 *  - **final** (`inFlight === 0`) — every source this boot writes has settled,
 *    so "nothing matched" really does mean "nothing to claim". `info`.
 *  - **unattested** (no snapshot) — no seed pipeline registered on this kernel,
 *    or a host too old to publish the contract. Reported as its own state rather
 *    than folded into either: a pass that cannot tell must not claim it can.
 *
 * ⚠️ `suppressed` sources deliberately never settle (multi-tenant replay,
 * `skipSeedData`) and are NOT counted as in-flight here: they write no rows
 * during this boot, so there is nothing for this pass to miss on their account.
 * Keying finality on `pending` instead would mark every multi-tenant boot
 * provisional forever — a permanent warning about behaviour that is correct by
 * design, which is how a log level gets trained away.
 *
 * The `handed N seeded record(s) to first admin X` prefix is unchanged and now
 * fires on every pass including `N = 0`: existing consumers match on it, and the
 * finality clause is appended rather than replacing it.
 */
function reportClaimPass(
  logger: ClaimOwnershipOptions['logger'],
  adminUserId: string,
  results: { object: string; count: number }[],
  eligibleObjects: number,
  seedSettlement: SeedSettlementSnapshot | undefined,
): void {
  const total = results.reduce((s, r) => s + r.count, 0);
  const head =
    `[security] handed ${total} seeded record(s) to first admin ${adminUserId} ` +
    `(${results.length} of ${eligibleObjects} eligible object(s) had unowned rows)`;
  const meta = {
    adminUserId,
    claimed: total,
    eligibleObjects,
    breakdown: results,
    seedInFlight: seedSettlement?.inFlight,
    seedSuppressed: seedSettlement?.suppressed,
  };

  if (seedSettlement && seedSettlement.inFlight > 0) {
    logger?.warn?.(
      `${head} — PROVISIONAL: ${seedSettlement.inFlight} seed source(s) were still writing when this ` +
        'pass ran, so rows seeded after it are NOT covered by it and stay unowned until the claim ' +
        're-runs on `app:seeded`. A count of 0 here is "nothing had landed yet", never "nothing to claim".',
      meta,
    );
    return;
  }
  if (!seedSettlement) {
    logger?.info?.(
      `${head} — unattested: no seed-settlement probe is registered on this kernel, so this pass ` +
        'cannot say whether a seed was still writing when it ran.',
      meta,
    );
    return;
  }
  logger?.info?.(
    `${head} — final: every seed source this boot writes has settled, so there was nothing left to claim.`,
    meta,
  );
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
 * {@link UNOWNED_PREDICATES} entry, paging that write only when the engine
 * refuses it for its per-row hook budget. Returns a per-object summary whose
 * `count` is the sum of every write's affected-row count.
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
  // Objects this pass actually WALKED, after the four skips below. Reported so
  // "claimed 0" can be read against the size of what was examined — a pass over
  // zero eligible objects and a pass over forty are different facts.
  let eligibleObjects = 0;

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
    eligibleObjects += 1;

    // Bound HERE, where `schema.name` is a literal argument at the call site —
    // see {@link ObjectWriter} for why that spelling is not incidental.
    const io: ObjectWriter = {
      reown: (predicate) => ql.update(
        schema.name,
        { owner_id: adminUserId },
        { where: predicate, multi: true, context: SYSTEM_CTX },
      ),
      readPage: (predicate) => ql.find(
        schema.name,
        { where: predicate, limit: CLAIM_PAGE_ROWS, fields: ['id'] },
        { context: SYSTEM_CTX },
      ),
    };

    let updated = 0;
    for (const where of UNOWNED_PREDICATES) {
      try {
        updated += await claimPredicate(io, schema.name, where, logger);
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

  reportClaimPass(logger, adminUserId, results, eligibleObjects, options.seedSettlement);
  return results;
}
