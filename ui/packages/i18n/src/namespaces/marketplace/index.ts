// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @object-ui/i18n — the `marketplace` namespace: the marketplace pages' strings.
 *
 * ## What this is
 *
 * The `marketplace.*` group of the ten language packs, moved out of them into
 * ten PARTIAL packs — `./<code>.ts`, each the same shape as
 * `../../locales/<code>.ts` with only the `marketplace` group in it — that are
 * fetched when a marketplace page mounts and deep-merged into the page's
 * i18next instance. The call sites do not change: they still ask
 * `t('marketplace.…')` of the default `translation` namespace, and the keys
 * are there by the time they render.
 *
 * ## Why it is lazy
 *
 * `locales/en.ts` is the console's one EAGER catalogue (`../../locales/registry.ts`
 * says why), and `ui/scripts/check-eager-closure-budget.mjs` holds its chunk,
 * `i18n-locale-en`, under a ceiling of its own. The marketplace group was
 * about 4 KB of that chunk gzipped, paid on every console page load for two
 * pages that are lazy routes. Moved here it is paid by the visitor who opens
 * them, in the language they read.
 *
 * ## What stayed in the packs
 *
 * Studio's packages page — outside the marketplace route — draws marketplace
 * installs with the same app-shell components the marketplace pages use:
 * `MarketplaceRowActions` / `MarketplaceNotLoaded` for a row's Not loaded
 * badge and reason and its Uninstall action, confirmation and result, and
 * `useDependencyMissingText` / `useProtocolCheckSkippedText` for an import's
 * refusal and protocol note. The keys those read are still pack keys, resident
 * wherever that page can open: `marketplace.installedAdditiveNote`,
 * `marketplace.notLoaded.*`, `marketplace.action.{uninstall,uninstalling,details}`,
 * four `marketplace.uninstall.*` leaves, and
 * `marketplace.install.{dependencyMissing,protocolCheckSkipped}.*`. ⛔ A key
 * that a page outside the marketplace route reads belongs in the pack, not
 * here; a key here is only reachable under {@link useMarketplaceNamespace}.
 * App-shell's `marketplaceNamespaceBoundary` test walks what those files read
 * and fails on a key that is only here.
 *
 * ## Residency, and why every catalogue is lazy
 *
 * Unlike the packs (and unlike the `studio` namespace) nothing here is
 * resident: the pages that read these strings are themselves fetched on
 * demand, so there is no first frame that needs one synchronously. All ten
 * catalogues are one literal `() => import()` each — its own chunk
 * (`apps/console/vite.config.ts` names them `i18n-ns-marketplace-<code>`).
 * ⛔ Never collapse the loaders into a template-literal `import()`; the
 * registry's header says why.
 *
 * The one exception is a host that made every catalogue resident on purpose:
 * `registerBuiltInLocales()` (the all-ten door, `@object-ui/i18n/locales`)
 * registers each language COMPLETE, namespace included, so a catalogue the
 * registry already holds is used as it stands and never fetched.
 *
 * A page waits for TWO catalogues: the one that serves its language, and
 * `en`. `en` is what the packs' `fallbackLng: 'en'` falls back to, so loading
 * it keeps the fallback the marketplace strings had while they were pack keys
 * — a key a translation lacks renders in English, never as its raw name.
 *
 * ## Which gates read it
 *
 * Every i18n gate that reads pack keys reads these files as part of the
 * packs: `ui/scripts/check-i18n-call-site-keys.mjs` (`collectEnKeys`, so the
 * dead-keys report too) and `ui/scripts/check-i18n-en-drift.mjs` read
 * `./<code>.ts` beside `../../locales/<code>.ts` and refuse a key defined in
 * both. `../../locales/index.ts` (the all-ten door) hands out each language's
 * pack merged with its catalogue here, so `all-locales-key-parity.test.ts`
 * and every other suite that walks `builtInLocales` still walks these keys.
 * `../../__tests__/marketplace-namespace.test.ts` holds this module's own
 * shape: ten literal loaders, no static catalogue import, no key in both
 * places.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { i18n as I18nInstance } from 'i18next';
import { DEFAULT_BUILT_IN_LANGUAGE, getLoadedBuiltInLocales, matchLanguageTag } from '../../locales/registry.js';
import { useObjectTranslation } from '../../provider.js';

/** One language's catalogue: a partial pack holding the `marketplace` group. */
export type MarketplaceCatalogue = Readonly<Record<string, unknown>>;

/** The namespace's name — and the pack group its catalogues hold. */
export const MARKETPLACE_NAMESPACE = 'marketplace';

/**
 * A key every catalogue defines and no pack does: whether an instance can
 * render the namespace in a language is whether it holds this key there.
 * `marketplace-namespace.test.ts` holds both halves of that.
 */
export const MARKETPLACE_NAMESPACE_PROBE_KEY = 'marketplace.title';

/**
 * The ten catalogues, each fetched on demand — one literal specifier each, so
 * each one is a chunk of its own. ⛔ Read the header before touching the
 * spelling.
 */
const MARKETPLACE_LOADERS: Readonly<Record<string, () => Promise<{ default: MarketplaceCatalogue }>>> =
  Object.freeze({
    en: () => import('./en.js'),
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

/** Every language this namespace ships a catalogue for. */
export const MARKETPLACE_LANGUAGE_CODES: readonly string[] = Object.freeze(Object.keys(MARKETPLACE_LOADERS));

const own = (record: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

const hasMarketplaceCatalogue = (code: string): boolean => own(MARKETPLACE_LOADERS, code);

/**
 * The code of the catalogue that serves `lang` — exact tag, then base language
 * (`zh-CN` → `zh`), the order the packs resolve in — or `null` when this
 * namespace has none for it, and `lang` is served by the `en` fallback.
 */
export function resolveMarketplaceLanguage(lang: string | undefined): string | null {
  return matchLanguageTag(lang ?? '', hasMarketplaceCatalogue);
}

const loaded: Record<string, MarketplaceCatalogue> = {};
const inFlight = new Map<string, Promise<MarketplaceCatalogue>>();
const failed = new Map<string, unknown>();
const listeners = new Set<() => void>();
let version = 0;

function announce(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

/**
 * The catalogue `code` names when it needs no fetch: one this module fetched,
 * or the namespace group of the COMPLETE catalogue the registry holds once a
 * host called `registerBuiltInLocales()` (see the header).
 */
function residentCatalogue(code: string): MarketplaceCatalogue | undefined {
  if (own(loaded, code)) return loaded[code];
  if (!hasMarketplaceCatalogue(code)) return undefined;
  const registered = getLoadedBuiltInLocales()[code] as Record<string, unknown> | undefined;
  const group = registered?.[MARKETPLACE_NAMESPACE] as Record<string, unknown> | undefined;
  const probe = MARKETPLACE_NAMESPACE_PROBE_KEY.slice(MARKETPLACE_NAMESPACE.length + 1);
  if (typeof group?.[probe] !== 'string') return undefined;
  // Kept, so every later answer for `code` is this same object.
  loaded[code] = Object.freeze({ [MARKETPLACE_NAMESPACE]: group });
  return loaded[code];
}

/** Whether the catalogue `code` names is resident (no fetch needed). */
export function isMarketplaceCatalogueLoaded(code: string): boolean {
  return residentCatalogue(code) !== undefined;
}

/**
 * Fetch the catalogue `code` names and resolve it. Memoised: a resident
 * catalogue resolves without a second import, and concurrent callers share one
 * in-flight promise. ⛔ A rejected load is not memoised: it is recorded, so a
 * page can say it failed, and the next explicit request fetches again.
 */
export function loadMarketplaceCatalogue(code: string): Promise<MarketplaceCatalogue> {
  if (!hasMarketplaceCatalogue(code)) {
    return Promise.reject(new Error(`The marketplace namespace ships no \`${code}\` catalogue.`));
  }
  const resident = residentCatalogue(code);
  if (resident) return Promise.resolve(resident);
  const existing = inFlight.get(code);
  if (existing) return existing;
  failed.delete(code);
  // The in-flight entry goes BEFORE the announcement: a listener re-reads the
  // state at once, and must not find a settled request still marked in flight.
  const pending = MARKETPLACE_LOADERS[code]().then(
    (mod) => {
      inFlight.delete(code);
      loaded[code] = mod.default;
      announce();
      return mod.default;
    },
    (err: unknown) => {
      inFlight.delete(code);
      failed.set(code, err);
      announce();
      throw err;
    },
  );
  inFlight.set(code, pending);
  return pending;
}

/**
 * The `[language key, catalogue code]` pairs an instance rendering `lang` needs:
 * the catalogue that serves `lang` (stored under its code, which is on i18next's
 * resolution path for every tag it serves), and `en`, the packs' fallback.
 */
function catalogueTargets(lang: string): Array<readonly [string, string]> {
  const serving = resolveMarketplaceLanguage(lang);
  const targets: Array<readonly [string, string]> = [[DEFAULT_BUILT_IN_LANGUAGE, DEFAULT_BUILT_IN_LANGUAGE]];
  if (serving !== null && serving !== DEFAULT_BUILT_IN_LANGUAGE) targets.unshift([serving, serving]);
  return targets;
}

/**
 * Whether `instance` still holds the namespace in `lng`, without leaning on a
 * fallback language — i18next's own answer, so a bundle removed since it was
 * installed is installed again.
 */
function holdsNamespace(instance: I18nInstance, lng: string): boolean {
  return instance.exists(MARKETPLACE_NAMESPACE_PROBE_KEY, { lng, fallbackLng: false });
}

/**
 * The language keys each instance has been given its catalogue under. Kept
 * per instance rather than read off the instance's keys: a host whose own
 * `resources` spell one `marketplace.*` key in a language has not supplied
 * that language's catalogue, and must still get the rest of it.
 */
const installed = new WeakMap<I18nInstance, Set<string>>();

/** The writes {@link installResident} makes are SILENT: see there. */
const SILENT_WRITE = Object.freeze({ silent: true });

/**
 * Merge every catalogue `lang` needs that is resident but not yet in
 * `instance`. Deep, and ⛔ never overwriting: a host's own `resources` for a
 * `marketplace.*` key win over the built-in text, the precedence the packs keep.
 *
 * Silent, because it runs while the gate renders, before anything below it
 * has read a marketplace key: nothing on screen needs telling, and an `added`
 * event would re-render every translated component in the page for nothing.
 *
 * @returns whether the instance now holds every catalogue `lang` needs.
 */
function installResident(instance: I18nInstance, lang: string): boolean {
  let given = installed.get(instance);
  if (!given) {
    given = new Set();
    installed.set(instance, given);
  }
  let complete = true;
  for (const [target, code] of catalogueTargets(lang)) {
    if (given.has(target) && holdsNamespace(instance, target)) continue;
    const catalogue = residentCatalogue(code);
    if (!catalogue) {
      complete = false;
      continue;
    }
    instance.addResourceBundle(target, 'translation', catalogue, true, false, SILENT_WRITE);
    given.add(target);
  }
  return complete;
}

/** What {@link useMarketplaceNamespace} answers. */
export interface MarketplaceNamespaceState {
  /**
   * `ready` — every `marketplace.*` key renders in the current language;
   * `loading` — a catalogue is still on its way; `failed` — a catalogue could
   * not be fetched, and nothing will try again until {@link retry} is called.
   */
  status: 'ready' | 'loading' | 'failed';
  /** Fetch the catalogues that failed again. */
  retry: () => void;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const readVersion = (): number => version;

/**
 * React hook: whether the page's i18next instance can render the
 * `marketplace.*` strings in its current language, starting the fetch when it
 * cannot.
 *
 * A marketplace page renders nothing that reads a `marketplace.*` key until
 * this answers `ready` (app-shell's `MarketplaceNamespaceGate` is that page
 * frame), so a visitor sees a loading state, never an English sentence in a
 * Chinese page nor a raw key. On a language switch it answers `loading` again
 * until the new language's catalogue has arrived.
 *
 * With no i18next instance at all (a component rendered without a provider)
 * there is no store to fill and the translator answers with keys or defaults
 * anyway, so it answers `ready`.
 */
export function useMarketplaceNamespace(): MarketplaceNamespaceState {
  const { i18n } = useObjectTranslation();
  // Re-render when a catalogue lands or fails — the store write this hook
  // makes is silent, so react-i18next's own subscription never hears of it.
  useSyncExternalStore(subscribe, readVersion, readVersion);
  const instance = i18n as I18nInstance | undefined;
  const lang = instance?.language || DEFAULT_BUILT_IN_LANGUAGE;

  const retry = useCallback(() => {
    let started = false;
    for (const [, code] of catalogueTargets(lang)) {
      if (!failed.has(code) || inFlight.has(code)) continue;
      loadMarketplaceCatalogue(code).catch(() => undefined);
      started = true;
    }
    // The failure is cleared and the request is under way, so the frame shows
    // its loading state again instead of the failure it is retrying. Never
    // called while rendering (an effect or a click), so announcing is safe.
    if (started) announce();
  }, [lang]);
  // A page opened (or switched to a language) after an earlier failure tries
  // again, once; otherwise a failure stays a failure until the visitor asks
  // again, so a chunk that cannot be fetched is never re-requested in a loop.
  useEffect(() => {
    retry();
  }, [retry]);

  if (typeof instance?.exists !== 'function' || typeof instance.addResourceBundle !== 'function') {
    return { status: 'ready', retry };
  }
  if (installResident(instance, lang)) return { status: 'ready', retry };

  let status: MarketplaceNamespaceState['status'] = 'loading';
  for (const [, code] of catalogueTargets(lang)) {
    if (residentCatalogue(code)) continue;
    if (failed.has(code) && !inFlight.has(code)) {
      status = 'failed';
      continue;
    }
    // Started while rendering, as `useStudioCatalogue` starts its fetch:
    // memoised, so a re-render joins the request already in flight.
    loadMarketplaceCatalogue(code).catch(() => undefined);
  }
  return { status, retry };
}
