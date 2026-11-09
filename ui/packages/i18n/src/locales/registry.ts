/**
 * @object-ui/i18n — the built-in catalogue registry (objectui#7479).
 *
 * ## What this module is for
 *
 * `locales/index.ts` names every pack in a static `import` statement, so every
 * module that reached ANY of them through the package entry reached all of
 * them. The console measured that (ten packs at the time): one eagerly loaded
 * chunk carrying every catalogue of which a viewer reads one, and every new translation key paid
 * for by every visitor in every language (objectui#7399's measurement, and the
 * per-chunk ceiling it ran out of).
 *
 * This module is the entry's replacement door. It holds:
 *
 *   - the language CODES, which cost nothing — the platform locale table's tags
 *     (`PLATFORM_LOCALE_TAGS` from `@objectstack/spec/system`, ruling F of
 *     objectstack#29349), not a list of this package's own;
 *   - one static `import` — `en`, and only `en` (see below);
 *   - one `() => import(...)` loader per other tag, each its own chunk;
 *   - a synchronous registry of what has actually been loaded so far.
 *
 * ## The table decides the set, and old codes keep resolving
 *
 * A catalogue is keyed by its table tag (`zh-Hans`, `zh-Hant`, `pt-BR`, …), and
 * the loader map below is TYPED on the table: a tag added to (or removed from)
 * `PLATFORM_LOCALES` without its catalogue is a compile error here, and
 * `all-locales-key-parity.test.ts` reads the same table, so a language the
 * Console lacks is red twice before it ships.
 *
 * The codes that stored values already carry (`sys_user.locale`, a cached seed,
 * an `Accept-Language` answer, an app's `supportedLocales`) are not table tags:
 * `zh`, `zh-CN`, `zh-TW`, `pt`, `ja-JP`, `en-US`. {@link resolveBuiltInLanguage}
 * reads every code through the table's read aliases (`platformLocaleTagOf`) —
 * the whole code first, then each shorter prefix — so `zh-CN` is served by
 * `zh-Hans`, `zh-TW` and `zh-Hant-TW` by `zh-Hant`, `pt` and `pt-PT` by
 * `pt-BR`, `de-AT` by `de`. ⛔ No second alias list lives in this package.
 *
 * ## Why `en` is static and the others are not
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
 *      `en` bundle those render as the RAW KEY, in the UI, in every other language.
 *   2. `@object-ui/app-shell`'s `LoadingScreen` renders BEFORE i18n is usable
 *      and on the server-down path where nothing else loads. It needs a
 *      synchronous dictionary, and leaving it with English literals instead is
 *      the "delete or untranslate the copy" route objectui#7399 rejected.
 *   3. A caller of the synchronous, published `createI18n()` that never awaits
 *      anything must still get a usable instance.
 *
 * So `en` is the documented resident fallback and every other catalogue is
 * fetched on demand. What a `zh-Hans` viewer pays is `en` + `zh-Hans`, not
 * every pack.
 *
 * ## The loaders are spelled out, one per line, on purpose
 *
 * ⛔ Never collapse them into `import(`./${lang}.js`)`. A template literal makes
 * the specifier dynamic, and every bundler answers that by emitting EVERY file
 * the pattern could match — which is the all-catalogue closure again, now
 * spelled in a way that reads lazy. One literal specifier per tag is one chunk
 * the bundler can name, and `apps/console/vite.config.ts` names them
 * (`i18n-locale-<tag>`) so `scripts/check-eager-locale-catalogues.mjs` can
 * weigh them in the BUILT bundle rather than in this source file.
 */
import {
  PLATFORM_LOCALE_TAGS,
  platformLocaleTagOf,
  type PlatformLocaleTag,
} from '@objectstack/spec/system';
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
 * The catalogues fetched on demand — one literal specifier each, so each one is
 * a chunk of its own. ⛔ Read the header before touching the spelling.
 *
 * Typed on the platform locale table: every table tag but `en` must have a
 * loader here and nothing else may, so the table and the packs cannot drift
 * apart without a compile error.
 */
const LAZY_LOCALE_LOADERS: Readonly<
  Record<Exclude<PlatformLocaleTag, typeof DEFAULT_BUILT_IN_LANGUAGE>, () => Promise<{ default: LocaleCatalogue }>>
> = Object.freeze({
  'zh-Hans': () => import('./zh-Hans.js'),
  'zh-Hant': () => import('./zh-Hant.js'),
  es: () => import('./es.js'),
  ar: () => import('./ar.js'),
  fr: () => import('./fr.js'),
  'pt-BR': () => import('./pt-BR.js'),
  ru: () => import('./ru.js'),
  de: () => import('./de.js'),
  ja: () => import('./ja.js'),
  ko: () => import('./ko.js'),
});

/**
 * Every language code this package ships a catalogue for: the platform locale
 * table's tags, in table (menu) order, with NO catalogue bytes behind the
 * list. This is what a language switcher enumerates.
 */
export const BUILT_IN_LANGUAGE_CODES: readonly string[] = Object.freeze([...PLATFORM_LOCALE_TAGS]);

/**
 * Exact-then-base language-tag matching: `tag` itself when `has(tag)`, else
 * its base language (`zh-CN` → `zh`) when `has(base)`, else `null`.
 *
 * A generic matcher over a caller's own set, for sets that are NOT the platform
 * locale table: `I18nProvider` asks it which language a cached seed boots in
 * (over the built-in packs plus `config.resources`), and the `studio` namespace
 * which of its two catalogues serves a code. The built-in catalogues are
 * matched by {@link resolveBuiltInLanguage}, which reads the table's read
 * aliases first.
 *
 * Exact first, so a catalogue keyed by a full tag (a `pt-BR` beside `pt`) is
 * never shadowed by its base language.
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
 * The tag of the built-in catalogue that serves `lang`, or `null` when this
 * package ships none for it.
 *
 * `lang` is read through the platform locale table's read aliases
 * (`platformLocaleTagOf`, case-insensitive): a table tag answers itself and a
 * stored code answers the tag it means — `zh`, `zh-CN`, `zh-SG` → `zh-Hans`;
 * `zh-TW`, `zh-HK`, `zh-MO` → `zh-Hant`; `pt` → `pt-BR`; `ja-JP` → `ja`;
 * `en-US` → `en`. A code the table does not name is retried one subtag shorter
 * at a time (RFC 4647 lookup), so `zh-Hant-TW` is served by `zh-Hant`,
 * `zh-Hans-CN` by `zh-Hans`, `de-AT` by `de` and `pt-PT` — through `pt` — by
 * `pt-BR`. The script subtag is kept until last, which is what tells the two
 * Chinese scripts apart: a region code cannot (Singapore writes Simplified,
 * Hong Kong Traditional), so the read aliases name each one.
 */
export function resolveBuiltInLanguage(lang: string): string | null {
  if (typeof lang !== 'string') return null;
  let candidate = lang;
  while (candidate) {
    const tag = platformLocaleTagOf(candidate);
    if (tag !== undefined && hasBuiltInCatalogue(tag)) return tag;
    const cut = candidate.lastIndexOf('-');
    if (cut <= 0) return null;
    candidate = candidate.slice(0, cut);
  }
  return null;
}

/**
 * Whether `@object-ui/i18n` ships a catalogue that serves `lang` — a table tag,
 * a read alias of one, or a longer tag one of those prefixes (`zh-CN` →
 * `zh-Hans`; see {@link resolveBuiltInLanguage}).
 */
export function isBuiltInLanguage(lang: string): boolean {
  return resolveBuiltInLanguage(lang) !== null;
}

/**
 * The catalogues loaded so far, keyed by table tag. `en` is in here from module
 * evaluation; each other catalogue appears once {@link loadBuiltInLocale} has
 * resolved for it.
 */
const loaded: Record<string, LocaleCatalogue> = {
  [DEFAULT_BUILT_IN_LANGUAGE]: en as LocaleCatalogue,
};

/** In-flight loads, so N callers for one language share one fetch. */
const inFlight = new Map<string, Promise<LocaleCatalogue | null>>();

/**
 * A synchronous snapshot of the catalogues this process has resolved, keyed by
 * table tag (`zh-Hans`, not `zh-CN`): a reader holding a language code looks it
 * up as `getLoadedBuiltInLocales()[resolveBuiltInLanguage(code)]`.
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
 * {@link registerBuiltInLocales}: that module statically imports every pack, so
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
 * needed). Reads the same resolution as {@link loadBuiltInLocale}, so the two
 * agree for a stored code: when `zh-Hans` is resident, `zh-CN` needs no fetch
 * either.
 */
export function isBuiltInLocaleLoaded(lang: string): boolean {
  const code = resolveBuiltInLanguage(lang);
  return code !== null && Object.prototype.hasOwnProperty.call(loaded, code);
}

/**
 * Fetch the built-in catalogue that serves `lang`, or resolve `null` for a code
 * this package has no catalogue for (an app-supplied locale, a typo).
 *
 * A stored code resolves the catalogue of the table tag it means (`zh-CN` →
 * the `zh-Hans` catalogue, `zh-TW` → `zh-Hant`) — see
 * {@link resolveBuiltInLanguage}. The catalogue is fetched and memoised under
 * ITS OWN tag, so `zh-CN`, `zh` and `zh-Hans` share one fetch and
 * {@link getLoadedBuiltInLocales} stays keyed by table tag, which is how
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
    ? LAZY_LOCALE_LOADERS[code as keyof typeof LAZY_LOCALE_LOADERS]
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
