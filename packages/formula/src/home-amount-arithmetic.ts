// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144 D5, D7 parameter 3, Open items 2 and 3] The home-amount
 * conversion arithmetic: exact decimal reading, the one division by the rate
 * rounded half away from zero, the canonical spelling, and the document date
 * a rate is picked for.
 *
 * Published here, not kept inside `@objectstack/objectql`, because two readers
 * must give the same answer: the engine's write-time home projection
 * (`@objectstack/objectql`'s `home-amount-projection.ts`, which imports these
 * back) and the form's live "≈ home amount" preview under `ui/`. A second
 * copy in the browser is exactly the drift a JPY (0 digits) or KWD (3 digits)
 * amount would hide. The fraction digits themselves stay in
 * `@objectstack/spec` (`CURRENCY_FRACTION_DIGITS`); this module is the
 * arithmetic only, and has no dependency of its own.
 */

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

// ── The document date ─────────────────────────────────────────────────────

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar date a document-date value names, as `YYYY-MM-DD`, or
 * `undefined` when it names none. A `date` value is its own calendar date, and
 * so is a bare `YYYY-MM-DD` spelling of any value. An instant (a `datetime`
 * value) is given `timezone`, the organization's `localization.timezone`
 * (IANA), and its calendar date is taken there (ruling 6539345871, letter B):
 * an invoice written at 01:00 in Shanghai is dated that Shanghai day. It is
 * the organization's setting and never the writer's request zone, so every
 * write path (a REST write, an import, a flow) picks the same rate for the
 * same stored instant. No timezone, or one `Intl` does not know, reads UTC,
 * the `localization.timezone` default — the `autonumber-format` reading.
 */
export function documentDateOf(value: unknown, timezone?: string): string | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : calendarDayIn(value, timezone);
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (CALENDAR_DATE.test(text)) return text;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? undefined : calendarDayIn(new Date(ms), timezone);
}

/** The `YYYY-MM-DD` calendar day of `instant` in `timezone` (IANA), UTC when absent or unknown. */
function calendarDayIn(instant: Date, timezone: string | undefined): string {
  if (timezone && timezone !== 'UTC') {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(instant);
      const y = parts.find((p) => p.type === 'year')?.value;
      const m = parts.find((p) => p.type === 'month')?.value;
      const d = parts.find((p) => p.type === 'day')?.value;
      if (y && m && d) return `${y}-${m}-${d}`;
    } catch {
      // An unknown zone reads UTC, below.
    }
  }
  return instant.toISOString().slice(0, 10);
}
