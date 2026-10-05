// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0093 D6 membership backfill runs ONCE per deployment, and the
 * deployment remembers that it ran.
 *
 * ## Why it must be one-time
 *
 * ADR-0093 D7 rules that membership is decided at CREATION: under the `auto`
 * policy a user is bound to the default organization when the user is created,
 * and "User leaves their only org — allowed … the invariant governs creation,
 * not the full lifecycle". The backfill exists for the users that predate the
 * reconciler — rows created before there was anything to bind them at
 * creation. It is not a lifecycle reconciler.
 *
 * Run on every `kernel:ready` and every `app:seeded`, it was one: a scan that
 * binds every member-less user cannot tell a user who predates the policy from
 * a user whose membership an administrator REMOVED, so every restart put the
 * removed member back. The pass therefore runs until it has reached a verdict
 * once, records that verdict in the deployment ledger, and every later pass
 * reads the record and does nothing.
 *
 * ## Why the record lives in `sys_migration`
 *
 * `sys_migration` is the deployment-level ledger that already answers "has
 * THIS deployment run this data migration" — one row per migration, written
 * against the `DataMigrationFlag` row contract in `@objectstack/spec/system`,
 * read-only over the API, provisioned by `PlatformObjectsPlugin` on every
 * served kernel. The seed/API tenancy repair in `metadata-protocol` writes its
 * receipt there from a boot hook for the same reasons; this module follows its
 * shape. The field reading:
 *
 *  - `verified_at: null` — the pass has no self-check; a timestamp would be a
 *    certificate nothing earned, and null is what `isDataMigrationFlagVerified`
 *    reads as "not verified", so no other id's gate can be reached by it;
 *  - `blocking: 0` — no consumer is held closed by this row;
 *  - `last_run_at` / `applied_at` / `details` — what the pass did.
 *
 * Every reader of the ledger reads one row by its id, so a new id cannot reach
 * another migration's gate.
 *
 * ## Which verdicts are recorded
 *
 * Recorded — the deployment has DECIDED, and a later pass must not decide
 * again:
 *  - the pass ran (policy `auto`, a default organization to bind to);
 *  - the policy was `invite-only`: users created under it were deliberately
 *    left unbound, so a later switch to `auto` must not sweep them in.
 *
 * Not recorded — nothing was decided yet, so a later pass still gets its turn:
 *  - no unambiguous target organization (single mode before the default
 *    organization exists; multi-org, where the backfill is refused by design);
 *  - an off-vocabulary policy value, or no usable engine.
 *
 * ## Failure directions
 *
 * Without a readable ledger the pass does NOT run: a pass that cannot be
 * recorded would run again on the next boot, which is exactly the re-binding
 * this module exists to stop. That is a functional absence (pre-existing
 * member-less users stay unbound until an administrator adds them) and is
 * reported at `warn`. A pass that ran but whose record failed to land is the
 * opposite case — nothing looks wrong, and the next boot silently repeats the
 * bulk bind — so it is reported at `error`, with the remedy.
 */

import { DATA_MIGRATION_FLAG_OBJECT, type DataMigrationFlag } from '@objectstack/spec/system';
import {
  backfillMemberships,
  type BackfillMembershipsResult,
  type ReconcileMembershipDeps,
} from './reconcile-membership.js';

/**
 * Ledger row id of the one-time membership backfill.
 *
 * Spelled here, not in `@objectstack/spec/system`: the writer and the only
 * reader are both this module, so publishing the id would declare a
 * cross-package coordination point that does not exist.
 */
export const MEMBERSHIP_BACKFILL_MIGRATION_ID = 'adr-0093-membership-backfill';

/** The engine surface the ledger needs, duck-typed. */
export interface MembershipBackfillLedger {
  getObject(name: string): unknown;
  findOne(object: string, options: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export type OneTimeMembershipBackfillStatus =
  /** The pass ran (or reached a recordable verdict) and its record landed. */
  | 'ran'
  /** The pass ran but its record did not land — the next boot repeats it. */
  | 'ran-unrecorded'
  /** The pass reached no verdict worth recording (see the module doc). */
  | 'undecided'
  /** The ledger already records a verdict — nothing was scanned or bound. */
  | 'already-run'
  /** No ledger on this kernel — the pass did not run. */
  | 'ledger-unavailable'
  /** The ledger could not be read — the pass did not run. */
  | 'ledger-unreadable';

export interface OneTimeMembershipBackfillResult {
  status: OneTimeMembershipBackfillStatus;
  /** The backfill's own summary, present whenever it was consulted. */
  backfill?: BackfillMembershipsResult;
}

interface LedgerLogger {
  info?: (msg: string, meta?: any) => void;
  warn: (msg: string, meta?: any) => void;
  error?: (msg: string, meta?: any) => void;
}

const SYSTEM_CTX = { isSystem: true };

function resolveLedger(engine: unknown): MembershipBackfillLedger | undefined {
  const candidate = engine as any;
  for (const method of ['getObject', 'findOne', 'insert']) {
    if (typeof candidate?.[method] !== 'function') return undefined;
  }
  return candidate as MembershipBackfillLedger;
}

/** Whether a backfill summary is a verdict the deployment should remember. */
function isRecordableVerdict(result: BackfillMembershipsResult): boolean {
  return result.reason === undefined || result.reason === 'policy';
}

/** The ledger row for one decided pass — pure. */
export function buildMembershipBackfillRecord(
  result: BackfillMembershipsResult,
  policy: unknown,
  now: string,
): DataMigrationFlag {
  return {
    id: MEMBERSHIP_BACKFILL_MIGRATION_ID,
    last_run_at: now,
    applied_at: now,
    verified_at: null,
    blocking: 0,
    details: JSON.stringify({
      policy: typeof policy === 'string' ? policy : String(policy),
      scanned: result.scanned,
      bound: result.bound,
      skipped: result.skipped,
      ...(result.reason ? { reason: result.reason } : {}),
    }),
  };
}

/**
 * Run the ADR-0093 D6 backfill unless this deployment has already decided it,
 * and record the verdict when it decides now. Never throws: it runs inside
 * boot hooks, which bookkeeping must not break.
 */
export async function runOneTimeMembershipBackfill(
  engine: unknown,
  deps: ReconcileMembershipDeps & { limit?: number },
  logger?: LedgerLogger,
): Promise<OneTimeMembershipBackfillResult> {
  const ledger = resolveLedger(engine);
  if (!ledger || !ledger.getObject(DATA_MIGRATION_FLAG_OBJECT)) {
    logger?.warn?.(
      `[auth] membership backfill did NOT run: the deployment ledger (${DATA_MIGRATION_FLAG_OBJECT}) is not ` +
        `available on this kernel, so a pass could not be recorded and would repeat on every boot, ` +
        `re-adding members an administrator removed. Pre-existing users without a membership stay ` +
        `unbound until an administrator adds them. Compose PlatformObjectsPlugin (it provisions the ledger) ` +
        `to let the one-time backfill run.`,
    );
    return { status: 'ledger-unavailable' };
  }

  let existing: Record<string, unknown> | null;
  try {
    existing = await ledger.findOne(DATA_MIGRATION_FLAG_OBJECT, {
      where: { id: MEMBERSHIP_BACKFILL_MIGRATION_ID },
      context: SYSTEM_CTX,
    });
  } catch (e: unknown) {
    logger?.warn?.(
      `[auth] membership backfill did NOT run: reading its record in ${DATA_MIGRATION_FLAG_OBJECT} failed, ` +
        `and running without knowing whether it already ran could re-add members an administrator removed. ` +
        `It is retried on the next boot.`,
      { error: e instanceof Error ? e.message : String(e) },
    );
    return { status: 'ledger-unreadable' };
  }
  if (existing?.id === MEMBERSHIP_BACKFILL_MIGRATION_ID) {
    return { status: 'already-run' };
  }

  const backfill = await backfillMemberships(engine, deps);
  if (!isRecordableVerdict(backfill)) {
    return { status: 'undecided', backfill };
  }

  const now = new Date().toISOString();
  const flag = buildMembershipBackfillRecord(backfill, deps.policy, now);
  try {
    await ledger.insert(
      DATA_MIGRATION_FLAG_OBJECT,
      { ...flag, created_at: now, updated_at: now },
      { context: SYSTEM_CTX },
    );
    logger?.info?.(
      `[auth] membership backfill recorded in ${DATA_MIGRATION_FLAG_OBJECT} (id '${MEMBERSHIP_BACKFILL_MIGRATION_ID}') ` +
        `— later boots will not run it again`,
      { id: MEMBERSHIP_BACKFILL_MIGRATION_ID, details: flag.details },
    );
    return { status: 'ran', backfill };
  } catch (e: unknown) {
    // A concurrent pass (another node of the same deployment) may have written
    // the row first — the primary key refuses the second insert. That is the
    // record landing, not failing.
    try {
      const raced = await ledger.findOne(DATA_MIGRATION_FLAG_OBJECT, {
        where: { id: MEMBERSHIP_BACKFILL_MIGRATION_ID },
        context: SYSTEM_CTX,
      });
      if (raced?.id === MEMBERSHIP_BACKFILL_MIGRATION_ID) return { status: 'ran', backfill };
    } catch {
      // Fall through to the loud report below — the record is unconfirmed.
    }
    // Inline, at `error`: the pass ran and every line reads clean, while the
    // record that stops the next boot from repeating the bulk bind is absent.
    const detail = e instanceof Error ? e.message : String(e);
    const message =
      `[auth] membership backfill ran, but recording it in ${DATA_MIGRATION_FLAG_OBJECT} failed (${detail}). ` +
      `The next boot will run it AGAIN and re-add every user without a membership to the default organization, ` +
      `including members an administrator removed since. Fix: make ${DATA_MIGRATION_FLAG_OBJECT} writable on this ` +
      `deployment (it is provisioned by PlatformObjectsPlugin) and verify with ` +
      `SELECT * FROM ${DATA_MIGRATION_FLAG_OBJECT} WHERE id = '${MEMBERSHIP_BACKFILL_MIGRATION_ID}'.`;
    if (logger?.error) logger.error(message, { error: detail });
    else logger?.warn?.(message, { error: detail });
    return { status: 'ran-unrecorded', backfill };
  }
}
