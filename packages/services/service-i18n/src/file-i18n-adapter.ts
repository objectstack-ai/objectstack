// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { normalizeSupportedLocales } from '@objectstack/spec/system';
import type { II18nService, Logger } from '@objectstack/spec/contracts';
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
  /**
   * Where `t()` reports a translation it could not serve as asked (#28109).
   * Each report is said ONCE (see {@link FileI18nAdapter.MISSING_TRANSLATION_REPORT_LIMIT}).
   * Omitted, the adapter stays silent, as it always was; `I18nServicePlugin`
   * passes the plugin logger. What `t()` returns never depends on it.
   */
  logger?: Pick<Logger, 'warn' | 'debug'>;
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
 * A source key whose value is `undefined` is skipped: a bundle that leaves a
 * leaf unset (a module's `apps.APP.label`, which the owning package
 * translates) must not erase the value an earlier bundle supplied.
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
    if (sVal === undefined) continue;
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
  /**
   * [#7679] The app's DECLARED `i18n.supportedLocales`, injected by
   * `AppPlugin.loadTranslations` the same way `defaultLocale` is. `undefined`
   * means the app declared nothing, which must keep reporting every loaded
   * locale. Deliberately NOT a prune of `translations`: the platform plugins
   * push their bundles at `kernel:ready`, after the app plugin has run, so
   * this can only work as a read-time filter in `getLocales()`.
   */
  private supportedLocales: string[] | undefined;
  private readonly logger: Pick<Logger, 'warn' | 'debug'> | undefined;
  /** What `t()` has already reported (#28109): `locale` alone, or `locale|key`. */
  private readonly reportedMisses = new Set<string>();

  /**
   * [#28109] How many distinct misses `t()` reports before it goes quiet and
   * says so once. `t()` sits on every translated string the server renders,
   * and its locale often comes straight from `Accept-Language`, so an
   * unbounded set would grow (and log) once per header value a client sends.
   * 1000 is above every per-locale gap the shipped bundles leave today
   * (measured in the PR) and costs at most some tens of KB of short strings.
   */
  static readonly MISSING_TRANSLATION_REPORT_LIMIT = 1000;

  constructor(options: FileI18nAdapterOptions = {}) {
    this.defaultLocale = options.defaultLocale ?? 'en';
    this.fallbackLocale = options.fallbackLocale;
    this.logger = options.logger;

    if (options.localesDir) {
      this.loadFromDirectory(options.localesDir);
    }
  }

  t(key: string, locale: string, params?: Record<string, unknown>): string {
    // Try requested locale
    let value = this.resolveFromLocale(key, locale);

    if (value === undefined) {
      // Try fallback locale
      const fallback = this.fallbackLocale && this.fallbackLocale !== locale ? this.fallbackLocale : undefined;
      if (fallback) value = this.resolveFromLocale(key, fallback);
      if (this.logger) this.reportMiss(key, locale, fallback, value !== undefined);
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

  /**
   * Report the locales this stack offers.
   *
   * [#7679] When the app declared `i18n.supportedLocales`, that declaration IS
   * the answer — in declared order, and including a declared locale no bundle
   * was ever loaded for (declared-but-unserved). Reporting the declaration
   * rather than an intersection is what gives a client the signal that a
   * locale it is offered has nothing behind it yet; quietly dropping it leaves
   * the gap invisible on both sides. It is also the only answer independent of
   * how much had loaded by the time this was called — the platform plugins are
   * still pushing bundles at `kernel:ready`.
   *
   * With nothing declared, the loaded set — the behaviour every app that never
   * opted in already has.
   */
  getLocales(): string[] {
    if (this.supportedLocales) return [...this.supportedLocales];
    const locales = new Set(this.translations.keys());
    for (const locale of this.authoredTranslations.keys()) locales.add(locale);
    return Array.from(locales);
  }

  /** @see II18nService.setSupportedLocales — [#7679] */
  setSupportedLocales(locales: readonly string[] | undefined): void {
    this.supportedLocales = normalizeSupportedLocales(locales);
  }

  getDefaultLocale(): string {
    return this.defaultLocale;
  }

  setDefaultLocale(locale: string): void {
    this.defaultLocale = locale;
  }

  /**
   * The locale `t()` consults after the requested one — the `fallbackLocale`
   * this adapter was constructed with, which `I18nServicePlugin` receives
   * from the stack's `i18n` config (`fallbackLocale || defaultLocale || 'en'`,
   * collapsed by the `os serve` / dev-plugin boot).
   *
   * [#14882] Exposed so the REST metadata reads pass the SAME locale to the
   * document translators' `fallbackChain` that `t()` falls back to; without
   * it the translators defaulted to `['en']` and a `zh-CN` workspace's
   * courtesy `en` bundle outranked its authored Chinese labels.
   * `undefined` when the adapter was constructed without one.
   *
   * @see II18nService.getFallbackLocale
   */
  getFallbackLocale(): string | undefined {
    return this.fallbackLocale;
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

  /**
   * Say, once, that `t()` could not answer `key` in `locale` (#28109). Only a
   * log line: the caller still gets the fallback text or the key.
   *
   * - The locale has no bundle at all (static or authored): ONE line per
   *   locale, not one per key. A locale nobody ships (a `fr` reader on the
   *   platform bundles) would otherwise report every key it renders.
   * - The fallback locale served the key: one line per key and locale. The
   *   key exists, so a translation for this locale is what is missing.
   * - No bundle holds the key: `debug`, always. Most `t()` callers probe on
   *   purpose (a deployment override address, a field label with a
   *   declared-label fallback) and read the echoed key as "not overridden",
   *   so a `warn` here would mostly report misses nobody has to fix.
   *
   * The first two are a `warn` only for a locale this stack OFFERS
   * (`getLocales()`: the declared `i18n.supportedLocales`, else every loaded
   * locale). For any other locale the client asked for something the app
   * never offered, often straight from `Accept-Language`; the fallback is the
   * designed answer there, so it is `debug`, and a client cannot drive the
   * warn volume by sending locales.
   */
  private reportMiss(key: string, locale: string, fallback: string | undefined, servedByFallback: boolean): void {
    const logger = this.logger;
    if (!logger) return;
    const hasBundle = this.translations.has(locale) || this.authoredTranslations.has(locale);
    const said = hasBundle ? `${locale}|${key}` : locale;
    if (this.reportedMisses.has(said)) return;
    const limit = FileI18nAdapter.MISSING_TRANSLATION_REPORT_LIMIT;
    if (this.reportedMisses.size >= limit) return;
    this.reportedMisses.add(said);

    const fallsBackTo = fallback ? `'${fallback}' (fallback locale) or to the key` : 'the key';
    const offered = this.getLocales().includes(locale);
    if (!hasBundle && offered) {
      logger.warn(
        `[i18n] locale '${locale}' is offered (i18n.supportedLocales) but has no translation bundle; ` +
        `strings requested in it fall back to ${fallsBackTo}. ` +
        `Load a '${locale}' bundle, or drop it from i18n.supportedLocales. Said once for this locale.`,
      );
    } else if (!hasBundle) {
      logger.debug(
        `[i18n] locale '${locale}' has no translation bundle and is not offered; ` +
        `strings requested in it fall back to ${fallsBackTo}. Said once for this locale.`,
      );
    } else if (servedByFallback) {
      const message =
        `[i18n] translation key '${key}' is missing in '${locale}'; served the '${fallback}' (fallback locale) text. ` +
        `Add it to the '${locale}' bundle. Said once for this key and locale.`;
      if (offered) logger.warn(message);
      else logger.debug(`${message} '${locale}' is not offered by this stack.`);
    } else {
      logger.debug(
        `[i18n] translation key '${key}' has no entry in '${locale}'${fallback ? ` or '${fallback}' (fallback locale)` : ''}; ` +
        'the key itself was returned. Said once for this key and locale.',
      );
    }
    if (this.reportedMisses.size >= limit) {
      logger.warn(
        `[i18n] ${limit} missing translations reported; further misses are not logged until the process restarts.`,
      );
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
