// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @object-ui/i18n — the `timesheet` namespace: the timesheet list view's strings.
 *
 * ## What this is
 *
 * The `timesheet.*` group, kept out of the language packs in one PARTIAL pack
 * per platform locale table tag — `./<tag>.ts`, each the same shape as
 * `../../locales/<tag>.ts` with only the `timesheet` group in it (`./zh-Hant.ts`
 * generated from `./zh-Hans.ts` by `gen:zh-hant`) — fetched when a timesheet
 * view mounts and deep-merged into the page's i18next instance. The call sites
 * ask `t('timesheet.…')` of the default `translation` namespace, and the keys
 * are there by the time `ObjectTimesheet` (`@object-ui/plugin-timesheet`)
 * renders past its namespace frame.
 *
 * ## Why it is lazy
 *
 * `locales/en.ts` is the console's one EAGER catalogue, held under a ceiling
 * by `ui/scripts/check-eager-closure-budget.mjs` (`i18n-locale-en`). The
 * timesheet is a lazily registered list view, so its strings are paid by the
 * visitor who opens one, in the language they read, and never on every page
 * load. ⛔ A key a surface outside `@object-ui/plugin-timesheet` reads belongs
 * in the packs, not here.
 *
 * ## Residency
 *
 * Nothing here is resident: every catalogue is one literal `() => import()`,
 * its own chunk (`apps/console/vite.config.ts` names them
 * `i18n-ns-timesheet-<tag>`). ⛔ Never collapse the loaders into a
 * template-literal `import()`; the registry's header says why. The runtime is
 * `../packNamespace.ts`, the one loader every pack-shaped namespace is built by.
 *
 * ## Which gates read it
 *
 * The i18n gates under `ui/scripts/` read `./<tag>.ts` beside the packs, and
 * `../../locales/index.ts` (the all-packs door) hands out each language's pack
 * merged with its catalogue here, so the key-parity suites walk these keys.
 * `../../__tests__/timesheet-namespace.test.ts` holds this module's own shape.
 */
import type { PlatformLocaleTag } from '@objectstack/spec/system';
import {
  createPackNamespace,
  type PackNamespaceCatalogue,
  type PackNamespaceState,
} from '../packNamespace.js';

/** One language's catalogue: a partial pack holding the `timesheet` group. */
export type TimesheetCatalogue = PackNamespaceCatalogue;

/** The namespace's name — and the pack group its catalogues hold. */
export const TIMESHEET_NAMESPACE = 'timesheet';

/**
 * A key every catalogue defines and no pack does: whether an instance can
 * render the namespace in a language is whether it holds this key there.
 */
export const TIMESHEET_NAMESPACE_PROBE_KEY = 'timesheet.missingBindingTitle';

/**
 * The catalogues, each fetched on demand — one literal specifier each, so each
 * one is a chunk of its own. Keyed by platform locale table tag and typed on
 * the table: a tag the table gains without its catalogue here is a compile
 * error.
 */
const TIMESHEET_LOADERS: Readonly<
  Record<PlatformLocaleTag, () => Promise<{ default: TimesheetCatalogue }>>
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

const timesheet = createPackNamespace({
  name: TIMESHEET_NAMESPACE,
  groups: [TIMESHEET_NAMESPACE],
  probeKey: TIMESHEET_NAMESPACE_PROBE_KEY,
  loaders: TIMESHEET_LOADERS,
});

/** Every language this namespace ships a catalogue for. */
export const TIMESHEET_LANGUAGE_CODES: readonly string[] = timesheet.languageCodes;

/**
 * The tag of the catalogue that serves `lang` (`zh-CN` → `zh-Hans`, `pt` →
 * `pt-BR`), or `null` when `lang` is served by the `en` fallback.
 */
export const resolveTimesheetLanguage: (lang: string | undefined) => string | null = timesheet.resolveLanguage;

/** Whether the catalogue `code` names is resident (no fetch needed). */
export const isTimesheetCatalogueLoaded: (code: string) => boolean = timesheet.isCatalogueLoaded;

/**
 * Fetch the catalogue `code` names and resolve it — memoised; a rejected load
 * is recorded, not memoised.
 */
export const loadTimesheetCatalogue: (code: string) => Promise<TimesheetCatalogue> = timesheet.loadCatalogue;

/** What {@link useTimesheetNamespace} answers. */
export type TimesheetNamespaceState = PackNamespaceState;

/**
 * React hook: whether the page's i18next instance can render the
 * `timesheet.*` strings in its current language, starting the fetch when it
 * cannot. `ObjectTimesheet` renders nothing that reads a `timesheet.*` key
 * until this answers `ready`.
 */
export const useTimesheetNamespace: () => TimesheetNamespaceState = timesheet.useNamespace;
