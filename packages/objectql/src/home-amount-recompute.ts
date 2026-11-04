// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144 D5, D7 parameter 1, Open item 8] The explicit recompute of stored
 * home amounts — `os migrate recompute-home-amounts`.
 *
 * ## Why it exists
 *
 * A write stores a `record`-mode amount converted into the organization's home
 * currency, with the rate it used (`home-amount-projection.ts`). A corrected
 * rate row does not, on its own, rewrite what was stored: D5 says it reaches
 * stored rows only through "an explicit recompute operation". This is that
 * operation. It also fills a home field added to an object that already holds
 * rows, whose stored rows were never converted.
 *
 * ## The write's own computation, never a copy
 *
 * Every number here comes from the code path a write runs:
 *
 * - The preview projects each stored row with {@link projectHomeAmounts} over
 *   the engine's own reads ({@link HomeAmountRecomputeEngine.homeAmountReadsFor}):
 *   the same rate-row rule (the latest `effective_date` on or before the
 *   document date, in the row's organization), the same exact division and
 *   single rounding, the same same-currency rule, and the same calendar day of
 *   a `datetime` document date in the organization's `localization.timezone`.
 * - The apply writes through `engine.update` with the home field in the
 *   payload. A payload that touches the home field makes the write project
 *   the row again, over the stored row, and the value the write computes is
 *   the one stored — so a recomputed row holds exactly what a fresh write of
 *   the same row would store.
 *
 * Each organization is converted into its OWN home currency at its OWN rates,
 * because the organization is the row's (`organization_id`), and the report
 * counts per organization.
 *
 * ## Which rows it lists and skips (parameter 1)
 *
 * Parameter 1 reports and skips a row whose historical rate is missing, and
 * applies the rest. A skipped row is never written: its home amount and rate
 * stay as stored, and no fallback (a rate of 1, a later rate, a zero) is put in
 * their place. Five reasons, each its own class with its own remedy:
 *
 * - `rate_missing` — no rate row for the currency is in force on the document
 *   date. Remedy: add the rate, re-run.
 * - `code_blank` — the amount holds a value beside a blank currency code (rows
 *   stored before the amount was switched to `record` mode; ruling 6492000994,
 *   letter B). There is no currency to convert from, so no rate can help.
 *   Remedy: `os migrate record-currency-codes`, then re-run.
 * - `document_date_blank` — a foreign amount with no document date.
 * - `home_currency_unset` — the organization has no `localization.currency`.
 * - `unconvertible` — the code is not ISO 4217, or the amount or document
 *   date does not parse; the write's own validator refuses such a row.
 *
 * ## Open item 8: how a skipped row's gap stays visible
 *
 * `sum` over a home field silently ignores an empty home amount, so a skipped
 * row would make a consolidated total low with no sign of it once the report
 * scrolled away. This run keeps the gap visible three ways:
 *
 * 1. **The run is not complete while any row is skipped.**
 *    {@link homeAmountRecomputeComplete} answers false, and the command exits
 *    non-zero, on a dry run as on an apply run, until a re-run skips nothing.
 * 2. **The applied run's audit entry carries the skipped rows**: their count
 *    per organization and reason, and each skipped row (record, field,
 *    reason, currency and date), so the gap outlives the terminal.
 * 3. **A skipped row is never written**, so the run's report is reproducible:
 *    a dry run lists the same rows again until they are fixed, and the
 *    stored home amount of a never-converted row stays blank, never 0.
 *
 * ## `--since`
 *
 * `since` filters on the DOCUMENT DATE (`homeAmount.rateDate`), the date that
 * picks the rate, read as the calendar day the write reads it as (a `datetime`
 * in the organization's timezone): a row is in the run when that day is on or
 * after `since`. A row with no document date is outside every `since` window.
 *
 * ## Writes
 *
 * Dry run unless `apply`. An apply writes only the rows whose stored home
 * amount or rate differs from the projection, and only the home and rate
 * fields: under `preserveAudit` with the row's stored `updated_at`, as the
 * other `os migrate` data runs that rewrite a column do. One `sys_audit_log`
 * entry records each applied run. Idempotent: a second run finds nothing to
 * change.
 */

import { keysetWalk, type KeysetPageQuery } from '@objectstack/types';
import { objectNotFoundError, withTransientRetry, type RetryOptions } from '@objectstack/core';

import {
  documentDateOf,
  isHomeAmountRefusal,
  planHomeAmounts,
  projectHomeAmounts,
  toScaledDecimal,
  EXCHANGE_RATE_MISSING_CODE,
  type HomeAmountPlanEntry,
  type HomeAmountReads,
  type HomeAmountServing,
} from './home-amount-projection.js';
import { isRecordCurrencyBlank } from './validation/record-currency-code.js';
import { VALIDATION_FAILED_CODE } from './validation/record-validator.js';

/** Why a stored amount was listed and not written. */
export type HomeAmountSkipReason =
  | 'rate_missing'
  | 'code_blank'
  | 'document_date_blank'
  | 'home_currency_unset'
  | 'unconvertible';

/** Every skip reason, in report order. */
export const HOME_AMOUNT_SKIP_REASONS: readonly HomeAmountSkipReason[] = [
  'rate_missing',
  'code_blank',
  'document_date_blank',
  'home_currency_unset',
  'unconvertible',
];

/** One stored amount the run listed and did not write. */
export interface HomeAmountRecomputeSkip {
  recordId: string;
  organizationId: string | null;
  /** The `record`-mode amount field. */
  field: string;
  reason: HomeAmountSkipReason;
  /** The amount's currency, where it has one. */
  currency?: string;
  /** The document date read (`YYYY-MM-DD`), for `rate_missing`. */
  date?: string;
}

/** The stored and the recomputed values of one amount's two projected fields. */
export interface HomeAmountRecomputeChange {
  recordId: string;
  organizationId: string | null;
  field: string;
  from: { home: unknown; rate: unknown };
  to: { home: unknown; rate: unknown };
}

/** The counts of one organization. Each count is of amounts (a row times a declaration). */
export interface HomeAmountRecomputeOrganization {
  organizationId: string | null;
  /** The organization's home currency as the write reads it, or null when unset. */
  homeCurrency: string | null;
  /** Amounts examined: in the `since` window. */
  amounts: number;
  /** Stored home amount and rate already equal the projection. */
  unchanged: number;
  /** Stored home amount or rate differs from the projection. */
  changed: number;
  /** Rows written (an apply run). */
  written: number;
  skipped: Record<HomeAmountSkipReason, number>;
  /** Amounts left out because their document date is before `since`, or blank. */
  outsideSince: number;
}

export interface HomeAmountRecomputeFailure {
  recordId: string;
  error: string;
}

/** Where the applied run's audit entry went. */
export type HomeAmountRecomputeAudit =
  | { written: true }
  | { written: false; reason: 'dry_run' | 'ledger_not_mounted' | 'refused'; error?: string };

export interface HomeAmountRecomputeReport {
  object: string;
  /** The declarations recomputed: the amount, its code, the home and rate fields and the document date. */
  fields: Array<{ field: string; codeField: string; homeField: string; rateField: string; rateDateField: string }>;
  /** The document-date floor, `YYYY-MM-DD`, or null for every row. */
  since: string | null;
  applied: boolean;
  scannedRecords: number;
  amounts: number;
  unchanged: number;
  changed: number;
  written: number;
  outsideSince: number;
  skippedTotal: number;
  skippedByReason: Record<HomeAmountSkipReason, number>;
  /** One entry per organization the walk met, ordered by id (null last). */
  organizations: HomeAmountRecomputeOrganization[];
  /** The amounts that change, up to `maxListed`. */
  changes: HomeAmountRecomputeChange[];
  changesTruncated: boolean;
  /** The amounts listed and skipped, up to `maxListed`. */
  skipped: HomeAmountRecomputeSkip[];
  skippedTruncated: boolean;
  /** Rows whose write failed after retries; the run continues past them. */
  failures: HomeAmountRecomputeFailure[];
  /** The `maxRecords` cap cut the walk short. */
  truncated: boolean;
  audit: HomeAmountRecomputeAudit;
}

/**
 * The engine surface the recompute needs: the declaration, a read, the update
 * every write goes through, an insert for the audit entry, and the serving the
 * write-time projection reads through.
 */
export interface HomeAmountRecomputeEngine {
  getObject(name: string): { fields?: Record<string, unknown> } | undefined;
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  update(object: string, data: Record<string, unknown>, options?: any): Promise<any>;
  insert(object: string, data: Record<string, unknown>, options?: any): Promise<any>;
  homeAmountReadsFor(context?: any): HomeAmountReads;
}

export interface HomeAmountRecomputeLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
}

export interface HomeAmountRecomputeOptions {
  /** The object whose stored rows are recomputed. */
  object: string;
  /** One `record`-mode amount declaring `homeAmount`; omitted, every declaration of the object. */
  field?: string;
  /** Only rows whose document date is on or after this calendar date (`YYYY-MM-DD`). */
  since?: string;
  /** Write the changes. Omit for a read-only dry run. */
  apply?: boolean;
  /** Safety bound on rows read. */
  maxRecords?: number;
  /** How many changes and how many skipped amounts the report lists (each); the counts are always whole. */
  maxListed?: number;
  /** Names the caller in the audit entry (`os migrate recompute-home-amounts`). */
  source?: string;
  /** Retry policy for one row's update; defaults to the transient defaults. */
  retry?: RetryOptions;
}

const SCAN_PAGE_SIZE = 500;
const DEFAULT_MAX_LISTED = 100;
/** How many skipped rows and failures the audit entry carries, each. */
const AUDIT_MAX_LISTED = 1000;
const AUDIT_OBJECT = 'sys_audit_log';
/** Unscoped by design, the context every `os migrate` data run reads with: every organization's rows. */
const SYSTEM_CTX = { isSystem: true } as const;
/** The write keeps the row's own `updated_at`: the run changes only the two projected fields. */
const SYSTEM_PRESERVING_CTX = { isSystem: true, preserveAudit: true } as const;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

type RefusalError = Error & { code: string; status: number; httpStatus: number; field?: string };

function refusal(code: string, message: string, field?: string): RefusalError {
  const err = new Error(message) as RefusalError;
  err.code = code;
  err.status = 400;
  // …and `httpStatus`, the same number under ADR-0112 D5's spelling (the CLI `--json` envelope reads it).
  err.httpStatus = 400;
  if (field !== undefined) err.field = field;
  return err;
}

const zeroReasons = (): Record<HomeAmountSkipReason, number> => ({
  rate_missing: 0,
  code_blank: 0,
  document_date_blank: 0,
  home_currency_unset: 0,
  unconvertible: 0,
});

/** Is `text` a real calendar date spelled `YYYY-MM-DD`? */
function isCalendarDate(text: string): boolean {
  if (!CALENDAR_DATE.test(text)) return false;
  const ms = Date.parse(`${text}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === text;
}

/**
 * The declarations to recompute, judged before any row is read: an unknown
 * object, an object declaring no home amount, a `field` that declares none,
 * and a malformed `since` are refused as a whole, on a dry run as on an apply.
 */
function resolvePlan(engine: HomeAmountRecomputeEngine, options: HomeAmountRecomputeOptions): HomeAmountPlanEntry[] {
  const { object, field, since } = options;
  const schema = engine.getObject(object);
  if (!schema) throw objectNotFoundError(object);
  if (since !== undefined && !isCalendarDate(since)) {
    throw refusal(
      VALIDATION_FAILED_CODE,
      `[home-amount-recompute] since '${since}' is not a calendar date: give it as YYYY-MM-DD (for example 2026-01-01). `
        + 'It is compared with each row\'s document date. Refused before the walk read or wrote any row.',
    );
  }
  const plan = planHomeAmounts(schema);
  if (plan.length === 0) {
    throw refusal(
      'INVALID_FIELD',
      `[home-amount-recompute] '${object}' declares no home amount: none of its currency fields declares `
        + `currencyConfig: { currencyMode: 'record', homeAmount: { field, rateDate, rateField } }, so it stores no `
        + 'converted amount to recompute. Refused before the walk read or wrote any row.',
    );
  }
  if (field === undefined) return plan;
  const entry = plan.find((e) => e.amountField === field);
  if (!entry) {
    throw refusal(
      'INVALID_FIELD',
      `[home-amount-recompute] '${object}.${field}' declares no home amount. The amounts of '${object}' that do: `
        + `${plan.map((e) => `'${e.amountField}'`).join(', ')}. Refused before the walk read or wrote any row.`,
      field,
    );
  }
  return [entry];
}

/** Do two stored numbers spell the same decimal (`71994.24`, `'71994.2400'`)? Both blank is the same. */
function sameStoredNumber(a: unknown, b: unknown): boolean {
  const blankA = a === undefined || a === null || a === '';
  const blankB = b === undefined || b === null || b === '';
  if (blankA || blankB) return blankA && blankB;
  const x = toScaledDecimal(a);
  const y = toScaledDecimal(b);
  if (x === undefined || y === undefined) return Object.is(a, b);
  const scale = Math.max(x.scale, y.scale);
  return x.digits * 10n ** BigInt(scale - x.scale) === y.digits * 10n ** BigInt(scale - y.scale);
}

/**
 * Recompute the stored home amounts of `options.object`.
 *
 * Dry run unless `options.apply` — a dry run writes nothing at all, so the
 * report can be reviewed before any row changes. Refusals before the walk:
 * an unknown object (`OBJECT_NOT_FOUND`), no home amount to recompute
 * (`INVALID_FIELD`), and a `since` that is not `YYYY-MM-DD`
 * (`VALIDATION_FAILED`).
 */
export async function recomputeHomeAmounts(
  engine: HomeAmountRecomputeEngine,
  logger: HomeAmountRecomputeLogger,
  options: HomeAmountRecomputeOptions,
): Promise<HomeAmountRecomputeReport> {
  const apply = options.apply === true;
  const { object } = options;
  const plan = resolvePlan(engine, options);
  const since = options.since ?? null;
  const maxListed = options.maxListed ?? DEFAULT_MAX_LISTED;
  const declared = engine.getObject(object)?.fields ?? {};

  const report: HomeAmountRecomputeReport = {
    object,
    fields: plan.map((e) => ({
      field: e.amountField,
      codeField: e.codeField,
      homeField: e.homeField,
      rateField: e.rateField,
      rateDateField: e.rateDateField,
    })),
    since,
    applied: apply,
    scannedRecords: 0,
    amounts: 0,
    unchanged: 0,
    changed: 0,
    written: 0,
    outsideSince: 0,
    skippedTotal: 0,
    skippedByReason: zeroReasons(),
    organizations: [],
    changes: [],
    changesTruncated: false,
    skipped: [],
    skippedTruncated: false,
    failures: [],
    truncated: false,
    audit: { written: false, reason: 'dry_run' },
  };
  // Every skipped amount, for the audit entry (capped there), kept apart from the report's own cap.
  const auditSkips: HomeAmountRecomputeSkip[] = [];
  const organizations = new Map<string, HomeAmountRecomputeOrganization>();

  const columns = new Set<string>(['id']);
  for (const name of ['organization_id', 'updated_at']) if (name in declared) columns.add(name);
  for (const e of plan) for (const name of [e.amountField, e.codeField, e.rateDateField, e.homeField, e.rateField]) columns.add(name);

  // Seek by `id`: this run's claim is about EVERY stored row, which an offset walk cannot promise.
  const walk = keysetWalk<Record<string, unknown>>(
    (q: KeysetPageQuery) => engine.find(object, { ...q, fields: [...columns], context: { ...SYSTEM_CTX } }),
    { pageSize: SCAN_PAGE_SIZE, max: options.maxRecords ?? 100_000 },
  );

  for await (const page of walk.pages()) {
    // The write's own reads, memoized across this page as one write memoizes across its batch.
    const reads = engine.homeAmountReadsFor({ ...SYSTEM_CTX });
    const serving = reads.serving;
    for (const row of page) {
      report.scannedRecords++;
      const id = row.id;
      if (id == null || id === '') continue;
      const recordId = String(id);
      // The organization the write converts this row under: the write's own reading.
      const organizationId = reads.organizationOf(row) ?? null;
      const org = await organizationEntry(organizations, serving, organizationId);
      const patch: Record<string, unknown> = {};

      for (const entry of plan) {
        if (since !== null) {
          const day = isRecordCurrencyBlank(row[entry.rateDateField])
            ? undefined
            : documentDateOf(row[entry.rateDateField], entry.rateDateIsInstant ? await serving.timezone(organizationId ?? undefined) : undefined);
          if (day === undefined || day < since) {
            report.outsideSince++;
            org.outsideSince++;
            continue;
          }
        }
        report.amounts++;
        org.amounts++;
        const skip = (reason: HomeAmountSkipReason, extra: { currency?: string; date?: string } = {}) => {
          report.skippedTotal++;
          report.skippedByReason[reason]++;
          org.skipped[reason]++;
          const item: HomeAmountRecomputeSkip = { recordId, organizationId, field: entry.amountField, reason, ...extra };
          if (report.skipped.length < maxListed) report.skipped.push(item);
          else report.skippedTruncated = true;
          if (auditSkips.length < AUDIT_MAX_LISTED) auditSkips.push(item);
        };

        // A blank code beside an amount is its own class: there is no currency to convert from
        // (the projection leaves such an entry out, so the code-blank refusal can answer instead).
        if (!isRecordCurrencyBlank(row[entry.amountField]) && isRecordCurrencyBlank(row[entry.codeField])) {
          skip('code_blank');
          continue;
        }

        let projected: Record<string, unknown>;
        try {
          projected = await projectHomeAmounts([entry], row, serving, {
            object,
            operation: 'update',
            organizationId: organizationId ?? undefined,
            recordId,
          });
        } catch (err) {
          const code = (err as { code?: unknown })?.code;
          const currency = typeof row[entry.codeField] === 'string' ? (row[entry.codeField] as string).trim() : undefined;
          if (isHomeAmountRefusal(err)) {
            if (code === EXCHANGE_RATE_MISSING_CODE) {
              skip('rate_missing', { currency, date: (err as { date: string }).date });
            } else {
              skip('home_currency_unset', { currency });
            }
            continue;
          }
          if (code === VALIDATION_FAILED_CODE) {
            skip('document_date_blank', { currency });
            continue;
          }
          throw err;
        }
        // The projection leaves out an entry whose inputs the write's validator refuses.
        if (!(entry.homeField in projected)) {
          skip('unconvertible', typeof row[entry.codeField] === 'string' ? { currency: String(row[entry.codeField]) } : {});
          continue;
        }

        const to = { home: projected[entry.homeField], rate: projected[entry.rateField] };
        const from = { home: row[entry.homeField] ?? null, rate: row[entry.rateField] ?? null };
        if (sameStoredNumber(from.home, to.home) && sameStoredNumber(from.rate, to.rate)) {
          report.unchanged++;
          org.unchanged++;
          continue;
        }
        report.changed++;
        org.changed++;
        if (report.changes.length < maxListed) report.changes.push({ recordId, organizationId, field: entry.amountField, from, to });
        else report.changesTruncated = true;
        // The write recomputes over whatever the payload holds for the home field: the
        // projection the write runs is the value stored, never this preview's.
        patch[entry.homeField] = to.home;
      }

      if (!apply || Object.keys(patch).length === 0) continue;
      try {
        await withTransientRetry(
          () => engine.update(
            object,
            {
              id,
              ...patch,
              ...(row.updated_at !== undefined && row.updated_at !== null ? { updated_at: row.updated_at } : {}),
            },
            { context: { ...SYSTEM_PRESERVING_CTX } },
          ),
          options.retry ?? {},
        );
        // Bumped AFTER the retry settles, never inside the retried closure.
        report.written++;
        org.written++;
      } catch (err) {
        // One row's failure must not abort the rest; a re-run revisits it, because it still differs.
        const message = (err as Error)?.message ?? String(err);
        logger.warn(`[home-amount-recompute] ${object} record ${recordId}: ${message}`);
        report.failures.push({ recordId, error: message });
      }
    }
  }
  if (walk.truncated) report.truncated = true;
  report.organizations = [...organizations.values()].sort((a, b) =>
    a.organizationId === b.organizationId ? 0 : a.organizationId === null ? 1 : b.organizationId === null ? -1 : a.organizationId < b.organizationId ? -1 : 1,
  );

  if (apply) report.audit = await writeAuditEntry(engine, logger, report, auditSkips, options.source);
  return report;
}

async function organizationEntry(
  organizations: Map<string, HomeAmountRecomputeOrganization>,
  serving: HomeAmountServing,
  organizationId: string | null,
): Promise<HomeAmountRecomputeOrganization> {
  const key = organizationId ?? '\u0000';
  let org = organizations.get(key);
  if (!org) {
    const home = await serving.homeCurrency(organizationId ?? undefined);
    org = {
      organizationId,
      homeCurrency: typeof home === 'string' && home.trim() !== '' ? home.trim() : null,
      amounts: 0,
      unchanged: 0,
      changed: 0,
      written: 0,
      skipped: zeroReasons(),
      outsideSince: 0,
    };
    organizations.set(key, org);
  }
  return org;
}

/**
 * The applied run's one `sys_audit_log` entry: a deployment-level `update`
 * (no record; the run spans organizations) whose `metadata` carries the run —
 * its scope, its counts per organization and reason, the skipped rows and the
 * failures (each capped at {@link AUDIT_MAX_LISTED}). Asks the registry first:
 * a composition without the audit ledger has no table to write, and says so
 * through the report instead of a failed insert. A refused write does not undo
 * the run, which already landed: it is warned and reported.
 */
async function writeAuditEntry(
  engine: HomeAmountRecomputeEngine,
  logger: HomeAmountRecomputeLogger,
  report: HomeAmountRecomputeReport,
  skips: HomeAmountRecomputeSkip[],
  source: string | undefined,
): Promise<HomeAmountRecomputeAudit> {
  if (!engine.getObject(AUDIT_OBJECT)) return { written: false, reason: 'ledger_not_mounted' };
  const metadata = {
    event: 'home_amount.recompute',
    source: source ?? null,
    object: report.object,
    fields: report.fields.map((f) => f.field),
    since: report.since,
    scannedRecords: report.scannedRecords,
    amounts: report.amounts,
    unchanged: report.unchanged,
    changed: report.changed,
    written: report.written,
    outsideSince: report.outsideSince,
    skippedByReason: report.skippedByReason,
    organizations: report.organizations,
    skipped: skips,
    skippedListed: skips.length < report.skippedTotal ? `${skips.length} of ${report.skippedTotal}` : undefined,
    failures: report.failures.slice(0, AUDIT_MAX_LISTED),
    truncated: report.truncated,
  };
  try {
    await engine.insert(
      AUDIT_OBJECT,
      { action: 'update', object_name: report.object, metadata: JSON.stringify(metadata) },
      { context: { ...SYSTEM_CTX } },
    );
    return { written: true };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    logger.warn(
      `[home-amount-recompute] the audit entry for this run was NOT written: the run itself landed `
        + `(${report.written} row(s) of ${report.object} rewritten), but ${AUDIT_OBJECT} refused the record of it, `
        + `so nothing in the ledger says who recomputed what. Cause: ${message}`,
    );
    return { written: false, reason: 'refused', error: message };
  }
}

/** Human-readable report body, shared by the CLI's dry-run and apply output. */
export function formatHomeAmountRecomputeReport(report: HomeAmountRecomputeReport): string[] {
  const lines: string[] = [];
  const fields = report.fields.map((f) => `${f.field} → ${f.homeField}`).join(', ');
  lines.push(
    `Scanned ${report.scannedRecords} row(s) of ${report.object} (${fields})`
      + (report.since ? `; document date on or after ${report.since}: ${report.amounts} amount(s), ${report.outsideSince} outside.` : `: ${report.amounts} amount(s).`),
  );
  for (const org of report.organizations) {
    const skipped = HOME_AMOUNT_SKIP_REASONS.filter((r) => org.skipped[r] > 0).map((r) => `${org.skipped[r]} ${r}`);
    lines.push(
      `  organization ${org.organizationId ?? '(none)'} · home ${org.homeCurrency ?? '(unset)'}: `
        + `${org.amounts} amount(s), ${org.unchanged} unchanged, ${org.changed} ${report.applied ? `changed (${org.written} row(s) written)` : 'would change'}`
        + (skipped.length > 0 ? `, skipped ${skipped.join(', ')}` : ''),
    );
  }
  if (report.changed === 0) {
    lines.push('✓ Every stored home amount already equals what a write would store now — nothing to recompute.');
  } else {
    lines.push(report.applied ? `Rewrote ${report.written} row(s) (${report.changed} amount(s)):` : `Would rewrite ${report.changed} amount(s):`);
    for (const c of report.changes) {
      lines.push(`  • ${c.recordId} ${c.field}: ${String(c.from.home)} @ ${String(c.from.rate)} → ${String(c.to.home)} @ ${String(c.to.rate)}`);
    }
    if (report.changesTruncated) lines.push(`  … and ${report.changed - report.changes.length} more`);
  }
  if (report.skippedTotal > 0) {
    lines.push(`✗ ${report.skippedTotal} amount(s) listed and NOT converted — a total over the home field leaves them out until fixed:`);
    for (const s of report.skipped) {
      const detail = s.reason === 'rate_missing'
        ? `no ${s.currency} rate on or before ${s.date}`
        : s.reason === 'code_blank' ? 'amount without a currency code' : s.reason.replace(/_/g, ' ');
      lines.push(`  • ${s.recordId} ${s.field} (organization ${s.organizationId ?? '(none)'}): ${detail}`);
    }
    if (report.skippedTruncated) lines.push(`  … and ${report.skippedTotal - report.skipped.length} more`);
    const remedies: string[] = [];
    if (report.skippedByReason.rate_missing > 0) remedies.push('rate_missing: add the exchange rate (Setup → Exchange Rates) and re-run');
    if (report.skippedByReason.code_blank > 0) {
      remedies.push(`code_blank: write the codes with \`os migrate record-currency-codes --object ${report.object} --field <amount> --code <ISO 4217>\`, then re-run`);
    }
    if (report.skippedByReason.document_date_blank > 0) remedies.push('document_date_blank: fill the document date, then re-run');
    if (report.skippedByReason.home_currency_unset > 0) remedies.push('home_currency_unset: set Localization → Default currency for the organization, then re-run');
    if (report.skippedByReason.unconvertible > 0) remedies.push('unconvertible: correct the code, amount or document date the write refuses, then re-run');
    for (const r of remedies) lines.push(`  → ${r}`);
  }
  if (report.failures.length > 0) {
    lines.push(`✗ ${report.failures.length} row(s) could not be written:`);
    for (const f of report.failures.slice(0, 5)) lines.push(`  • ${f.recordId}: ${f.error}`);
    if (report.failures.length > 5) lines.push(`  … and ${report.failures.length - 5} more`);
    lines.push('Re-running is safe: a row is only rewritten while its stored home amount differs.');
  }
  if (report.truncated) lines.push('⚠ Walk incomplete — some rows were not examined; re-run without the cap to finish.');
  if (report.applied) {
    lines.push(report.audit.written
      ? 'Recorded in the audit log (sys_audit_log, one entry for this run).'
      : `⚠ No audit entry for this run: ${report.audit.reason === 'ledger_not_mounted' ? 'the audit ledger (sys_audit_log) is not part of this composition' : `the audit ledger refused it (${report.audit.error ?? 'unknown'})`}.`);
  } else if (report.changed > 0) {
    lines.push('Dry run — no row or table was written. Re-run with --apply to recompute.');
  }
  return lines;
}

/**
 * Did this run leave every stored home amount equal to what a write would store
 * now? False while any amount is skipped (Open item 8: the gap keeps the run
 * open), any write failed, the walk was cut short, or a dry run found changes.
 */
export function homeAmountRecomputeComplete(report: HomeAmountRecomputeReport): boolean {
  return report.skippedTotal === 0
    && report.failures.length === 0
    && !report.truncated
    && (report.applied || report.changed === 0);
}
