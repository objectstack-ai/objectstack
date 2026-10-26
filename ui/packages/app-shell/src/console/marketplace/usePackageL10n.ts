/**
 * usePackageL10n
 *
 * Resolves a marketplace package's translatable fields against the
 * current i18n locale. Mirrors the server-side resolver
 * `resolvePackageL10n` in @objectstack/spec/cloud but stays inline here
 * so the app-shell doesn't pull the full spec package into its bundle.
 *
 * Resolution chain (first hit wins):
 *   1. translations[<exact requested locale>]   (e.g. `zh-CN`)
 *   2. translations[<language-only locale>]     (e.g. `zh`)
 *   3. translations[<fallback locale>]          (default `en`)
 *   4. base column on the package row           (snake_case from REST)
 */

import { useMemo } from 'react';
import { useObjectTranslation } from '@object-ui/i18n';
import type { MarketplacePackageSummary, MarketplacePackageTranslation } from './marketplaceApi.js';

type L10nField = keyof MarketplacePackageTranslation;

const FALLBACK_LOCALE = 'en';

function languageOf(locale: string): string {
  const dash = locale.indexOf('-');
  return dash === -1 ? locale : locale.slice(0, dash);
}

function uniqueLocales(codes: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of codes) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

function pickFromTranslations(
  translations: MarketplacePackageSummary['translations'] | undefined,
  locale: string,
  field: L10nField,
): string | undefined {
  if (!translations) return undefined;
  const lang = languageOf(locale);
  // Build chain: exact → language-only → any regional variant matching the
  // language (e.g. 'zh' → 'zh-CN' / 'zh-Hans') → fallback. The regional
  // expansion covers the common case where the i18n provider returns a
  // bare language code ('zh') but package manifests ship region-tagged
  // translations ('zh-CN').
  const variants = Object.keys(translations).filter(
    (code) => code === lang || code.startsWith(`${lang}-`),
  );
  const chain = uniqueLocales([locale, lang, ...variants, FALLBACK_LOCALE]);
  for (const code of chain) {
    const entry = translations[code];
    if (!entry) continue;
    const value = entry[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function baseColumn(pkg: MarketplacePackageSummary, field: L10nField): string | undefined {
  // Map camelCase L10n field → REST snake_case column.
  const SNAKE: Record<L10nField, string> = {
    displayName: 'display_name',
    description: 'description',
    readme: 'readme',
    tagline: 'tagline',
    // Captions live only inside translations on the wire — no base column.
    screenshotCaptions: 'screenshotCaptions',
  };
  const v = (pkg as unknown as Record<string, unknown>)[SNAKE[field]] ?? (pkg as unknown as Record<string, unknown>)[field];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export interface LocalizedPackage {
  displayName: string;
  description: string | undefined;
  readme: string | undefined;
  tagline: string | undefined;
}

/**
 * Resolve `displayName`, `description`, `readme`, and `tagline` for a
 * package against the active locale. `displayName` is guaranteed to be
 * a non-empty string (falls back to `manifest_id` as a last resort) so
 * callers can render it without further guards.
 */
export function usePackageL10n(
  pkg: Pick<MarketplacePackageSummary, 'manifest_id' | 'display_name' | 'translations'> & {
    description?: string | null;
    readme?: string | null;
  } | null | undefined,
): LocalizedPackage {
  const { language } = useObjectTranslation();
  return useMemo<LocalizedPackage>(() => {
    if (!pkg) {
      return { displayName: '', description: undefined, readme: undefined, tagline: undefined };
    }
    const locale = language || FALLBACK_LOCALE;
    const displayName =
      pickFromTranslations(pkg.translations ?? undefined, locale, 'displayName')
      ?? baseColumn(pkg as MarketplacePackageSummary, 'displayName')
      ?? pkg.manifest_id;
    const description =
      pickFromTranslations(pkg.translations ?? undefined, locale, 'description')
      ?? baseColumn(pkg as MarketplacePackageSummary, 'description');
    const readme =
      pickFromTranslations(pkg.translations ?? undefined, locale, 'readme')
      ?? baseColumn(pkg as MarketplacePackageSummary, 'readme');
    const tagline =
      pickFromTranslations(pkg.translations ?? undefined, locale, 'tagline')
      ?? baseColumn(pkg as MarketplacePackageSummary, 'tagline');
    return { displayName, description, readme, tagline };
  }, [pkg, language]);
}

/**
 * Stateless variant for use in `.map()` over a list of packages where
 * calling `usePackageL10n` per row would violate the rules of hooks.
 * The caller passes the language they obtained once from
 * `useObjectTranslation()` at the top of the component.
 */
export function localizePackage(
  pkg: MarketplacePackageSummary,
  language: string,
): LocalizedPackage {
  const locale = language || FALLBACK_LOCALE;
  const displayName =
    pickFromTranslations(pkg.translations ?? undefined, locale, 'displayName')
    ?? baseColumn(pkg, 'displayName')
    ?? pkg.manifest_id;
  const description =
    pickFromTranslations(pkg.translations ?? undefined, locale, 'description')
    ?? baseColumn(pkg, 'description');
  const readme =
    pickFromTranslations(pkg.translations ?? undefined, locale, 'readme')
    ?? baseColumn(pkg, 'readme');
  const tagline =
    pickFromTranslations(pkg.translations ?? undefined, locale, 'tagline')
    ?? baseColumn(pkg, 'tagline');
  return { displayName, description, readme, tagline };
}
