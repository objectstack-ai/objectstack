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
 * A scan that binds every member-less user cannot tell a user who predates
 * the policy from a user whose membership was decided at creation and has
 * since changed, so the scan may only ever run before any such decision
 * exists. The pass therefore runs until it has reached a verdict once,
 * records that verdict in the deployment ledger, and every later pass reads
 * the record and does nothing.
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
 *    left unbound, so a later switch to `auto` must not sweep them in;
 *  - no unambiguous target organization while organizations DO exist
 *    (multi-org, where the backfill is refused by design).
 *
 * Not recorded — nothing was decided yet, so a later pass still gets its turn:
 *  - no target organization and no organization at all (a fresh install
 *    before its default organization exists);
 *  - a scan that could not read the user or membership table in full;
 *  - an off-vocabulary policy value, or no usable engine.
 *
 * The same ledger also records the one-time default-organization owner bind
 * ({@link DEFAULT_ORG_OWNER_BIND_MIGRATION_ID}), through the same helpers.
 *
 * ## Failure directions
 *
 * Without a readable ledger the pass does NOT run: a pass that cannot be
 * recorded would run again on the next boot and judge users whose
 * membership was already decided. That is a functional absence (pre-existing
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

/**
 * Ledger row id of the one-time default-organization owner bind: the platform
 * admin is bound as owner of the default organization once, when the
 * bootstrap first decides it, and never again automatically (ADR-0093 D7).
 */
export const DEFAULT_ORG_OWNER_BIND_MIGRATION_ID = 'adr-0093-default-org-owner-bind';

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

export interface LedgerLogger {
  info?: (msg: string, meta?: any) => void;
  warn: (msg: string, meta?: any) => void;
  error?: (msg: string, meta?: any) => void;
}

/** What the ledger says about one decision id. */
export type LedgerDecisionReading = 'recorded' | 'absent' | 'unavailable' | 'unreadable';

const SYSTEM_CTX = { isSystem: true };

function resolveLedger(engine: unknown): MembershipBackfillLedger | undefined {
  const candidate = engine as any;
  for (const method of ['getObject', 'findOne', 'insert']) {
    if (typeof candidate?.[method] !== 'function') return undefined;
  }
  return candidate as MembershipBackfillLedger;
}

/**
 * Read whether the deployment ledger records decision `id`. Never throws:
 * `unavailable` (no ledger on this kernel) and `unreadable` (the read failed)
 * are answers the caller must handle, never "absent".
 */
export async function readLedgerDecision(engine: unknown, id: string): Promise<LedgerDecisionReading> {
  const ledger = resolveLedger(engine);
  try {
    if (!ledger || !ledger.getObject(DATA_MIGRATION_FLAG_OBJECT)) return 'unavailable';
    const row = await ledger.findOne(DATA_MIGRATION_FLAG_OBJECT, { where: { id }, context: SYSTEM_CTX });
    return row?.id === id ? 'recorded' : 'absent';
  } catch {
    return 'unreadable';
  }
}

/** The ledger row for one recorded decision — pure. */
export function buildLedgerDecisionRecord(id: string, details: Record<string, unknown>, now: string): DataMigrationFlag {
  return {
    id,
    last_run_at: now,
    applied_at: now,
    verified_at: null,
    blocking: 0,
    details: JSON.stringify(details),
  };
}

/** The ledger row for one decided backfill pass — pure. */
export function buildMembershipBackfillRecord(
  result: BackfillMembershipsResult,
  policy: unknown,
  now: string,
): DataMigrationFlag {
  return buildLedgerDecisionRecord(
    MEMBERSHIP_BACKFILL_MIGRATION_ID,
    {
      policy: typeof policy === 'string' ? policy : String(policy),
      scanned: result.scanned,
      bound: result.bound,
      skipped: result.skipped,
      ...(result.reason ? { reason: result.reason } : {}),
    },
    now,
  );
}

/**
 * Insert one decision row. THROWS on failure — the caller decides what a lost
 * record means. Named in `DURABILITY_CRITICAL_CALLEES`
 * (`scripts/check-durability-degradation-log-level.mjs`): a lost record leaves
 * every log line clean while the next boot decides again.
 */
async function persistLedgerDecisionRow(ledger: MembershipBackfillLedger, flag: DataMigrationFlag): Promise<void> {
  const now = flag.last_run_at;
  await ledger.insert(
    DATA_MIGRATION_FLAG_OBJECT,
    { ...flag, created_at: now, updated_at: now },
    { context: SYSTEM_CTX },
  );
}

/**
 * Record decision `flag` in the ledger. Never throws. A concurrent writer that
 * landed the same id first counts as recorded; any other failure is reported
 * at `error` (nothing else looks wrong, and the next boot decides again).
 */
export async function recordLedgerDecision(
  engine: unknown,
  flag: DataMigrationFlag,
  what: string,
  logger?: LedgerLogger,
): Promise<boolean> {
  const ledger = resolveLedger(engine);
  if (!ledger) return false;
  try {
    await persistLedgerDecisionRow(ledger, flag);
    logger?.info?.(
      `[auth] ${what} recorded in ${DATA_MIGRATION_FLAG_OBJECT} (id '${flag.id}') — later boots will not decide it again`,
      { id: flag.id, details: flag.details },
    );
    return true;
  } catch (e: unknown) {
    if ((await readLedgerDecision(engine, flag.id)) === 'recorded') return true;
    // Inline, at `error`: the decision was acted on and every line reads
    // clean, while the record that stops the next boot from deciding again is
    // absent.
    const detail = e instanceof Error ? e.message : String(e);
    const message =
      `[auth] ${what} was carried out, but recording it in ${DATA_MIGRATION_FLAG_OBJECT} failed (${detail}). ` +
      `The next boot will decide it AGAIN, re-deciding membership for users whose membership was already ` +
      `decided. Fix: make ${DATA_MIGRATION_FLAG_OBJECT} writable on this deployment (it is provisioned by ` +
      `PlatformObjectsPlugin) and verify with SELECT * FROM ${DATA_MIGRATION_FLAG_OBJECT} WHERE id = '${flag.id}'.`;
    if (logger?.error) logger.error(message, { error: detail });
    else logger?.warn?.(message, { error: detail });
    return false;
  }
}

/** Whether any organization exists — `undefined` when that cannot be read. */
async function anyOrganizationExists(engine: any): Promise<boolean | undefined> {
  try {
    if (typeof engine?.count === 'function') {
      const n = await engine.count('sys_organization', { where: {}, context: SYSTEM_CTX });
      if (typeof n === 'number') return n > 0;
    }
    if (typeof engine?.find !== 'function') return undefined;
    const rows = await engine.find(
      'sys_organization',
      { where: {}, orderBy: [{ field: 'id', order: 'asc' }], limit: 1 },
      { context: SYSTEM_CTX },
    );
    return Array.isArray(rows) ? rows.length > 0 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a backfill summary is a verdict the deployment should remember.
 *
 * `no-target-org` is deferred ONLY while the deployment holds no organization
 * at all (a fresh install before its default organization exists). With
 * organizations present and still no unambiguous target — multi-org, where
 * the backfill is refused by design — the refusal IS the decision, and it is
 * recorded so a later pass cannot reverse it.
 */
async function isRecordableVerdict(engine: unknown, result: BackfillMembershipsResult): Promise<boolean> {
  if (result.reason === undefined || result.reason === 'policy') return true;
  if (result.reason === 'no-target-org') return (await anyOrganizationExists(engine)) === true;
  return false;
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
  const reading = await readLedgerDecision(engine, MEMBERSHIP_BACKFILL_MIGRATION_ID);
  if (reading === 'unavailable') {
    logger?.warn?.(
      `[auth] membership backfill did NOT run: the deployment ledger (${DATA_MIGRATION_FLAG_OBJECT}) is not ` +
        `available on this kernel, so a pass could not be recorded and would repeat on every boot, ` +
        `re-deciding membership for users whose membership was already decided. Pre-existing users without ` +
        `a membership stay unbound until an administrator adds them. Compose PlatformObjectsPlugin (it ` +
        `provisions the ledger) to let the one-time backfill run.`,
    );
    return { status: 'ledger-unavailable' };
  }
  if (reading === 'unreadable') {
    logger?.warn?.(
      `[auth] membership backfill did NOT run: reading its record in ${DATA_MIGRATION_FLAG_OBJECT} failed, ` +
        `and running without knowing whether it already ran could re-decide membership for users whose ` +
        `membership was already decided. It is retried on the next boot.`,
    );
    return { status: 'ledger-unreadable' };
  }
  if (reading === 'recorded') return { status: 'already-run' };

  const backfill = await backfillMemberships(engine, deps);
  if (!(await isRecordableVerdict(engine, backfill))) {
    return { status: 'undecided', backfill };
  }

  const flag = buildMembershipBackfillRecord(backfill, deps.policy, new Date().toISOString());
  const recorded = await recordLedgerDecision(engine, flag, 'membership backfill', logger);
  return { status: recorded ? 'ran' : 'ran-unrecorded', backfill };
}
