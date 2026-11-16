// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `rmbUpper(amount)` — an amount of money as Chinese capital numerals
 * (人民币大写金额), the line a Chinese quote, contract, order confirmation or
 * invoice prints beside the figures: `245000` → `贰拾肆万伍仟元整`,
 * `10500.5` → `壹万零伍佰元伍角`.
 *
 * The rules are the ones bank and accounting documents follow:
 *
 *  - Digits 零壹贰叁肆伍陆柒捌玖, places 拾佰仟 inside a group of four, groups
 *    万 and 亿. A ten is written `壹拾` (`10` → `壹拾元整`), never a bare `拾`.
 *  - One `零` stands for any run of zeros inside the number, and none is
 *    written at the end of a group or of the yuan part: `1005` → `壹仟零伍`,
 *    `10500` → `壹万零伍佰`, `100000001` → `壹亿零壹`, `1000000` → `壹佰万`.
 *    A group of four that starts with zeros after a higher group takes a `零`
 *    (`壹万零伍佰`); a full group does not (`壹拾万柒仟`, the form the rules
 *    allow without the optional `零`).
 *  - Above 亿 the count of 亿 is itself written with 万: `10_0001_0000_0000`
 *    → `壹拾万零壹亿`. Amounts are refused from 10^16 (一亿亿) up.
 *  - The yuan part ends in `元`; with no 角 and no 分 the text ends in `整`.
 *    A 角 with no 分 ends at the 角 (`伍角`). A 分 with no 角 after a yuan part
 *    writes `零` for the empty 角 (`壹元零伍分`). An amount under one yuan is
 *    its 角 and 分 alone (`0.5` → `伍角`, `0.05` → `伍分`).
 *  - Zero is `零元整`. A negative amount is prefixed `负`; one that rounds to
 *    zero is `零元整`, never `负零元整`.
 *
 * The amount is rounded to 分 (two decimals) once, half away from zero, on
 * the exact decimal it spells — the rounding the home-amount projection uses
 * (`divideToPlaces`, `home-amount-arithmetic.ts`), so `1.005` is `壹元零壹分`
 * and binary floating point never decides a cent. A number, a bigint or the
 * decimal text a driver answers a currency column with (`"245000.00"`, an
 * exponent spelling too) is read; `null` reads `''`, the way `trim(null)` and
 * `label()` of an empty field do, so an empty total prints an empty line.
 * Anything else — text that spells no decimal, a boolean, a list, NaN, an
 * infinity — is refused with a throw, which the engine reports as a runtime
 * error, rather than printed as some amount.
 *
 * The spelling is judged before any conversion ({@link spelledFen}): its
 * magnitude is read off its digits and exponent, an amount of 10^16 yuan or
 * more is refused there (and again after rounding, which can carry
 * 9999999999999999.995 up to 10^16), an amount below 0.001 is zero there, and only the
 * digits down to the 0.001 place — the place half-away-from-zero rounding to
 * 分 reads — are converted. So the work is bounded by the length of the text,
 * whatever its exponent says.
 *
 * Package-internal (NOT re-exported from `index.ts`): the CEL function is the
 * published surface.
 */

import { divideToPlaces } from './home-amount-arithmetic';

const DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'] as const;
const PLACES = ['', '拾', '佰', '仟'] as const;

const TEN_THOUSAND = 10_000n;
const HUNDRED_MILLION = 100_000_000n;

/** The decimal spellings read: sign, integer digits, fraction digits, exponent. */
const DECIMAL_SPELLING = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * The power of ten of the highest place an amount may reach: 10^15, so the
 * largest amount written is 9999万9999亿9999万9999 yuan and 99 分, and 10^16
 * (一亿亿, which the 万/亿 scheme would have to write as 亿亿) is refused.
 */
const TOP_PLACE = 15;

/** 10^16 yuan in 分: the smallest amount refused once rounded. */
const LIMIT_FEN = 10n ** 18n;

/** The lowest place rounding to 分 reads: 0.001. */
const BOTTOM_PLACE = -3;

const TOO_LARGE =
  'rmbUpper(amount): `amount` is too large to write in capital numerals (10^16 yuan or more).';

/** `n` in 1..9999 with places, one `零` per inner run of zeros and none at the end. */
function group(n: number): string {
  let text = '';
  let pendingZero = false;
  for (let place = 3; place >= 0; place--) {
    const digit = Math.floor(n / 10 ** place) % 10;
    if (digit === 0) {
      if (text !== '') pendingZero = true;
      continue;
    }
    if (pendingZero) {
      text += '零';
      pendingZero = false;
    }
    text += DIGITS[digit] + PLACES[place];
  }
  return text;
}

/** A positive whole number of yuan, below 10^16. */
function yuan(n: bigint): string {
  if (n < TEN_THOUSAND) return group(Number(n));
  if (n < HUNDRED_MILLION) {
    const low = n % TEN_THOUSAND;
    const head = group(Number(n / TEN_THOUSAND)) + '万';
    if (low === 0n) return head;
    return head + (low < 1_000n ? '零' : '') + group(Number(low));
  }
  const low = n % HUNDRED_MILLION;
  const head = yuan(n / HUNDRED_MILLION) + '亿';
  if (low === 0n) return head;
  return head + (low < 10_000_000n ? '零' : '') + yuan(low);
}

/** The capital-numeral text of `amount`, rounded to 分; see the module docblock. */
export function rmbUpper(amount: unknown): string {
  if (amount === null || amount === undefined) return '';
  const fen = spelledFen(amount);
  const negative = fen < 0n;
  const abs = negative ? -fen : fen;
  if (abs === 0n) return '零元整';

  const whole = abs / 100n;
  const jiao = Number((abs / 10n) % 10n);
  const fenDigit = Number(abs % 10n);

  let text = whole > 0n ? yuan(whole) + '元' : '';
  if (jiao === 0 && fenDigit === 0) {
    text += '整';
  } else {
    if (jiao > 0) text += DIGITS[jiao] + '角';
    else if (whole > 0n) text += '零';
    if (fenDigit > 0) text += DIGITS[fenDigit] + '分';
  }
  return (negative ? '负' : '') + text;
}

/**
 * `amount` in 分, rounded half away from zero, with the magnitude judged from
 * the spelling before anything is converted: 10^16 yuan or more throws, an
 * amount below 0.001 is 0, and only the digits from the leading one down to
 * the 0.001 place become a number — the digits below it cannot move the
 * rounding, because half away from zero at 分 reads the 0.001 digit alone.
 */
function spelledFen(amount: unknown): bigint {
  let text: string | undefined;
  if (typeof amount === 'number') text = Number.isFinite(amount) ? String(amount) : undefined;
  else if (typeof amount === 'bigint') text = amount.toString();
  else if (typeof amount === 'string') text = amount.trim();
  const m = text === undefined ? null : DECIMAL_SPELLING.exec(text);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) {
    throw new Error(
      `rmbUpper(amount): \`amount\` is not a number (${describe(amount)}). ` +
      'Pass a number, a currency field, or decimal text such as "245000.00".',
    );
  }
  const [, sign, int, frac = '', exp] = m;
  const digits = int + frac;
  const lead = digits.search(/[1-9]/);
  if (lead === -1) return 0n;
  // The power of ten of the leading digit; a long exponent reads ±Infinity.
  const place = int.length - 1 - lead + (exp === undefined ? 0 : Number(exp));
  if (place > TOP_PLACE) throw new Error(TOO_LARGE);
  if (place < BOTTOM_PLACE) return 0n;
  const kept = digits.slice(lead, lead + place - BOTTOM_PLACE + 1).padEnd(place - BOTTOM_PLACE + 1, '0');
  const thousandths = BigInt(sign === '-' ? `-${kept}` : kept);
  const fen = divideToPlaces({ digits: thousandths, scale: -BOTTOM_PLACE }, { digits: 1n, scale: 0 }, 2).digits;
  // Rounding can carry an amount at the top place up to 10^16 itself
  // (9999999999999999.995 → 10^16): refused like any other amount that large.
  if ((fen < 0n ? -fen : fen) >= LIMIT_FEN) throw new Error(TOO_LARGE);
  return fen;
}

/** A short, value-free description of a refused argument for the error text. */
function describe(value: unknown): string {
  if (typeof value === 'string') return 'text that spells no decimal';
  if (typeof value === 'number') return Number.isNaN(value) ? 'NaN' : 'an infinite number';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'a map' : `a ${typeof value}`;
}
