// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Package listing localization resolver.
 *
 * Given a package (or marketplace listing) row and a requested locale,
 * returns the best-available value for a translatable field. The resolver
 * is shared between the cloud control plane (server-side rendering of
 * search results), tenant runtimes (rest proxies), and ObjectUI (browse
 * UI) so all surfaces resolve locales identically.
 *
 * Resolution order — first hit wins:
 *   1. `translations[<exact requested locale>][<field>]`     e.g. `zh-CN`
 *   2. `translations[<language-only locale>][<field>]`       e.g. `zh`
 *   3. `translations[<fallbackLocale>][<field>]`             default `en`
 *   4. base column (`pkg[<field>]`)
 *
 * The function is intentionally untyped at the parent level: it accepts
 * any shape that has a `translations?: PackageTranslations` plus a base
 * `Record<string, unknown>`, so it works equally on `Package`,
 * `MarketplaceListing`, and the snake_case rows returned by raw ObjectQL
 * queries (where the base field is `display_name`, not `displayName`).
 *
 * @see PackageTranslationSchema in ./package.zod.ts
 */

import type { PackageTranslation, PackageTranslations } from './package.zod';

/** Fields that can be localized via `PackageTranslation`. */
export type PackageL10nField = keyof PackageTranslation;

export interface ResolvePackageL10nOptions {
  /** BCP-47 locale to render (e.g. `zh-CN`, `ja`). */
  locale: string;
  /** Locale to fall back to before the base column. Default `en`. */
  fallbackLocale?: string;
}

/**
 * Look up a single localized field on a package/listing row.
 *
 * @example
 * ```ts
 * const name = resolvePackageL10nField(pkg, 'displayName', { locale: 'zh-CN' })
 *           ?? resolvePackageL10nField(pkg, 'displayName', { locale: 'zh' });
 * ```
 *
 * @param row     A package or marketplace listing row. Both camelCase
 *                (`displayName`) and snake_case (`display_name`) base
 *                columns are accepted — the resolver checks both.
 * @param field   The {@link PackageL10nField} to resolve.
 * @param opts    Locale and fallback configuration.
 *
 * @returns       The best-matching localized value, or `undefined` if
 *                neither the translations map nor the base column has
 *                a value.
 */
export function resolvePackageL10nField(
  row: { translations?: PackageTranslations | null } & Record<string, unknown>,
  field: PackageL10nField,
  opts: ResolvePackageL10nOptions,
): string | undefined {
  const fallback = opts.fallbackLocale ?? 'en';
  const translations = row.translations ?? undefined;

  if (translations) {
    const lang = languageOf(opts.locale);
    // Regional expansion: if the requested locale is bare ('zh'),
    // also accept any region-tagged variant present in translations
    // ('zh-CN', 'zh-Hans', …). Keeps server + client resolvers aligned
    // with the @object-ui/app-shell client resolver.
    const variants = Object.keys(translations).filter(
      (code) => code === lang || code.startsWith(`${lang}-`),
    );
    const candidates = uniqueLocales([opts.locale, lang, ...variants, fallback]);
    for (const code of candidates) {
      const entry = translations[code];
      if (!entry) continue;
      const value = entry[field];
      if (typeof value === 'string' && value.length > 0) return value;
    }
  }

  // Fall back to the base column. Accept both camelCase and snake_case.
  const base = (row as Record<string, unknown>)[field]
    ?? (row as Record<string, unknown>)[camelToSnake(field)];
  return typeof base === 'string' && base.length > 0 ? base : undefined;
}

/**
 * Resolve all localized fields at once. Returns an object with the same
 * keys as {@link PackageTranslation}, each populated with the best
 * available value (or `undefined`).
 *
 * Convenient for React components that need every field rendered in one
 * pass without sprinkling resolver calls inline.
 */
export function resolvePackageL10n(
  row: { translations?: PackageTranslations | null } & Record<string, unknown>,
  opts: ResolvePackageL10nOptions,
): {
  displayName?: string;
  description?: string;
  readme?: string;
  tagline?: string;
  screenshotCaptions?: Record<string, string>;
} {
  return {
    displayName: resolvePackageL10nField(row, 'displayName', opts),
    description: resolvePackageL10nField(row, 'description', opts),
    readme: resolvePackageL10nField(row, 'readme', opts),
    tagline: resolvePackageL10nField(row, 'tagline', opts),
    screenshotCaptions: resolveScreenshotCaptions(row, opts),
  };
}

/**
 * Resolve the screenshot caption map for the requested locale. Unlike
 * the scalar fields, captions are merged across the fallback chain so
 * partially-translated maps (e.g. only the first 2 captions in `zh`)
 * still show English text for the remaining indices.
 */
export function resolveScreenshotCaptions(
  row: { translations?: PackageTranslations | null } & Record<string, unknown>,
  opts: ResolvePackageL10nOptions,
): Record<string, string> | undefined {
  const translations = row.translations ?? undefined;
  if (!translations) return undefined;
  const fallback = opts.fallbackLocale ?? 'en';
  // Walk from least-specific → most-specific so later writes override.
  const order = [fallback, languageOf(opts.locale), opts.locale];
  const merged: Record<string, string> = {};
  let touched = false;
  for (const code of uniqueLocales(order)) {
    const entry = translations[code];
    if (!entry?.screenshotCaptions) continue;
    touched = true;
    for (const [idx, caption] of Object.entries(entry.screenshotCaptions)) {
      if (typeof caption === 'string' && caption.length > 0) merged[idx] = caption;
    }
  }
  return touched ? merged : undefined;
}

// ──────────────────────────────────────────────────────────────────────
// internals
// ──────────────────────────────────────────────────────────────────────

/** Strip the region subtag: `zh-CN` → `zh`. Returns the input if no `-`. */
function languageOf(locale: string): string {
  const dash = locale.indexOf('-');
  return dash === -1 ? locale : locale.slice(0, dash);
}

/** Dedupe while preserving order. */
function uniqueLocales(codes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of codes) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/** `displayName` → `display_name`. */
function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}
