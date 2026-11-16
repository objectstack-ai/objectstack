// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34096] Materialise, at an install door's schema sync, the roll-up
 * `summary` fields a package install or upgrade added to objects whose rows
 * already exist.
 *
 * ## The hole
 *
 * A summary column is written by three paths (`summary-aggregate.ts`): the
 * insert-time seed (new rows only), the child-write recompute (a parent named
 * by a child write), and `os migrate summary-nulls` (an operator run). A
 * summary that an upgrade adds — HotCRM's o2c module adding `invoiced_amount`
 * to `crm_contract` through `objectExtensions` — reaches none of them for the
 * rows already stored: the schema sync adds the column, every existing parent
 * holds `NULL` there, and it stays `NULL` until one of its children is
 * written. A contract created after the upgrade reads `0` for the same empty
 * child set, so one logical state read two ways depending on when the row was
 * made.
 *
 * ## Materialise on the upgrade, not compute on read
 *
 * A value computed on read is not the stored column: every filter, sort,
 * GROUP BY and formula over it still reads `NULL` (the reason
 * `summary-backfill.ts` gives for recomputing rather than reading), and a read
 * path that aggregates per row pays the aggregate on every list read for ever.
 * The install door is the one moment that both knows a summary is new and has
 * just created its column, so the values are written there, through
 * {@link backfillSummaryNulls}: the same aggregate the engine's own recompute
 * uses, a system context with no tenant (every organization's rows), and the
 * engine's `update` verb on the parent. No child row is written. The parent
 * write carries `skipAutomations: true`, as the door's own seed writes do
 * (end-state data, not user events): no metadata-bound hook and no
 * record-change flow runs on a backfilled parent, while the engine's own
 * roll-up recompute still runs, so a parent that is itself a child of another
 * roll-up moves that roll-up too. Keyset pages of 500, bounded per object.
 *
 * ## Which summaries are new
 *
 * The engine records, when the boot completes (the plugin calls
 * {@link sealSummariesMaterialisedAtBoot} at `kernel:bootstrapped`, after the
 * install-local rehydrate at `kernel:ready`), the roll-ups it serves then:
 * those are the ones the stored rows were computed for. Every later
 * {@link materialiseSummariesAddedSinceBoot} — run by `ObjectQL.syncSchemas`,
 * the sync an install door asks for after its hot register — walks only the
 * roll-ups the engine serves now and has not recorded, then records them. So
 * a second upgrade that adds no roll-up reads and writes nothing, and a sync
 * before the boot completes (the rehydrate's) walks nothing.
 *
 * The walk names every new roll-up in `recomputeUndefinedOnEmpty` (#15064):
 * the door is the caller that KNOWS these columns were never computed, so a
 * new `min`/`max`/`avg` is recomputed on every `NULL` parent too. After it,
 * an empty child set reads what a new row reads: `0` for `count`/`sum` (their
 * empty-set value), `null` for `min`/`max`/`avg` (undefined on the empty set).
 *
 * ## A failed or interrupted walk
 *
 * The walk writes only rows still holding `NULL`, so it is idempotent. A row
 * that fails, an object that cannot be read, or a walk cut short by the
 * per-object bound leaves the walk incomplete: its roll-ups are NOT recorded,
 * so the next install door's sync walks them again and fills only what is
 * still `NULL`, and the incompleteness is logged at `error` with the operator
 * command that finishes it (`os migrate summary-nulls --apply`, naming each
 * roll-up). A process that dies mid-walk records nothing either, but its next
 * boot seals what it serves, so there the operator command is the re-run.
 */

import {
  backfillSummaryNulls,
  summaryBackfillComplete,
  type SummaryBackfillEngine,
  type SummaryBackfillReport,
} from './summary-backfill.js';

/** The engine surface the materialisation reads and writes through. `ObjectQL` is one. */
export interface SummaryMaterialiseEngine extends SummaryBackfillEngine {
  getConfigs(): Record<string, unknown>;
}

export interface SummaryMaterialiseLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error?(msg: string, meta?: unknown): void;
}

/** What one {@link materialiseSummariesAddedSinceBoot} did. */
export type SummaryMaterialiseOutcome =
  /** The boot has not completed: the roll-ups served now are the boot's own. */
  | { status: 'boot-not-complete' }
  /** No roll-up is served that the boot (or an earlier walk) did not record. */
  | { status: 'nothing-added' }
  /** The added roll-ups (`object.field`) were walked to completion and recorded. */
  | { status: 'materialised'; added: string[]; report: SummaryBackfillReport }
  /** The walk did not complete; the roll-ups stay unrecorded and the next sync walks them again. */
  | { status: 'incomplete'; added: string[]; report?: SummaryBackfillReport; error?: string };

/** Per engine: the roll-ups (`object.field`) the stored rows are known to be computed for. */
const recorded = new WeakMap<object, Set<string>>();
/** Per engine: the walk in progress, so two doors' syncs do not walk the same roll-ups twice at once. */
const inFlight = new WeakMap<object, Promise<unknown>>();

/** Every roll-up the engine serves now, as `object.field` → its parent object. */
function servedSummaries(engine: SummaryMaterialiseEngine): Map<string, string> {
  const served = new Map<string, string>();
  for (const object of Object.keys(engine.getConfigs())) {
    for (const desc of engine.getOwnedSummaryDescriptors(object)) {
      served.set(`${desc.parentObject}.${desc.summaryField}`, desc.parentObject);
    }
  }
  return served;
}

/**
 * Record the roll-ups the engine serves at the end of the boot as computed for
 * the stored rows. Called once per boot; a later call adds what is served then.
 * Returns how many roll-ups are recorded.
 */
export function sealSummariesMaterialisedAtBoot(engine: SummaryMaterialiseEngine): number {
  const set = recorded.get(engine) ?? new Set<string>();
  for (const key of servedSummaries(engine).keys()) set.add(key);
  recorded.set(engine, set);
  return set.size;
}

/** The incompleteness line: consequence and the command that finishes it. */
function incompleteMessage(added: string[], detail: string): string {
  const named = added.map((k) => `--recompute-undefined-on-empty ${k}`).join(' ');
  return (
    `[summary-materialise] the roll-up summary field(s) ${added.join(', ')} added by a package install or upgrade were ` +
    `NOT computed on every existing row (${detail}). CONSEQUENCE: those rows keep NULL there while a new row with the ` +
    `same children reads the computed value, and nothing else fills them until one of their children is written. ` +
    `FIX: clear the cause, then run \`os migrate summary-nulls --apply ${named}\` (idempotent: it fills only the rows ` +
    `still NULL); the next package install in this process also walks them again.`
  );
}

async function walkAdded(
  engine: SummaryMaterialiseEngine,
  logger: SummaryMaterialiseLogger,
): Promise<SummaryMaterialiseOutcome> {
  const set = recorded.get(engine);
  if (!set) return { status: 'boot-not-complete' };
  const served = servedSummaries(engine);
  const added = [...served.keys()].filter((key) => !set.has(key)).sort();
  if (added.length === 0) return { status: 'nothing-added' };
  const objects = [...new Set(added.map((key) => served.get(key)!))].sort();
  const say = (msg: string, meta: unknown) => {
    // Sanctioned logger shape (PR #9750): reach for `error`, fall back to `warn`.
    if (typeof logger.error === 'function') logger.error(msg, meta);
    else logger.warn(msg, meta);
  };
  let report: SummaryBackfillReport;
  try {
    report = await backfillSummaryNulls(engine, logger, {
      apply: true,
      objects,
      recomputeUndefinedOnEmpty: added,
      // The door's own writes are end-state data, not user events (its seed
      // owner stamp, the seed-loader rule): no metadata-bound hook or
      // record-change flow runs on a backfilled parent. The roll-up recompute
      // is the engine's, so a chained roll-up still moves.
      skipAutomations: true,
    });
  } catch (err) {
    const error = (err as Error)?.message ?? String(err);
    say(incompleteMessage(added, `the walk could not run: ${error}`), { added });
    return { status: 'incomplete', added, error };
  }
  if (!summaryBackfillComplete(report)) {
    const parts = [
      report.failures.length > 0
        ? `${report.failures.length} row(s) failed, e.g. ${report.failures.slice(0, 3).map((f) => `${f.object}/${f.recordId}: ${f.error}`).join('; ')}`
        : '',
      report.unreadableObjects.length > 0 ? `unreadable: ${report.unreadableObjects.join(', ')}` : '',
      report.truncated && report.unreadableObjects.length === 0 ? 'the walk reached its per-object bound' : '',
    ].filter(Boolean);
    say(incompleteMessage(added, parts.join('; ')), { added, failures: report.failures });
    return { status: 'incomplete', added, report };
  }
  for (const key of added) set.add(key);
  logger.info(
    `[summary-materialise] computed the roll-up summary field(s) ${added.join(', ')} added by a package install or ` +
      `upgrade on the existing rows: ${report.filled} value(s) written over ${report.scannedRecords} row(s).`,
    { added, filled: report.filled, scannedRecords: report.scannedRecords },
  );
  return { status: 'materialised', added, report };
}

/**
 * Walk the roll-ups the engine serves that the boot did not record (see the
 * module comment), filling every existing row still `NULL` there, and record
 * them once the walk completes. Never throws: an incomplete walk is logged at
 * `error` and reported. Serialised per engine.
 */
export function materialiseSummariesAddedSinceBoot(
  engine: SummaryMaterialiseEngine,
  logger: SummaryMaterialiseLogger,
): Promise<SummaryMaterialiseOutcome> {
  const previous = inFlight.get(engine) ?? Promise.resolve();
  const run = previous.then(() => walkAdded(engine, logger), () => walkAdded(engine, logger));
  inFlight.set(engine, run);
  return run;
}
