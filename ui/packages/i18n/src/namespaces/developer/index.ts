// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @object-ui/i18n — the `developer` namespace: the developer surfaces' strings.
 *
 * ## What this is
 *
 * Two groups of the language packs, moved out of them into one PARTIAL pack
 * per platform locale table tag — `./<tag>.ts`, each the same shape as
 * `../../locales/<tag>.ts` holding only these groups (`./zh-Hant.ts` generated
 * from `./zh-Hans.ts` by `gen:zh-hant`):
 *
 *   - `console.developer.*` — the console's Developer pages (API console, flow
 *     runs, public forms, integrations), `apps/console/src/pages/developer/`,
 *     each a lazy route;
 *   - `connectAgent.*` — connecting an AI assistant over MCP: the Integrations
 *     page's agent section (`AgentConnectSection`) and the two console widgets
 *     in app-shell's `console/connect/` — `mcp:connect-agent` (the Connect an
 *     assistant page) and `mcp:authorized-assistants` (the platform-admin AI
 *     Assistants tab of a user record).
 *
 * Call sites do not change: they still ask `t('console.developer.…')` /
 * `t('connectAgent.…')` of the default `translation` namespace, and the keys
 * are there by the time they render, because each of those surfaces renders
 * under app-shell's `DeveloperNamespaceGate`, which waits for
 * {@link useDeveloperNamespace}.
 *
 * ## Why it is lazy
 *
 * `locales/en.ts` is the console's one EAGER catalogue, and
 * `ui/scripts/check-eager-closure-budget.mjs` holds its chunk,
 * `i18n-locale-en`, under a ceiling of its own. These two groups were about
 * 4.5 KB of that chunk gzipped, paid on every console page load for surfaces
 * no first load (sign-in, the shell, home, a record's list or detail) draws.
 * Moved here they are paid by the visitor who opens one, in the language they
 * read.
 *
 * ⛔ A key that a surface outside those directories reads belongs in the pack,
 * not here: a key here is only reachable under {@link useDeveloperNamespace}.
 * `PACK_NAMESPACE_FRAMES` in `ui/scripts/check-i18n-call-site-keys.mjs` names
 * the directories, and refuses a call site outside them that reads a key only
 * this namespace defines.
 *
 * ## Residency
 *
 * Nothing here is resident. Every catalogue is one literal `() => import()` —
 * its own chunk (`apps/console/vite.config.ts` names them
 * `i18n-ns-developer-<tag>`). ⛔ Never collapse the loaders into a
 * template-literal `import()`; the registry's header says why. The runtime —
 * residency, the `en` fallback catalogue, the frame's hook — is
 * `../packNamespace.ts`, the one loader every pack-shaped namespace is built
 * by.
 *
 * ## Which gates read it
 *
 * The same as `../marketplace/`: every i18n gate that reads pack keys reads
 * `./<tag>.ts` beside `../../locales/<tag>.ts` (through `PACK_NAMESPACE_FRAMES`)
 * and refuses a key defined in both; `../../locales/index.ts` (the all-packs
 * door) hands out each language's pack merged with its catalogue here, so
 * every suite that walks `builtInLocales` still walks these keys.
 * `../../__tests__/developer-namespace.test.ts` holds this module's own shape.
 */
import type { PlatformLocaleTag } from '@objectstack/spec/system';
import {
  createPackNamespace,
  type PackNamespaceCatalogue,
  type PackNamespaceState,
} from '../packNamespace.js';

/** The namespace's name. */
export const DEVELOPER_NAMESPACE = 'developer';

/** The pack groups its catalogues hold. */
export const DEVELOPER_NAMESPACE_GROUPS: readonly string[] = Object.freeze(['console.developer', 'connectAgent']);

/**
 * A key every catalogue defines and no pack does: whether an instance can
 * render the namespace in a language is whether it holds this key there.
 */
export const DEVELOPER_NAMESPACE_PROBE_KEY = 'connectAgent.capabilities.title';

/**
 * The catalogues, each fetched on demand — one literal specifier each, so each
 * one is a chunk of its own. ⛔ Read the header before touching the spelling.
 * Typed on the platform locale table: a tag the table gains without its
 * catalogue here is a compile error.
 */
const DEVELOPER_LOADERS: Readonly<
  Record<PlatformLocaleTag, () => Promise<{ default: PackNamespaceCatalogue }>>
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

const developer = createPackNamespace({
  name: DEVELOPER_NAMESPACE,
  groups: DEVELOPER_NAMESPACE_GROUPS,
  probeKey: DEVELOPER_NAMESPACE_PROBE_KEY,
  loaders: DEVELOPER_LOADERS,
});

/** Every language this namespace ships a catalogue for. */
export const DEVELOPER_LANGUAGE_CODES: readonly string[] = developer.languageCodes;

/** Whether the catalogue `code` names is resident (no fetch needed). */
export const isDeveloperCatalogueLoaded: (code: string) => boolean = developer.isCatalogueLoaded;

/** Fetch the catalogue `code` names — memoised; a rejected load is recorded, not memoised. */
export const loadDeveloperCatalogue: (code: string) => Promise<PackNamespaceCatalogue> = developer.loadCatalogue;

/** What {@link useDeveloperNamespace} answers. */
export type DeveloperNamespaceState = PackNamespaceState;

/**
 * React hook: whether the page's i18next instance can render the
 * `console.developer.*` and `connectAgent.*` strings in its current language,
 * starting the fetch when it cannot. App-shell's `DeveloperNamespaceGate` is
 * the frame that waits on it.
 */
export const useDeveloperNamespace: () => DeveloperNamespaceState = developer.useNamespace;
