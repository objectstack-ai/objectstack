// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ISO 4217 / CLDR currency fraction digits — the static digit table behind the
 * #7918 publish-time rule (maintainer ruling 2026-08-12, Option A): a currency
 * field whose AUTHORED `precision` contradicts its statically-known currency's
 * fraction digits is rejected at parse/publish time, with a message naming
 * both numbers.
 *
 * ## Provenance — CLDR `currencyData`, checked in, not probed at runtime
 *
 * Generated from CLDR 48.0 `currencyData` digit counts as carried by ICU 78.2
 * (node v22.22.2 full-icu, Unicode 17.0), on 2026-08-12, via:
 *
 * ```js
 * for (const c of Intl.supportedValuesOf('currency'))
 *   table[c] = new Intl.NumberFormat(undefined, { style: 'currency', currency: c })
 *     .resolvedOptions().maximumFractionDigits;
 * ```
 *
 * The probe is locale-free on purpose: the digit count comes from CLDR's
 * `currencyData`, keyed by the currency and not by the reader — measured
 * identical across en-US / de-DE / ja-JP / ar-KW / zh-CN / fr-FR / pl-PL /
 * es-ES (the #7918 card's own measurement, and objectui's
 * `currencyFractionDigits` renderer helper carries the same one). Checking a
 * CHECKED-IN snapshot rather than asking `Intl` at validation time keeps
 * publish-time validation deterministic — the verdict cannot vary with the
 * host's ICU build (a small-icu node answers 2 for everything), and the
 * validation path takes no `Intl` dependency at all.
 *
 * Renderers still derive display width from live `Intl` (objectui#4361), and
 * the two sources agree because both read CLDR `currencyData`. If a future
 * CLDR revision moves a digit count, regenerate with the snippet above and
 * update the provenance line — the table is a snapshot, not hand-curated data.
 *
 * ## The set is deliberately OPEN — unknown codes fail OPEN
 *
 * `CurrencyConfigSchema` validates currency codes by length only, on purpose:
 * cryptocurrency and custom business codes (BTC, ETH, …) are legal. A code
 * this table does not know gets `undefined` — NO verdict — so the #7918 rule
 * does not fire on it. Refusing unknown codes would be a different rule that
 * nobody ruled; do not "improve" this into a membership check.
 */

/**
 * Fraction digits per currency code — every code CLDR 48.0 `currencyData`
 * carries (162 entries; see the provenance block above). 0-digit currencies
 * (JPY, KRW, CLP, ISK, VND, …) have no minor unit at all; 3-digit currencies
 * (BHD, JOD, KWD, LYD, OMR, TND) have a thousandth minor unit (fils/baisa).
 */
export const CURRENCY_FRACTION_DIGITS: Readonly<Record<string, number>> = {
  AED: 2, AFN: 0, ALL: 0, AMD: 2, ANG: 2, AOA: 2, ARS: 2, AUD: 2,
  AWG: 2, AZN: 2, BAM: 2, BBD: 2, BDT: 2, BGN: 2, BHD: 3, BIF: 0,
  BMD: 2, BND: 2, BOB: 2, BRL: 2, BSD: 2, BTN: 2, BWP: 2, BYN: 2,
  BZD: 2, CAD: 2, CDF: 2, CHF: 2, CLP: 0, CNY: 2, COP: 0, CRC: 2,
  CUC: 2, CUP: 2, CVE: 2, CZK: 2, DJF: 0, DKK: 2, DOP: 2, DZD: 2,
  EGP: 2, ERN: 2, ETB: 2, EUR: 2, FJD: 2, FKP: 2, GBP: 2, GEL: 2,
  GHS: 2, GIP: 2, GMD: 2, GNF: 0, GTQ: 2, GYD: 2, HKD: 2, HNL: 2,
  HRK: 2, HTG: 2, HUF: 0, IDR: 0, ILS: 2, INR: 2, IQD: 0, IRR: 0,
  ISK: 0, JMD: 2, JOD: 3, JPY: 0, KES: 2, KGS: 2, KHR: 2, KMF: 0,
  KPW: 0, KRW: 0, KWD: 3, KYD: 2, KZT: 2, LAK: 0, LBP: 0, LKR: 2,
  LRD: 2, LSL: 2, LYD: 3, MAD: 2, MDL: 2, MGA: 0, MKD: 2, MMK: 0,
  MNT: 2, MOP: 2, MRU: 2, MUR: 2, MVR: 2, MWK: 2, MXN: 2, MYR: 2,
  MZN: 2, NAD: 2, NGN: 2, NIO: 2, NOK: 2, NPR: 2, NZD: 2, OMR: 3,
  PAB: 2, PEN: 2, PGK: 2, PHP: 2, PKR: 0, PLN: 2, PYG: 0, QAR: 2,
  RON: 2, RSD: 2, RUB: 2, RWF: 0, SAR: 2, SBD: 2, SCR: 2, SDG: 2,
  SEK: 2, SGD: 2, SHP: 2, SLE: 2, SLL: 0, SOS: 0, SRD: 2, SSP: 2,
  STN: 2, SVC: 2, SYP: 0, SZL: 2, THB: 2, TJS: 2, TMT: 2, TND: 3,
  TOP: 2, TRY: 2, TTD: 2, TWD: 2, TZS: 2, UAH: 2, UGX: 0, USD: 2,
  UYU: 2, UZS: 2, VES: 2, VND: 0, VUV: 0, WST: 2, XAF: 0, XCD: 2,
  XCG: 2, XDR: 2, XOF: 0, XPF: 0, XSU: 2, YER: 0, ZAR: 2, ZMW: 2,
  ZWG: 2, ZWL: 2,
};

/**
 * The fraction digits CLDR gives `code`, or `undefined` for a code outside
 * the table (crypto/custom — the open-set, fail-open case above). Case-folded
 * to match `Intl.NumberFormat`'s own case-insensitive currency handling, so a
 * lowercased `'jpy'` — legal under the length-3 schema — cannot dodge the
 * check that `'JPY'` gets.
 */
export function currencyFractionDigits(code: string): number | undefined {
  return CURRENCY_FRACTION_DIGITS[code.toUpperCase()];
}

/**
 * The #7918 verdict, shared by BOTH anchors of the rule — the field-level
 * `precision` key (checked in `FieldSchema`'s `superRefine`) and
 * `CurrencyConfigSchema.precision` (checked pre-default inside that schema) —
 * so the two doors cannot drift apart in wording. Returns the issue message
 * when `precision` contradicts `currency`'s fraction digits, `undefined` when
 * they agree or the currency is unknown (fail-open).
 *
 * The message's first clause names both numbers, verbatim per the ruling:
 * "currency JPY has 0 fraction digits; `precision: 2` contradicts it".
 */
export function currencyPrecisionContradiction(
  currency: string,
  precision: number,
): string | undefined {
  const digits = currencyFractionDigits(currency);
  if (digits === undefined || digits === precision) return undefined;
  return (
    `currency ${currency.toUpperCase()} has ${digits} fraction digits; ` +
    `\`precision: ${precision}\` contradicts it — the amount would render minor-unit digits ` +
    `the currency does not have, or drop digits it does (ISO 4217 / CLDR currencyData). ` +
    `Declare \`precision: ${digits}\`, or omit \`precision\` and let renderers derive the width ` +
    `from the currency. Codes outside CLDR (crypto/custom) are not checked, and a field in ` +
    `\`dynamic\` currencyMode has no single currency to check against.`
  );
}
