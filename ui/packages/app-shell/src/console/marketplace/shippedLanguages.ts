/**
 * The languages a marketplace version ships, read off the catalog's answer:
 * the reader, the naming and the percent format that `MarketplaceLanguages.tsx`
 * draws with and the languages facet labels its buttons with. That file's
 * header says which answers there are and how each one reads.
 */

import { resolveBuiltInLanguage, useDisplayLocale } from '@object-ui/i18n';
import { localeLabel } from '../../layout/LocaleSwitcher.js';
import type { MarketplacePackageVersion } from './marketplaceApi.js';

/** One shipped language, ready to draw. */
export interface ShippedLanguage {
  /** The code as the catalog served it (`zh-CN`); the facet sends this spelling. */
  code: string;
  /** Its native name, as the language menu names it. */
  label: string;
  /** The served `coverage_percent`, or `null` when the coverage names no row for it. */
  percent: number | null;
  /**
   * The version's default locale, as `locale_coverage.default_locale` names it.
   * Never read off a position: the measurement lists the locales in bundle
   * order when the app declares none, so the default need not come first.
   */
  isDefault: boolean;
}

/** What one version says about its languages. */
export type ShippedLanguages =
  /** The catalog does not serve the keys: draw nothing. */
  | { kind: 'unserved' }
  /** Served, and nothing was measured: "No language information". */
  | { kind: 'unknown' }
  | { kind: 'listed'; languages: readonly ShippedLanguage[] };

const UNSERVED: ShippedLanguages = { kind: 'unserved' };
const UNKNOWN: ShippedLanguages = { kind: 'unknown' };

/** How many languages the catalog card names before it says how many more. */
export const CARD_LANGUAGE_LIMIT = 3;

/** A served locale code's native name, read through the platform locale table first. */
export function languageLabel(code: string): string {
  return localeLabel(resolveBuiltInLanguage(code) ?? code);
}

/**
 * The languages `version` ships. `supported_locales` decides which languages
 * are drawn, in its order except that the default comes first;
 * `locale_coverage` supplies the default (`default_locale`) and each one's
 * percent, so a language the coverage names no row for is drawn without one,
 * and without a coverage nothing is marked default.
 */
export function readShippedLanguages(
  version: Pick<MarketplacePackageVersion, 'supported_locales' | 'locale_coverage'> | null | undefined,
): ShippedLanguages {
  if (!version) return UNSERVED;
  const served = version.supported_locales;
  if (served === null) return UNKNOWN;
  if (!Array.isArray(served)) return UNSERVED;
  const codes = served.filter((code): code is string => typeof code === 'string' && code !== '');
  if (codes.length === 0) return UNKNOWN;
  const coverage = version.locale_coverage;
  const rows = Array.isArray(coverage?.locales) ? coverage.locales : [];
  const defaultLocale = typeof coverage?.default_locale === 'string' ? coverage.default_locale : null;
  const languages = codes.map((code): ShippedLanguage => {
    const row = rows.find((r) => r?.locale === code);
    const percent = typeof row?.coverage_percent === 'number' && Number.isFinite(row.coverage_percent)
      ? row.coverage_percent
      : null;
    return { code, label: languageLabel(code), percent, isDefault: code === defaultLocale };
  });
  return {
    kind: 'listed',
    languages: [...languages.filter((l) => l.isDefault), ...languages.filter((l) => !l.isDefault)],
  };
}

/**
 * Format a served percent (0–100, one decimal) in the display locale — `60%`,
 * `60 %` in German — so no pack carries a format string of its own. The
 * locale is `useDisplayLocale()`, as the page's dates are, never a tag of its own.
 */
export function useCoverageFormatter(): (percent: number) => string {
  const format = new Intl.NumberFormat(useDisplayLocale(), { style: 'percent', maximumFractionDigits: 1 });
  return (percent) => format.format(percent / 100);
}
