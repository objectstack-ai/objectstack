// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @object-ui/i18n — the one runtime behind every PACK-SHAPED lazy namespace.
 *
 * ## What a pack-shaped namespace is
 *
 * Groups of pack keys moved out of the language packs into one PARTIAL pack
 * per platform locale table tag — `namespaces/<ns>/<tag>.ts`, each the same
 * shape as `../locales/<tag>.ts` holding only the moved groups — fetched when
 * the surface that reads them mounts and deep-merged into the page's i18next
 * instance. Call sites do not change: they still ask `t('<group>.…')` of the
 * default `translation` namespace, and the keys are there by the time they
 * render. `locales/en.ts` is the console's one EAGER catalogue, held under a
 * ceiling of its own by `ui/scripts/check-eager-closure-budget.mjs`
 * (`i18n-locale-en`); a group only lazy surfaces read is paid on every page
 * load for nothing, so it moves into one of these.
 *
 * `./marketplace/` and `./developer/` are the namespaces; each module's header
 * says what it holds and which surfaces read it. Every namespace is built by
 * {@link createPackNamespace} — ⛔ never a second copy of this loader. (The
 * `studio` namespace is not pack-shaped: it is a `{token}` string table with a
 * resident `en`, and keeps its own module.)
 *
 * ## Residency
 *
 * Nothing in a pack-shaped namespace is resident: the surfaces that read it
 * render behind a frame that waits for {@link PackNamespace.useNamespace} to
 * answer `ready`, so no first frame needs a key synchronously. Each catalogue
 * is one literal `() => import()` in the namespace's own module, so each is a
 * chunk of its own (`apps/console/vite.config.ts` names them
 * `i18n-ns-<ns>-<tag>`). ⛔ Never collapse the loaders into a template-literal
 * `import()`; `../locales/registry.ts`'s header says why.
 *
 * The one exception is a host that made every catalogue resident on purpose:
 * `registerBuiltInLocales()` (the all-packs door, `@object-ui/i18n/locales`)
 * registers each language COMPLETE, namespaces included, so a catalogue the
 * registry already holds is used as it stands and never fetched.
 *
 * A surface waits for TWO catalogues: the one that serves its language, and
 * `en`. `en` is what the packs' `fallbackLng: 'en'` falls back to, so loading
 * it keeps the fallback the moved strings had while they were pack keys — a
 * key a translation lacks renders in English, never as its raw name.
 */
import { useCallback, useContext, useEffect, useSyncExternalStore } from 'react';
import type { i18n as I18nInstance } from 'i18next';
import { I18nContext, getI18n } from 'react-i18next';
import type { PlatformLocaleTag } from '@objectstack/spec/system';
import {
  DEFAULT_BUILT_IN_LANGUAGE,
  getLoadedBuiltInLocales,
  resolveBuiltInLanguage,
} from '../locales/registry.js';

/** One language's catalogue: a partial pack holding the namespace's groups. */
export type PackNamespaceCatalogue = Readonly<Record<string, unknown>>;

/** One catalogue loader per platform locale table tag. */
export type PackNamespaceLoaders = Readonly<
  Record<PlatformLocaleTag, () => Promise<{ default: PackNamespaceCatalogue }>>
>;

/** What a namespace's frame reads off {@link PackNamespace.useNamespace}. */
export interface PackNamespaceState {
  /**
   * `ready` — every key of the namespace renders in the current language;
   * `loading` — a catalogue is still on its way; `failed` — a catalogue could
   * not be fetched, and nothing will try again until {@link retry} is called.
   */
  status: 'ready' | 'loading' | 'failed';
  /** Fetch the catalogues that failed again. */
  retry: () => void;
}

export interface PackNamespaceDefinition {
  /** The namespace's name (its directory under `namespaces/`). */
  name: string;
  /**
   * The pack groups its catalogues hold, as dotted paths (`marketplace`,
   * `console.developer`). Read when a host registered every catalogue
   * complete: these subtrees of the registered catalogue are the namespace.
   */
  groups: readonly string[];
  /**
   * A key every catalogue defines and no pack does: whether an instance can
   * render the namespace in a language is whether it holds this key there.
   */
  probeKey: string;
  /** One literal `() => import()` per platform locale table tag. */
  loaders: PackNamespaceLoaders;
}

export interface PackNamespace {
  /** Every language this namespace ships a catalogue for. */
  readonly languageCodes: readonly string[];
  /**
   * The tag of the catalogue that serves `lang`, read the way the packs
   * resolve — through the platform locale table's read aliases (`zh-CN` →
   * `zh-Hans`, `zh-TW` → `zh-Hant`, `pt` → `pt-BR`) — or `null` when this
   * namespace has none for it, and `lang` is served by the `en` fallback.
   */
  resolveLanguage(lang: string | undefined): string | null;
  /** Whether the catalogue `code` names is resident (no fetch needed). */
  isCatalogueLoaded(code: string): boolean;
  /**
   * Fetch the catalogue `code` names and resolve it. Memoised: a resident
   * catalogue resolves without a second import, and concurrent callers share
   * one in-flight promise. ⛔ A rejected load is not memoised: it is recorded,
   * so a frame can say it failed, and the next explicit request fetches again.
   */
  loadCatalogue(code: string): Promise<PackNamespaceCatalogue>;
  /**
   * React hook: whether the page's i18next instance can render the
   * namespace's keys in its current language, starting the fetch when it
   * cannot. A surface renders nothing that reads one of them until this
   * answers `ready`, so a visitor sees a loading state, never an English
   * sentence in a translated page nor a raw key. On a language switch it
   * answers `loading` again until the new language's catalogue has arrived.
   *
   * With no i18next instance at all (a component rendered without a provider)
   * there is no store to fill and the translator answers with keys or
   * defaults anyway, so it answers `ready`.
   */
  useNamespace(): PackNamespaceState;
}

const own = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function lookup(tree: unknown, path: string): unknown {
  let node: unknown = tree;
  for (const segment of path.split('.')) {
    if (!isRecord(node) || !own(node, segment)) return undefined;
    node = node[segment];
  }
  return node;
}

/** `value` placed at the dotted `path` of `into`, building the groups above it. */
function place(into: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let node = into;
  for (const segment of segments.slice(0, -1)) {
    if (!isRecord(node[segment])) node[segment] = {};
    node = node[segment] as Record<string, unknown>;
  }
  node[segments[segments.length - 1]] = value;
}

/** The writes `installResident` makes are SILENT: see there. */
const SILENT_WRITE = Object.freeze({ silent: true });

/** Build a pack-shaped lazy namespace's runtime. See the header. */
export function createPackNamespace(definition: PackNamespaceDefinition): PackNamespace {
  const { name, groups, probeKey, loaders } = definition;

  const languageCodes: readonly string[] = Object.freeze(Object.keys(loaders));

  const hasCatalogue = (code: string): code is PlatformLocaleTag => own(loaders, code);

  function resolveLanguage(lang: string | undefined): string | null {
    const tag = resolveBuiltInLanguage(lang ?? '');
    return tag !== null && hasCatalogue(tag) ? tag : null;
  }

  const loaded: Record<string, PackNamespaceCatalogue> = {};
  const inFlight = new Map<string, Promise<PackNamespaceCatalogue>>();
  const failed = new Map<string, unknown>();
  const listeners = new Set<() => void>();
  let version = 0;

  function announce(): void {
    version += 1;
    for (const listener of [...listeners]) listener();
  }

  /**
   * The catalogue `code` names when it needs no fetch: one this namespace
   * fetched, or the namespace's groups of the COMPLETE catalogue the registry
   * holds once a host called `registerBuiltInLocales()` (see the header).
   */
  function residentCatalogue(code: string): PackNamespaceCatalogue | undefined {
    if (own(loaded, code)) return loaded[code];
    if (!hasCatalogue(code)) return undefined;
    const registered = getLoadedBuiltInLocales()[code];
    if (typeof lookup(registered, probeKey) !== 'string') return undefined;
    const catalogue: Record<string, unknown> = {};
    for (const group of groups) {
      const subtree = lookup(registered, group);
      if (subtree !== undefined) place(catalogue, group, subtree);
    }
    // Kept, so every later answer for `code` is this same object.
    loaded[code] = Object.freeze(catalogue);
    return loaded[code];
  }

  const isCatalogueLoaded = (code: string): boolean => residentCatalogue(code) !== undefined;

  function loadCatalogue(code: string): Promise<PackNamespaceCatalogue> {
    if (!hasCatalogue(code)) {
      return Promise.reject(new Error(`The ${name} namespace ships no \`${code}\` catalogue.`));
    }
    const resident = residentCatalogue(code);
    if (resident) return Promise.resolve(resident);
    const existing = inFlight.get(code);
    if (existing) return existing;
    failed.delete(code);
    // The in-flight entry goes BEFORE the announcement: a listener re-reads
    // the state at once, and must not find a settled request still in flight.
    const pending = loaders[code]().then(
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
   * The `[language key, catalogue code]` pairs an instance rendering `lang`
   * needs: the catalogue that serves `lang` (stored under its table tag, the
   * key the packs' bundle has: an instance in a stored alias such as `zh-CN`
   * reaches it through `fallbackLng`, as it reaches the pack), and `en`.
   */
  function catalogueTargets(lang: string): Array<readonly [string, string]> {
    const serving = resolveLanguage(lang);
    const targets: Array<readonly [string, string]> = [[DEFAULT_BUILT_IN_LANGUAGE, DEFAULT_BUILT_IN_LANGUAGE]];
    if (serving !== null && serving !== DEFAULT_BUILT_IN_LANGUAGE) targets.unshift([serving, serving]);
    return targets;
  }

  /**
   * Whether `instance` still holds the namespace in `lng`, without leaning on
   * a fallback language — i18next's own answer, so a bundle removed since it
   * was installed is installed again.
   */
  const holdsNamespace = (instance: I18nInstance, lng: string): boolean =>
    instance.exists(probeKey, { lng, fallbackLng: false });

  /**
   * The language keys each instance has been given its catalogue under. Kept
   * per instance rather than read off the instance's keys: a host whose own
   * `resources` spell one of the namespace's keys in a language has not
   * supplied that language's catalogue, and must still get the rest of it.
   */
  const installed = new WeakMap<I18nInstance, Set<string>>();

  /**
   * Merge every catalogue `lang` needs that is resident but not yet in
   * `instance`. Deep, and ⛔ never overwriting: a host's own `resources` for
   * one of these keys win over the built-in text, the precedence the packs
   * keep. Silent, because it runs while the frame renders, before anything
   * below it has read a key: an `added` event would re-render every
   * translated component in the page for nothing.
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

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  const readVersion = (): number => version;

  function useNamespace(): PackNamespaceState {
    // The instance react-i18next hands `t()`: the provider's, else the one
    // `initReactI18next` installed. Read directly rather than through
    // `useTranslation`, which warns (NO_I18NEXT_INSTANCE) where there is none.
    const instance = (useContext(I18nContext)?.i18n ?? getI18n()) as I18nInstance | undefined;
    // Re-render when a catalogue lands or fails — the store write this hook
    // makes is silent, so react-i18next's own subscription never hears of it.
    useSyncExternalStore(subscribe, readVersion, readVersion);
    // …and when the instance switches language.
    const subscribeLanguage = useCallback(
      (listener: () => void) => {
        if (typeof instance?.on !== 'function') return () => undefined;
        instance.on('languageChanged', listener);
        return () => {
          instance.off('languageChanged', listener);
        };
      },
      [instance],
    );
    const readLanguage = (): string => instance?.language || DEFAULT_BUILT_IN_LANGUAGE;
    const lang = useSyncExternalStore(subscribeLanguage, readLanguage, readLanguage);

    const retry = useCallback(() => {
      let started = false;
      for (const [, code] of catalogueTargets(lang)) {
        if (!failed.has(code) || inFlight.has(code)) continue;
        loadCatalogue(code).catch(() => undefined);
        started = true;
      }
      // The failure is cleared and the request is under way, so the frame
      // shows its loading state again instead of the failure it is retrying.
      // Never called while rendering (an effect or a click), so announcing is
      // safe.
      if (started) announce();
    }, [lang]);
    // A surface opened (or switched to a language) after an earlier failure
    // tries again, once; otherwise a failure stays a failure until the visitor
    // asks again, so a chunk that cannot be fetched is never re-requested in a
    // loop.
    useEffect(() => {
      retry();
    }, [retry]);

    if (typeof instance?.exists !== 'function' || typeof instance.addResourceBundle !== 'function') {
      return { status: 'ready', retry };
    }
    if (installResident(instance, lang)) return { status: 'ready', retry };

    let status: PackNamespaceState['status'] = 'loading';
    for (const [, code] of catalogueTargets(lang)) {
      if (residentCatalogue(code)) continue;
      if (failed.has(code) && !inFlight.has(code)) {
        status = 'failed';
        continue;
      }
      // Started while rendering, as `useStudioCatalogue` starts its fetch:
      // memoised, so a re-render joins the request already in flight.
      loadCatalogue(code).catch(() => undefined);
    }
    return { status, retry };
  }

  return Object.freeze({ languageCodes, resolveLanguage, isCatalogueLoaded, loadCatalogue, useNamespace });
}
