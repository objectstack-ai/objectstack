/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Licensed under the MIT license found in the LICENSE file.
 */

/**
 * `resolveFieldCurrency` now lives in `@object-ui/i18n` (co-located with
 * `useLocalization`, which supplies the tenant default). This module re-exports
 * it so the long-standing `@object-ui/fields` import path keeps working for
 * every field/cell renderer that already depends on it.
 */
export { resolveFieldCurrency } from '@object-ui/i18n';

/**
 * Fallback width for a currency whose digit count cannot be resolved: the
 * literal both call sites used unconditionally before objectui#4361. It is
 * reached only when there is no ISO code to ask about (an invalid code, or a
 * runtime with no currency data at all), never as a policy.
 */
const DEFAULT_FRACTION_DIGITS = 2;

/**
 * ISO 4217 minor-unit width, memoized per currency code.
 *
 * The probe is deliberately made with NO locale. Measured across
 * en-US / de-DE / ja-JP / ar-KW / zh-CN / fr-FR / pl-PL / es-ES and the runtime
 * default, every locale answers the same digit count for the same code (USD 2,
 * JPY 0, KWD 3, BHD 3, CLP 0, ISK 0) — the count comes from CLDR's
 * `currencyData`, which is keyed by the currency, not by who is reading it.
 * Dropping the locale from the probe therefore loses nothing and removes a
 * failure mode: a malformed locale tag makes `Intl.NumberFormat` throw
 * `RangeError: Incorrect locale information provided`, which would turn a bad
 * LOCALE into a wrong CURRENCY width. It also makes the code the whole cache
 * key.
 */
const fractionDigitsByCurrency = new Map<string, number>();

/**
 * The number of fraction digits ISO 4217 gives `currency` — 0 for JPY/KRW/CLP,
 * 2 for USD/EUR/CNY, 3 for KWD/BHD/OMR/TND — as ICU reports it.
 *
 * Returns {@link DEFAULT_FRACTION_DIGITS} when the code is not a currency code
 * at all: `Intl` throws `RangeError: Invalid currency code` for those, and the
 * throw must not escape, or a bad code would change the width used by the
 * callers' own bad-currency fallbacks (objectui#4332 pinned those strings). A
 * code that is well-formed but unknown to CLDR (e.g. `ZZZ`) does not throw —
 * ICU answers 2 for anything outside its table, which is the same default.
 *
 * Memoized because the currency cell renderer runs once per grid cell: measured
 * at 24.3us per uncached probe against 0.02us cached (200k iterations, node 22),
 * so a 500-row grid pays ~12ms per render pass for a value that cannot change.
 */
export function currencyFractionDigits(currency: string): number {
  const cached = fractionDigitsByCurrency.get(currency);
  if (cached !== undefined) return cached;
  let digits = DEFAULT_FRACTION_DIGITS;
  try {
    // `maximumFractionDigits` is typed `number | undefined` on
    // `ResolvedNumberFormatOptions` — it is absent when a format resolves with
    // significant-digit rounding instead of fraction-digit rounding, which a
    // bare `style: 'currency'` never does. Coalesced rather than asserted so
    // the value is a number by construction and not by claim.
    digits =
      new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? DEFAULT_FRACTION_DIGITS;
  } catch {
    // Not a currency code — keep the historical width and let the caller's own
    // formatting attempt surface the bad code.
  }
  fractionDigitsByCurrency.set(currency, digits);
  return digits;
}

/**
 * Display symbols, memoized per **(locale, currency)** pair.
 *
 * The pair, not the code — and this is the one place this helper deliberately
 * parts company with {@link currencyFractionDigits} above. The digit count is
 * locale-independent (measured across eight locales, see that map's note), so
 * its probe drops the locale and keys the cache on the code alone. The SYMBOL
 * is genuinely locale-dependent, measured on the same runtime:
 *
 *   - `USD` → `$` at `en` / `en-US` / `de-DE` / `ja-JP`, `US$` at `en-GB` and
 *     `zh-CN`, `$US` at `fr-FR`;
 *   - `JPY` → U+00A5 at `en`, the FULLWIDTH U+FFE5 at `ja-JP`, `JP¥` at
 *     `en-GB`, and the bare code `JPY` at `fr-FR`.
 *
 * Copying the code-only cache key would therefore let whichever locale asked
 * first answer for every locale after it, for the life of the process — a
 * silent wrong answer rather than a crash, so it is pinned by test.
 *
 * `|` is safe as the key separator: it appears in neither a BCP-47 tag nor an
 * ISO 4217 code, so no two distinct pairs can collide on one key.
 */
const symbolByLocaleAndCurrency = new Map<string, string>();

/**
 * The string ICU renders in place of `currency` for a reader in `locale` — `$`
 * for USD at `en`, `€` for EUR, U+00A5 for JPY — taken from the `currency` part
 * of the very format the display path already uses.
 *
 * This is the ONE channel for the symbol (objectui#4414). It is not an
 * independent opinion about how a currency should look: it is the same
 * `Intl.NumberFormat(locale, { style: 'currency', currency })` that
 * `formatDisplayNumber` formats amounts with, read one part at a time. So a
 * widget that renders an amount in one mode and a bare symbol in another cannot
 * disagree with itself — which is exactly what the hand-written
 * `currency === 'USD' ? '$' : currency` ternary did, showing `JPY` beside a
 * readonly `¥1,235`.
 *
 * Falls back to `currency` itself — the code as given — in the three cases
 * where ICU cannot answer, because a bare code is a legitimate adornment (it is
 * what ICU itself returns for KWD/BHD/CHF/ISK, and what
 * `formatCurrency`'s own bad-code branch renders beside it):
 *
 *  1. an invalid currency code — `Intl` throws `RangeError: Invalid currency
 *     code`;
 *  2. a malformed locale tag (`en_US` with an underscore, say) — `Intl` throws
 *     `RangeError: Incorrect locale information provided`. `currencyFractionDigits`
 *     dodged this failure mode by dropping the locale from its probe; this
 *     helper needs the locale, so it catches instead. Neither throw may escape:
 *     this runs during render, so an escaped `RangeError` is a blank widget.
 *  3. no `currency` part in the output at all — not observed for
 *     `style: 'currency'`, but coalesced rather than asserted.
 */
export function currencySymbol(currency: string, locale: string): string {
  const key = `${locale}|${currency}`;
  const cached = symbolByLocaleAndCurrency.get(key);
  if (cached !== undefined) return cached;
  let symbol = currency;
  try {
    // The formatted value is irrelevant — only the `currency` part is read — so
    // the cheapest deterministic input is used.
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0);
    symbol = parts.find((part) => part.type === 'currency')?.value ?? currency;
  } catch {
    // Bad code or bad locale — keep the code, and let the caller's own
    // formatting attempt surface the real problem.
  }
  symbolByLocaleAndCurrency.set(key, symbol);
  return symbol;
}
