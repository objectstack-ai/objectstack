/**
 * @object-ui/i18n
 *
 * Internationalization (i18n) support for Object UI.
 * Provides 10+ built-in language packs, RTL support, and date/currency formatting.
 *
 * @example
 * ```tsx
 * import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
 *
 * function App() {
 *   return (
 *     <I18nProvider config={{ defaultLanguage: 'zh' }}>
 *       <MyComponent />
 *     </I18nProvider>
 *   );
 * }
 *
 * function MyComponent() {
 *   const { t, language, changeLanguage, direction } = useObjectTranslation();
 *   return (
 *     <div dir={direction}>
 *       <h1>{t('common.save')}</h1>
 *       <button onClick={() => changeLanguage('en')}>English</button>
 *       <button onClick={() => changeLanguage('zh')}>中文</button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @packageDocumentation
 */

// Core i18n setup
export {
  createI18n,
  getDirection,
  getAvailableLanguages,
  pickInitialLanguage,
  type I18nConfig,
  type TranslationKeys,
} from './i18n.js';

// React integration
export {
  I18nProvider,
  useObjectTranslation,
  useI18nContext,
  // Language-preference persistence: the key the provider writes, and the
  // reader apps that bring their own i18next instance need to honour it.
  LOCALE_STORAGE_KEY,
  readStoredLanguage,
  // Locale seed (objectui#4035) — a SEPARATE slot from the explicit
  // choice above, and never a substitute for it. An app that fetches the
  // server's resolved locale for the last signed-in caller caches it here; the provider applies it at
  // bootstrap only when the user has chosen nothing themselves.
  LOCALE_SEED_STORAGE_KEY,
  readCachedLanguageSeed,
  cacheLanguageSeed,
  // Resolve the boot language, and fetch its catalogue, BEFORE first render
  // (objectui#7479). A host with an await before `createRoot().render()` spends
  // it here and paints in the user's language; a host without one gets the
  // documented `en`-while-loading render instead.
  resolveBootstrapLanguage,
  preloadBootstrapLocale,
  type BootstrapLocaleOptions,
  type I18nProviderProps,
} from './provider.js';

// Safe translation hook factory
export { createSafeTranslation, useSafeTranslate } from './useSafeTranslation.js';

// objectui#7258 — locale labels for the server's built-in default measures,
// handed to core's `buildChartSeries` as `builtinAggregateLabels`.
export { builtinAggregateLabels, type SafeTranslate } from './builtinAggregateLabels.js';

// objectui#8261 — the ONE authority for i18next's `t` narrowed to
// `(key, options?) => string`. `@object-ui/app-shell` and `@object-ui/fields`
// re-export it from here rather than declaring their own copies.
export type { TranslateFn } from './translateFn.js';

// Convention-based object/field label i18n
export { useObjectLabel, useSafeFieldLabel } from './useObjectLabel.js';

// Locale packs — ⛔ ONE catalogue is statically re-exported here, not ten
// (objectui#7479).
//
// This entry used to re-export all ten packs and `builtInLocales`, which made
// every one of them statically reachable from any import of this package. The
// console measured the result: ~450 KB gzipped of translation data in the EAGER
// closure, ten catalogues fetched before first paint for a viewer who reads
// one, and every new key paid for by every visitor in every language.
//
// ⛔ Do not restore a static re-export of a second catalogue here, and do not
// re-export `builtInLocales` from this entry. Both put all ten back:
// `builtInLocales` names every pack in one object literal, so nothing can shake
// it. `scripts/check-eager-locale-catalogues.mjs` fails the build if a
// non-active catalogue reappears in the console's eager closure, and
// `src/__tests__/entry-locale-shape-7479.test.ts` fails on the SOURCE shape so
// the reason is legible without a console build.
//
// What replaced them:
//   - `en` stays — it is `fallbackLng`, the source of `TranslationKeys`, and
//     the synchronous dictionary the app-shell splash renders from before i18n
//     is usable. See `./locales/registry.js` for the full argument.
//   - `loadBuiltInLocale(code)` fetches any of the ten on demand.
//   - `BUILT_IN_LANGUAGE_CODES` enumerates them at zero payload.
//   - `@object-ui/i18n/locales` is the explicit, published door to all ten for
//     a caller that genuinely wants them all resident (the parity suites do).
export { isRTL, RTL_LANGUAGES } from './locales/rtl.js';
export {
  BUILT_IN_LANGUAGE_CODES,
  DEFAULT_BUILT_IN_LANGUAGE,
  getLoadedBuiltInLocales,
  isBuiltInLanguage,
  isBuiltInLocaleLoaded,
  loadBuiltInLocale,
  type LocaleCatalogue,
} from './locales/registry.js';
export { default as en } from './locales/en.js';

// Formatting utilities
export {
  formatDate,
  formatDateTime,
  formatRelativeTime,
  formatCurrency,
  formatNumber,
  type DateFormatOptions,
  type CurrencyFormatOptions,
  type NumberFormatOptions,
} from './utils/index.js';

// Spec-aligned formatters (v2.0.7)
export {
  resolvePlural,
  formatDateSpec,
  formatNumberSpec,
  applyLocaleConfig,
  type SpecPluralRule,
  type SpecDateFormat,
  type SpecNumberFormat,
  type SpecLocaleConfig,
} from './utils/index.js';

// Spec TranslationData → flat namespace transform (consumed by
// `useObjectLabel`). Exposed so apps don't have to copy/paste — see
// `apps/console/src/loadLanguage.ts` for the canonical consumer.
export {
  isSpecTranslationData,
  transformSpecTranslations,
  type SpecTranslationData,
} from './utils/index.js';

export { pickLocalized, setLocalized, clearLocalized } from './pickLocalized.js';
export { LocalizationProvider, useLocalization, type LocalizationValue } from './LocalizationContext.js';
export { resolveFieldCurrency } from './currency.js';

// The one number-display formatter (objectui#4033) and the locale it formats
// in. Every field cell / widget / metric renderer goes through this pair —
// see `utils/number-display.ts` for the grouping policy and its interim status.
export { useDisplayLocale } from './useDisplayLocale.js';
export {
  formatDisplayNumber,
  shouldGroupDisplayNumber,
  type DisplayNumberFormatOptions,
} from './utils/index.js';

// objectui#11675 — the first day of the week for a locale tag. The calendar's
// grids and the timeline's week buckets read it from the tag they format with,
// so the week starts where the locale says and never on a hard-coded day.
export { firstDayOfWeek, type WeekdayIndex } from './utils/index.js';
