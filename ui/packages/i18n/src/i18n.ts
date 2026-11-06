/**
 * @object-ui/i18n - Core i18n configuration and initialization
 *
 * Wraps i18next with Object UI defaults and built-in locale support.
 */
import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { PLATFORM_LOCALE_READ_ALIASES } from '@objectstack/spec/system';
import {
  BUILT_IN_LANGUAGE_CODES,
  getLoadedBuiltInLocales,
  resolveBuiltInLanguage,
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
 * in every pack is a string), so nothing observable rides on this; the rule
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
 * The browser language is matched in this order:
 *
 *   1. an app pack in `config.resources` keyed by its base language (`zh` for a
 *      `zh-CN` browser) — the precedence an app's own pack has always had;
 *   2. the built-in catalogue the WHOLE tag reads as through the platform locale
 *      table, answered as its table tag (`zh-TW` → `zh-Hant`, `zh-CN` →
 *      `zh-Hans`, `pt-BR` → `pt-BR`, `fr-CA` → `fr`). ⛔ Never the base language
 *      alone: `zh` cannot tell a Taiwan browser from a mainland one.
 *
 * ⚠️ Browser detection is asked of the registry rather than of the merged
 * resource map: a catalogue that has not been fetched yet is still a language
 * this renderer can produce, and asking the map would have made detection
 * depend on load order.
 */
export function pickInitialLanguage(config: I18nConfig = {}): string {
  const { defaultLanguage = 'en', resources = {}, detectBrowserLanguage = true } = config;
  if (!detectBrowserLanguage || typeof navigator === 'undefined') return defaultLanguage;
  const browserTag = navigator.language;
  if (!browserTag) return defaultLanguage;
  const browserLang = browserTag.split('-')[0];
  if (browserLang && Object.prototype.hasOwnProperty.call(resources, browserLang)) return browserLang;
  return resolveBuiltInLanguage(browserTag) ?? defaultLanguage;
}

/**
 * i18next's `fallbackLng`, read off the platform locale table's read aliases.
 *
 * The built-in catalogues are keyed by table tag (`zh-Hans`, `pt-BR`), while an
 * instance's language is often a stored code (`zh`, `zh-CN`, `zh-TW`, `pt`):
 * `sys_user.locale`, a cached seed, an app's `supportedLocales`. i18next's own
 * hierarchy only walks a code DOWN (`zh-TW` → `zh`), never across to the tag it
 * means, so each alias names its table tag as the first fallback, ahead of
 * `fallbackLanguage`: `zh-TW` resolves `zh-TW`, `zh`, then `zh-Hant`, then
 * `en`. A longer code reaches its entry through i18next's own lookup of this
 * map (the whole code, its script part, then its language part: `pt-PT` →
 * `pt` → `pt-BR`; `zh-Hant-TW` → `zh-Hant`).
 *
 * An object, not a function: i18next caches the resolved hierarchy for an
 * object `fallbackLng` and recomputes it on every lookup for a function one.
 */
function fallbackLanguagesFor(fallbackLanguage: string): Record<string, string[]> {
  const fallbacks: Record<string, string[]> = { default: [fallbackLanguage] };
  // A table tag falls back to `fallbackLanguage` alone. Listed so a longer tag
  // stops at its script part: i18next asks this map for `zh-Hant` before `zh`,
  // so `zh-Hant-TW` never borrows a missing key from the Simplified catalogue.
  for (const tag of BUILT_IN_LANGUAGE_CODES) fallbacks[tag] = [fallbackLanguage];
  for (const [code, tag] of Object.entries(PLATFORM_LOCALE_READ_ALIASES)) {
    fallbacks[code] = tag === fallbackLanguage ? [fallbackLanguage] : [tag, fallbackLanguage];
  }
  return fallbacks;
}

/**
 * The keys whose interpolated object name is spaced from the Chinese text
 * around it, and the option that carries the name. Opt-in by key: every other
 * key, and every static string, renders exactly as authored.
 *
 * A Chinese title such as `新建{{object}}` reads `新建联系人` for a translated
 * label, which is right, and `新建Repair Ticket` for a label with no Chinese
 * translation, which is not: Chinese typesetting puts a space between Han text
 * and a Latin word. The space is decided by the VALUE, at render time, because
 * the pack cannot know which label it will meet. The pack keeps the plain
 * `{{object}}` spelling (no format spec), the one spelling the provider-less
 * fallback interpolator can also resolve.
 */
export const CJK_LATIN_SPACED_KEYS: Readonly<Record<string, string>> = {
  'form.createTitle': 'object',
  'form.editTitle': 'object',
  'form.viewTitle': 'object',
  'console.ai.recordWriteCreateTitle': 'object',
  'console.ai.recordWriteUpdateTitle': 'object',
};

/** The languages whose packs the spacing applies to. */
const CJK_LATIN_SPACED_LANGUAGES: ReadonlySet<string> = new Set(['zh']);

const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LATIN_OR_DIGIT = /[\p{Script=Latin}\p{Nd}]/u;

/**
 * Put one space between `value` and a CJK character it touches in `text`, on
 * each side where `value`'s edge character is a Latin letter or a digit.
 * `新建Repair Ticket` → `新建 Repair Ticket`; `新建联系人` is unchanged, and so
 * is a side that already has a space or punctuation.
 */
export function spaceLatinValueFromCjk(text: string, value: string): string {
  if (!value || !text.includes(value)) return text;
  const chars = Array.from(value);
  const padStart = LATIN_OR_DIGIT.test(chars[0]);
  const padEnd = LATIN_OR_DIGIT.test(chars[chars.length - 1]);
  if (!padStart && !padEnd) return text;
  const parts = text.split(value);
  let out = parts[0];
  for (let i = 1; i < parts.length; i += 1) {
    const before = Array.from(out).pop() ?? '';
    const after = Array.from(parts[i])[0] ?? '';
    out += (padStart && CJK_CHAR.test(before) ? ' ' : '') + value + (padEnd && CJK_CHAR.test(after) ? ' ' : '') + parts[i];
  }
  return out;
}

/** The i18next post-processor that applies {@link CJK_LATIN_SPACED_KEYS}. */
const CJK_LATIN_SPACING_PROCESSOR = 'objectui-cjk-latin-spacing';

const cjkLatinSpacingProcessor = {
  type: 'postProcessor' as const,
  name: CJK_LATIN_SPACING_PROCESSOR,
  process(value: string, keys: string | string[], options: Record<string, unknown>, translator: { language?: string }): string {
    if (typeof value !== 'string') return value;
    const key = Array.isArray(keys) ? keys[0] : keys;
    const option = typeof key === 'string' ? CJK_LATIN_SPACED_KEYS[key] : undefined;
    if (!option) return value;
    const lng = typeof options?.lng === 'string' ? options.lng : translator?.language;
    if (!lng || !CJK_LATIN_SPACED_LANGUAGES.has(lng.split('-')[0])) return value;
    const name = options?.[option];
    return typeof name === 'string' ? spaceLatinValueFromCjk(value, name) : value;
  },
};

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
  instance.use(initReactI18next).use(cjkLatinSpacingProcessor).init({
    lng,
    fallbackLng: fallbackLanguagesFor(fallbackLanguage),
    resources: mergedResources,
    postProcess: [CJK_LATIN_SPACING_PROCESSOR],
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
