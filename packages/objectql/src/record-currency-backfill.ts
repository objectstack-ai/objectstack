// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The explicit backfill of the currency code a `record`-mode amount owes on
 * rows stored before the switch — `os migrate record-currency-codes`
 * (ADR-0144, maintainer ruling 6492000994 on the multi-currency epic, letter B).
 *
 * ## The hole this fills
 *
 * An existing `dynamic` or `fixed` amount field switched to
 * `currencyMode: 'record'` names a sibling code field (`currencyField`), and
 * the rows already stored hold an amount beside a blank code. The switch is
 * allowed, and nothing refuses such a row for resting: the write guard
 * (`validation/record-currency-code.ts`) judges only a write that touches the
 * pair (the ADR-0113 D1 posture). Until the code is written, though, the row
 * displays as a plain number, falls into the `null` group of a grouped
 * aggregate, and sits outside every currency-paired filter — and a home
 * currency projection has no code to convert it from. This run writes the code
 * into those rows, once.
 *
 * ## The code is the operator's, never derived
 *
 * Exactly one code is written, the one the caller supplies. ⛔ It is never
 * read from a retired `defaultCurrency`, from the tenant's
 * `localization.currency`, or from anything else (ADR-0144 D8 rule 4: the
 * stored code is always one somebody submitted). One run writes one code into
 * every codeless row of the field; a field whose stored amounts were in more
 * than one currency is split by the operator's own writes first, because
 * nothing here can tell those rows apart. The code is judged by the shared
 * `iso_4217_currency` membership predicate BEFORE any row is read: a code the
 * code field's own `valueDomain` would refuse is refused here as a whole,
 * instead of row by row.
 *
 * ## Which rows
 *
 * A row is filled when its amount is not blank and its code is blank, both
 * judged by {@link isRecordCurrencyBlank} — the write guard's own predicate, so
 * the rows filled are exactly the rows the guard would refuse on their next
 * write of the pair. A row that holds a code is never touched, whatever the
 * code; a row with a blank amount needs no code and is left alone. Each is
 * counted, so the report says why every row it read was or was not written.
 * Like `summary-backfill.ts`, the walk reads the columns and tests them in JS
 * rather than pushing a null predicate to the driver: null comparison is where
 * drivers diverge, and a backfill whose coverage depends on the driver skips
 * rows silently.
 *
 * ## Written through `engine.update`
 *
 * The precedent followed is `summary-backfill.ts` and every other `os migrate`
 * data run (`comment-parent-pair`, `activity-changed-fields`): one
 * `engine.update` per row, under the unscoped system context. The engine path
 * is the one that already judges this exact write — the record-mode guard sees
 * the payload touch the code and the stored amount beside it, and the code
 * field's `valueDomain` judges the code — so a write this run makes is one the
 * platform would accept from any caller, audited and hooked like any other.
 * A driver write would step around both and record nothing.
 *
 * ## One organization at a time (ADR-0144 Open item 13, ruling 6670707546 item A)
 *
 * Every organization has its own home currency (`localization.currency`), so
 * one code is right for the rows of at most the organizations that share it.
 * The run is scoped by organization:
 *
 * - `organizationId` walks and writes only that organization's rows. The walk
 *   and every `engine.update` run under `{ isSystem: true, tenantId }`, and the
 *   walk also filters on the row's own `organization_id`: the system context
 *   narrows the driver only under a walled tenancy posture
 *   (`engine-driver-read-scope.test.ts`), and a CLI boot reads the posture
 *   from its own shell, which need not be the server's.
 * - Neither `organizationId` nor `allOrganizations`: the rows are walked once,
 *   read-only, and counted per organization. When they belong to more than one
 *   organization the run is refused before any write, and the refusal carries
 *   each organization's codeless count. A database whose rows belong to one
 *   organization (or to none) runs exactly as before the scope existed.
 * - `allOrganizations` is the explicit way to write the one code into every
 *   organization's codeless rows, under the unscoped system context.
 *
 * ⛔ No organization's `localization.currency` is read here, let alone written
 * as a code (ADR-0144 D8 rule 4).
 *
 * ## Idempotent, and no deployment flag
 *
 * Every write turns a blank code into a member code, so a second run finds no
 * row to fill and writes nothing; "re-run until it reports zero" is the
 * operator's verification. Nothing gates on the run, so it records no
 * `sys_migration` flag (the `summary-nulls` reasoning: a flag nothing reads).
 */

import { keysetWalk, type KeysetPageQuery } from '@objectstack/types';
import { objectNotFoundError, withTransientRetry, type RetryOptions } from '@objectstack/core';
import { isValueDomainMember } from '@objectstack/spec/shared';

import { isRecordCurrencyBlank, recordCurrencyFieldOf } from './validation/record-currency-code.js';
import { isFederatedUnprovisionedInjectedColumn } from './federated-object.js';

/** One row whose code could not be written. */
export interface RecordCurrencyBackfillFailure {
  recordId: string;
  error: string;
}

/** The counts of one organization's rows (`organizationId` null: rows that name none). */
export interface RecordCurrencyBackfillOrganization {
  organizationId: string | null;
  scannedRecords: number;
  codeless: number;
  written: number;
  skippedCodePresent: number;
  skippedAmountBlank: number;
}

export interface RecordCurrencyBackfillReport {
  object: string;
  /** The organization the run was scoped to, or null for an unscoped run. */
  organizationId: string | null;
  /** The run was told to write the one code into every organization. */
  allOrganizations: boolean;
  /** The `record`-mode amount field. */
  field: string;
  /** Its `currencyConfig.currencyField` — the column this run writes. */
  codeField: string;
  /** The operator-supplied ISO 4217 code. */
  code: string;
  scannedRecords: number;
  /** Rows holding an amount beside a blank code — the rows this run fills. */
  codeless: number;
  /** Codes written (equal to `codeless` on an apply run with no failures;
   *  always 0 on a dry run — a dry run writes nothing). */
  written: number;
  /** Rows left alone because they already hold a code. */
  skippedCodePresent: number;
  /** Rows left alone because their amount is blank — no amount, no code owed. */
  skippedAmountBlank: number;
  /** A few codeless record ids, so an operator can go and look. */
  sampleRecordIds: string[];
  /** False on a dry run — no writes were made. */
  applied: boolean;
  /** The `maxRecords` cap cut the walk short. */
  truncated: boolean;
  /** Rows whose write failed after retries; the run continues past them. */
  failures: RecordCurrencyBackfillFailure[];
  /** The same counts per organization the walk met, ordered by id (null last). */
  organizations: RecordCurrencyBackfillOrganization[];
}

/** Engine surface the backfill needs: the object's declaration, a read, and
 *  the update verb every write of the pair goes through. */
export interface RecordCurrencyBackfillEngine {
  getObject(name: string): { fields?: Record<string, unknown> } | undefined;
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  update(object: string, data: Record<string, unknown>, options?: any): Promise<any>;
}

export interface RecordCurrencyBackfillLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
}

export interface RecordCurrencyBackfillOptions {
  /** The object whose rows are walked. */
  object: string;
  /** The `record`-mode `currency` field whose rows owe a code. */
  field: string;
  /** The ISO 4217 code to write, exactly as written (`USD`). Never derived. */
  code: string;
  /** Write the code. Omit for a read-only dry run. */
  apply?: boolean;
  /** Only this organization's rows are walked and written. */
  organizationId?: string;
  /** Write the one code into every organization's codeless rows. Never with `organizationId`. */
  allOrganizations?: boolean;
  /** Safety bound on rows read. */
  maxRecords?: number;
  /** Retry policy for one row's update; defaults to the transient defaults. */
  retry?: RetryOptions;
}

const SCAN_PAGE_SIZE = 500;
const MAX_SAMPLE_IDS = 5;
/** Unscoped by design, the context every `os migrate` data run uses:
 *  `isSystem` with no `tenantId` is what `buildDriverOptions` reads as "do not
 *  tenant-scope this", so every organization's rows are walked. */
const SYSTEM_CTX = { isSystem: true } as const;

type RefusalError = Error & { code: string; status: number; httpStatus: number; field: string };

/** The refusal of a run whose rows belong to more than one organization, with each one's counts. */
export type RecordCurrencyBackfillOrganizationsRefusal = RefusalError & {
  organizations: RecordCurrencyBackfillOrganization[];
};

function refusalOf(code: string, field: string, message: string): RefusalError {
  const err = new Error(message) as RefusalError;
  err.code = code;
  err.status = 400;
  // …and `httpStatus`, the same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads (the CLI `--json` envelope). `status` stays for the HTTP doors.
  err.httpStatus = 400;
  err.field = field;
  return err;
}

/** `INVALID_FIELD` / 400 — an option value this run cannot apply as written
 *  (the `summary-backfill.ts` envelope for the same condition). */
function invalidField(field: string, message: string): RefusalError {
  return refusalOf('INVALID_FIELD', field, message);
}

/** The scope options, judged before any row is read. Answers the organization column, when the object stores one. */
function resolveScope(
  engine: RecordCurrencyBackfillEngine,
  options: RecordCurrencyBackfillOptions,
): string | undefined {
  const { object, organizationId } = options;
  if (organizationId !== undefined && options.allOrganizations === true) {
    throw refusalOf(
      'VALIDATION_ERROR',
      'organizationId',
      `[record-currency-backfill] name one organization or all of them, not both: an organization scope and ` +
        `the all-organizations run exclude each other. Refused before the walk read or wrote any row.`,
    );
  }
  if (organizationId !== undefined && organizationId.trim() === '') {
    throw refusalOf(
      'VALIDATION_ERROR',
      'organizationId',
      `[record-currency-backfill] the organization id is blank: give the id of the organization whose rows ` +
        `are filled. Refused before the walk read or wrote any row.`,
    );
  }
  const schema = engine.getObject(object);
  const declared = schema?.fields ?? {};
  // The row's own organization, left out of the read on a federated object that does not provision it.
  const column = 'organization_id' in declared && !isFederatedUnprovisionedInjectedColumn(schema, 'organization_id')
    ? 'organization_id'
    : undefined;
  if (organizationId !== undefined && column === undefined) {
    throw invalidField(
      'organization_id',
      `[record-currency-backfill] '${object}' stores no organization_id, so its rows belong to no ` +
        `organization and cannot be scoped to '${organizationId}': run it without an organization. ` +
        'Refused before the walk read or wrote any row.',
    );
  }
  return column;
}

/**
 * Resolve the pair and judge the code BEFORE any row is read: an apply run
 * must not discover half way that it was asked to write a code the code
 * field refuses, or to fill a field that owes none.
 */
function resolvePair(
  engine: RecordCurrencyBackfillEngine,
  options: RecordCurrencyBackfillOptions,
): string {
  const { object, field, code } = options;
  const schema = engine.getObject(object);
  if (!schema) throw objectNotFoundError(object);
  const def = schema.fields?.[field];
  const codeField = recordCurrencyFieldOf(def);
  if (codeField === undefined) {
    throw invalidField(
      field,
      `[record-currency-backfill] '${object}.${field}' is not a record-mode currency field: ` +
        (def === undefined
          ? `'${object}' declares no field '${field}'. `
          : `it does not declare currencyConfig: { currencyMode: 'record', currencyField }. `) +
        'Only a currency field whose records each name their own currency owes a code. ' +
        'Refused before the walk read or wrote any row.',
    );
  }
  if (!isValueDomainMember('iso_4217_currency', code)) {
    throw invalidField(
      codeField,
      `[record-currency-backfill] '${code}' is not an ISO 4217 currency code, so '${object}.${codeField}' ` +
        `would refuse it: give the uppercase alphabetic code of the currency these amounts are in ` +
        `(for example USD). Refused before the walk read or wrote any row.`,
    );
  }
  return codeField;
}

/**
 * Write `options.code` into the code field of every row of `options.object`
 * whose `record`-mode amount `options.field` holds a value beside a blank code.
 *
 * Dry run unless `options.apply` — and a dry run writes nothing at all, so the
 * report can be reviewed before any row changes. An unknown object, a field
 * that is not a `record`-mode currency field, a code that is not an ISO 4217
 * member, an `organizationId` beside `allOrganizations`, and an
 * `organizationId` on an object that stores no organization throw before the
 * walk starts, on a dry run as on an apply run. With neither scope option, a
 * walk that meets the rows of more than one organization throws
 * `VALIDATION_ERROR` / 400 (`field: 'organizationId'`) carrying each
 * organization's counts in `organizations`, before any write.
 */
export async function backfillRecordCurrencyCodes(
  engine: RecordCurrencyBackfillEngine,
  logger: RecordCurrencyBackfillLogger,
  options: RecordCurrencyBackfillOptions,
): Promise<RecordCurrencyBackfillReport> {
  const apply = options.apply === true;
  const codeField = resolvePair(engine, options);
  const organizationColumn = resolveScope(engine, options);
  if (options.organizationId !== undefined || options.allOrganizations === true) {
    return walkCodelessRows(engine, logger, options, codeField, organizationColumn, apply);
  }
  // Unscoped: count first, write only when the rows belong to one organization.
  const preview = await walkCodelessRows(engine, logger, options, codeField, organizationColumn, false);
  const named = preview.organizations.filter((o) => o.organizationId !== null);
  if (named.length > 1) throw organizationsRefusal(preview, named);
  return apply ? walkCodelessRows(engine, logger, options, codeField, organizationColumn, true) : preview;
}

function organizationsRefusal(
  preview: RecordCurrencyBackfillReport,
  named: RecordCurrencyBackfillOrganization[],
): RecordCurrencyBackfillOrganizationsRefusal {
  const counts = preview.organizations
    .map((o) => `${o.organizationId ?? '(none)'}: ${o.codeless} codeless row(s)`)
    .join('; ');
  const err = refusalOf(
    'VALIDATION_ERROR',
    'organizationId',
    `[record-currency-backfill] the rows of '${preview.object}' belong to ${named.length} ` +
      `organizations (${counts}), and each organization has its own home currency, so one code is not known ` +
      'to be right for all of them. Name the organization whose rows are in this currency, one run per ' +
      'organization, or ask for every organization explicitly. Refused before any row was written.',
  ) as RecordCurrencyBackfillOrganizationsRefusal;
  err.organizations = preview.organizations;
  return err;
}

async function walkCodelessRows(
  engine: RecordCurrencyBackfillEngine,
  logger: RecordCurrencyBackfillLogger,
  options: RecordCurrencyBackfillOptions,
  codeField: string,
  organizationColumn: string | undefined,
  apply: boolean,
): Promise<RecordCurrencyBackfillReport> {
  const { object, field, code, organizationId } = options;
  // [ruling 6670707546 item A] A scoped run reads and writes as that organization.
  const context = organizationId !== undefined ? { ...SYSTEM_CTX, tenantId: organizationId } : { ...SYSTEM_CTX };

  const report: RecordCurrencyBackfillReport = {
    object,
    organizationId: organizationId ?? null,
    allOrganizations: options.allOrganizations === true,
    field,
    codeField,
    code,
    scannedRecords: 0,
    codeless: 0,
    written: 0,
    skippedCodePresent: 0,
    skippedAmountBlank: 0,
    sampleRecordIds: [],
    applied: apply,
    truncated: false,
    failures: [],
    organizations: [],
  };
  const organizations = new Map<string, RecordCurrencyBackfillOrganization>();
  const organizationOf = (row: Record<string, unknown>): RecordCurrencyBackfillOrganization => {
    const own = organizationColumn !== undefined ? row[organizationColumn] : undefined;
    const id = own === undefined || own === null || own === '' ? null : String(own);
    const key = id ?? '\u0000';
    let entry = organizations.get(key);
    if (!entry) {
      entry = { organizationId: id, scannedRecords: 0, codeless: 0, written: 0, skippedCodePresent: 0, skippedAmountBlank: 0 };
      organizations.set(key, entry);
    }
    return entry;
  };

  // Seek by `id` rather than offset: this run's claim is about EVERY stored
  // row, and an offset walk cannot promise it visited them all. A scoped walk
  // filters on the row's own organization as well as reading as it: the
  // context narrows the driver only under a walled posture.
  const walk = keysetWalk<Record<string, unknown>>(
    (q: KeysetPageQuery) => engine.find(object, {
      ...q,
      fields: organizationColumn !== undefined ? ['id', organizationColumn, field, codeField] : ['id', field, codeField],
      context: { ...context },
    }),
    {
      pageSize: SCAN_PAGE_SIZE,
      max: options.maxRecords ?? 100_000,
      ...(organizationId !== undefined && organizationColumn !== undefined
        ? { where: { [organizationColumn]: organizationId } }
        : {}),
    },
  );

  for await (const page of walk.pages()) {
    for (const row of page) {
      report.scannedRecords++;
      const org = organizationOf(row);
      org.scannedRecords++;
      const id = row.id;
      if (id == null || id === '') continue;
      // A code, any code, is the row's own: never overwritten.
      if (!isRecordCurrencyBlank(row[codeField])) {
        report.skippedCodePresent++;
        org.skippedCodePresent++;
        continue;
      }
      // No amount, no currency owed — the write guard asks none either.
      if (isRecordCurrencyBlank(row[field])) {
        report.skippedAmountBlank++;
        org.skippedAmountBlank++;
        continue;
      }
      report.codeless++;
      org.codeless++;
      if (report.sampleRecordIds.length < MAX_SAMPLE_IDS) report.sampleRecordIds.push(String(id));
      if (!apply) continue;
      try {
        await withTransientRetry(
          () => engine.update(object, { id, [codeField]: code }, { context: { ...context } }),
          options.retry ?? {},
        );
        // Bumped AFTER the retry settles, never inside the retried closure.
        report.written++;
        org.written++;
      } catch (err) {
        // One row's failure must not abort the rest. Recorded so the caller
        // can surface it; the run is idempotent, so a re-run revisits only
        // what is still codeless.
        const message = (err as any)?.message ?? String(err);
        logger.warn(`[record-currency-backfill] ${object} record ${String(id)}: ${message}`);
        report.failures.push({ recordId: String(id), error: message });
      }
    }
  }
  if (walk.truncated) report.truncated = true;
  report.organizations = [...organizations.values()].sort((a, b) =>
    a.organizationId === b.organizationId ? 0 : a.organizationId === null ? 1 : b.organizationId === null ? -1 : a.organizationId < b.organizationId ? -1 : 1,
  );
  return report;
}

/** Human-readable report body, shared by the CLI's dry-run and apply output. */
export function formatRecordCurrencyBackfillReport(report: RecordCurrencyBackfillReport): string[] {
  const lines: string[] = [];
  const pair = `${report.object}.${report.field}`;
  const scope = report.organizationId !== null
    ? ` in organization ${report.organizationId}`
    : report.allOrganizations ? ' in every organization' : '';
  lines.push(
    `Scanned ${report.scannedRecords} row(s) of ${report.object}${scope} for an amount in ${report.field} ` +
      `beside a blank currency code in ${report.codeField}.`,
  );
  // An unscoped run reaches here over one organization's rows: its lines stay as they were.
  if (report.allOrganizations) {
    for (const org of report.organizations) {
      lines.push(
        `  organization ${org.organizationId ?? '(none)'}: ${org.codeless} codeless row(s)` +
          (report.applied ? `, ${org.written} written` : ''),
      );
    }
  }
  if (report.codeless === 0) {
    lines.push(`✓ Every ${pair} amount already has its currency code — nothing to backfill.`);
  } else {
    lines.push(
      report.applied
        ? `Wrote ${report.code} into ${report.codeField} on ${report.written} of ${report.codeless} codeless row(s).`
        : `Would write ${report.code} into ${report.codeField} on ${report.codeless} codeless row(s).`,
      `  e.g. ${report.sampleRecordIds.join(', ')}`,
    );
  }
  lines.push(
    `· Skipped: ${report.skippedCodePresent} row(s) already holding a code (never overwritten), ` +
      `${report.skippedAmountBlank} row(s) with a blank amount (no code owed).`,
  );
  if (report.failures.length > 0) {
    lines.push(`✗ ${report.failures.length} row(s) could not be written:`);
    for (const f of report.failures.slice(0, MAX_SAMPLE_IDS)) lines.push(`  • ${f.recordId}: ${f.error}`);
    if (report.failures.length > MAX_SAMPLE_IDS) {
      lines.push(`  … and ${report.failures.length - MAX_SAMPLE_IDS} more`);
    }
    lines.push('Re-running is safe: the backfill only ever revisits rows whose code is still blank.');
  }
  if (report.truncated) {
    lines.push('⚠ Walk incomplete — some rows were not examined; re-run without the cap to finish.');
  }
  // Claims no row or table, never that nothing was written: the command that
  // prints it boots through the driver's connect, which can switch a SQLite
  // file's journal mode (its header, no row). The command appends that note.
  if (!report.applied && report.codeless > 0) {
    lines.push('Dry run — no row or table was written. Re-run with --apply to backfill.');
  }
  return lines;
}

/** Did this run leave the field with no known codeless row? */
export function recordCurrencyBackfillComplete(report: RecordCurrencyBackfillReport): boolean {
  return report.failures.length === 0 && !report.truncated && (report.applied || report.codeless === 0);
}
