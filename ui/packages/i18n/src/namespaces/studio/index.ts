// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @object-ui/i18n — the `studio` namespace: the Studio designer's strings.
 *
 * ## What this is
 *
 * The metadata-admin / Studio designer carried its own two-locale string table
 * inside `@object-ui/app-shell` (`views/metadata-admin/i18n.ts`). The
 * maintainer's ruling on objectstack#25922 (comment 6431032267, Q2 = A, kept by
 * the re-ruling 6431234244) moves it here as ONE lazy namespace that carries
 * the existing `en` and `zh` text, with every other language falling back to
 * `en` — no invented translations. The table moves in slices; until the last
 * one, app-shell's `t()` / `tFormat()` / `tOptional()` read a key from its own
 * table first and from this namespace second, so no call site changes.
 *
 * ## Why a namespace of its own and not a group in the `locales/` packs
 *
 *   - Size. `locales/en.ts` is the console's one EAGER catalogue (see
 *     `../../locales/registry.ts`); folding the designer's English into it
 *     would put every Studio string on every page load.
 *   - Coverage. `all-locales-key-parity.test.ts` holds every pack to every
 *     `en` key. This namespace ships two languages on purpose, so it is
 *     OUTSIDE that suite by construction: its catalogues are not packs, live
 *     outside `locales/`, and are not members of `builtInLocales`, which is the
 *     population that suite iterates. It needs no exemption there, and ⛔ must
 *     never be given one.
 *   - Syntax. Values carry the designer's `{token}` placeholders, substituted
 *     by `tFormat()`, not i18next's `{{token}}`; registering them as i18next
 *     resources would hand i18next strings it interpolates wrongly.
 *
 * ## Residency, the same shape as `../../locales/registry.ts`
 *
 * `en` is imported statically: it is the fallback for every key and every
 * language, and a synchronous `t()` has to be able to answer with it. `zh` is
 * one literal `() => import()` — its own chunk (`apps/console/vite.config.ts`
 * names it `i18n-ns-studio-zh`), fetched the first time a Chinese lookup asks
 * for it. Until it lands, a lookup answers in `en` and {@link useStudioCatalogue}
 * re-renders its caller once it has. ⛔ Never collapse the loader into a
 * template-literal `import()`; the registry's header says why.
 *
 * ## Which gates read it
 *
 * `ui/scripts/check-i18n-dead-keys.mjs` (`collectDesignerKeys`) reads `./en.ts`
 * and `./zh.ts` as app-shell's engine strings, by AST, whenever app-shell's
 * string module imports this namespace — the same edge the runtime follows. So
 * the designer population of `check:i18n-drift` and the dead-keys report see
 * every key. `__tests__/studio-namespace.test.ts` holds the namespace's own
 * parity (en ⊆ zh, placeholder parity, documented zh-only families), the job
 * `check:i18n-designer-parity` shared until objectstack#25922 slice S7 retired
 * the app-shell table and that gate with it.
 */
import { useSyncExternalStore } from 'react';
import { matchLanguageTag } from '../../locales/registry.js';
import en from './en.js';

/** One language's catalogue: designer key → value. */
export type StudioCatalogue = Readonly<Record<string, string>>;

/** The namespace's name. */
export const STUDIO_NAMESPACE = 'studio';

/** The resident catalogue every other language falls back to. */
export const STUDIO_FALLBACK_LANGUAGE = 'en';

/**
 * The catalogues fetched on demand — one literal specifier each, so each one is
 * a chunk of its own.
 */
const LAZY_STUDIO_LOADERS: Readonly<Record<string, () => Promise<{ default: StudioCatalogue }>>> =
  Object.freeze({
    zh: () => import('./zh.js'),
  });

/** Every language this namespace ships a catalogue for. */
export const STUDIO_LANGUAGE_CODES: readonly string[] = Object.freeze([
  STUDIO_FALLBACK_LANGUAGE,
  ...Object.keys(LAZY_STUDIO_LOADERS),
]);

const own = (record: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

function hasStudioCatalogue(code: string): boolean {
  return code === STUDIO_FALLBACK_LANGUAGE || own(LAZY_STUDIO_LOADERS, code);
}

/**
 * The code of the catalogue that serves `lang`: exact tag, then base language
 * (`zh-CN` → `zh`, matched case-insensitively), else the `en` fallback. A
 * language this namespace has no catalogue for is served by `en`, never by a
 * raw key.
 */
export function resolveStudioLanguage(lang: string | undefined): string {
  return matchLanguageTag((lang ?? '').toLowerCase(), hasStudioCatalogue) ?? STUDIO_FALLBACK_LANGUAGE;
}

const loaded: Record<string, StudioCatalogue> = { [STUDIO_FALLBACK_LANGUAGE]: en };
const inFlight = new Map<string, Promise<StudioCatalogue>>();
const listeners = new Set<() => void>();
let version = 0;

/** Whether the catalogue that serves `lang` is resident (no fetch needed). */
export function isStudioCatalogueLoaded(lang: string | undefined): boolean {
  return own(loaded, resolveStudioLanguage(lang));
}

/**
 * Fetch the catalogue that serves `lang` and resolve it. Memoised: a resident
 * catalogue resolves without a second import, and concurrent callers share one
 * in-flight promise. ⛔ A rejected load is not memoised, so a chunk that failed
 * to download is retried by the next lookup.
 */
export function loadStudioCatalogue(lang: string | undefined): Promise<StudioCatalogue> {
  const code = resolveStudioLanguage(lang);
  if (own(loaded, code)) return Promise.resolve(loaded[code]);
  const existing = inFlight.get(code);
  if (existing) return existing;
  const pending = LAZY_STUDIO_LOADERS[code]()
    .then((mod) => {
      loaded[code] = mod.default;
      version += 1;
      for (const listener of [...listeners]) listener();
      return mod.default;
    })
    .finally(() => {
      inFlight.delete(code);
    });
  inFlight.set(code, pending);
  return pending;
}

/**
 * The namespace's value for `key` in `lang`, or `undefined` when neither that
 * language's catalogue nor the `en` fallback defines it.
 *
 * Synchronous. When the serving catalogue is not resident yet, the lookup
 * starts its fetch and answers from `en` meanwhile — the same fallback a key
 * the catalogue does not define gets. A failed fetch is swallowed here (the
 * next lookup retries); the caller keeps rendering `en`.
 */
export function studioString(key: string, lang: string | undefined): string | undefined {
  const code = resolveStudioLanguage(lang);
  const catalogue = loaded[code];
  if (catalogue === undefined) {
    loadStudioCatalogue(code).catch(() => undefined);
  } else if (own(catalogue, key)) {
    return catalogue[key];
  }
  return own(en, key) ? en[key] : undefined;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const readVersion = (): number => version;

/**
 * React hook: re-render the caller once a lazily fetched catalogue lands.
 *
 * Call it from the hook a component already takes its language from (app-shell's
 * `useMetadataLocale()` does), so every component that reads this namespace
 * through `studioString` re-reads it after the fetch instead of staying on the
 * `en` answer it rendered first. It also starts the fetch for `lang`.
 */
export function useStudioCatalogue(lang: string | undefined): void {
  useSyncExternalStore(subscribe, readVersion, readVersion);
  if (!isStudioCatalogueLoaded(lang)) loadStudioCatalogue(lang).catch(() => undefined);
}
