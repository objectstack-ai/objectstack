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
  /** The version's default locale: the first the catalog lists. */
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
 * are drawn and in what order; `locale_coverage` only supplies each one's
 * percent, so a language the coverage names no row for is drawn without one.
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
  const rows = Array.isArray(version.locale_coverage?.locales) ? version.locale_coverage.locales : [];
  return {
    kind: 'listed',
    languages: codes.map((code, index) => {
      const row = rows.find((r) => r?.locale === code);
      const percent = typeof row?.coverage_percent === 'number' && Number.isFinite(row.coverage_percent)
        ? row.coverage_percent
        : null;
      return { code, label: languageLabel(code), percent, isDefault: index === 0 };
    }),
  };
}

/**
 * Format a served percent (0–100, one decimal) in the display locale — `60%`,
 * `60 %` in German — so no pack carries a format string of its own. The
 * locale is `useDisplayLocale()`, as the page's dates are, never a tag of its own.
 */
export function usePercentFormatter(): (percent: number) => string {
  const format = new Intl.NumberFormat(useDisplayLocale(), { style: 'percent', maximumFractionDigits: 1 });
  return (percent) => format.format(percent / 100);
}
