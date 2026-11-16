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
 * the exact decimal it spells — the reading and the rounding the home-amount
 * projection uses (`home-amount-arithmetic.ts`), so `1.005` is `壹元零壹分`
 * and binary floating point never decides a cent. A number, a bigint or the
 * decimal text a driver answers a currency column with (`"245000.00"`) is
 * read; `null` reads `''`, the way `trim(null)` and `label()` of an empty
 * field do, so an empty total prints an empty line. Anything else — text that
 * spells no decimal, a boolean, a list, NaN, an infinity — is refused with a
 * throw, which the engine reports as a runtime error, rather than printed as
 * some amount.
 *
 * Package-internal (NOT re-exported from `index.ts`): the CEL function is the
 * published surface.
 */

import { divideToPlaces, toScaledDecimal } from './home-amount-arithmetic';

const DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'] as const;
const PLACES = ['', '拾', '佰', '仟'] as const;

const TEN_THOUSAND = 10_000n;
const HUNDRED_MILLION = 100_000_000n;

/** 10^16 yuan in 分: the first amount the 万/亿 scheme would have to write as 亿亿. */
const LIMIT_FEN = 10n ** 18n;

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
  const exact = typeof amount === 'number' || typeof amount === 'bigint' || typeof amount === 'string'
    ? toScaledDecimal(amount)
    : undefined;
  if (exact === undefined) {
    throw new Error(
      `rmbUpper(amount): \`amount\` is not a number (${describe(amount)}). ` +
      'Pass a number, a currency field, or decimal text such as "245000.00".',
    );
  }
  const fen = divideToPlaces(exact, { digits: 1n, scale: 0 }, 2).digits;
  const negative = fen < 0n;
  const abs = negative ? -fen : fen;
  if (abs >= LIMIT_FEN) {
    throw new Error(
      'rmbUpper(amount): `amount` is too large to write in capital numerals (10^16 yuan or more).',
    );
  }
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

/** A short, value-free description of a refused argument for the error text. */
function describe(value: unknown): string {
  if (typeof value === 'string') return 'text that spells no decimal';
  if (typeof value === 'number') return Number.isNaN(value) ? 'NaN' : 'an infinite number';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'a map' : `a ${typeof value}`;
}
