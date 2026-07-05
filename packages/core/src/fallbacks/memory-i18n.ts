// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Recursively merge `source` into `target`. Nested plain objects are merged
 * rather than replaced, so multiple plugins can each contribute their own
 * slice of a locale's translations (e.g. `{objects: {account: ...}}` and
 * `{objects: {task: ...}}`) without clobbering one another.
 * Exported for the authored-translation sync (#2591).
 */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const tVal = target[key];
    const sVal = source[key];
    if (
      tVal && sVal
      && typeof tVal === 'object' && !Array.isArray(tVal)
      && typeof sVal === 'object' && !Array.isArray(sVal)
    ) {
      result[key] = deepMerge(
        tVal as Record<string, unknown>,
        sVal as Record<string, unknown>,
      );
    } else {
      result[key] = sVal;
    }
  }
  return result;
}

/**
 * Resolve a locale code against available locales with fallback.
 *
 * Fallback chain:
 *   1. Exact match (e.g. `zh-CN` → `zh-CN`)
 *   2. Case-insensitive match (e.g. `zh-cn` → `zh-CN`)
 *   3. Base language match (e.g. `zh-CN` → `zh`)
 *   4. Variant expansion (e.g. `zh` → `zh-CN`)
 *
 * Returns the matched locale code, or `undefined` when no match is found.
 */
export function resolveLocale(requestedLocale: string, availableLocales: string[]): string | undefined {
  if (availableLocales.length === 0) return undefined;

  // 1. Exact match
  if (availableLocales.includes(requestedLocale)) return requestedLocale;

  // 2. Case-insensitive match
  const lower = requestedLocale.toLowerCase();
  const caseMatch = availableLocales.find(l => l.toLowerCase() === lower);
  if (caseMatch) return caseMatch;

  // 3. Base language match (zh-CN → zh)
  const baseLang = requestedLocale.split('-')[0].toLowerCase();
  const baseMatch = availableLocales.find(l => l.toLowerCase() === baseLang);
  if (baseMatch) return baseMatch;

  // 4. Variant expansion (zh → zh-CN, zh-TW, etc. — first match wins)
  const variantMatch = availableLocales.find(l => l.split('-')[0].toLowerCase() === baseLang);
  if (variantMatch) return variantMatch;

  return undefined;
}

/**
 * In-memory i18n service fallback.
 *
 * Implements the II18nService contract with basic translate/load/getLocales
 * operations.  Used by ObjectKernel as an automatic fallback when no real
 * i18n plugin (e.g. I18nServicePlugin) is registered.
 *
 * Supports runtime translation loading, locale management, and
 * locale code fallback (e.g. `zh` → `zh-CN`).
 * Does not load files from disk — operates purely in-memory.
 */
export function createMemoryI18n() {
  const translations = new Map<string, Record<string, unknown>>();
  // Runtime-AUTHORED overlay (#2591): translations published as `translation`
  // metadata. Kept separate from the static map so a re-sync can REPLACE the
  // whole authored layer (clear-then-reload — deleted keys must not linger),
  // while authored values win over static bundle values on read.
  const authored = new Map<string, Record<string, unknown>>();
  let defaultLocale = 'en';

  /**
   * Resolve a dot-notation key from a nested object.
   */
  function resolveKey(data: Record<string, unknown>, key: string): string | undefined {
    const parts = key.split('.');
    let current: unknown = data;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return typeof current === 'string' ? current : undefined;
  }

  /** Merged (static ⊕ authored) view of a single, exact locale key. */
  function mergedLocale(locale: string): Record<string, unknown> | undefined {
    const stat = translations.get(locale);
    const auth = authored.get(locale);
    if (stat && auth) return deepMerge(stat, auth);
    return auth ?? stat;
  }

  /**
   * Find translation data for a locale, with fallback resolution.
   */
  function resolveTranslations(locale: string): Record<string, unknown> | undefined {
    // Exact match
    const exact = mergedLocale(locale);
    if (exact) return exact;

    // Locale fallback (zh → zh-CN, en-us → en-US, etc.)
    const allLocales = [...new Set([...translations.keys(), ...authored.keys()])];
    const resolved = resolveLocale(locale, allLocales);
    if (resolved) return mergedLocale(resolved);

    return undefined;
  }

  return {
    _fallback: true, _serviceName: 'i18n',

    t(key: string, locale: string, params?: Record<string, unknown>): string {
      const data = resolveTranslations(locale) ?? mergedLocale(defaultLocale);
      const value = data ? resolveKey(data, key) : undefined;
      if (value == null) return key;
      if (!params) return value;
      // Interpolation format: {{paramName}} — matches FileI18nAdapter convention
      return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(params[name] ?? `{{${name}}}`));
    },

    getTranslations(locale: string): Record<string, unknown> {
      return resolveTranslations(locale) ?? {};
    },

    loadTranslations(locale: string, data: Record<string, unknown>): void {
      const existing = translations.get(locale);
      if (existing) {
        translations.set(locale, deepMerge(existing, data));
      } else {
        translations.set(locale, { ...data });
      }
    },

    /**
     * Replace the ENTIRE runtime-authored translation layer (#2591). Called
     * by the authored-translation sync with the full current set of active
     * `translation` metadata items keyed by locale. Wholesale replacement —
     * not a merge — so deleted items/keys stop resolving on the next sync.
     */
    replaceAuthoredTranslations(byLocale: Record<string, Record<string, unknown>>): void {
      authored.clear();
      for (const [locale, data] of Object.entries(byLocale ?? {})) {
        if (!data || typeof data !== 'object') continue;
        authored.set(locale, { ...data });
      }
    },

    getLocales(): string[] {
      return [...new Set([...translations.keys(), ...authored.keys()])];
    },

    getDefaultLocale(): string {
      return defaultLocale;
    },

    setDefaultLocale(locale: string): void {
      defaultLocale = locale;
    },
  };
}
