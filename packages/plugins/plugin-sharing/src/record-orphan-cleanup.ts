// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5103 / #5190] The record-existence cleanup primitives.
 *
 * Two tables in this package store "(`object_name`, `record_id`) → some
 * access": `sys_record_share` (principal-based grants) and `sys_share_link`
 * (capability tokens). Both have the SAME invariant — **record gone ⇒ the row
 * cannot describe any access at all** — and therefore the same two operations:
 *
 *  - a set-based revoke keyed on the ids a delete just removed, and
 *  - a sweep that asks, per row, whether its record still exists.
 *
 * #5103 built both for `sys_record_share`. #5190 needs them for
 * `sys_share_link`, and a second copy would be the fork this module exists to
 * prevent: one chunk size, one keyset walk, one "a failed probe deletes
 * NOTHING" rule, one truncation report. The tables' owning services keep their
 * own public methods (`SharingService.sweepOrphanedRecordShares`,
 * `ShareLinkService.sweepOrphanedShareLinks`) — `sys_share_link` is
 * `managedBy: 'engine-owned'` and its writes flow through `IShareLinkService`,
 * so ownership stays where the object declares it; only the mechanism is
 * shared.
 *
 * Nothing here knows what a share or a link MEANS. It knows a table name, an
 * `(object_name, record_id)` pair per row, and that deleting on an unanswered
 * question is the one thing it must never do.
 */

import { keysetWalk } from '@objectstack/types';

/** System-elevated context for the plugin's own queries / mutations. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** The slice of the engine these primitives need. */
export interface OrphanCleanupEngine {
  find(object: string, options?: any): Promise<any[]>;
  delete(object: string, options?: any): Promise<any>;
}

/**
 * [#5103] Ids per `$in`. Mirrors the chunk
 * `SharingRuleService.revokeRuleGrantsForRecords` already uses: a single
 * statement binding a thousand parameters is a portability trap (SQLite's
 * default `SQLITE_MAX_VARIABLE_NUMBER` is 999 on older builds), and one number
 * for every revoke path keeps them from drifting.
 */
export const RECORD_SCOPED_DELETE_CHUNK = 200;

/** [#5103] Rows read per page by an orphan sweep. */
export const ORPHAN_SWEEP_PAGE_SIZE = 500;

/**
 * [#5103] Rows one sweep will scan before stopping and reporting truncation.
 * The sweep runs on every boot, so it must cost a bounded amount on a table
 * that only grows; the next boot resumes from the start and the rows it did not
 * reach stay reachable by the object-scoped sweep. A cap is not a failure — but
 * an unreported cap turns a partial scan into a false "nothing to clean", which
 * is why {@link OrphanShareSweepResult} carries it.
 */
export const ORPHAN_SWEEP_MAX_ROWS = 50_000;

/** [#5103] Options for a record-existence orphan sweep. */
export interface OrphanShareSweepOptions {
  /** Restrict the sweep to one object. Default: every object with rows. */
  object?: string;
  /** Rows per page. Default {@link ORPHAN_SWEEP_PAGE_SIZE}. */
  batchSize?: number;
  /** Stop after scanning this many rows. Default {@link ORPHAN_SWEEP_MAX_ROWS}. */
  max?: number;
}

/** [#5103] What one orphan-sweep pass did. */
export interface OrphanShareSweepResult {
  /** Rows examined. */
  scanned: number;
  /** Rows revoked because their record no longer exists. */
  revoked: number;
  /**
   * Objects whose existence probe could not be run (unregistered object,
   * driver error). Their rows were LEFT ALONE — "could not ask" is not
   * "the record is gone", and only the second one may delete anything.
   */
  unresolvedObjects: string[];
  /** True when {@link OrphanShareSweepOptions.max} stopped the scan early. */
  truncated: boolean;
}

/**
 * Structural on purpose — it accepts both owning services' option shapes
 * (`SharingServiceOptions['logger']`, `ShareLinkServiceOptions['logger']`)
 * and a bare `{ warn }` stub in a test.
 *
 * `warn` is REQUIRED, and the members carry the same real signatures as the
 * producers that feed this parameter (#10692, ruled 2026-08-25). Every report
 * this module emits lands on `warn` — the "could not check", "stopped early"
 * and "revoked N rows" lines — so a logger without a guaranteed `warn` is one
 * this sweep can lose its ONLY output into: #9754's silence rule, one module
 * downstream of the producers #10556 tightened. Both owning services' `logger`
 * members require `warn` since PR #11856, so they stay assignable; what stops
 * compiling is a logger with no `warn`, which was never a useful argument
 * here. The bare-`Function` spelling this replaces documented no call shape
 * and could not tighten until those producers dropped bare `Function`
 * (`Function` is assignable to no concrete signature).
 *
 * Deliberately NO `error` member — adding one would enrol this sink in
 * `check:optional-error-sink`'s population (see `logger-shapes.ts`, "Why this
 * shape declares no `error`"). Requiredness is pinned in
 * `logger-required-warn.pin.ts`.
 */
interface MinimalLogger {
  info?: (msg: any, ...rest: any[]) => void;
  warn: (msg: any, ...rest: any[]) => void;
}

/** How one caller's rows are named in this module's log lines. */
export interface OrphanSweepSubject {
  /** Table to sweep, e.g. `sys_record_share`. */
  table: string;
  /** Noun for log messages: `share` → "orphan share sweep", "share rows". */
  noun: string;
  /** Issue reference appended to the "revoked N rows" warning. */
  issue: string;
}

/**
 * [#5103] Delete every row of `table` that belongs to records just deleted from
 * `object`.
 *
 * Set-based and chunked, so its cost tracks the number of ids, not the number
 * of rows. Returns nothing: counting would need a read the hot delete path
 * should not pay for, and callers that need a count (tests, the sweep) can read
 * the table.
 */
export async function deleteRowsForDeletedRecords(
  engine: OrphanCleanupEngine,
  table: string,
  object: string,
  recordIds: readonly string[],
): Promise<void> {
  if (!table || !object || recordIds.length === 0) return;
  for (let i = 0; i < recordIds.length; i += RECORD_SCOPED_DELETE_CHUNK) {
    const batch = recordIds.slice(i, i + RECORD_SCOPED_DELETE_CHUNK);
    await engine.delete(table, {
      where: { object_name: object, record_id: { $in: batch } },
      multi: true,
      context: SYSTEM_CTX,
    } as any);
  }
}

/**
 * [#5103] Which of `recordIds` still exist on `object`. Batched by
 * {@link RECORD_SCOPED_DELETE_CHUNK} so the `$in` never outgrows a driver's
 * bind-parameter limit. Throws on a query failure — the caller MUST treat that
 * as "unknown", never as "none of them exist".
 */
export async function findLiveRecordIds(
  engine: OrphanCleanupEngine,
  object: string,
  recordIds: readonly string[],
): Promise<Set<string>> {
  const live = new Set<string>();
  for (let i = 0; i < recordIds.length; i += RECORD_SCOPED_DELETE_CHUNK) {
    const batch = recordIds.slice(i, i + RECORD_SCOPED_DELETE_CHUNK);
    const rows = await engine.find(object, {
      where: { id: { $in: batch } },
      fields: ['id'],
      limit: batch.length,
      context: SYSTEM_CTX,
    });
    for (const row of (rows ?? [])) {
      if ((row as any)?.id != null) live.add(String((row as any).id));
    }
  }
  return live;
}

/** [#5103] Set-based delete of rows by id, chunked like the revoke. */
export async function deleteRowsByIds(
  engine: OrphanCleanupEngine,
  table: string,
  rowIds: readonly string[],
): Promise<void> {
  for (let i = 0; i < rowIds.length; i += RECORD_SCOPED_DELETE_CHUNK) {
    const batch = rowIds.slice(i, i + RECORD_SCOPED_DELETE_CHUNK);
    await engine.delete(table, {
      where: { id: { $in: batch } },
      multi: true,
      context: SYSTEM_CTX,
    } as any);
  }
}

/**
 * [#5103] Remove every row of `subject.table` whose RECORD no longer exists.
 *
 * The convergence half of the record-delete cascade, and the shape
 * `SharingRuleService.sweepOrphanedRuleGrants` (#4433) established — with a
 * different predicate, which is the whole point: that sweep asks "does the RULE
 * row still exist", so it can never see a manual share, nor a rule grant whose
 * rule is alive and whose record is not. This one asks "does the RECORD still
 * exist", which is the question the invariant is actually made of, and it is
 * source-agnostic (and, for `sys_share_link`, holder-agnostic).
 *
 * Two callers, one primitive:
 *  - `kernel:bootstrapped`, unscoped — historical orphans from before the
 *    cascade existed, plus anything a crashed hook missed, converge on the next
 *    boot;
 *  - the cascade's unbounded-delete branch, scoped to one object — a bulk
 *    delete whose row set could not be enumerated cannot name the ids to
 *    revoke, but the sweep does not need them: it reads the rows and asks about
 *    each record. This is deliberately NOT the rule path's "revoke everything on
 *    the object and re-grant asynchronously" — that trade is only available
 *    where a reconcile can put the grants back, and nothing can re-create a
 *    manual share or re-mint a link someone already holds.
 *
 * Bounded on both axes: rows are read by keyset page (never `OFFSET`, which
 * skips rows in a walk that deletes as it goes — #4363), the scan stops at
 * `max` and SAYS so, and existence is probed one batched `id IN (…)` per object
 * per page rather than one query per row.
 *
 * Fails SAFE per object: a probe that throws leaves that object's rows
 * untouched and is reported in `unresolvedObjects`. "Nothing was queried" is not
 * "nothing matched" — deleting on a failed probe would turn a transient driver
 * error into permanent access loss. (The RESOLVE path fails the other way, and
 * for the same reason: there, "cannot ask" must not grant. Both refuse to act on
 * an unanswered question; only the safe direction differs.)
 */
export async function sweepOrphanedRowsByRecordExistence(
  engine: OrphanCleanupEngine,
  subject: OrphanSweepSubject,
  options?: OrphanShareSweepOptions,
  logger?: MinimalLogger,
): Promise<OrphanShareSweepResult> {
  const result: OrphanShareSweepResult = {
    scanned: 0,
    revoked: 0,
    unresolvedObjects: [],
    truncated: false,
  };
  const unresolved = new Set<string>();
  const walk = keysetWalk<any>(
    (q) => engine.find(subject.table, {
      ...q,
      fields: ['id', 'object_name', 'record_id'],
      context: SYSTEM_CTX,
    }),
    {
      where: options?.object ? { object_name: options.object } : undefined,
      pageSize: Math.max(1, options?.batchSize ?? ORPHAN_SWEEP_PAGE_SIZE),
      max: options?.max ?? ORPHAN_SWEEP_MAX_ROWS,
    },
  );

  try {
    for await (const page of walk.pages()) {
      result.scanned += page.length;

      // Group the page by object so existence is one probe per object, not
      // one per row.
      const byObject = new Map<string, Map<string, string[]>>();
      for (const row of page) {
        const objectName = row?.object_name == null ? '' : String(row.object_name);
        const recordId = row?.record_id == null ? '' : String(row.record_id);
        const rowId = row?.id == null ? '' : String(row.id);
        if (!objectName || !recordId || !rowId) continue;
        const perRecord = byObject.get(objectName) ?? new Map<string, string[]>();
        const rowIds = perRecord.get(recordId) ?? [];
        rowIds.push(rowId);
        perRecord.set(recordId, rowIds);
        byObject.set(objectName, perRecord);
      }

      for (const [objectName, perRecord] of byObject) {
        if (unresolved.has(objectName)) continue;
        const recordIds = [...perRecord.keys()];
        let live: Set<string>;
        try {
          live = await findLiveRecordIds(engine, objectName, recordIds);
        } catch (err: any) {
          unresolved.add(objectName);
          logger?.warn?.(
            `[sharing] orphan ${subject.noun} sweep could not check whether records still exist — ` +
              `its ${subject.noun} rows were left in place (they are re-checked on the next sweep)`,
            { object: objectName, error: err?.message },
          );
          continue;
        }
        const orphanRowIds: string[] = [];
        for (const [recordId, rowIds] of perRecord) {
          if (live.has(recordId)) continue;
          orphanRowIds.push(...rowIds);
        }
        if (orphanRowIds.length === 0) continue;
        await deleteRowsByIds(engine, subject.table, orphanRowIds);
        result.revoked += orphanRowIds.length;
      }
    }
  } catch (err: any) {
    logger?.warn?.(
      `[sharing] orphan ${subject.noun} sweep stopped early — remaining rows are re-checked on the next sweep`,
      { object: options?.object, error: err?.message, scanned: result.scanned },
    );
    result.truncated = true;
  }

  result.unresolvedObjects = [...unresolved];
  result.truncated = result.truncated || walk.truncated;
  if (result.revoked > 0) {
    logger?.warn?.(
      `[sharing] revoked ${subject.noun} rows whose record no longer exists (${subject.issue})`,
      { rows: result.revoked, scanned: result.scanned, object: options?.object },
    );
  }
  return result;
}
