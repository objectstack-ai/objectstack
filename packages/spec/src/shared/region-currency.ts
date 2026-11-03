// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A region's current currency: the checked-in CLDR region → currency table and
 * its one lookup.
 *
 * Two readers, one table. plugin-auth gives a new organization the currency of
 * its creator's language or region (`organization-default-currency.ts`), and
 * the console offers an administrator the currency of the browser's region
 * when `localization.currency` is still unset (the workspace prompt). Both read
 * this module, so the console carries no second copy of the table.
 *
 * It imports nothing: `Intl.Locale` is the only thing the lookup calls.
 *
 * @module
 */

/**
 * Region (ISO 3166-1 alpha-2 and the CLDR territory codes beside it) → the
 * region's current ISO 4217 currency.
 *
 * ## Provenance: CLDR `currencyData`, checked in, not hand-written
 *
 * Generated on 2026-10-24 from CLDR 48 `supplemental/currencyData.json`
 * (`cldr-core@48.0.0` on npm, sha256 of that file
 * `ab007c5bb654a11601d6328f73a9b5b504334c556f3edb760020d6e2cc408472`), the
 * same CLDR release as `CURRENCY_FRACTION_DIGITS` (`data/currency-fraction-digits.ts`).
 * For each two-letter region the value is the FIRST entry of its
 * `currencyData.region` list that has no `_to` date and is not
 * `_tender: "false"`. CLDR orders that list so the first current tender is the
 * region's primary currency (`PS` → `ILS` ahead of `JOD`). Entries are kept
 * only when the code is in the `iso_4217_currency` value domain, the set the
 * settings key accepts. Eleven regions have no current tender and are absent:
 * `AQ` and `ZZ` (`XXX`), and the retired `BU` `CP` `CS` `DD` `SU` `TP` `YD`
 * `YU` `ZR`.
 *
 * `Intl` has no region → currency lookup, which is why this is a table. To
 * refresh it for a later CLDR, regenerate it by the rule above and update this
 * provenance block. Do not edit entries by hand.
 */
export const REGION_CURRENCY: Readonly<Record<string, string>> = {
  AC: 'SHP', AD: 'EUR', AE: 'AED', AF: 'AFN', AG: 'XCD', AI: 'XCD', AL: 'ALL', AM: 'AMD',
  AO: 'AOA', AR: 'ARS', AS: 'USD', AT: 'EUR', AU: 'AUD', AW: 'AWG', AX: 'EUR', AZ: 'AZN',
  BA: 'BAM', BB: 'BBD', BD: 'BDT', BE: 'EUR', BF: 'XOF', BG: 'EUR', BH: 'BHD', BI: 'BIF',
  BJ: 'XOF', BL: 'EUR', BM: 'BMD', BN: 'BND', BO: 'BOB', BQ: 'USD', BR: 'BRL', BS: 'BSD',
  BT: 'BTN', BV: 'NOK', BW: 'BWP', BY: 'BYN', BZ: 'BZD', CA: 'CAD', CC: 'AUD', CD: 'CDF',
  CF: 'XAF', CG: 'XAF', CH: 'CHF', CI: 'XOF', CK: 'NZD', CL: 'CLP', CM: 'XAF', CN: 'CNY',
  CO: 'COP', CR: 'CRC', CU: 'CUP', CV: 'CVE', CW: 'XCG', CX: 'AUD', CY: 'EUR', CZ: 'CZK',
  DE: 'EUR', DG: 'USD', DJ: 'DJF', DK: 'DKK', DM: 'XCD', DO: 'DOP', DZ: 'DZD', EA: 'EUR',
  EC: 'USD', EE: 'EUR', EG: 'EGP', EH: 'MAD', ER: 'ERN', ES: 'EUR', ET: 'ETB', EU: 'EUR',
  FI: 'EUR', FJ: 'FJD', FK: 'FKP', FM: 'USD', FO: 'DKK', FR: 'EUR', GA: 'XAF', GB: 'GBP',
  GD: 'XCD', GE: 'GEL', GF: 'EUR', GG: 'GBP', GH: 'GHS', GI: 'GIP', GL: 'DKK', GM: 'GMD',
  GN: 'GNF', GP: 'EUR', GQ: 'XAF', GR: 'EUR', GS: 'GBP', GT: 'GTQ', GU: 'USD', GW: 'XOF',
  GY: 'GYD', HK: 'HKD', HM: 'AUD', HN: 'HNL', HR: 'EUR', HT: 'HTG', HU: 'HUF', IC: 'EUR',
  ID: 'IDR', IE: 'EUR', IL: 'ILS', IM: 'GBP', IN: 'INR', IO: 'USD', IQ: 'IQD', IR: 'IRR',
  IS: 'ISK', IT: 'EUR', JE: 'GBP', JM: 'JMD', JO: 'JOD', JP: 'JPY', KE: 'KES', KG: 'KGS',
  KH: 'KHR', KI: 'AUD', KM: 'KMF', KN: 'XCD', KP: 'KPW', KR: 'KRW', KW: 'KWD', KY: 'KYD',
  KZ: 'KZT', LA: 'LAK', LB: 'LBP', LC: 'XCD', LI: 'CHF', LK: 'LKR', LR: 'LRD', LS: 'ZAR',
  LT: 'EUR', LU: 'EUR', LV: 'EUR', LY: 'LYD', MA: 'MAD', MC: 'EUR', MD: 'MDL', ME: 'EUR',
  MF: 'EUR', MG: 'MGA', MH: 'USD', MK: 'MKD', ML: 'XOF', MM: 'MMK', MN: 'MNT', MO: 'MOP',
  MP: 'USD', MQ: 'EUR', MR: 'MRU', MS: 'XCD', MT: 'EUR', MU: 'MUR', MV: 'MVR', MW: 'MWK',
  MX: 'MXN', MY: 'MYR', MZ: 'MZN', NA: 'NAD', NC: 'XPF', NE: 'XOF', NF: 'AUD', NG: 'NGN',
  NI: 'NIO', NL: 'EUR', NO: 'NOK', NP: 'NPR', NR: 'AUD', NU: 'NZD', NZ: 'NZD', OM: 'OMR',
  PA: 'PAB', PE: 'PEN', PF: 'XPF', PG: 'PGK', PH: 'PHP', PK: 'PKR', PL: 'PLN', PM: 'EUR',
  PN: 'NZD', PR: 'USD', PS: 'ILS', PT: 'EUR', PW: 'USD', PY: 'PYG', QA: 'QAR', RE: 'EUR',
  RO: 'RON', RS: 'RSD', RU: 'RUB', RW: 'RWF', SA: 'SAR', SB: 'SBD', SC: 'SCR', SD: 'SDG',
  SE: 'SEK', SG: 'SGD', SH: 'SHP', SI: 'EUR', SJ: 'NOK', SK: 'EUR', SL: 'SLE', SM: 'EUR',
  SN: 'XOF', SO: 'SOS', SR: 'SRD', SS: 'SSP', ST: 'STN', SV: 'USD', SX: 'XCG', SY: 'SYP',
  SZ: 'SZL', TA: 'GBP', TC: 'USD', TD: 'XAF', TF: 'EUR', TG: 'XOF', TH: 'THB', TJ: 'TJS',
  TK: 'NZD', TL: 'USD', TM: 'TMT', TN: 'TND', TO: 'TOP', TR: 'TRY', TT: 'TTD', TV: 'AUD',
  TW: 'TWD', TZ: 'TZS', UA: 'UAH', UG: 'UGX', UM: 'USD', US: 'USD', UY: 'UYU', UZ: 'UZS',
  VA: 'EUR', VC: 'XCD', VE: 'VES', VG: 'USD', VI: 'USD', VN: 'VND', VU: 'VUV', WF: 'XPF',
  WS: 'WST', XK: 'EUR', YE: 'YER', YT: 'EUR', ZA: 'ZAR', ZM: 'ZMW', ZW: 'ZWG',
};

/**
 * The ISO 4217 currency of a BCP 47 tag's region, or `undefined`.
 *
 * The region is the tag's own (`zh-CN` → `CN`), or for a tag without one the
 * likely region `Intl.Locale#maximize()` gives (`zh` → `CN`, `ja` → `JP`,
 * `zh-Hant` → `TW`). A malformed tag, a tag whose region is not a country
 * (`es-419`, `en-150`), and a region with no current currency all answer
 * `undefined`: no guess is made.
 */
export function currencyForLocale(tag: unknown): string | undefined {
  if (typeof tag !== 'string') return undefined;
  const value = tag.trim();
  if (!value) return undefined;
  let region: string | undefined;
  try {
    region = new Intl.Locale(value).maximize().region;
  } catch {
    return undefined;
  }
  if (!region || !Object.prototype.hasOwnProperty.call(REGION_CURRENCY, region)) return undefined;
  return REGION_CURRENCY[region];
}
