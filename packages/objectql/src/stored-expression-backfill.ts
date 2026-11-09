// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The backfill of stored computed fields over rows that never went through a
 * write since the field was declared — `os migrate stored-expressions` — and
 * the boot advisory that names it.
 *
 * ## The hole this fills
 *
 * A stored computed field (a non-`formula` field declaring `expression`) is
 * computed by the engine on every insert and update, and on nothing else
 * (`computeStoredExpressions`, the write path). Declare one on an object that
 * already holds rows and schema sync adds the column, NULL on every row: no
 * write has computed it, and none will until each row is next written. Every
 * reader of the column — a filter, a sort, a roll-up, an analytics anchor
 * reading a NULL offset as 0 — answers from a value the declaration never
 * produced, with no error. A fresh database is right, an upgraded one is not;
 * this run removes that asymmetry, the way `os migrate summary-nulls` does for
 * roll-ups.
 *
 * ## The write's own computation, never a copy
 *
 * Each value comes from {@link StoredExpressionBackfillEngine.computeStoredExpressionsOver}:
 * the engine's plan and serving for a write (option labels, the one hop, the
 * `can()` map), over the row as stored. The apply writes through
 * `engine.update` with the computed values in the payload; the write computes
 * every stored field of the row again over the stored row, so a filled row
 * holds exactly what a fresh write of it would store.
 *
 * ## Which rows it writes
 *
 * By default, the rows holding a NULL the expression gives a value — the hole.
 * A NULL the expression itself answers (an empty reference, a null input) is
 * already the write's value and is left alone. With `changed`, also every row
 * whose stored value differs from the expression over it — the run to make
 * after an expression is CHANGED, which no boot can detect; the report counts
 * such rows on every run (`staleRows`), which is how an operator learns to ask
 * for it. ⚠️ An expression reading the clock (`now()`, `today()`) recomputes
 * to the current time, so under `changed` every row of it differs.
 *
 * Because the apply IS a write, it stores every stored field the write
 * computes for that row, so a stale value on a row this run fills is
 * rewritten with it (counted under `written`). A row on which a stored field
 * does not evaluate while it holds a value is listed and NOT written: the
 * write would replace that value with the fault's `null`.
 *
 * ## Writes
 *
 * Dry run unless `apply`; a dry run writes nothing. An apply writes under
 * `preserveAudit` with the row's stored `updated_at`, as the other `os migrate`
 * data runs that rewrite a computed column do: `updated_at` does not move.
 * Hooks, roll-ups over the column and the audit writers see each write as any
 * write. One row's failure does not stop the run; it is listed. Idempotent: a
 * second run finds nothing to fill. No `sys_migration` flag is recorded:
 * nothing gates on the run (the `summary-nulls` reasoning).
 *
 * ## The boot advisory
 *
 * {@link announceStoredExpressionHoles} reads the first page of each object
 * declaring a stored computed field and, when that sample holds a hole, warns
 * once naming the fields and this command. Bounded on purpose — one read of
 * at most {@link ADVISORY_SAMPLE_SIZE} rows per such object, and nothing for
 * an object declaring none — so it never scans a large table at boot; a
 * column added to an object with rows is NULL on every row, so the first page
 * finds it. It writes nothing: rewriting data at boot fires hooks and audit
 * rows nobody ordered, which is why the backfill is a command.
 */

import { keysetWalk, type KeysetPageQuery } from '@objectstack/types';
import { objectNotFoundError, withTransientRetry, type RetryOptions } from '@objectstack/core';

import { planStoredExpressions } from './engine-top-level.js';
import { isFederatedUnprovisionedInjectedColumn } from './federated-object.js';

/** The engine surface the run needs: the declarations, a read, the stored-expression computation and the update. */
export interface StoredExpressionBackfillEngine {
  getObject(name: string): { fields?: Record<string, unknown> } | undefined;
  getConfigs?(): Record<string, unknown>;
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  update(object: string, data: Record<string, unknown>, options?: any): Promise<any>;
  computeStoredExpressionsOver(
    object: string,
    rows: ReadonlyArray<Record<string, unknown>>,
    context?: any,
    onFault?: (field: string, message: string) => void,
  ): Promise<Array<Record<string, unknown>>>;
}

export interface StoredExpressionBackfillLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
}

export interface StoredExpressionBackfillOptions {
  /** Restrict to these objects (default: every object declaring a stored computed field). */
  objects?: string[];
  /** One stored computed field of the ONE object named in `objects` (default: every one it declares). */
  field?: string;
  /** Also rewrite rows whose stored (non-NULL) value differs from the expression — after an expression changed. */
  changed?: boolean;
  /** Write the computed values. Omit for a read-only dry run. */
  apply?: boolean;
  /** Safety bound on rows read per object. */
  maxRecordsPerObject?: number;
  /** How many faulted rows and failures the report lists (each); the counts are always whole. */
  maxListed?: number;
  /** Retry policy for one row's update; defaults to the transient defaults. */
  retry?: RetryOptions;
}

/** One stored computed field the run examined. */
export interface StoredExpressionBackfillFieldOutcome {
  object: string;
  field: string;
  /** Rows storing NULL where the expression gives a value — the hole. */
  nullRows: number;
  /** Rows storing a value that differs from the expression (rewritten only under `changed`, or on a filled row). */
  staleRows: number;
  /** Rows on which the expression does not evaluate (it computes `null` there, as on a write). */
  faultedRows: number;
  /** Values written (an apply run). */
  written: number;
  /** A few record ids with a hole, so an operator can go and look. */
  sampleRecordIds: string[];
}

/** A row on which a stored computed field does not evaluate. */
export interface StoredExpressionFault {
  object: string;
  field: string;
  recordId: string;
  error: string;
  /** True when the row holds a value there, so the row is not written (the write would store `null`). */
  blocksWrite: boolean;
}

/** A row whose write failed after retries; the run continues past it. */
export interface StoredExpressionBackfillFailure {
  object: string;
  recordId: string;
  error: string;
}

export interface StoredExpressionBackfillReport {
  /** Objects walked — those declaring a stored computed field in scope. */
  scannedObjects: string[];
  scannedRecords: number;
  /** Every field walked, in declaration order per object. */
  fields: StoredExpressionBackfillFieldOutcome[];
  nullRows: number;
  staleRows: number;
  faultedRows: number;
  /** Rows a write would change but which hold a value a faulting field would erase: listed, never written. */
  skippedRows: number;
  /** Rows written (an apply run). */
  writtenRows: number;
  /** The scope: NULL holes only (false), or every stale value too (true). */
  changed: boolean;
  applied: boolean;
  /** A per-object cap or an unreadable object cut the walk short. */
  truncated: boolean;
  unreadableObjects: string[];
  faults: StoredExpressionFault[];
  faultsTruncated: boolean;
  failures: StoredExpressionBackfillFailure[];
}

const SCAN_PAGE_SIZE = 200;
const DEFAULT_MAX_LISTED = 50;
const MAX_SAMPLE_IDS = 5;
/** How many rows of each object the boot advisory reads. */
export const ADVISORY_SAMPLE_SIZE = 100;
/** Unscoped by design, the context every `os migrate` data run reads with: every organization's rows. */
const SYSTEM_CTX = { isSystem: true } as const;
/** The write keeps the row's own `updated_at`: the run changes only computed columns. */
const SYSTEM_PRESERVING_CTX = { isSystem: true, preserveAudit: true } as const;

type RefusalError = Error & { code: string; status: number; httpStatus: number; field?: string };

function invalidField(message: string, field?: string): RefusalError {
  const err = new Error(message) as RefusalError;
  err.code = 'INVALID_FIELD';
  err.status = 400;
  // …and `httpStatus`, the same number under ADR-0112 D5's spelling (the CLI `--json` envelope reads it).
  err.httpStatus = 400;
  if (field !== undefined) err.field = field;
  return err;
}

/** The stored computed fields `object` declares, by the write's own predicate. */
function storedExpressionFields(engine: Pick<StoredExpressionBackfillEngine, 'getObject'>, object: string): string[] {
  return planStoredExpressions(engine.getObject(object)).map((entry) => entry.name);
}

/**
 * The fields to walk per object, judged before any row is read: an unknown
 * object (`OBJECT_NOT_FOUND`), a named object declaring no stored computed
 * field, a `field` without exactly one object, and a `field` that is not one
 * of its stored computed fields (`INVALID_FIELD`) are refused as a whole.
 */
function resolveScope(engine: StoredExpressionBackfillEngine, options: StoredExpressionBackfillOptions): Map<string, string[]> {
  const scope = new Map<string, string[]>();
  const named = options.objects;
  if (options.field !== undefined && named?.length !== 1) {
    throw invalidField(
      `[stored-expression-backfill] field '${options.field}' names a field of ONE object: give exactly one object with it. `
        + 'Refused before the walk read or wrote any row.',
      options.field,
    );
  }
  if (!named) {
    const all = typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : [];
    for (const object of all) {
      const fields = storedExpressionFields(engine, object);
      if (fields.length > 0) scope.set(object, fields);
    }
    return scope;
  }
  for (const object of named) {
    if (!engine.getObject(object)) throw objectNotFoundError(object);
    const fields = storedExpressionFields(engine, object);
    if (fields.length === 0) {
      throw invalidField(
        `[stored-expression-backfill] '${object}' declares no stored computed field: none of its fields other than `
          + '`formula` ones declares `expression`, so it stores no computed value to fill. '
          + 'Refused before the walk read or wrote any row.',
      );
    }
    if (options.field !== undefined && !fields.includes(options.field)) {
      throw invalidField(
        `[stored-expression-backfill] '${object}.${options.field}' is not a stored computed field. The ones '${object}' `
          + `declares: ${fields.map((f) => `'${f}'`).join(', ')}. Refused before the walk read or wrote any row.`,
        options.field,
      );
    }
    scope.set(object, options.field !== undefined ? [options.field] : fields);
  }
  return scope;
}

const isBlank = (value: unknown): boolean => value === null || value === undefined;

/**
 * Does a stored value spell what the expression computes? A driver hands back
 * its own spelling of the value the write stored — a number as a decimal
 * string, a boolean as 0/1, a date as text — so a value is compared as the
 * type the computation produced, never by identity alone.
 */
export function sameStoredValue(stored: unknown, computed: unknown): boolean {
  if (isBlank(stored) || isBlank(computed)) return isBlank(stored) && isBlank(computed);
  if (Object.is(stored, computed)) return true;
  if (typeof computed === 'number' || typeof computed === 'bigint') {
    const s = typeof stored === 'string' && stored.trim() !== '' ? Number(stored) : stored;
    return typeof s === 'number' && Number(computed) === s;
  }
  if (typeof computed === 'boolean') {
    if (stored === 1 || stored === '1' || stored === 'true') return computed;
    if (stored === 0 || stored === '0' || stored === 'false') return !computed;
    return false;
  }
  if (computed instanceof Date) {
    const ms = stored instanceof Date ? stored.getTime() : Date.parse(String(stored));
    if (ms === computed.getTime()) return true;
    // A `date` column stores the calendar day alone.
    return typeof stored === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(stored) && computed.toISOString().slice(0, 10) === stored;
  }
  if (typeof computed === 'object' || typeof stored === 'object') {
    const s = typeof stored === 'string' ? safeParse(stored) : stored;
    return JSON.stringify(s) === JSON.stringify(computed);
  }
  return String(stored) === String(computed);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Compute one page, and the faults of each row. One batched computation per
 * page; only when it reported a fault is each row whose value came back
 * `null` computed again on its own, which is what ties a fault to its row.
 */
async function computePage(
  engine: StoredExpressionBackfillEngine,
  object: string,
  page: ReadonlyArray<Record<string, unknown>>,
): Promise<{ values: Array<Record<string, unknown>>; faults: Array<Map<string, string>> }> {
  const faulted = new Set<string>();
  const values = await engine.computeStoredExpressionsOver(object, page, { ...SYSTEM_CTX }, (field) => {
    faulted.add(field);
  });
  const faults = page.map(() => new Map<string, string>());
  if (faulted.size === 0) return { values, faults };
  for (let i = 0; i < page.length; i++) {
    if (![...faulted].some((field) => values[i]?.[field] === null)) continue;
    await engine.computeStoredExpressionsOver(object, [page[i]], { ...SYSTEM_CTX }, (field, message) => {
      if (!faults[i].has(field)) faults[i].set(field, message);
    });
  }
  return { values, faults };
}

/**
 * Fill the stored computed fields of stored rows — the NULL holes by default,
 * every stale value too under `options.changed`.
 *
 * Dry run unless `options.apply`. Refusals before the walk: an unknown object
 * (`OBJECT_NOT_FOUND`), and a named object or `field` declaring no stored
 * computed field (`INVALID_FIELD`).
 */
export async function backfillStoredExpressions(
  engine: StoredExpressionBackfillEngine,
  logger: StoredExpressionBackfillLogger,
  options: StoredExpressionBackfillOptions = {},
): Promise<StoredExpressionBackfillReport> {
  const apply = options.apply === true;
  const changed = options.changed === true;
  const maxListed = options.maxListed ?? DEFAULT_MAX_LISTED;
  const scope = resolveScope(engine, options);

  const report: StoredExpressionBackfillReport = {
    scannedObjects: [],
    scannedRecords: 0,
    fields: [],
    nullRows: 0,
    staleRows: 0,
    faultedRows: 0,
    skippedRows: 0,
    writtenRows: 0,
    changed,
    applied: apply,
    truncated: false,
    unreadableObjects: [],
    faults: [],
    faultsTruncated: false,
    failures: [],
  };

  for (const [object, fields] of scope) {
    report.scannedObjects.push(object);
    const outcomes = new Map<string, StoredExpressionBackfillFieldOutcome>();
    for (const field of fields) {
      const outcome = { object, field, nullRows: 0, staleRows: 0, faultedRows: 0, written: 0, sampleRecordIds: [] };
      outcomes.set(field, outcome);
      report.fields.push(outcome);
    }
    // The stamp the apply keeps; a federated object's injected columns are not provisioned, so its write sends none.
    const schema = engine.getObject(object);
    const hasUpdatedAt = 'updated_at' in (schema?.fields ?? {}) && !isFederatedUnprovisionedInjectedColumn(schema, 'updated_at');

    // Seek by `id`: this run's claim is about EVERY stored row, which an offset walk cannot promise.
    const walk = keysetWalk<Record<string, unknown>>(
      (q: KeysetPageQuery) => engine.find(object, { ...q, context: { ...SYSTEM_CTX } }),
      { pageSize: SCAN_PAGE_SIZE, max: options.maxRecordsPerObject ?? 100_000 },
    );

    try {
      for await (const page of walk.pages()) {
        const { values, faults } = await computePage(engine, object, page);
        for (let i = 0; i < page.length; i++) {
          const row = page[i];
          report.scannedRecords++;
          if (row.id == null || row.id === '') continue;
          const recordId = String(row.id);
          const patch: Record<string, unknown> = {};
          let hole = false;
          let stale = false;
          let blocked = false;
          for (const field of fields) {
            const outcome = outcomes.get(field)!;
            const stored = row[field];
            const fault = faults[i].get(field);
            if (fault !== undefined) {
              outcome.faultedRows++;
              report.faultedRows++;
              const blocksWrite = !isBlank(stored);
              if (blocksWrite) blocked = true;
              if (report.faults.length < maxListed) report.faults.push({ object, field, recordId, error: fault, blocksWrite });
              else report.faultsTruncated = true;
              continue;
            }
            const value = values[i]?.[field] ?? null;
            if (isBlank(stored)) {
              if (isBlank(value)) continue;
              outcome.nullRows++;
              report.nullRows++;
              if (outcome.sampleRecordIds.length < MAX_SAMPLE_IDS) outcome.sampleRecordIds.push(recordId);
              hole = true;
              patch[field] = value;
            } else if (!sameStoredValue(stored, value)) {
              outcome.staleRows++;
              report.staleRows++;
              stale = true;
              patch[field] = value;
            }
          }
          if (!(hole || (changed && stale))) continue;
          // The write computes EVERY stored field of the row, the ones this run was not asked about too.
          for (const [field] of faults[i]) if (!fields.includes(field) && !isBlank(row[field])) blocked = true;
          if (blocked) {
            report.skippedRows++;
            continue;
          }
          if (!apply) continue;
          try {
            await withTransientRetry(
              () => engine.update(
                object,
                { id: row.id, ...patch, ...(hasUpdatedAt && !isBlank(row.updated_at) ? { updated_at: row.updated_at } : {}) },
                { context: { ...SYSTEM_PRESERVING_CTX } },
              ),
              options.retry ?? {},
            );
            // Bumped AFTER the retry settles, never inside the retried closure.
            report.writtenRows++;
            for (const field of Object.keys(patch)) outcomes.get(field)!.written++;
          } catch (err) {
            // One row's failure must not abort the rest; a re-run revisits it, because it still holds the hole.
            const message = (err as Error)?.message ?? String(err);
            logger.warn(`[stored-expression-backfill] ${object} record ${recordId}: ${message}`);
            report.failures.push({ object, recordId, error: message });
          }
        }
      }
    } catch (err) {
      // An object this run cannot read is one whose rows it cannot vouch for: reported, and it truncates.
      logger.warn(
        `[stored-expression-backfill] cannot read ${object} (${(err as Error)?.message ?? err}) — `
          + 'reported as unreadable; this run does not cover it',
      );
      report.unreadableObjects.push(object);
      report.truncated = true;
      continue;
    }
    if (walk.truncated) report.truncated = true;
  }
  return report;
}

/** Did this run leave no hole it was asked to fill (and, under `changed`, no stale value)? */
export function storedExpressionBackfillComplete(report: StoredExpressionBackfillReport): boolean {
  const pending = report.nullRows + (report.changed ? report.staleRows : 0);
  return report.failures.length === 0
    && report.skippedRows === 0
    && !report.truncated
    && (report.applied || pending === 0);
}

/** Human-readable report body, shared by the CLI's dry-run and apply output. */
export function formatStoredExpressionBackfillReport(report: StoredExpressionBackfillReport): string[] {
  const lines: string[] = [];
  lines.push(
    `Scanned ${report.scannedRecords} row(s) across ${report.scannedObjects.length} object(s) for stored computed `
      + `fields ${report.changed ? 'whose stored value differs from their expression' : 'still stored as NULL'}.`,
  );
  const pending = report.fields.filter((f) => f.nullRows > 0 || (report.changed && f.staleRows > 0));
  if (pending.length === 0) {
    lines.push(report.changed
      ? '✓ Every stored computed value already equals its expression — nothing to recompute.'
      : '✓ No NULL a stored computed field\'s expression would fill — nothing to backfill.');
  } else {
    lines.push(report.applied
      ? `Wrote ${report.fields.reduce((n, f) => n + f.written, 0)} value(s) on ${report.writtenRows} row(s) in ${pending.length} field(s):`
      : `Would write ${report.nullRows + (report.changed ? report.staleRows : 0)} value(s) in ${pending.length} field(s):`);
    for (const f of pending) {
      const parts = [`${f.nullRows} NULL row(s)`];
      if (report.changed) parts.push(`${f.staleRows} stale row(s)`);
      if (report.applied) parts.push(`${f.written} written`);
      lines.push(`  • ${f.object}.${f.field} — ${parts.join(', ')}${f.sampleRecordIds.length > 0 ? `\n      e.g. ${f.sampleRecordIds.join(', ')}` : ''}`);
    }
  }
  const stale = report.fields.filter((f) => f.staleRows > 0);
  if (!report.changed && stale.length > 0) {
    lines.push(
      `· ${report.staleRows} stored value(s) differ from their expression — the expression changed after they were written `
        + `(${stale.map((f) => `${f.object}.${f.field} ${f.staleRows}`).join(', ')}). Not rewritten by this run, except on a row `
        + 'it fills; re-run with --changed to recompute them. An expression reading the clock always differs.',
    );
  }
  const faulted = report.fields.filter((f) => f.faultedRows > 0);
  if (faulted.length > 0) {
    lines.push(
      `· ${report.faultedRows} row(s) where an expression does not evaluate — it computes NULL there, as on any write `
        + `(${faulted.map((f) => `${f.object}.${f.field} ${f.faultedRows}`).join(', ')}):`,
    );
    for (const fault of report.faults.slice(0, MAX_SAMPLE_IDS)) {
      lines.push(`  • ${fault.object}.${fault.field} ${fault.recordId}${fault.blocksWrite ? ' (holds a value: row not written)' : ''}: ${fault.error.split('\n')[0]}`);
    }
    if (report.faultedRows > MAX_SAMPLE_IDS) lines.push(`  … and ${report.faultedRows - MAX_SAMPLE_IDS} more`);
  }
  if (report.skippedRows > 0) {
    lines.push(
      `✗ ${report.skippedRows} row(s) listed and NOT written: a field that does not evaluate there holds a value the write `
        + 'would replace with NULL. Fix the expression or the row, then re-run.',
    );
  }
  if (report.failures.length > 0) {
    lines.push(`✗ ${report.failures.length} row(s) could not be written:`);
    for (const f of report.failures.slice(0, MAX_SAMPLE_IDS)) lines.push(`  • ${f.object} ${f.recordId}: ${f.error}`);
    if (report.failures.length > MAX_SAMPLE_IDS) lines.push(`  … and ${report.failures.length - MAX_SAMPLE_IDS} more`);
    lines.push('Re-running is safe: the backfill only revisits rows that still differ.');
  }
  if (report.unreadableObjects.length > 0) lines.push(`⚠ Unreadable object(s): ${report.unreadableObjects.join(', ')}`);
  if (report.truncated) lines.push('⚠ Walk incomplete — some rows were not examined; re-run with a higher --max-records.');
  // Claims no row or table, never that nothing was written: the command boots through the SQL driver's connect,
  // which can switch a SQLite file's journal mode (its header, no row). The command appends that note on SQLite.
  if (!report.applied && pending.length > 0) lines.push('Dry run — no row or table was written. Re-run with --apply to write.');
  return lines;
}

/** One object's holes in the advisory's sample. */
export interface StoredExpressionHoleSample {
  object: string;
  /** `field` → rows of the sample holding a NULL its expression fills. */
  fields: Record<string, number>;
  sampled: number;
}

/**
 * The boot advisory: read the first {@link ADVISORY_SAMPLE_SIZE} rows of each
 * object declaring a stored computed field and answer the samples holding a
 * hole. Reads only; an object whose sample cannot be read or computed is left
 * out (the command, which walks every row, is the authority).
 */
export async function sampleStoredExpressionHoles(
  engine: Pick<StoredExpressionBackfillEngine, 'getObject' | 'getConfigs' | 'find' | 'computeStoredExpressionsOver'>,
  onSkip?: (object: string, error: unknown) => void,
): Promise<StoredExpressionHoleSample[]> {
  const out: StoredExpressionHoleSample[] = [];
  const objects = typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : [];
  for (const object of objects) {
    const fields = storedExpressionFields(engine, object);
    if (fields.length === 0) continue;
    try {
      const rows = await engine.find(object, {
        orderBy: [{ field: 'id', order: 'asc' }],
        limit: ADVISORY_SAMPLE_SIZE,
        context: { ...SYSTEM_CTX },
      });
      if (rows.length === 0) continue;
      // A fault computes `null`, never a hole; it is the write's to report, not a boot's.
      const values = await engine.computeStoredExpressionsOver(object, rows, { ...SYSTEM_CTX }, () => {});
      const holes: Record<string, number> = {};
      rows.forEach((row, i) => {
        for (const field of fields) {
          if (isBlank(row[field]) && !isBlank(values[i]?.[field])) holes[field] = (holes[field] ?? 0) + 1;
        }
      });
      if (Object.keys(holes).length > 0) out.push({ object, fields: holes, sampled: rows.length });
    } catch (err) {
      onSkip?.(object, err);
    }
  }
  return out;
}

/**
 * Warn once when a stored computed field holds NULLs its expression fills,
 * naming each and `os migrate stored-expressions`. An advisory: it never fails
 * a boot and writes nothing.
 */
export async function announceStoredExpressionHoles(
  engine: Pick<StoredExpressionBackfillEngine, 'getObject' | 'getConfigs' | 'find' | 'computeStoredExpressionsOver'>,
  logger: StoredExpressionBackfillLogger & { debug?(msg: string, meta?: unknown): void },
): Promise<StoredExpressionHoleSample[]> {
  let samples: StoredExpressionHoleSample[] = [];
  try {
    samples = await sampleStoredExpressionHoles(engine, (object, err) => {
      logger.debug?.('[stored-expression] boot sample skipped', { object, error: (err as Error)?.message ?? String(err) });
    });
  } catch (err) {
    // An advisory must never be the reason a boot fails.
    logger.debug?.('[stored-expression] boot sample failed', { error: (err as Error)?.message ?? String(err) });
    return [];
  }
  if (samples.length === 0) return samples;
  const named = samples
    .flatMap((s) => Object.entries(s.fields).map(([field, n]) => `${s.object}.${field} (${n} of the first ${s.sampled} rows)`))
    .join(', ');
  logger.warn(
    `[stored-expression] stored computed field(s) hold NULL on rows no write has computed since the field was declared: ${named}. `
      + 'Every reader of these columns (filters, sorts, roll-ups, reports) reads NULL where the expression gives a value, until '
      + 'each row is next written. Run `os migrate stored-expressions` (dry run) to see every such row, then `--apply` to fill them.',
  );
  return samples;
}
