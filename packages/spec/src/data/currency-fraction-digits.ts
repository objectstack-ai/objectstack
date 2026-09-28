// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ISO 4217 / CLDR currency fraction digits — a checked-in snapshot whose KEY
 * SET is the membership list of the `iso_4217_currency` value domain
 * (`shared/value-domain.zod.ts`): a `text` field declaring
 * `valueDomain: 'iso_4217_currency'` accepts exactly these codes.
 *
 * #19992 — the snapshot was generated for the #7918 publish-time rule that
 * compared an authored `currencyConfig.precision` with the currency's fraction
 * digits. That key was removed (ADR-0049 enforce-or-remove: no renderer or
 * runtime ever read it), and the verdict function and its case-folding lookup
 * went with it, having no other reader. The table stayed because the value
 * domain reads its keys; the digit VALUES are kept as the provenance below
 * records them rather than being flattened to a code list, so a regeneration
 * stays a diff against the same snippet.
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
 * `currencyFractionDigits` renderer helper carries the same one). Reading a
 * CHECKED-IN snapshot rather than asking `Intl` at validation time keeps the
 * verdict deterministic — it cannot vary with the host's ICU build (a
 * small-icu node answers 2 for everything), and the validation path takes no
 * `Intl` dependency at all.
 *
 * Renderers derive display width from live `Intl` (objectui#4361), and the
 * two sources agree because both read CLDR `currencyData`. If a future CLDR
 * revision moves a digit count or a code, regenerate with the snippet above and
 * update the provenance line — the table is a snapshot, not hand-curated data.
 *
 * ## Two different code rules — do not merge them
 *
 * `CurrencyConfigSchema` validates a currency FIELD's code by length only, on
 * purpose: cryptocurrency and custom business codes (BTC, ETH, …) are legal
 * there, and this table is not consulted. The `iso_4217_currency` value domain
 * is the opposite, opt-in rule for a text field that must hold a standard
 * code. Neither is a stricter version of the other.
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
