// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @object-ui/i18n — the `marketplace` namespace: the marketplace pages' strings.
 *
 * ## What this is
 *
 * The `marketplace.*` group of the language packs, moved out of them into one
 * PARTIAL pack per platform locale table tag — `./<tag>.ts`, each the same
 * shape as `../../locales/<tag>.ts` with only the `marketplace` group in it
 * (`./zh-Hant.ts` generated from `./zh-Hans.ts` by `gen:zh-hant`) — that are
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
 * demand, so there is no first frame that needs one synchronously. Every
 * catalogue is one literal `() => import()` — its own chunk
 * (`apps/console/vite.config.ts` names them `i18n-ns-marketplace-<tag>`).
 * ⛔ Never collapse the loaders into a template-literal `import()`; the
 * registry's header says why. The runtime — residency, the `en` fallback
 * catalogue, the frame's hook — is `../packNamespace.ts`, the one loader
 * every pack-shaped namespace is built by.
 *
 * ## Which gates read it
 *
 * Every i18n gate that reads pack keys reads these files as part of the
 * packs: `ui/scripts/check-i18n-call-site-keys.mjs` (`collectEnKeys`, so the
 * dead-keys report too) and `ui/scripts/check-i18n-en-drift.mjs` read
 * `./<tag>.ts` beside `../../locales/<tag>.ts` and refuse a key defined in
 * both. `../../locales/index.ts` (the all-packs door) hands out each language's
 * pack merged with its catalogue here, so `all-locales-key-parity.test.ts`
 * and every other suite that walks `builtInLocales` still walks these keys.
 * `../../__tests__/marketplace-namespace.test.ts` holds this module's own
 * shape: one literal loader per table tag, no static catalogue import, no key in both
 * places.
 */
import type { PlatformLocaleTag } from '@objectstack/spec/system';
import {
  createPackNamespace,
  type PackNamespaceCatalogue,
  type PackNamespaceState,
} from '../packNamespace.js';

/** One language's catalogue: a partial pack holding the `marketplace` group. */
export type MarketplaceCatalogue = PackNamespaceCatalogue;

/** The namespace's name — and the pack group its catalogues hold. */
export const MARKETPLACE_NAMESPACE = 'marketplace';

/**
 * A key every catalogue defines and no pack does: whether an instance can
 * render the namespace in a language is whether it holds this key there.
 * `marketplace-namespace.test.ts` holds both halves of that.
 */
export const MARKETPLACE_NAMESPACE_PROBE_KEY = 'marketplace.title';

/**
 * The catalogues, each fetched on demand — one literal specifier each, so each
 * one is a chunk of its own. ⛔ Read the header before touching the spelling.
 *
 * Keyed by platform locale table tag and typed on the table, as the packs'
 * loaders are (`../../locales/registry.ts`): a tag the table gains without its
 * catalogue here is a compile error.
 */
const MARKETPLACE_LOADERS: Readonly<
  Record<PlatformLocaleTag, () => Promise<{ default: MarketplaceCatalogue }>>
> = Object.freeze({
  en: () => import('./en.js'),
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

const marketplace = createPackNamespace({
  name: MARKETPLACE_NAMESPACE,
  groups: [MARKETPLACE_NAMESPACE],
  probeKey: MARKETPLACE_NAMESPACE_PROBE_KEY,
  loaders: MARKETPLACE_LOADERS,
});

/** Every language this namespace ships a catalogue for. */
export const MARKETPLACE_LANGUAGE_CODES: readonly string[] = marketplace.languageCodes;

/**
 * The tag of the catalogue that serves `lang` (`zh-CN` → `zh-Hans`, `pt` →
 * `pt-BR`), or `null` when `lang` is served by the `en` fallback.
 */
export const resolveMarketplaceLanguage: (lang: string | undefined) => string | null = marketplace.resolveLanguage;

/** Whether the catalogue `code` names is resident (no fetch needed). */
export const isMarketplaceCatalogueLoaded: (code: string) => boolean = marketplace.isCatalogueLoaded;

/**
 * Fetch the catalogue `code` names and resolve it — memoised; a rejected load
 * is recorded, not memoised.
 */
export const loadMarketplaceCatalogue: (code: string) => Promise<MarketplaceCatalogue> = marketplace.loadCatalogue;

/** What {@link useMarketplaceNamespace} answers. */
export type MarketplaceNamespaceState = PackNamespaceState;

/**
 * React hook: whether the page's i18next instance can render the
 * `marketplace.*` strings in its current language, starting the fetch when it
 * cannot. A marketplace page renders nothing that reads a `marketplace.*` key
 * until this answers `ready` (app-shell's `MarketplaceNamespaceGate` is that
 * page frame), so a visitor sees a loading state, never an English sentence in
 * a Chinese page nor a raw key.
 */
export const useMarketplaceNamespace: () => MarketplaceNamespaceState = marketplace.useNamespace;
