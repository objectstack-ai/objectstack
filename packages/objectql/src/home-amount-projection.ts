// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144 D5, D7 parameters 3 and 4] The write-time home projection: a
 * `record`-mode amount declaring `currencyConfig.homeAmount` is converted into
 * the organization's home currency when it is written, and the result is
 * stored in the declared home field together with the rate it used.
 *
 * ## What one projection computes
 *
 * For each declaration, over the row IMAGE the write stores (the insert row
 * after every hook and strip, or the stored row with the final update payload
 * laid over it):
 *
 * - **A blank amount** stores a blank home amount and a blank rate. There is
 *   nothing to convert, so nothing is looked up and nothing is refused.
 * - **The home currency** is the organization's `localization.currency`
 *   setting, read through the host. Unset, the write is refused
 *   `ERR_HOME_CURRENCY_UNSET` / 400 (ADR-0144 Open item 4): the sources rule
 *   out a silent default, so the engine never picks one.
 * - **The same currency as home** stores rate `1` and the amount rounded to
 *   the home currency's minor units, with no rate lookup and no rate row
 *   needed (Open item 6).
 * - **A foreign currency** reads the rate row of that currency with the latest
 *   `effective_date` on or before the record's document date (Open item 2):
 *   never a row dated after the document, and never "the most recent row".
 *   None ⇒ the write is refused `ERR_EXCHANGE_RATE_MISSING` / 400, naming the
 *   currency and the date (D5: "a missing rate refuses the write"; no 1:1
 *   rate, no nearest row, no null home amount is stored in its place).
 * - **The arithmetic** is parameter 3: "1 home unit = `rate` units of the
 *   foreign currency", so the home amount is the record amount DIVIDED by the
 *   rate. It is exact decimal arithmetic on the decimal spellings of the two
 *   numbers (scaled integers, never a floating-point division), rounded once,
 *   half away from zero, to the home currency's ISO 4217 minor units read from
 *   `CURRENCY_FRACTION_DIGITS` (Open item 3): JPY 0, USD 2, KWD 3.
 * - **The rate stored** is the rate row's own value, never rounded (D1: the
 *   amount is stored "with the rate used"; a rounded rate would not reproduce
 *   the stored home amount). A rate field whose declared `scale` keeps fewer
 *   decimals than the rate carries refuses the write at the record
 *   validator's `max_scale` seam, as every number field does; the engine
 *   never rounds a value to fit a field.
 *
 * ## Who writes the two fields
 *
 * Only this projection. The spec makes the home and rate fields declare
 * `readonly: true`, so a caller's value for either is stripped before the
 * projection runs; the projection writes AFTER every strip, onto the payload
 * the driver stores, so its own values are never stripped. It also runs after
 * the field defaults, so a `defaultValue` on either field never stands: the
 * projection overwrites it. A writer the strips do not judge (a system write,
 * an update under `preserveAudit`) that sends the home or rate field triggers
 * the projection, which recomputes over it: the stored home amount is always
 * the declared conversion of the stored amount, never a copied-in number. A
 * corrected rate row reaches stored amounts only through an explicit
 * recompute, because an update that touches none of the amount, its code, its
 * document date or the two projected fields does not project at all (D5).
 */

import { isValueDomainMember } from '@objectstack/spec/shared';
import { CURRENCY_FRACTION_DIGITS } from '@objectstack/spec/data';
import { isRecordCurrencyBlank, recordCurrencyFieldOf } from './validation/record-currency-code.js';
import { ValidationError } from './validation/record-validator.js';

/** The object the rates are read from (ADR-0144 D3). */
export const EXCHANGE_RATE_OBJECT = 'sys_exchange_rate';

/** The ADR-0112 `code` {@link ExchangeRateMissingError} carries. */
export const EXCHANGE_RATE_MISSING_CODE = 'ERR_EXCHANGE_RATE_MISSING' as const;

/** The ADR-0112 `code` {@link HomeCurrencyUnsetError} carries. */
export const HOME_CURRENCY_UNSET_CODE = 'ERR_HOME_CURRENCY_UNSET' as const;

/** One `homeAmount` declaration, with the code field its amount is in. */
export interface HomeAmountPlanEntry {
  /** The `record`-mode `currency` field declaring `homeAmount`. */
  readonly amountField: string;
  /** Its `currencyConfig.currencyField`: the ISO 4217 code of the amount. */
  readonly codeField: string;
  /** `homeAmount.field`: where the home amount is stored. */
  readonly homeField: string;
  /** `homeAmount.rateDate`: the document date that picks the rate. */
  readonly rateDateField: string;
  /** `homeAmount.rateField`: where the rate used is stored. */
  readonly rateField: string;
}

/**
 * Every `homeAmount` declaration of an object's field map, in declaration
 * order. Read off the registered declaration: the spec already refused a
 * pointer at a missing or wrong-typed field, so a declaration here names
 * fields that exist. Empty for an object declaring none (the common case), so
 * an ordinary write pays one loop over its field names.
 */
export function planHomeAmounts(schema: unknown): HomeAmountPlanEntry[] {
  const fields = (schema as { fields?: unknown } | null | undefined)?.fields;
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) return [];
  const plan: HomeAmountPlanEntry[] = [];
  for (const [amountField, def] of Object.entries(fields as Record<string, unknown>)) {
    const codeField = recordCurrencyFieldOf(def);
    if (codeField === undefined) continue;
    const home = (def as { currencyConfig?: { homeAmount?: unknown } }).currencyConfig?.homeAmount;
    if (home === null || typeof home !== 'object') continue;
    const { field, rateDate, rateField } = home as { field?: unknown; rateDate?: unknown; rateField?: unknown };
    if (typeof field !== 'string' || typeof rateDate !== 'string' || typeof rateField !== 'string') continue;
    plan.push({ amountField, codeField, homeField: field, rateDateField: rateDate, rateField });
  }
  return plan;
}

/** The keys whose presence in an update payload makes the projection run for `entry`. */
function projectionInputs(entry: HomeAmountPlanEntry): readonly string[] {
  return [entry.amountField, entry.codeField, entry.rateDateField, entry.homeField, entry.rateField];
}

/**
 * The entries an update payload moves: it carries the amount, its code, its
 * document date, or one of the two projected fields. Only these are projected
 * on an update, so an edit of any other field never re-reads a rate (a
 * corrected rate reaches stored rows only through an explicit recompute).
 */
export function homeAmountsTouched(
  plan: readonly HomeAmountPlanEntry[],
  payload: Record<string, unknown> | null | undefined,
): HomeAmountPlanEntry[] {
  if (!payload || plan.length === 0) return [];
  return plan.filter((entry) => projectionInputs(entry).some((key) => Object.prototype.hasOwnProperty.call(payload, key)));
}

// ── Exact decimal arithmetic ──────────────────────────────────────────────

/** A decimal as a scaled integer: the value is `digits / 10^scale`. */
export interface ScaledDecimal {
  readonly digits: bigint;
  readonly scale: number;
}

const DECIMAL_SPELLING = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * The exact decimal a stored or written number spells, or `undefined` when it
 * spells none. A JavaScript number is read through its shortest round-trip
 * spelling (`String(0.1389)` is `'0.1389'`), which is the decimal the writer
 * wrote; a string (a driver answering an exact-decimal column as text) is read
 * as written. Exponent spellings are accepted.
 */
export function toScaledDecimal(value: unknown): ScaledDecimal | undefined {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    text = String(value);
  } else if (typeof value === 'bigint') {
    text = value.toString();
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return undefined;
  }
  const m = DECIMAL_SPELLING.exec(text);
  if (!m) return undefined;
  const [, sign, int = '', frac = '', exp] = m;
  if (int === '' && frac === '') return undefined;
  let digits = BigInt(`${int}${frac}` || '0');
  let scale = frac.length - (exp === undefined ? 0 : Number(exp));
  if (scale < 0) {
    digits *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { digits: sign === '-' ? -digits : digits, scale };
}

const abs = (n: bigint): bigint => (n < 0n ? -n : n);

/**
 * `numerator / denominator`, rounded to an integer half away from zero —
 * the one rounding step of the projection.
 */
function divideRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = abs(numerator);
  const d = abs(denominator);
  let q = n / d;
  if ((n % d) * 2n >= d) q += 1n;
  return negative ? -q : q;
}

/**
 * `amount ÷ rate`, rounded once, half away from zero, to `places` decimals —
 * parameter 3 as arithmetic. Both operands are exact; so is every
 * intermediate.
 */
export function divideToPlaces(amount: ScaledDecimal, rate: ScaledDecimal, places: number): ScaledDecimal {
  // (a / 10^as) / (r / 10^rs) × 10^places = a × 10^(rs + places) / (r × 10^as)
  const numerator = amount.digits * 10n ** BigInt(rate.scale + places);
  const denominator = rate.digits * 10n ** BigInt(amount.scale);
  return { digits: divideRoundHalfAwayFromZero(numerator, denominator), scale: places };
}

/** The canonical decimal spelling of a scaled decimal (`-1234.50` for `{ -123450n, 2 }`). */
export function formatScaledDecimal(value: ScaledDecimal): string {
  const text = abs(value.digits).toString().padStart(value.scale + 1, '0');
  const body = value.scale === 0 ? text : `${text.slice(0, -value.scale)}.${text.slice(-value.scale)}`;
  return value.digits < 0n ? `-${body}` : body;
}

/**
 * The number the home field stores: the rounded decimal's own spelling read
 * back as a number. A currency value is a bare number (ADR-0104 D1); the
 * arithmetic that produced it never touched a float.
 */
function toStoredNumber(value: ScaledDecimal): number {
  const n = Number(formatScaledDecimal(value));
  return Object.is(n, -0) ? 0 : n;
}

// ── The document date ─────────────────────────────────────────────────────

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar date a document-date value names, as `YYYY-MM-DD`, or
 * `undefined` when it names none. A `date` value is its own calendar date. A
 * `datetime` value is an instant, and its calendar date is taken in UTC — the
 * one reading that gives every write path (a REST write, an import, a flow)
 * the same rate for the same stored instant, whatever zone the writer's
 * request carried.
 */
export function documentDateOf(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (CALENDAR_DATE.test(text)) return text;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString().slice(0, 10);
}

// ── What the projection reads ─────────────────────────────────────────────

/** The rate row the projection picked. */
export interface ExchangeRateRow {
  readonly rate: unknown;
  readonly effectiveDate: string | undefined;
}

/**
 * What a projection reads from outside the row, for one organization. The
 * engine supplies it per write, memoized, so a batch of N rows in one
 * currency and date asks the rate table once.
 */
export interface HomeAmountServing {
  /** The organization's `localization.currency`, or `undefined` when unset. */
  homeCurrency(organizationId: string | undefined): Promise<string | undefined>;
  /** The `currency` row with the latest `effective_date` on or before `onOrBefore`, or `undefined`. */
  rateOn(organizationId: string | undefined, currency: string, onOrBefore: string): Promise<ExchangeRateRow | undefined>;
}

/** Wrap a serving so each (organization, currency, date) and each organization's home currency is read once. */
export function memoizeHomeAmountServing(serving: HomeAmountServing): HomeAmountServing {
  const homes = new Map<string, Promise<string | undefined>>();
  const rates = new Map<string, Promise<ExchangeRateRow | undefined>>();
  return {
    homeCurrency(organizationId) {
      const key = organizationId ?? '';
      let hit = homes.get(key);
      if (!hit) {
        hit = serving.homeCurrency(organizationId);
        homes.set(key, hit);
      }
      return hit;
    },
    rateOn(organizationId, currency, onOrBefore) {
      const key = `${organizationId ?? ''}\u0000${currency}\u0000${onOrBefore}`;
      let hit = rates.get(key);
      if (!hit) {
        hit = serving.rateOn(organizationId, currency, onOrBefore);
        rates.set(key, hit);
      }
      return hit;
    },
  };
}

// ── The refusals ──────────────────────────────────────────────────────────

const verb = (operation: 'insert' | 'update') => (operation === 'insert' ? 'Insert' : 'Update');
const rowPhrase = (recordId: unknown) => (recordId === undefined || recordId === null ? '' : ` (record ${String(recordId)})`);

/**
 * `ERR_EXCHANGE_RATE_MISSING` / 400 — no rate row for the record's currency
 * is in force on its document date (ADR-0144 D5, Open item 9). Identified by
 * `code`, which survives crossing package boundaries.
 */
export class ExchangeRateMissingError extends Error {
  readonly code = EXCHANGE_RATE_MISSING_CODE;
  readonly status = 400;
  /** The same number under ADR-0112 D5's spelling. */
  readonly httpStatus = 400;
  /** The object written. */
  readonly object: string;
  /** The amount that could not be converted. */
  readonly field: string;
  /** Its currency: the code of the rate row that is missing. */
  readonly currency: string;
  /** The document date, `YYYY-MM-DD`: no row is in force on or before it. */
  readonly date: string;
  /** The organization's home currency the amount was to be converted into. */
  readonly homeCurrency: string;

  constructor(
    object: string,
    operation: 'insert' | 'update',
    entry: HomeAmountPlanEntry,
    currency: string,
    date: string,
    homeCurrency: string,
    recordId?: unknown,
  ) {
    super(
      `${verb(operation)} on '${object}'${rowPhrase(recordId)} was REFUSED: '${entry.amountField}' is in ${currency} `
        + `and is converted into the home currency ${homeCurrency} at the rate in force on its document date `
        + `('${entry.rateDateField}' = ${date}), and no exchange rate for ${currency} has an effective date on or `
        + `before ${date}. The row was not written. Add an exchange rate for ${currency} effective on or before `
        + `${date} (Setup → Exchange Rates; a rate states how many ${currency} one ${homeCurrency} buys), then write `
        + `again. A missing rate is never replaced by 1, by a later rate, or by an empty home amount.`,
    );
    this.name = 'ExchangeRateMissingError';
    this.object = object;
    this.field = entry.amountField;
    this.currency = currency;
    this.date = date;
    this.homeCurrency = homeCurrency;
  }
}

/**
 * `ERR_HOME_CURRENCY_UNSET` / 400 — the organization has no home currency, so
 * an amount declaring a home amount cannot be converted (ADR-0144 Open item
 * 4). Identified by `code`.
 */
export class HomeCurrencyUnsetError extends Error {
  readonly code = HOME_CURRENCY_UNSET_CODE;
  readonly status = 400;
  /** The same number under ADR-0112 D5's spelling. */
  readonly httpStatus = 400;
  /** The object written. */
  readonly object: string;
  /** The amount whose home amount could not be computed. */
  readonly field: string;
  /** The setting to fill, `namespace.key`. */
  readonly setting = 'localization.currency';

  constructor(object: string, operation: 'insert' | 'update', entry: HomeAmountPlanEntry, held: string | undefined, recordId?: unknown) {
    const state = held === undefined
      ? 'the organization has no home currency: the setting Localization → Default currency (localization.currency) is not set'
      : `the organization's home currency setting Localization → Default currency (localization.currency) holds '${held}', which is not an ISO 4217 currency code`;
    super(
      `${verb(operation)} on '${object}'${rowPhrase(recordId)} was REFUSED: '${entry.amountField}' stores its amount `
        + `converted into the home currency in '${entry.homeField}', and ${state}. The row was not written. `
        + `Set Localization → Default currency to the organization's home currency (for example USD), then write `
        + `again. The platform never assumes a home currency.`,
    );
    this.name = 'HomeCurrencyUnsetError';
    this.object = object;
    this.field = entry.amountField;
  }
}

/** Is this one of the projection's own refusals? */
export function isHomeAmountRefusal(e: unknown): e is ExchangeRateMissingError | HomeCurrencyUnsetError {
  return e instanceof ExchangeRateMissingError || e instanceof HomeCurrencyUnsetError;
}

// ── The projection ────────────────────────────────────────────────────────

const isIsoCurrency = (code: string): boolean => isValueDomainMember('iso_4217_currency', code);

/** Where a projection runs: whose organization, which operation, which record. */
export interface HomeAmountWrite {
  readonly object: string;
  readonly operation: 'insert' | 'update';
  readonly organizationId: string | undefined;
  readonly recordId?: unknown;
}

/**
 * Project every entry of `plan` over one row `image` and answer the values to
 * write: for each entry, its home field and its rate field. Reads through
 * `serving`; never mutates `image`.
 *
 * An entry whose inputs another check refuses is left out, so that check
 * answers instead of a rate lookup over a value that will never be stored: a
 * blank code (`ERR_CURRENCY_CODE_REQUIRED`), a code that is not ISO 4217 or
 * an amount or document date that does not parse (the record validator).
 *
 * @throws HomeCurrencyUnsetError   no usable `localization.currency`
 * @throws ExchangeRateMissingError no rate row in force on the document date
 * @throws ValidationError          a foreign amount with a blank document date
 */
export async function projectHomeAmounts(
  plan: readonly HomeAmountPlanEntry[],
  image: Record<string, unknown>,
  serving: HomeAmountServing,
  write: HomeAmountWrite,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const entry of plan) {
    const amountValue = image[entry.amountField];
    if (isRecordCurrencyBlank(amountValue)) {
      out[entry.homeField] = null;
      out[entry.rateField] = null;
      continue;
    }
    const amount = toScaledDecimal(amountValue);
    const codeValue = image[entry.codeField];
    if (amount === undefined || isRecordCurrencyBlank(codeValue) || typeof codeValue !== 'string') continue;
    const code = codeValue.trim();
    if (!isIsoCurrency(code)) continue;

    const homeValue = await serving.homeCurrency(write.organizationId);
    const home = typeof homeValue === 'string' && homeValue.trim() !== '' ? homeValue.trim() : undefined;
    if (home === undefined || !isIsoCurrency(home)) {
      throw new HomeCurrencyUnsetError(write.object, write.operation, entry, home, write.recordId);
    }
    const places = CURRENCY_FRACTION_DIGITS[home]!;

    if (code === home) {
      // Open item 6: the same currency as home converts at 1, with no lookup.
      out[entry.homeField] = toStoredNumber(divideToPlaces(amount, { digits: 1n, scale: 0 }, places));
      out[entry.rateField] = 1;
      continue;
    }

    const dateValue = image[entry.rateDateField];
    if (isRecordCurrencyBlank(dateValue)) {
      throw new ValidationError([{
        field: entry.rateDateField,
        code: 'required',
        message: `'${entry.rateDateField}' is required to convert '${entry.amountField}' (${code}) into the home `
          + `currency ${home}: the exchange rate is the one in force on this date`,
      }]);
    }
    const date = documentDateOf(dateValue);
    if (date === undefined) continue;

    const row = await serving.rateOn(write.organizationId, code, date);
    const rate = row ? toScaledDecimal(row.rate) : undefined;
    if (!row || rate === undefined || rate.digits <= 0n) {
      throw new ExchangeRateMissingError(write.object, write.operation, entry, code, date, home, write.recordId);
    }
    out[entry.homeField] = toStoredNumber(divideToPlaces(amount, rate, places));
    out[entry.rateField] = typeof row.rate === 'number' ? row.rate : Number(formatScaledDecimal(rate));
  }
  return out;
}

/**
 * The one patch a PREDICATE update can store for the projected fields of the
 * entries it touches, judged over every matched row's projection. `updateMany`
 * writes ONE patch to all of them, so a projected field is set only when it
 * comes out the same on every matched row (the payload moved every row to one
 * currency, amount and date, say). A patch that would project different
 * values on different rows cannot be one statement, and is refused before
 * anything is written: update those rows by id, where each is projected from
 * its own stored row. A caller's value for a projected field never stands
 * either way — the stored-expression rule for a predicate update, applied to
 * the home projection.
 */
export function settleBulkHomeAmounts(
  touched: readonly HomeAmountPlanEntry[],
  patch: Record<string, unknown>,
  projected: ReadonlyArray<Record<string, unknown>>,
  object: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch };
  const refused: Array<{ field: string; code: 'invalid_value'; message: string }> = [];
  for (const entry of touched) {
    for (const name of [entry.homeField, entry.rateField]) {
      delete out[name];
      if (projected.length === 0) continue;
      const first = projected[0]![name];
      if (projected.every((values) => Object.is(values[name], first))) {
        if (first !== undefined) out[name] = first;
        continue;
      }
      refused.push({
        field: name,
        code: 'invalid_value',
        message: `'${name}' on '${object}' is the engine's conversion of '${entry.amountField}' into the home currency, `
          + 'and this update moves its inputs on rows where it then converts to different values, which one update '
          + 'of all the matched rows cannot store; update those rows by id, so each is converted from its own row',
      });
    }
  }
  if (refused.length > 0) throw new ValidationError(refused);
  return out;
}
