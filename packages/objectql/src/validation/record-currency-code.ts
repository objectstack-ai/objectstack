// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144 D2, D8 rule 4] A `record`-mode amount is stored with its currency
 * code, or the write is refused.
 *
 * A `currency` field declaring `currencyConfig: { currencyMode: 'record',
 * currencyField }` holds a bare number (ADR-0104 D1) whose currency is the
 * ISO 4217 code in the sibling field `currencyField` names. An amount stored
 * beside a blank code is a number in no currency: every reader would label it
 * with something it never was. The ADR's design rule 4 settles who supplies
 * the code: a form pre-fills the organization's currency at the renderer, and
 * the stored value is always the one submitted — the server never fills one
 * in. This refusal is what makes that true.
 *
 * ## What is judged
 *
 * The row's IMAGE after the write — the insert row as the driver will store
 * it, or the stored row with the update payload laid over it. A pair is
 * judged when its amount holds a value and its code field is blank (absent,
 * `null`, or a string with no characters but white space). A blank amount
 * needs no code; a code that is not an ISO 4217 member is the code field's
 * own `valueDomain` refusal, judged by the record validator, not here.
 *
 * On an update only the pairs the payload touches — it carries the amount or
 * the code — are judged, as every other write-time rule here judges only what
 * a write changes: a row stored before the amount was declared `record` is
 * not refused for an edit of an unrelated field.
 *
 * ## The answer
 *
 * `ERR_CURRENCY_CODE_REQUIRED` / 400, registered under `@objectstack/objectql`
 * in the ADR-0112 ledger (ADR-0144 Open item 9), naming the code field in
 * `field` and the amount in `amountField`. A top-level code rather than a
 * field-level `VALIDATION_FAILED` entry because the ADR assigns this refusal
 * to ADR-0112's vocabulary, and a client that pre-fills the code recognises it
 * by that name.
 */

/** The ADR-0112 `code` {@link RecordCurrencyCodeRequiredError} carries. */
export const CURRENCY_CODE_REQUIRED_CODE = 'ERR_CURRENCY_CODE_REQUIRED' as const;

/** One record-mode amount and the field that holds its currency code. */
export interface RecordCurrencyPair {
  /** The `currency` field declaring `currencyMode: 'record'`. */
  readonly amountField: string;
  /** Its `currencyConfig.currencyField` — the sibling ISO 4217 code field. */
  readonly codeField: string;
}

/**
 * The code field a declared field's amount is in, when the field is a
 * `record`-mode `currency` field naming one — `undefined` otherwise. Read off
 * the declaration as registered: the parse already refused a `record` config
 * with no pointer, and a body that skipped the parse and carries none names no
 * currency this seam could judge.
 */
export function recordCurrencyFieldOf(def: unknown): string | undefined {
  if (def === null || typeof def !== 'object') return undefined;
  const { type, currencyConfig } = def as { type?: unknown; currencyConfig?: unknown };
  if (type !== 'currency' || currencyConfig === null || typeof currencyConfig !== 'object') return undefined;
  const { currencyMode, currencyField } = currencyConfig as { currencyMode?: unknown; currencyField?: unknown };
  return currencyMode === 'record' && typeof currencyField === 'string' && currencyField !== ''
    ? currencyField
    : undefined;
}

/** Every record-mode amount an object's field map declares, in declaration order. */
export function recordCurrencyPairs(fields: unknown): RecordCurrencyPair[] {
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) return [];
  const pairs: RecordCurrencyPair[] = [];
  for (const [amountField, def] of Object.entries(fields as Record<string, unknown>)) {
    const codeField = recordCurrencyFieldOf(def);
    if (codeField !== undefined) pairs.push({ amountField, codeField });
  }
  return pairs;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/**
 * `ERR_CURRENCY_CODE_REQUIRED` / 400 — see the module header. Identified by
 * `code`, which survives crossing package boundaries.
 */
export class RecordCurrencyCodeRequiredError extends Error {
  readonly code = CURRENCY_CODE_REQUIRED_CODE;
  readonly status = 400;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads. `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = 400;
  /** The object written. */
  readonly object: string;
  /** The first blank code field — the one the caller must fill. */
  readonly field: string;
  /** Every blank code field of the row, first included. */
  readonly fields: string[];
  /** The record-mode amount whose currency `field` holds. */
  readonly amountField: string;

  constructor(object: string, operation: 'insert' | 'update', hits: readonly RecordCurrencyPair[], recordId?: unknown) {
    const [first] = hits;
    const row = recordId === undefined || recordId === null ? '' : ` (record ${String(recordId)})`;
    super(
      `${operation === 'insert' ? 'Insert' : 'Update'} on '${object}'${row} was REFUSED: '${first.amountField}' `
        + `holds an amount in the record's own currency (currencyMode: 'record'), and its currency code field `
        + `'${first.codeField}' is blank`
        + (hits.length > 1 ? ` (also: ${hits.slice(1).map((h) => `'${h.codeField}' for '${h.amountField}'`).join(', ')})` : '')
        + `. The row was not written. Write the record's ISO 4217 code (for example 'USD') into '${first.codeField}' `
        + `in the same write, or leave '${first.amountField}' empty. The server never fills a currency in: a form `
        + `pre-fills the organization's currency, and the stored code is always the one submitted.`,
    );
    this.name = 'RecordCurrencyCodeRequiredError';
    this.object = object;
    this.field = first.codeField;
    this.fields = [...new Set(hits.map((h) => h.codeField))];
    this.amountField = first.amountField;
  }
}

/**
 * Refuse a row image whose record-mode amount holds a value beside a blank
 * currency code — see the module header.
 *
 * @param image   the row as it will be stored (insert row, or stored row ⊕ payload)
 * @param touched an update's payload: only the pairs it carries a key of are judged;
 *                omitted on insert, where every pair is judged
 */
export function assertRecordCurrencyCodes(
  object: string,
  fields: unknown,
  image: Record<string, unknown> | null | undefined,
  operation: 'insert' | 'update',
  touched?: Record<string, unknown> | null,
  recordId?: unknown,
): void {
  if (!image) return;
  const pairs = recordCurrencyPairs(fields);
  if (pairs.length === 0) return;
  const has = (key: string) => touched != null && Object.prototype.hasOwnProperty.call(touched, key);
  const hits = pairs.filter((p) => {
    if (operation === 'update' && !has(p.amountField) && !has(p.codeField)) return false;
    return !isBlank(image[p.amountField]) && isBlank(image[p.codeField]);
  });
  if (hits.length > 0) throw new RecordCurrencyCodeRequiredError(object, operation, hits, recordId);
}

/**
 * Does an update payload touch any record-mode pair? The engine asks it before
 * paying for the stored rows a predicate update would otherwise not read.
 */
export function touchesRecordCurrency(fields: unknown, payload: Record<string, unknown> | null | undefined): boolean {
  if (!payload) return false;
  return recordCurrencyPairs(fields).some(
    (p) => Object.prototype.hasOwnProperty.call(payload, p.amountField)
      || Object.prototype.hasOwnProperty.call(payload, p.codeField),
  );
}
