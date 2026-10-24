/**
 * @object-ui/i18n - Core i18n configuration and initialization
 *
 * Wraps i18next with Object UI defaults and built-in locale support.
 */
import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  BUILT_IN_LANGUAGE_CODES,
  getLoadedBuiltInLocales,
  isBuiltInLanguage,
} from './locales/registry.js';
import { isRTL } from './locales/rtl.js';
import type { TranslationKeys } from './locales/en.js';

export interface I18nConfig {
  /** Default language (default: 'en') */
  defaultLanguage?: string;
  /** Fallback language (default: 'en') */
  fallbackLanguage?: string;
  /**
   * Additional translation resources, **deep-merged** over the built-in packs.
   *
   * The packs' top-level keys are the namespace groups (`common`, `calendar`,
   * `list`, ...), so supplying a partial group merges into it and leaves the
   * group's other keys in place:
   * `{ en: { calendar: { today: 'Heute' } } }` overrides `calendar.today` only.
   * Arrays are replaced wholesale, never concatenated (objectui#7572).
   */
  resources?: Record<string, Record<string, unknown>>;
  /** Whether to detect browser language automatically (default: true) */
  detectBrowserLanguage?: boolean;
  /** i18next interpolation options */
  interpolation?: {
    escapeValue?: boolean;
    prefix?: string;
    suffix?: string;
  };
  /**
   * Warn (once per key) in the dev console when a translation key is missing
   * and the UI falls back to the key/defaultValue. Helps catch un-translated
   * static strings while iterating. Defaults to ON outside production builds.
   *
   * Convention-key probes from `useObjectLabel` (object/field/view labels that
   * intentionally fall back to server metadata) are excluded — they are not
   * real "missing keys", just speculative lookups.
   */
  warnMissingKeys?: boolean;
}

/**
 * Internal `t()` option flag set by `useObjectLabel` on its convention-key
 * probes. The missing-key handler skips any lookup carrying this flag, so the
 * deliberate object/field/view label probes (which usually miss and fall back
 * to server metadata) never surface as dev warnings. Not part of the public
 * API — shared between `i18n.ts` and `useObjectLabel.ts` to avoid drift.
 */
export const I18N_PROBE_FLAG = '__ouiLabelProbe';

// Module-scoped ambient: this browser-targeted package omits @types/node, but
// bundlers (Vite/esbuild) statically replace `process.env.NODE_ENV`, so the
// reference is safe and tree-shakes to a constant in production.
declare const process: { env: Record<string, string | undefined> } | undefined;

/** True outside production builds (bundlers statically replace this). */
function isDevEnv(): boolean {
  return typeof process === 'undefined' || process.env.NODE_ENV !== 'production';
}

/**
 * Build a dev-only i18next `missingKeyHandler`. Dedupes by language+key so a
 * missing string warns once, not on every re-render, and stays silent for the
 * convention-key probes flagged with {@link I18N_PROBE_FLAG}.
 */
function createMissingKeyHandler(): (
  lngs: readonly string[],
  ns: string,
  key: string,
  fallbackValue: string,
  updateMissing: boolean,
  options: Record<string, unknown>,
) => void {
  const seen = new Set<string>();
  return (lngs, _ns, key, fallbackValue, _updateMissing, options) => {
    if (options && options[I18N_PROBE_FLAG]) return;
    const lng = Array.isArray(lngs) ? lngs[0] : String(lngs ?? '');
    const dedupeKey = `${lng}:${key}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const fb = fallbackValue ? `"${fallbackValue}"` : 'the key itself';
    console.warn(
      `[object-ui i18n] Missing translation for "${key}" (language "${lng}") — falling back to ${fb}.`,
    );
  };
}

/**
 * A plain object — the only shape the resource merge recurses into. Arrays and
 * `null` are excluded on purpose; see {@link deepMergeTranslations}.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge caller-supplied translations over a built-in language pack.
 *
 * A language pack's top-level keys ARE the namespace groups (`common`,
 * `calendar`, `list`, ...), each a nested object, so the one-level merge this
 * replaced made `resources: { en: { calendar: { today: 'Heute' } } }` **replace**
 * the whole `calendar` group: `month` / `week` / `day` / `allDay` / `newEvent` /
 * `moreEvents` / `unscheduled` left the instance, `t('calendar.allDay')` returned
 * the bare key, and `calendar.allDay` reached the DOM as literal text
 * (objectui#7572). Packs nest up to four levels below the group
 * (`console.ai.empty.build.title`), so the merge recurses rather than adding one
 * fixed extra level.
 *
 * ARRAYS ARE REPLACED, NOT CONCATENATED — a deliberate choice, not a library
 * default. Measured: no built-in pack carries an array value today (every leaf
 * in all ten packs is a string), so nothing observable rides on this; the rule
 * decides what a future array means. An author who writes an array is naming the
 * whole list, so replacement is the only rule that lets them shorten or reorder
 * one, and the only one that is idempotent when the merge runs again. This is
 * narrower than i18next's own `deepExtend` (which the provider's async
 * `addResourceBundle` path uses): that recurses into arrays index-wise and would
 * leave a longer base array's tail behind — the same silent-hybrid shape this
 * issue is about.
 *
 * `__proto__` is skipped. Recursive assignment, unlike the object spread it
 * replaces, would otherwise reach the prototype setter; i18next's `deepExtend`
 * guards the same key.
 */
function deepMergeTranslations(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    if (key === '__proto__') continue;
    const incoming = override[key];
    const existing = merged[key];
    merged[key] =
      isPlainObject(existing) && isPlainObject(incoming)
        ? deepMergeTranslations(existing, incoming)
        : incoming;
  }
  return merged;
}

/**
 * The language {@link createI18n} will boot in for this config — `defaultLanguage`,
 * overridden by a browser language this renderer can produce.
 *
 * Exported because the answer is needed BEFORE an instance exists
 * (objectui#7479): with the catalogues lazy, a host that wants its first render
 * to already be in the right language has to know which catalogue to await, and
 * the only alternative — create an instance, read `.language`, throw it away —
 * would boot i18next in the wrong locale to find out what the right one is.
 * `I18nProvider` and {@link preloadBootstrapLocale} answer with THIS function,
 * so the host and the provider cannot disagree about which catalogue is active.
 *
 * ⚠️ Browser detection is asked of {@link isBuiltInLanguage} rather than of the
 * merged resource map: a catalogue that has not been fetched yet is still a
 * language this renderer can produce, and asking the map would have made
 * detection depend on load order.
 */
export function pickInitialLanguage(config: I18nConfig = {}): string {
  const { defaultLanguage = 'en', resources = {}, detectBrowserLanguage = true } = config;
  if (!detectBrowserLanguage || typeof navigator === 'undefined') return defaultLanguage;
  const browserLang = navigator.language?.split('-')[0];
  if (!browserLang) return defaultLanguage;
  const known =
    isBuiltInLanguage(browserLang) ||
    Object.prototype.hasOwnProperty.call(resources, browserLang);
  return known ? browserLang : defaultLanguage;
}

/**
 * Create and initialize an i18next instance with Object UI defaults
 */
export function createI18n(config: I18nConfig = {}): I18nInstance {
  const {
    fallbackLanguage = 'en',
    resources = {},
    interpolation,
    warnMissingKeys = isDevEnv(),
  } = config;
  // `defaultLanguage` and `detectBrowserLanguage` are read by
  // {@link pickInitialLanguage}, which owns that precedence for this function
  // AND for the hosts that must know the answer before an instance exists.

  // Merge the catalogues that are RESIDENT with user-provided resources.
  //
  // ⛔ Every built-in code gets a bundle here even when its catalogue has not
  // been fetched yet (objectui#7479). The empty bundle is load-bearing, not a
  // placeholder: it keeps `instance.options.resources` — which
  // {@link getAvailableLanguages}, the browser detection below and i18next's
  // own `hasResourceBundle` all read — enumerating every language this package
  // can produce, instead of shrinking to whatever happened to be loaded at
  // instance-creation time. Until the catalogue lands, `fallbackLng` renders
  // those keys through `en`; `I18nProvider` then deep-merges the real
  // catalogue in WITHOUT overwriting anything `resources` put there, so the
  // precedence below survives the async arrival.
  const mergedResources: Record<string, { translation: Record<string, unknown> }> = {};
  const residentCatalogues = getLoadedBuiltInLocales();

  for (const lang of BUILT_IN_LANGUAGE_CODES) {
    mergedResources[lang] = {
      translation: deepMergeTranslations(
        (residentCatalogues[lang] ?? {}) as unknown as Record<string, unknown>,
        resources[lang] || {},
      ),
    };
  }

  // Add any additional languages from resources not in built-in locales
  for (const [lang, translations] of Object.entries(resources)) {
    if (!mergedResources[lang]) {
      mergedResources[lang] = { translation: translations as Record<string, unknown> };
    }
  }

  const lng = pickInitialLanguage(config);

  const instance = i18next.createInstance();

  // IMPORTANT: disable react-i18next Suspense. Otherwise `useTranslation()`
  // calls during bootstrap throw a Suspense promise (the i18n instance is
  // technically still "initializing" on the very first render in StrictMode),
  // which unmounts the entire App subtree — including ConditionalAuthWrapper,
  // so the discovery fetch never runs and the splash never appears.
  instance.use(initReactI18next).init({
    lng,
    fallbackLng: fallbackLanguage,
    resources: mergedResources,
    interpolation: {
      escapeValue: false, // React already escapes
      ...interpolation,
    },
    returnNull: false,
    // Dev-only: surface un-translated static keys in the console (deduped,
    // and silent for useObjectLabel's intentional convention-key probes).
    saveMissing: warnMissingKeys,
    missingKeyHandler: warnMissingKeys ? createMissingKeyHandler() : undefined,
    react: {
      useSuspense: false,
    },
  });

  return instance;
}

/**
 * Get the text direction for the current language
 */
export function getDirection(lang: string): 'ltr' | 'rtl' {
  return isRTL(lang) ? 'rtl' : 'ltr';
}

/**
 * Get available languages from an i18n instance
 */
export function getAvailableLanguages(instance: I18nInstance): string[] {
  const resources = instance.options.resources;
  return resources ? Object.keys(resources) : [];
}

export type { TranslationKeys };
