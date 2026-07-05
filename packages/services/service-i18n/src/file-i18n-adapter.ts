// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { II18nService } from '@objectstack/spec/contracts';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Configuration options for FileI18nAdapter.
 */
export interface FileI18nAdapterOptions {
  /** Default locale (e.g. 'en') */
  defaultLocale?: string;
  /** Directory containing locale files (JSON). Each file should be named `{locale}.json`. */
  localesDir?: string;
  /** Fallback locale when a key is not found in the requested locale */
  fallbackLocale?: string;
}

/**
 * Resolve a nested key in a translations object using dot notation.
 *
 * @param data - Translation data object
 * @param key - Dot-separated key (e.g. 'objects.account.label')
 * @returns The resolved string value, or undefined if not found
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

/**
 * Deep-merge two plain objects recursively.
 * Arrays and non-plain-object values from `source` overwrite those in `target`.
 * Exported for the plugin's authored-translation re-sync (#2591), which must
 * merge multiple authored items targeting the same locale with the exact
 * semantics the adapter itself uses.
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
 * Interpolate parameters into a translated string.
 * Replaces `{{paramName}}` with the corresponding value from params.
 *
 * @param template - Template string with `{{key}}` placeholders
 * @param params - Parameter map
 * @returns Interpolated string
 */
function interpolate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return params[key] != null ? String(params[key]) : `{{${key}}}`;
  });
}

/**
 * File-based I18n adapter implementing II18nService.
 *
 * Loads JSON translation files from a directory on disk.
 * Each file should be named `{locale}.json` and contain a flat or nested
 * key-value map of translations.
 *
 * Supports:
 * - Dot-notation key resolution (e.g. 'objects.account.label')
 * - Parameter interpolation via `{{paramName}}` syntax
 * - Fallback locale for missing translations
 * - Runtime translation loading via loadTranslations()
 *
 * Suitable for server-side rendering, CLI tools, and development environments.
 *
 * @example
 * ```ts
 * const i18n = new FileI18nAdapter({
 *   defaultLocale: 'en',
 *   localesDir: './i18n',
 *   fallbackLocale: 'en',
 * });
 *
 * i18n.t('objects.account.label', 'zh-CN'); // '客户'
 * i18n.t('greeting', 'en', { name: 'World' }); // 'Hello, World!'
 * ```
 */
export class FileI18nAdapter implements II18nService {
  private readonly translations = new Map<string, Record<string, unknown>>();
  /**
   * Runtime-AUTHORED overlay (#2591): translations published as `translation`
   * metadata in the Studio. Kept separate from the static `translations` map
   * so a re-sync can REPLACE the whole authored layer (clear-then-reload) —
   * deep-merging authored items into the static map would make deleted keys
   * linger forever. Authored values win over static bundle values on read.
   */
  private readonly authoredTranslations = new Map<string, Record<string, unknown>>();
  /** Per-locale merged view (static ⊕ authored), invalidated on any write. */
  private readonly mergedCache = new Map<string, Record<string, unknown>>();
  private defaultLocale: string;
  private readonly fallbackLocale: string | undefined;

  constructor(options: FileI18nAdapterOptions = {}) {
    this.defaultLocale = options.defaultLocale ?? 'en';
    this.fallbackLocale = options.fallbackLocale;

    if (options.localesDir) {
      this.loadFromDirectory(options.localesDir);
    }
  }

  t(key: string, locale: string, params?: Record<string, unknown>): string {
    // Try requested locale
    let value = this.resolveFromLocale(key, locale);

    // Try fallback locale
    if (value === undefined && this.fallbackLocale && this.fallbackLocale !== locale) {
      value = this.resolveFromLocale(key, this.fallbackLocale);
    }

    // Return key if not found
    if (value === undefined) return key;

    // Interpolate parameters
    if (params && Object.keys(params).length > 0) {
      return interpolate(value, params);
    }

    return value;
  }

  getTranslations(locale: string): Record<string, unknown> {
    const authored = this.authoredTranslations.get(locale);
    if (!authored) return this.translations.get(locale) ?? {};
    const cached = this.mergedCache.get(locale);
    if (cached) return cached;
    const merged = deepMerge(this.translations.get(locale) ?? {}, authored);
    this.mergedCache.set(locale, merged);
    return merged;
  }

  loadTranslations(locale: string, translations: Record<string, unknown>): void {
    const existing = this.translations.get(locale);
    if (existing) {
      // Deep-merge so multiple plugins can contribute to the same nested keys
      // (e.g. each plugin adds its own objects under `objects.*`)
      this.translations.set(locale, deepMerge(existing, translations));
    } else {
      this.translations.set(locale, { ...translations });
    }
    this.mergedCache.delete(locale);
  }

  /**
   * Replace the ENTIRE runtime-authored translation layer (#2591).
   *
   * Called by the I18nServicePlugin's authored-translation re-sync with the
   * full current set of active `translation` metadata items, keyed by
   * locale. Wholesale replacement — not a merge — so keys removed from (or
   * deleted with) an authored item stop resolving on the next sync, while
   * the static bundle layer underneath is untouched.
   */
  replaceAuthoredTranslations(byLocale: Record<string, Record<string, unknown>>): void {
    this.authoredTranslations.clear();
    for (const [locale, data] of Object.entries(byLocale)) {
      if (!data || typeof data !== 'object') continue;
      this.authoredTranslations.set(locale, { ...data });
    }
    this.mergedCache.clear();
  }

  getLocales(): string[] {
    const locales = new Set(this.translations.keys());
    for (const locale of this.authoredTranslations.keys()) locales.add(locale);
    return Array.from(locales);
  }

  getDefaultLocale(): string {
    return this.defaultLocale;
  }

  setDefaultLocale(locale: string): void {
    this.defaultLocale = locale;
  }

  /**
   * Load all JSON translation files from a directory.
   * Each file should be named `{locale}.json`.
   */
  private loadFromDirectory(dir: string): void {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const locale = file.replace(/\.json$/, '');
      const filePath = path.join(dir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content) as Record<string, unknown>;
        this.translations.set(locale, data);
      } catch {
        // Skip files that can't be parsed
      }
    }
  }

  private resolveFromLocale(key: string, locale: string): string | undefined {
    // Authored layer wins over the static bundle (same precedence as
    // getTranslations' merged view) — cheap two-map probe instead of a merge.
    const authored = this.authoredTranslations.get(locale);
    if (authored) {
      const value = resolveKey(authored, key);
      if (value !== undefined) return value;
    }
    const data = this.translations.get(locale);
    if (!data) return undefined;
    return resolveKey(data, key);
  }
}
