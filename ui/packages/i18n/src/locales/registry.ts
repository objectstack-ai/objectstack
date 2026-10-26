/**
 * @object-ui/i18n — the built-in catalogue registry (objectui#7479).
 *
 * ## What this module is for
 *
 * `locales/index.ts` names all ten packs in ten static `import` statements, so
 * every module that reached ANY of them through the package entry reached all
 * ten. The console measured that: one eagerly loaded chunk carrying ten
 * catalogues of which a viewer reads one, and every new translation key paid
 * for by every visitor in every language (objectui#7399's measurement, and the
 * per-chunk ceiling it ran out of).
 *
 * This module is the entry's replacement door. It holds:
 *
 *   - the ten language CODES, which cost nothing;
 *   - one static `import` — `en`, and only `en` (see below);
 *   - nine `() => import(...)` loaders, one per catalogue, each its own chunk;
 *   - a synchronous registry of what has actually been loaded so far.
 *
 * ## Why `en` is static and the other nine are not
 *
 * ⛔ This is not a shortcut around the ask; it is what makes the ask safe, and
 * the card admits it in as many words ("no `packages/i18n/src/locales/*` module
 * in any eager chunk EXCEPT THE ACTIVE ONE", and "roughly NINE catalogues'
 * worth" of bytes). Three separate mechanisms need an `en` catalogue to be
 * resident and none of them can await one:
 *
 *   1. `createI18n` declares `fallbackLng: 'en'`. Any key a pack does not
 *      define — the four `console.ai.*` outbound messages are exempted from
 *      parity by `all-locales-key-parity.test.ts`, and a plural category no
 *      pack enumerates is resolved the same way — renders through `en`. With no
 *      `en` bundle those render as the RAW KEY, in the UI, in nine languages.
 *   2. `@object-ui/app-shell`'s `LoadingScreen` renders BEFORE i18n is usable
 *      and on the server-down path where nothing else loads. It needs a
 *      synchronous dictionary, and leaving it with English literals instead is
 *      the "delete or untranslate the copy" route objectui#7399 rejected.
 *   3. A caller of the synchronous, published `createI18n()` that never awaits
 *      anything must still get a usable instance.
 *
 * So `en` is the documented resident fallback and the other nine are fetched on
 * demand. What a `zh` viewer pays is `en` + `zh`, not ten.
 *
 * ## The loaders are spelled out, one per line, on purpose
 *
 * ⛔ Never collapse them into `import(`./${lang}.js`)`. A template literal makes
 * the specifier dynamic, and every bundler answers that by emitting EVERY file
 * the pattern could match — which is the ten-catalogue closure again, now
 * spelled in a way that reads lazy. Ten literal specifiers are ten chunks the
 * bundler can name, and `apps/console/vite.config.ts` names them
 * (`i18n-locale-<code>`) so `scripts/check-eager-locale-catalogues.mjs` can
 * weigh them in the BUILT bundle rather than in this source file.
 */
import en from './en.js';
import type { TranslationKeys } from './en.js';

/**
 * A built-in catalogue as the runtime handles one.
 *
 * Deliberately NOT `TranslationKeys`: `en.ts` ends in `as const`, so that type
 * carries `en`'s literal VALUES and no other pack's strings are assignable to
 * it. Consumers that want the shape read {@link TranslationKeys} off `en`
 * directly and cast, exactly as `builtInLocales` consumers already did.
 */
export type LocaleCatalogue = Readonly<Record<string, unknown>>;

/**
 * The catalogue every instance can rely on being present, synchronously.
 * See the header for the three mechanisms that require it.
 */
export const DEFAULT_BUILT_IN_LANGUAGE = 'en';

/**
 * The nine catalogues fetched on demand — one literal specifier each, so each
 * one is a chunk of its own. ⛔ Read the header before touching the spelling.
 */
const LAZY_LOCALE_LOADERS: Readonly<Record<string, () => Promise<{ default: LocaleCatalogue }>>> =
  Object.freeze({
    zh: () => import('./zh.js'),
    ja: () => import('./ja.js'),
    ko: () => import('./ko.js'),
    de: () => import('./de.js'),
    fr: () => import('./fr.js'),
    es: () => import('./es.js'),
    pt: () => import('./pt.js'),
    ru: () => import('./ru.js'),
    ar: () => import('./ar.js'),
  });

/**
 * Every language code this package ships a catalogue for — the ten, in the
 * order `builtInLocales` declared them, and with NO catalogue bytes behind the
 * list. This is what a language switcher enumerates.
 */
export const BUILT_IN_LANGUAGE_CODES: readonly string[] = Object.freeze([
  DEFAULT_BUILT_IN_LANGUAGE,
  ...Object.keys(LAZY_LOCALE_LOADERS),
]);

/**
 * Exact-then-base language-tag matching: `tag` itself when `has(tag)`, else
 * its base language (`zh-CN` → `zh`) when `has(base)`, else `null`.
 *
 * The ONE implementation of this order in the package (objectui#11326). The
 * registry asks it which catalogue serves a code, and `I18nProvider` asks it
 * which language a cached seed boots in — each with its own `has`, so the two
 * can never disagree about the ORDER while each keeps its own notion of what
 * exists.
 *
 * Exact first, so a catalogue keyed by a full tag (a `pt-BR` beside `pt`, a
 * `zh-TW` beside `zh`) is never shadowed by its base language.
 */
export function matchLanguageTag(tag: string, has: (code: string) => boolean): string | null {
  if (has(tag)) return tag;
  const base = tag.split('-')[0];
  if (base && base !== tag && has(base)) return base;
  return null;
}

/** Whether a built-in catalogue is keyed by exactly `code`. */
function hasBuiltInCatalogue(code: string): boolean {
  return (
    code === DEFAULT_BUILT_IN_LANGUAGE ||
    Object.prototype.hasOwnProperty.call(LAZY_LOCALE_LOADERS, code)
  );
}

/**
 * The code of the built-in catalogue that serves `lang`, or `null` when this
 * package ships none for it.
 *
 * A region-tagged code is served by its base language's catalogue: the
 * platform answers `zh-CN`, a language menu offers `zh-CN`, and the user's
 * stored choice is `zh-CN`, while the catalogue is keyed `zh`. An exact match
 * still wins — see {@link matchLanguageTag}.
 */
export function resolveBuiltInLanguage(lang: string): string | null {
  return matchLanguageTag(lang, hasBuiltInCatalogue);
}

/**
 * Whether `@object-ui/i18n` ships a catalogue that serves `lang` — exactly, or
 * through its base language (`zh-CN` → `zh`; see {@link resolveBuiltInLanguage}).
 */
export function isBuiltInLanguage(lang: string): boolean {
  return resolveBuiltInLanguage(lang) !== null;
}

/**
 * The catalogues loaded so far. `en` is in here from module evaluation; each of
 * the other nine appears once {@link loadBuiltInLocale} has resolved for it.
 */
const loaded: Record<string, LocaleCatalogue> = {
  [DEFAULT_BUILT_IN_LANGUAGE]: en as LocaleCatalogue,
};

/** In-flight loads, so N callers for one language share one fetch. */
const inFlight = new Map<string, Promise<LocaleCatalogue | null>>();

/**
 * A synchronous snapshot of the catalogues this process has resolved.
 *
 * ⚠️ A SNAPSHOT, not a live view: callers that render from it must re-read it
 * after `loadBuiltInLocale` resolves, or they will keep rendering the answer
 * they took before the fetch landed.
 */
export function getLoadedBuiltInLocales(): Readonly<Record<string, LocaleCatalogue>> {
  return { ...loaded };
}

/**
 * Make a catalogue resident WITHOUT fetching it — for a caller that already
 * holds one.
 *
 * The only caller in this repository is `locales/index.ts`'s
 * {@link registerBuiltInLocales}: that module statically imports all ten, so
 * asking {@link loadBuiltInLocale} to `import()` them again would be an await
 * for modules the evaluator already has. It is also what lets a test that needs
 * a non-`en` locale resident say so in ONE SYNCHRONOUS LINE at module scope —
 * the shape AGENTS.md prescribes for a cost that belongs in the import phase,
 * rather than a `beforeAll` bounded by `hookTimeout`.
 *
 * ⛔ Not exported from the package entry, deliberately. An app that wants a
 * catalogue resident asks for it by CODE through `loadBuiltInLocale`; handing
 * the entry a way to inject arbitrary objects into the registry would make
 * "which catalogue is this" unanswerable from the codes alone.
 */
export function registerBuiltInLocale(lang: string, catalogue: LocaleCatalogue): void {
  loaded[lang] = catalogue;
}

/**
 * Whether the catalogue that serves `lang` is already resident (no fetch
 * needed). Reads the same exact-then-base resolution as
 * {@link loadBuiltInLocale}, so the two agree for a region-tagged code: when
 * `zh` is resident, `zh-CN` needs no fetch either.
 */
export function isBuiltInLocaleLoaded(lang: string): boolean {
  const code = resolveBuiltInLanguage(lang);
  return code !== null && Object.prototype.hasOwnProperty.call(loaded, code);
}

/**
 * Fetch the built-in catalogue that serves `lang`, or resolve `null` for a code
 * this package has no catalogue for (an app-supplied locale, a typo).
 *
 * A region-tagged code resolves its base language's catalogue (`zh-CN` → the
 * `zh` catalogue) unless a catalogue is keyed by the full tag — see
 * {@link resolveBuiltInLanguage}. The catalogue is fetched and memoised under
 * ITS OWN code, so `zh-CN` and `zh` share one fetch and
 * {@link getLoadedBuiltInLocales} stays keyed by catalogue code, which is how
 * `createI18n` and the app-shell splash read it.
 *
 * Memoised in both directions: a resolved catalogue is returned from the
 * registry without a second import, and concurrent callers share one in-flight
 * promise. ⛔ A REJECTED load is not memoised — a chunk that failed to download
 * (offline, a cache miss against a redeployed origin) must be retryable, and a
 * language preference is never worth wedging permanently over one bad fetch.
 */
export async function loadBuiltInLocale(lang: string): Promise<LocaleCatalogue | null> {
  const code = resolveBuiltInLanguage(lang);
  if (code === null) return null;

  const resident = loaded[code];
  if (resident) return resident;

  const loader = Object.prototype.hasOwnProperty.call(LAZY_LOCALE_LOADERS, code)
    ? LAZY_LOCALE_LOADERS[code]
    : undefined;
  if (!loader) return null;

  const existing = inFlight.get(code);
  if (existing) return existing;

  const pending = loader()
    .then((mod) => {
      const catalogue = mod.default;
      loaded[code] = catalogue;
      return catalogue;
    })
    .finally(() => {
      inFlight.delete(code);
    });
  inFlight.set(code, pending);
  return pending;
}

export type { TranslationKeys };
