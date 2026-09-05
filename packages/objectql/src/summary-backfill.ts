// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one-off backfill of roll-up `count`/`sum` columns left `NULL` by inserts
 * that predate PR #6013 — `os migrate summary-nulls` (#6063, the second half of
 * #5749).
 *
 * ## The hole this fills
 *
 * PR #6013 seeds a roll-up's empty-set value at PARENT INSERT time, so from
 * that release on a `count`/`sum` column starts at 0 and only ever moves to
 * another number. It is a producer-side fix and therefore reaches new rows
 * only: `ObjectQL.initializeSummaryFields` is create-time, and the recompute
 * that would otherwise correct a stored `NULL` visits a parent only when one of
 * its CHILDREN is written. A parent stored before the upgrade that has never
 * had a child is named by neither path, so it keeps its `NULL` indefinitely —
 * and `filter ["task_count", "=", 0]`, `ORDER BY`, `GROUP BY` and every formula
 * reading the column silently drop it (null propagation). A re-seeded database
 * is correct; an IN-PLACE upgraded one is not. That asymmetry is what this run
 * removes, once.
 *
 * ## Why per-row recompute and not `SET col = 0 WHERE col IS NULL`
 *
 * The cheap `UPDATE` is not merely coarse, it is **wrong**: a pre-upgrade
 * parent that DOES have children is `NULL` too — nothing ever recomputed it —
 * and its correct value is the real aggregate, not 0. Writing 0 there would
 * replace a visibly-missing value with a confidently-wrong one, and the next
 * child write would silently change it back. So every `NULL` row is recomputed
 * through {@link aggregateSummaryValue} — the identical computation the engine's
 * own child-write recompute uses, over the identical descriptors the engine
 * maintains (maintainer ruling on #6063, 2026-08-07).
 *
 * ## Scope: `count`/`sum` by default
 *
 * A `NULL` `min`/`max`/`avg` is the LEGITIMATE reading of "no child rows" —
 * those aggregates are undefined on the empty set, which is exactly why #6013
 * leaves them `null` at insert. They are not a defect and are not written
 * here unless the caller says otherwise; {@link summaryNullIsBackfillable} is
 * the single predicate, derived from the same empty-set list.
 *
 * ## …and, on request, a column the caller KNOWS was never computed (#15064)
 *
 * That predicate decides on the FUNCTION alone, so it cannot tell apart two
 * states that are identical in storage: a `null` `max` meaning "no child rows",
 * and a `null` `max` on a column declared AFTER its parent rows already existed
 * — which nothing has ever computed (the insert-time seed is create-time, the
 * recompute visits a parent only on a child write, and this run skipped the
 * function). The narrowing is right for the hole it was written for; the defect
 * was that the one caller holding the fact "this column is new" — the publish
 * path that just declared it — had no way to say so. `recomputeUndefinedOnEmpty`
 * names such roll-ups (`object.field`): a named `min`/`max`/`avg` is walked like
 * a `count`, and every `NULL` parent is recomputed through the SAME
 * {@link aggregateSummaryValue}. A parent whose aggregate comes back as the
 * empty-set reading (`null` — no child rows) already holds the value the engine
 * would write, so it is neither counted as a hole nor written; one whose
 * aggregate is defined is filled. Unnamed, the run is exactly what it was, and
 * `os migrate summary-nulls` keeps its meaning on every deployment (maintainer
 * ruling on #15064, 2026-09-05: a caller-supplied scope, not a relaxed
 * predicate). A name that resolves to no roll-up this run walks is REFUSED
 * before any row is read: the caller's fact could not be acted on, and a silent
 * no-op there is exactly the false all-clear #15064 was filed over.
 *
 * ## Driver-agnostic, and no `IS NULL` pushdown
 *
 * The walk reads `id` + the roll-up columns and tests `== null` in JS. It does
 * NOT push a null predicate down to the driver: null-comparison compilation is
 * exactly where drivers diverge (`sql-driver-null-operators.test.ts`,
 * `sql-driver-out-of-contract-filter-input.test.ts`), and a migration whose
 * coverage depends on which driver it happens to run against is a migration
 * that silently skips rows. Reading the value and testing it in JS is the one
 * form that means the same thing everywhere (#6063 ruling 3).
 *
 * ## Idempotent
 *
 * Every write turns a `NULL` into a number, so the second run's walk finds no
 * `NULL` rows and writes nothing. A partially-completed run is safe to repeat,
 * and "re-run until it reports zero" is the operator's own verification. The
 * same holds under `recomputeUndefinedOnEmpty`: a childless parent's `null`
 * `max` is re-examined and re-confirmed on every run, never counted or written,
 * so a scoped re-run reports zero too.
 */

import { keysetWalk, type KeysetPageQuery } from '@objectstack/types';
import { withTransientRetry, type RetryOptions } from '@objectstack/core';

import {
  aggregateSummaryValue,
  summaryNullIsBackfillable,
  type SummaryDescriptor,
} from './summary-aggregate.js';

/** Roll-up column examined by one run, with what the run did to it. */
export interface SummaryBackfillFieldOutcome {
  object: string;
  field: string;
  /** `min`/`max`/`avg` appear here only when named in
   *  `recomputeUndefinedOnEmpty` (#15064); an unscoped run lists `count`/`sum`. */
  fn: SummaryDescriptor['fn'];
  /** The child object aggregated — so a report names the whole relationship. */
  childObject: string;
  /** Parent rows found holding `NULL` in this column that this run fills. For a
   *  `min`/`max`/`avg` named in `recomputeUndefinedOnEmpty`, a `NULL` whose
   *  recompute is the empty-set reading (`null`) is not a hole and is not
   *  counted — the row already holds the engine's own value. */
  nullRows: number;
  /** Of those, the ones whose recomputed value is a real aggregate (> 0 rows
   *  of children) — the rows a `SET col = 0` shortcut would have corrupted. A
   *  defined `min`/`max`/`avg` implies a child row, so under the scope every
   *  counted row is one of these. */
  nonEmpty: number;
  /** Values written (equal to `nullRows` on an apply run with no failures;
   *  always 0 on a dry run — a dry run writes nothing). */
  filled: number;
  /** A few affected record ids, so an operator can go and look. */
  sampleRecordIds: string[];
}

/** One parent row whose recompute could not be completed. */
export interface SummaryBackfillFailure {
  object: string;
  field: string;
  recordId: string;
  error: string;
}

export interface SummaryBackfillReport {
  /** Objects walked — those owning at least one backfillable roll-up column. */
  scannedObjects: string[];
  scannedRecords: number;
  fields: SummaryBackfillFieldOutcome[];
  /** Parent rows found holding `NULL` in a `count`/`sum` roll-up. */
  nullRows: number;
  /** Values actually written (0 on a dry run). */
  filled: number;
  /**
   * `object.field (fn)` roll-ups deliberately NOT touched: `min`/`max`/`avg`
   * have no empty-set value, so a stored `null` there is the correct reading of
   * "no child rows". Reported rather than silently omitted — the scope
   * narrowing is a decision an operator should be able to SEE.
   */
  skippedUndefinedOnEmpty: string[];
  /**
   * The complement of `skippedUndefinedOnEmpty`, in the same `object.field (fn)`
   * spelling: the `min`/`max`/`avg` roll-ups the caller named in
   * `recomputeUndefinedOnEmpty` and this run therefore walked like a `count`
   * (#15064). Empty on an unscoped run.
   */
  recomputedUndefinedOnEmpty: string[];
  /** False on a dry run — no writes were made. */
  applied: boolean;
  /** A per-object cap or an unreadable object cut the walk short. */
  truncated: boolean;
  /** Objects that could not be read at all — reported, and they truncate. */
  unreadableObjects: string[];
  /** Rows whose recompute failed after retries; the run continues past them. */
  failures: SummaryBackfillFailure[];
}

/** Engine surface the backfill needs: the engine's OWN roll-up index, a read,
 *  an aggregate, and the same update verb the recompute writes through. */
export interface SummaryBackfillEngine {
  getOwnedSummaryDescriptors(parentObject: string): SummaryDescriptor[];
  getConfigs?(): Record<string, unknown>;
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  aggregate(object: string, query: any, options?: any): Promise<any[]>;
  update(object: string, data: Record<string, unknown>, options?: any): Promise<any>;
}

export interface SummaryBackfillLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
}

export interface SummaryBackfillOptions {
  /** Write the recomputed values. Omit for a read-only dry run. */
  apply?: boolean;
  /** Restrict to these objects (default: every object owning a roll-up). */
  objects?: string[];
  /**
   * `object.field` roll-ups the caller KNOWS have never been computed — a
   * column declared after its parent rows already existed — so a stored `null`
   * there is a hole whatever the function (#15064). A `min`/`max`/`avg` named
   * here is recomputed for every `NULL` parent through the same aggregate the
   * engine writes, instead of being reported under `skippedUndefinedOnEmpty`;
   * a parent with no child rows keeps its `null`, which is already the engine's
   * value for it. Naming a `count`/`sum` is accepted and changes nothing —
   * those are in scope by default — so a caller can pass every column it just
   * declared without knowing the empty-set list. A name that resolves to no
   * roll-up owned by an object this run walks is refused (`FIELD_NOT_FOUND`,
   * 404) before any row is read. Omitted, the run is exactly the `count`/`sum`
   * backfill it always was.
   */
  recomputeUndefinedOnEmpty?: string[];
  /** Safety bound on parent rows read per object. */
  maxRecordsPerObject?: number;
  /** Retry policy for one row's aggregate + update; defaults to the transient
   *  defaults the engine's own recompute uses (framework#3147). */
  retry?: RetryOptions;
}

const SCAN_PAGE_SIZE = 500;
const MAX_SAMPLE_IDS = 5;
/** Unscoped by design: a deployment-wide backfill must see every org's rows.
 *  `isSystem` with no `tenantId` is what `buildDriverOptions` reads as "do not
 *  tenant-scope this" — the same context the other `os migrate` data runs use. */
const SYSTEM_CTX = { isSystem: true } as const;

/** `object.field` — the spelling `recomputeUndefinedOnEmpty` takes, and the
 *  key a named roll-up is resolved by. */
const rollupKey = (desc: SummaryDescriptor): string => `${desc.parentObject}.${desc.summaryField}`;
/** `object.field (fn)` — the spelling both report lists share. */
const rollupLabel = (desc: SummaryDescriptor): string => `${rollupKey(desc)} (${desc.fn})`;

/** The engine's OWN roll-up index for `object`; an index that cannot be read
 *  contributes nothing rather than aborting the run. */
function ownedDescriptors(engine: SummaryBackfillEngine, object: string): SummaryDescriptor[] {
  try {
    return engine.getOwnedSummaryDescriptors(object) ?? [];
  } catch {
    return [];
  }
}

/** The roll-ups `object` owns that this run walks — every `count`/`sum`, plus
 *  the `min`/`max`/`avg` the caller named in `recomputeUndefinedOnEmpty` — and
 *  the `min`/`max`/`avg` it owns that stay out of scope. */
function partitionDescriptors(
  engine: SummaryBackfillEngine,
  object: string,
  scope: ReadonlySet<string>,
): { backfillable: SummaryDescriptor[]; skipped: string[]; recomputed: string[] } {
  const backfillable: SummaryDescriptor[] = [];
  const skipped: string[] = [];
  const recomputed: string[] = [];
  for (const desc of ownedDescriptors(engine, object)) {
    if (summaryNullIsBackfillable(desc.fn)) backfillable.push(desc);
    else if (scope.has(rollupKey(desc))) {
      backfillable.push(desc);
      recomputed.push(rollupLabel(desc));
    } else skipped.push(rollupLabel(desc));
  }
  return { backfillable, skipped, recomputed };
}

/**
 * Resolve `recomputeUndefinedOnEmpty` against the roll-ups owned by the objects
 * this run walks, BEFORE any row is read (#15064).
 *
 * Every entry must name a summary field the engine's own index owns on one of
 * `candidates`; an entry naming a `count`/`sum` resolves too (already in scope
 * — nothing to add). One that resolves to nothing — a typo, a field that is not
 * a roll-up, or an object `options.objects` left out of this run — is REFUSED
 * as a whole, with nothing written: the caller asserted a fact about a column
 * this run cannot see, and quietly walking the rest would hand back the
 * `filled: 0` false all-clear this option exists to end. `FIELD_NOT_FOUND`
 * (ADR-0112 standard catalog, 404) is the envelope: the named field is what
 * could not be found.
 */
function resolveRecomputeScope(
  engine: SummaryBackfillEngine,
  candidates: string[],
  named: string[] | undefined,
): Set<string> {
  const scope = new Set<string>();
  if (!named || named.length === 0) return scope;
  const owned = new Set<string>();
  for (const object of candidates) {
    for (const desc of ownedDescriptors(engine, object)) owned.add(rollupKey(desc));
  }
  const unresolved: string[] = [];
  for (const entry of named) {
    if (owned.has(entry)) scope.add(entry);
    else if (!unresolved.includes(entry)) unresolved.push(entry);
  }
  if (unresolved.length > 0) {
    const err = new Error(
      `[summary-backfill] recomputeUndefinedOnEmpty names ${unresolved.length} roll-up(s) this run cannot find: ` +
        `${unresolved.join(', ')}. Each entry is spelled object.field and must name a summary field owned by one ` +
        `of the ${candidates.length} object(s) this run walks (an object left out by \`objects\` is not walked). ` +
        'Refused before any row was read; nothing was written.',
    ) as Error & { code: string; status: number; fields: string[] };
    err.code = 'FIELD_NOT_FOUND';
    err.status = 404;
    err.fields = unresolved;
    throw err;
  }
  return scope;
}

/**
 * Recompute every `count`/`sum` roll-up column still stored as `NULL` — and,
 * for the `min`/`max`/`avg` roll-ups named in `options.recomputeUndefinedOnEmpty`,
 * every `NULL` parent whose aggregate is defined (#15064).
 *
 * Dry run unless `options.apply` — and a dry run writes nothing at all, so the
 * report can be reviewed (and diffed against what actually happened) before any
 * row changes. An unresolvable `recomputeUndefinedOnEmpty` entry throws before
 * the walk starts, on a dry run as on an apply run.
 */
export async function backfillSummaryNulls(
  engine: SummaryBackfillEngine,
  logger: SummaryBackfillLogger,
  options: SummaryBackfillOptions = {},
): Promise<SummaryBackfillReport> {
  const apply = options.apply === true;
  const maxPerObject = options.maxRecordsPerObject ?? 100_000;
  const candidates =
    options.objects ??
    (typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : []);

  // Resolved (and refused) BEFORE the walk: an apply run must not write half
  // the deployment and then discover the caller named a column it cannot see.
  const scope = resolveRecomputeScope(engine, candidates, options.recomputeUndefinedOnEmpty);

  const scannedObjects: string[] = [];
  const outcomes = new Map<string, SummaryBackfillFieldOutcome>();
  const skippedUndefinedOnEmpty: string[] = [];
  const recomputedUndefinedOnEmpty: string[] = [];
  const unreadableObjects: string[] = [];
  const failures: SummaryBackfillFailure[] = [];
  let scannedRecords = 0;
  let truncated = false;

  for (const object of candidates) {
    const { backfillable, skipped, recomputed } = partitionDescriptors(engine, object, scope);
    skippedUndefinedOnEmpty.push(...skipped);
    recomputedUndefinedOnEmpty.push(...recomputed);
    if (backfillable.length === 0) continue;
    scannedObjects.push(object);

    for (const desc of backfillable) {
      outcomes.set(`${object}.${desc.summaryField}`, {
        object,
        field: desc.summaryField,
        fn: desc.fn,
        childObject: desc.childObject,
        nullRows: 0,
        nonEmpty: 0,
        filled: 0,
        sampleRecordIds: [],
      });
    }

    // Seek by `id` rather than offset (#4363): this run's claim is about EVERY
    // stored row, and an offset walk cannot promise it visited them all.
    const walk = keysetWalk<Record<string, unknown>>(
      (q: KeysetPageQuery) => engine.find(object, {
        ...q,
        fields: ['id', ...backfillable.map((d) => d.summaryField)],
        context: { ...SYSTEM_CTX },
      }),
      { pageSize: SCAN_PAGE_SIZE, max: maxPerObject },
    );

    try {
      for await (const page of walk.pages()) {
        for (const row of page) {
          scannedRecords++;
          const parentId = row.id;
          if (parentId == null || parentId === '') continue;
          for (const desc of backfillable) {
            // The stored value is what this run judges: `null` (and the
            // `undefined` a document driver returns for an absent column) is
            // the hole; a real number — including a 0 the seed or a recompute
            // already wrote, and including an author-supplied value — is left
            // exactly as it is.
            if (row[desc.summaryField] != null) continue;
            const outcome = outcomes.get(`${object}.${desc.summaryField}`)!;
            outcome.nullRows++;
            const sampled = outcome.sampleRecordIds.length < MAX_SAMPLE_IDS;
            if (sampled) outcome.sampleRecordIds.push(String(parentId));
            // True only for a `min`/`max`/`avg` the caller named in
            // `recomputeUndefinedOnEmpty` (#15064) — nothing else undefined on
            // the empty set reaches this loop. Its empty-set reading is `null`,
            // which is what the row already holds, so an aggregate over no
            // child rows is nothing to write, and not a hole either.
            const undefinedOnEmpty = !summaryNullIsBackfillable(desc.fn);
            try {
              // Counters are bumped AFTER the retry settles, never inside the
              // retried closure — a retried attempt would otherwise count the
              // same row twice and the report would overstate the run.
              let computed: unknown;
              await withTransientRetry(async () => {
                computed = await aggregateSummaryValue(
                  engine, desc, String(parentId), { ...SYSTEM_CTX },
                );
                if (!apply) return;
                if (undefinedOnEmpty && computed == null) return;
                await engine.update(
                  desc.parentObject,
                  { id: parentId, [desc.summaryField]: computed },
                  { context: { ...SYSTEM_CTX } },
                );
              }, options.retry ?? {});
              if (undefinedOnEmpty && computed == null) {
                // Reclassified: the stored `null` IS the engine's value for this
                // parent. Undo the count and the sample taken above.
                outcome.nullRows--;
                if (sampled) outcome.sampleRecordIds.pop();
                continue;
              }
              // A defined `min`/`max`/`avg` implies at least one child row by
              // construction; `count`/`sum` keep the `!== 0` reading the report
              // has always used.
              if (undefinedOnEmpty || (typeof computed === 'number' && computed !== 0)) outcome.nonEmpty++;
              if (apply) outcome.filled++;
            } catch (err) {
              // One row's failure must not abort the rest — the same rule the
              // engine's recompute follows. Recorded so the caller can surface
              // it and the operator can re-run (the run is idempotent, so a
              // repeat only revisits what is still `NULL`).
              const message = (err as any)?.message ?? String(err);
              logger.warn(
                `[summary-backfill] ${object}.${desc.summaryField} record ${String(parentId)}: ${message}`,
              );
              failures.push({
                object, field: desc.summaryField, recordId: String(parentId), error: message,
              });
            }
          }
        }
      }
    } catch (err) {
      // An object we cannot read is an object whose rows this run cannot vouch
      // for. Record it AND truncate rather than skip it quietly.
      logger.warn(
        `[summary-backfill] cannot read ${object} (${(err as Error)?.message ?? err}) — ` +
          'reported as unreadable; this run does not cover it',
      );
      unreadableObjects.push(object);
      truncated = true;
      continue;
    }
    if (walk.truncated) truncated = true;
  }

  const fields = [...outcomes.values()]
    .filter((f) => f.nullRows > 0)
    .sort((a, b) => b.nullRows - a.nullRows);

  return {
    scannedObjects,
    scannedRecords,
    fields,
    nullRows: fields.reduce((n, f) => n + f.nullRows, 0),
    filled: fields.reduce((n, f) => n + f.filled, 0),
    skippedUndefinedOnEmpty,
    recomputedUndefinedOnEmpty,
    applied: apply,
    truncated,
    unreadableObjects,
    failures,
  };
}

/** Human-readable report body, shared by the CLI's dry-run and apply output. */
export function formatSummaryBackfillReport(report: SummaryBackfillReport): string[] {
  const lines: string[] = [];
  // Unscoped wording is byte-identical to what it always was; the scoped run
  // (#15064) says which extra columns it walked and why a NULL may remain.
  const named = report.recomputedUndefinedOnEmpty.length;
  lines.push(
    `Scanned ${report.scannedRecords} parent row(s) across ${report.scannedObjects.length} object(s) ` +
      `for count/sum roll-up columns${named > 0 ? ` (plus ${named} named min/max/avg column(s))` : ''} ` +
      'still stored as NULL.',
  );
  if (report.fields.length === 0) {
    lines.push(`✓ No NULL ${named > 0 ? '' : 'count/sum '}roll-up values found — nothing to backfill.`);
  } else {
    const verb = report.applied ? 'Backfilled' : 'Would backfill';
    lines.push(`${verb} ${report.applied ? report.filled : report.nullRows} value(s) in ${report.fields.length} column(s):`);
    for (const f of report.fields) {
      lines.push(
        `  • ${f.object}.${f.field} (${f.fn} over ${f.childObject}) — ${f.nullRows} NULL row(s), ` +
          `${f.nonEmpty} with real child data` +
          `\n      e.g. ${f.sampleRecordIds.join(', ')}`,
      );
    }
    if (report.fields.some((f) => f.nonEmpty > 0)) {
      lines.push(
        'Rows "with real child data" are why this run recomputes instead of writing 0:',
        'their correct value is the aggregate over their children, not the empty-set value.',
      );
    }
  }
  if (report.skippedUndefinedOnEmpty.length > 0) {
    lines.push(
      `· Untouched by design (no empty-set value — a null there means "no child rows"): ` +
        report.skippedUndefinedOnEmpty.join(', '),
    );
  }
  if (report.recomputedUndefinedOnEmpty.length > 0) {
    lines.push(
      '· Recomputed on request (named as never computed — a column declared after its parent rows existed): ' +
        report.recomputedUndefinedOnEmpty.join(', ') +
        '\n    A parent with no child rows keeps NULL there: that is the aggregate\'s own value, not a hole.',
    );
  }
  if (report.failures.length > 0) {
    lines.push(`✗ ${report.failures.length} row(s) could not be recomputed:`);
    for (const f of report.failures.slice(0, MAX_SAMPLE_IDS)) {
      lines.push(`  • ${f.object}.${f.field} ${f.recordId}: ${f.error}`);
    }
    if (report.failures.length > MAX_SAMPLE_IDS) {
      lines.push(`  … and ${report.failures.length - MAX_SAMPLE_IDS} more`);
    }
    lines.push('Re-running is safe: the backfill only ever revisits rows still holding NULL.');
  }
  if (report.unreadableObjects.length > 0) {
    lines.push(`⚠ Unreadable object(s): ${report.unreadableObjects.join(', ')}`);
  }
  if (report.truncated) {
    lines.push('⚠ Walk incomplete — some rows were not examined; re-run without the cap to finish.');
  }
  if (!report.applied && report.nullRows > 0) {
    lines.push('Dry run — nothing was written. Re-run with --apply to backfill.');
  }
  return lines;
}

/** Did this run leave the deployment with no known NULL roll-up left? */
export function summaryBackfillComplete(report: SummaryBackfillReport): boolean {
  return report.failures.length === 0 && !report.truncated && (report.applied || report.nullRows === 0);
}
