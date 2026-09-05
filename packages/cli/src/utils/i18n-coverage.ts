// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * I18n Coverage Detector
 *
 * Compares the translation keys a stack *should* carry against the bundles
 * actually attached to it, and reports the ones that are missing or empty.
 *
 * The expected set is **not** computed here. It comes from
 * {@link collectExpectedEntries} in `i18n-extract.ts` — the same walker that
 * scaffolds bundles for `os i18n extract`. That sharing is the point: this
 * detector used to keep its own parallel walk, and the two drifted until whole
 * declared surfaces were extractable but ungated — most visibly the action
 * labels declared *inline on an object* (`sys_approval_request`'s
 * Approve/Reject/Reassign), which shipped English into a zh-CN workspace with
 * no lint ever noticing (#3370). One walker, one surface, no drift.
 *
 * The inline `label:` in the metadata is the *source* string, authored in the
 * default locale: the runtime resolver falls back to it when a bundle carries
 * no entry, and `os i18n extract` seeds bundles from it. So an inline label
 * satisfies the default locale on its own — a bundle is what other locales
 * need. Keys with no source string anywhere are not reported here; a missing
 * label is `required/label`'s finding.
 *
 * An inline LOCALE MAP — `{ en: 'Members', 'zh-CN': '成员' }`, the second form
 * `I18nLabelSchema` authorizes — is a source string in every locale it
 * carries, and is read as one here (#14749, maintainer ruling 2026-09-03,
 * Q2 = B1). It used to be read as nothing at all: the walker narrowed it to
 * `undefined` on its way here, which is also what an absent prop produces, so
 * a prop localised into four languages and a prop nobody wrote were the same
 * input to this file. Locales the map carries now count as covered; locales it
 * omits are gaps, on the same footing as a bundle that omits them. The map is
 * still never extracted and never gets a bundle row — that half is the
 * extractor's header, and ⛔ no key is invented from a node path.
 *
 * Which locales get checked is the project's call, never an assumption: the
 * `i18n.supportedLocales` block declares them, and absent that block only the
 * locales a bundle already exists for are checked. A project that does not
 * translate therefore reports nothing at all — see {@link computeI18nCoverage}.
 *
 * Pure: no filesystem or network. Safe to invoke from `os lint`, `os i18n
 * check`, IDE tooling, and unit tests.
 */

import type { TranslationBundle, TranslationData } from '@objectstack/spec/system';
import { collectExpectedEntries, type ExpectedEntry } from './i18n-extract.js';

export type CoverageSeverity = 'error' | 'warning';

export interface CoverageIssue {
  severity: CoverageSeverity;
  /** BCP-47 locale code where the key is missing. */
  locale: string;
  /** Dot-path of the missing key (e.g. `objects.account._views.all_accounts.label`). */
  key: string;
  /** Source kind the key was harvested from. */
  source:
    | 'object'
    | 'field'
    | 'option'
    | 'section'
    | 'view'
    | 'action'
    | 'globalAction'
    | 'app'
    | 'navigation'
    | 'dashboard'
    | 'widget'
    | 'dataset'
    | 'page'
    | 'flow'
    | 'metadataForm';
  /** Human-readable explanation. */
  message: string;
}

export interface CoverageStats {
  locale: string;
  expected: number;
  translated: number;
  missing: number;
  /** Coverage percent rounded to one decimal (0–100). */
  coveragePercent: number;
}

export interface CoverageReport {
  /** Locales discovered across all bundles attached to the stack. */
  locales: string[];
  /** Default / source-of-truth locale (errors are raised against this one). */
  defaultLocale: string;
  /** Per-locale coverage statistics. */
  stats: CoverageStats[];
  /** Per-issue listing (errors + warnings, locale-scoped). */
  issues: CoverageIssue[];
  /** Aggregate counts. */
  totals: {
    expectedKeys: number;
    issues: number;
    errors: number;
    warnings: number;
  };
}

export interface CoverageOptions {
  /**
   * The locale that *must* be translated. Missing keys here surface as
   * errors; missing keys in other locales surface as warnings. Defaults to
   * `'en'`.
   */
  defaultLocale?: string;
  /**
   * Restrict the check to this set of locales (in addition to the default
   * locale). When omitted, every locale that appears in any bundle is
   * checked.
   */
  locales?: string[];
  /**
   * When `true`, missing keys in non-default locales are also reported as
   * errors. Useful for CI gates that demand full translation parity.
   */
  strict?: boolean;
}

// ─── Bundle helpers ────────────────────────────────────────────────────

function mergeData(target: TranslationData | undefined, source: TranslationData): TranslationData {
  if (!target) return JSON.parse(JSON.stringify(source));
  // shallow object merge across the four well-known sub-records is enough for
  // coverage detection; we never need a deep merge of leaf strings because
  // duplicates are accepted (last-write-wins).
  const out: TranslationData = { ...target };
  if (source.objects) {
    out.objects = { ...(out.objects ?? {}) };
    for (const [name, data] of Object.entries(source.objects)) {
      out.objects[name] = {
        ...(out.objects[name] ?? {}),
        ...data,
        fields: { ...(out.objects[name]?.fields ?? {}), ...(data.fields ?? {}) },
        _views: { ...(out.objects[name]?._views ?? {}), ...(data._views ?? {}) },
        _actions: { ...(out.objects[name]?._actions ?? {}), ...(data._actions ?? {}) },
      } as any;
    }
  }
  if (source.globalActions) {
    out.globalActions = { ...(out.globalActions ?? {}), ...source.globalActions };
  }
  if (source.apps) out.apps = { ...(out.apps ?? {}), ...source.apps };
  if (source.messages) out.messages = { ...(out.messages ?? {}), ...source.messages };
  if ((source as any).metadataForms) {
    const tgt: Record<string, any> = { ...((out as any).metadataForms ?? {}) };
    for (const [type, data] of Object.entries((source as any).metadataForms)) {
      const existing = tgt[type] ?? {};
      const incoming = (data ?? {}) as any;
      tgt[type] = {
        ...existing,
        ...incoming,
        sections: { ...(existing.sections ?? {}), ...(incoming.sections ?? {}) },
        fields: { ...(existing.fields ?? {}), ...(incoming.fields ?? {}) },
      };
    }
    (out as any).metadataForms = tgt;
  }
  return out;
}

function flattenBundles(bundles: TranslationBundle[]): { merged: TranslationBundle; locales: string[] } {
  const merged: Record<string, TranslationData> = {};
  const localesSet = new Set<string>();
  for (const bundle of bundles) {
    if (!bundle || typeof bundle !== 'object') continue;
    for (const [locale, data] of Object.entries(bundle)) {
      if (!data || typeof data !== 'object') continue;
      localesSet.add(locale);
      merged[locale] = mergeData(merged[locale], data as TranslationData);
    }
  }
  return { merged, locales: Array.from(localesSet).sort() };
}

// ─── Expected key extraction ───────────────────────────────────────────

interface ExpectedKey {
  source: CoverageIssue['source'];
  /** Lookup path expressed as an array of segments. */
  path: string[];
  /** Friendly display key (joined with dots). */
  displayKey: string;
  /** Description shown in the issue message when the key is missing. */
  context: string;
  /**
   * The source string the reader sees in the default locale, when the metadata
   * authors one. This *is* the default-locale text — see `computeI18nCoverage`.
   */
  inline?: string;
  /**
   * The inline locale map the author wrote at this prop, when they wrote one
   * (`{ en: 'Members', 'zh-CN': '成员' }`) — the second authorized form of an
   * `I18nLabel`, carried here verbatim by the walker.
   *
   * Present ⇒ this key IS authored, whatever `inline` says. See
   * {@link inlineLocaleText} for how a locale is read out of it, and
   * `computeI18nCoverage` for why that read is narrower than the renderer's.
   */
  inlineLocales?: Readonly<Record<string, string>>;
}

/**
 * Map the shared walker's fine-grained kinds onto the coverage taxonomy.
 *
 * The three registry-driven kinds all describe the same Studio metadata-form
 * baseline, so they collapse to one `metadataForm` bucket — that is the bucket
 * `os lint` hides wholesale unless `--include-platform` is passed.
 */
const COVERAGE_SOURCE: Record<ExpectedEntry['source'], CoverageIssue['source']> = {
  object: 'object',
  field: 'field',
  option: 'option',
  // An object section heading (`objects.<o>._sections.<s>.label`) is the
  // user's own metadata, not the Studio-form baseline — it keeps its own
  // bucket so `os lint` reports it as `i18n/missing-section` rather than
  // folding it away with `--include-platform`.
  section: 'section',
  view: 'view',
  action: 'action',
  globalAction: 'globalAction',
  app: 'app',
  navigation: 'navigation',
  dashboard: 'dashboard',
  widget: 'widget',
  // Analytics dataset copy (`datasets.<d>.label`, `.description`, and each
  // dimension's / measure's `label`) — the author's own semantic layer, drawn
  // under every metric tile and on every chart axis, so it keeps its own
  // bucket and reports as `i18n/missing-dataset` rather than folding away with
  // `--include-platform`. A dataset is bound BY REFERENCE from N widgets
  // across M dashboards (ADR-0021 D1), which is also why it is not folded into
  // the `dashboard` bucket: the string is defined once, not once per
  // presentation.
  dataset: 'dataset',
  page: 'page',
  // Screen-flow copy (`flows.<f>.label`, `flows.<f>.screens.<n>.title`, and
  // the per-field `label` / `placeholder`) — the author's own wizard text, so
  // it keeps its own bucket and reports as `i18n/missing-flow` rather than
  // folding away with `--include-platform`. Until this bucket existed the
  // family could not report a screen-flow gap at all: HotCRM measured
  // `0 i18n/missing-*` while six screen dialogs rendered English in all four
  // locales (#11485).
  flow: 'flow',
  metadataType: 'metadataForm',
  metadataFormSection: 'metadataForm',
  metadataFormField: 'metadataForm',
};

const SOURCE_NOUN: Record<CoverageIssue['source'], string> = {
  object: 'Object',
  field: 'Field',
  option: 'Option',
  section: 'Section',
  view: 'View',
  action: 'Action',
  globalAction: 'Global action',
  app: 'App',
  navigation: 'Navigation item',
  dashboard: 'Dashboard',
  widget: 'Widget',
  dataset: 'Dataset',
  page: 'Page',
  flow: 'Flow',
  metadataForm: 'Metadata form',
};

/**
 * The same taxonomy, spelled as the plural surface noun a *reader* of
 * `os i18n check --help` needs — `SOURCE_NOUN` above is the singular subject of
 * a per-issue message ("Object \"account\" fields.name.label"), which is a
 * different sentence and cannot serve both.
 *
 * ⚠️ This is the SET, not a sample. `os i18n check --help` used to name five of
 * these kinds in a parenthetical, and a five-item sample of a fifteen-member
 * taxonomy does not read as an illustration — it reads as a scope statement, so
 * a reader who wanted app navigation or dashboard widgets checked concluded the
 * command did not cover them and went looking for a second tool that does not
 * exist. The capability was shipped and hidden by its own description.
 *
 * The `Record<CoverageIssue['source'], string>` type is what keeps that from
 * happening again: it is exhaustive by construction, so a new member of the
 * union is a **compile error** here until it is named, and naming it publishes
 * it in `--help` in the same edit. ⛔ Never widen this to a partial map or an
 * index signature — that restores exactly the drift this file measured.
 *
 * Kinds that fold together do so here too, because they fold in the *report*:
 * a filter-preset tab is reported as `view`, an action parameter as `action`,
 * and the three registry-driven metadata-form kinds as `metadataForm`.
 */
const SOURCE_SURFACE: Record<CoverageIssue['source'], string> = {
  object: 'objects',
  field: 'fields',
  option: 'options',
  section: 'sections',
  view: 'views',
  action: 'actions',
  globalAction: 'global actions',
  app: 'apps',
  navigation: 'navigation items',
  dashboard: 'dashboards',
  widget: 'widgets',
  dataset: 'datasets',
  page: 'pages',
  flow: 'flow screens',
  metadataForm: 'metadata forms',
};

/**
 * Every source kind a {@link CoverageIssue} can carry, in declaration order.
 * Derived from {@link SOURCE_SURFACE}, never retyped.
 */
export const COVERAGE_SOURCE_KINDS = Object.keys(SOURCE_SURFACE) as ReadonlyArray<
  CoverageIssue['source']
>;

/**
 * The translatable surfaces this detector reports on, as one comma-separated
 * phrase — the text `os i18n check --help` shows.
 *
 * Derived from the taxonomy rather than retyped beside it: the command's
 * description and the kinds its report can emit are then one fact with one
 * source, and cannot drift apart the way they did.
 */
export const COVERAGE_SURFACE_PHRASE = COVERAGE_SOURCE_KINDS.map((kind) => SOURCE_SURFACE[kind]).join(', ');

/** Subject line for the "missing translation" message. */
function describeEntry(entry: ExpectedEntry, source: CoverageIssue['source']): string {
  const noun = SOURCE_NOUN[source];
  const owner = entry.objectName ?? entry.appName ?? entry.metadataType ?? entry.flowName;
  // Everything past the owning collection and its name reads as the attribute
  // path: `objects.account.fields.name.label` → `fields.name.label`.
  const attribute = entry.path.slice(2).join('.');
  return owner && attribute ? `${noun} "${owner}" ${attribute}` : `${noun} ${entry.path.join('.')}`;
}

/**
 * Every key a bundle *may* carry, paired with the text the metadata already
 * shows for it. Sourced from the extractor's walker so the gated surface and
 * the scaffolded surface can never disagree. Callers drop the keys that are
 * authored nowhere — see {@link computeI18nCoverage}.
 */
function collectExpectedKeys(config: any): ExpectedKey[] {
  return collectExpectedEntries(config).map((entry) => {
    const source = COVERAGE_SOURCE[entry.source];
    return {
      source,
      path: entry.path,
      displayKey: entry.path.join('.'),
      context: describeEntry(entry, source),
      inline: entry.inline,
      inlineLocales: entry.inlineLocales,
    };
  });
}

// ─── Lookup ────────────────────────────────────────────────────────────

/**
 * The text an inline locale map holds **for `locale` specifically** — or
 * `undefined`, which is this detector's word for "not translated here".
 *
 * ## Why this is narrower than the renderer's rule, deliberately
 *
 * `resolveI18nLabel` (and objectui's `pickLocalized`, which it is pinned to
 * limb for limb) answers a different question: *what should I put on screen
 * for this reader?* Its six limbs therefore end in three fallbacks — the
 * untagged `default` entry, the `en` entry, then any string in the map — so it
 * essentially never misses. Reading coverage off it would report every locale
 * as covered the moment a map exists, which is the mirror image of the bug
 * this function was added to fix: one answer standing for two opposite facts.
 *
 * So only the **tag-matching** limbs count as coverage, in the reference's own
 * order and with its own case rules:
 *
 *   1. the exact tag — `zh-CN` reads the key `zh-CN`;
 *   2. the base language — `zh-CN` reads the key `zh`;
 *   3. the first region-qualified sibling sharing that base — `zh` reads
 *      `zh-CN`; `zh-TW` reads `zh-CN` too. Same language, other region: what
 *      the renderer really shows, and a translation into the language asked
 *      for.
 *
 * The fallback limbs are excluded because falling back **is** what an
 * untranslated locale looks like: a `ja-JP` reader shown the `en` entry is
 * precisely the gap this gate exists to report, and `default` is the entry an
 * author writes for locales they did **not** translate.
 *
 * `i18n-label-resolver.ts` is the authority on the limb rule and on the case
 * asymmetry mirrored here (region case is irrelevant because limb 3 compares
 * language subtags only; language case is significant, because the reference
 * folds neither side). `inline-locale-coverage-parity.test.ts` pins this
 * function against `resolveI18nLabel`: whenever this says "covered", the
 * renderer really shows that entry.
 *
 * Empty values do not count, matching {@link lookupKey}'s rule on the bundle
 * side — an empty translation is not a translation, whichever side it is
 * written on.
 */
export function inlineLocaleText(
  map: Readonly<Record<string, string>> | undefined,
  locale: string,
): string | undefined {
  if (!map) return undefined;
  const read = (tag: string): string | undefined => {
    if (!Object.prototype.hasOwnProperty.call(map, tag)) return undefined;
    const value = map[tag];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };
  const tag = (locale || 'en').trim();
  const exact = read(tag);
  if (exact !== undefined) return exact;
  const base = tag.split('-')[0];
  const baseHit = read(base);
  if (baseHit !== undefined) return baseHit;
  for (const key of Object.keys(map)) {
    if (key.split('-')[0] === base) {
      const sibling = read(key);
      if (sibling !== undefined) return sibling;
    }
  }
  return undefined;
}

/**
 * Any text the inline map holds at all — the test for "did the author write
 * something here", used only to decide whether the key is worth reporting on.
 *
 * ⛔ Not a coverage answer: see {@link inlineLocaleText} for that.
 */
function inlineLocaleAny(map: Readonly<Record<string, string>> | undefined): string | undefined {
  if (!map) return undefined;
  for (const value of Object.values(map)) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function lookupKey(data: TranslationData | undefined, path: string[]): string | undefined {
  let current: any = data;
  for (const segment of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[segment];
  }
  return typeof current === 'string' && current.length > 0 ? current : undefined;
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Compute a coverage report for a normalized stack config.
 */
export function computeI18nCoverage(config: any, opts: CoverageOptions = {}): CoverageReport {
  // Locale selection, most specific first: an explicit caller override, then
  // the project's own `i18n` block, then 'en'. Reading the config matters for a
  // monolingual non-English project — forcing 'en' on a stack whose source
  // strings are Chinese would report a language it never claimed to speak.
  const declared = config?.i18n;
  const declaredLocales: string[] = Array.isArray(declared?.supportedLocales)
    ? declared.supportedLocales.filter((l: unknown): l is string => typeof l === 'string' && l.length > 0)
    : [];
  const defaultLocale =
    opts.defaultLocale ??
    (typeof declared?.defaultLocale === 'string' && declared.defaultLocale.length > 0
      ? declared.defaultLocale
      : 'en');
  const bundles: TranslationBundle[] = Array.isArray(config?.translations) ? config.translations : [];
  const { merged, locales: discovered } = flattenBundles(bundles);

  // A project only owes translations for locales it opted into. `supportedLocales`
  // is that opt-in; without it the check falls back to the locales some bundle
  // already exists for. Declare neither — the monolingual case — and the only
  // active locale is the default one, which every inline label already satisfies,
  // so the gate reports nothing rather than inventing a translation debt.
  let activeLocales: string[];
  if (opts.locales && opts.locales.length > 0) {
    activeLocales = Array.from(new Set<string>([defaultLocale, ...opts.locales]));
  } else if (declaredLocales.length > 0) {
    activeLocales = Array.from(new Set<string>([defaultLocale, ...declaredLocales, ...discovered]));
  } else if (discovered.length === 0) {
    activeLocales = [defaultLocale];
  } else {
    activeLocales = discovered.includes(defaultLocale) ? discovered : [defaultLocale, ...discovered];
  }

  // A key is only worth translating if a source string is authored somewhere:
  // inline in the metadata, or in some bundle (a project may externalize a
  // string it never wrote inline — other locales still owe a translation for
  // it). A key authored in neither place has no text to translate at all; a
  // missing label is `required/label`'s finding, not an i18n gap.
  //
  // An inline LOCALE MAP is authored text too (#14749, maintainer ruling
  // 2026-09-03, Q2 = B1). It used to fail this test — the walker narrowed a
  // map to `undefined` on its way here, the same value an absent prop
  // produces — so a prop written out in four languages was dropped from the
  // expected set exactly as if nobody had written it, and a bundle entry for
  // one of its locales pulled it back in and then reported every OTHER locale
  // as missing. Both readings were the same defect: one diagnostic standing
  // for two opposite facts.
  const authoredInBundle = (path: string[]): boolean =>
    Object.values(merged).some((data) => lookupKey(data, path) !== undefined);
  const expected = collectExpectedKeys(config).filter(
    (key) =>
      key.inline !== undefined
      || inlineLocaleAny(key.inlineLocales) !== undefined
      || authoredInBundle(key.path),
  );
  const issues: CoverageIssue[] = [];
  const stats: CoverageStats[] = [];

  for (const locale of activeLocales) {
    const data = merged[locale];
    let translated = 0;
    for (const key of expected) {
      // Three sources, most specific first.
      //
      // 1. The bundle entry for this locale.
      // 2. The inline locale map's entry FOR THIS LOCALE — tag-matched, never
      //    the renderer's fallback limbs (see `inlineLocaleText`). A locale
      //    the map carries is translated; one it does not is a gap, which is
      //    the whole of what the B1 ruling asks this gate to be able to say.
      // 3. The inline `label:` IS the default-locale text — the runtime
      //    resolver falls back to it (i18n-resolver `translateObject`), and
      //    `os i18n extract` seeds bundles from it. Demanding a default-locale
      //    bundle entry that merely restates it reports a gap that does not
      //    exist. A map satisfies the default locale on the same grounds and
      //    by the same reading: whatever it resolves to there IS the source
      //    text a reader of the default locale sees, so `inlineLocaleAny`
      //    stands in for `inline` when the author wrote a map instead of a
      //    string.
      const value = lookupKey(data, key.path)
        ?? inlineLocaleText(key.inlineLocales, locale)
        ?? (locale === defaultLocale ? (key.inline ?? inlineLocaleAny(key.inlineLocales)) : undefined);
      if (value !== undefined) {
        translated += 1;
        continue;
      }
      const isError = locale === defaultLocale || opts.strict === true;
      issues.push({
        severity: isError ? 'error' : 'warning',
        locale,
        key: key.displayKey,
        source: key.source,
        message: `${key.context} missing translation for locale "${locale}"`,
      });
    }
    const missing = expected.length - translated;
    stats.push({
      locale,
      expected: expected.length,
      translated,
      missing,
      coveragePercent: expected.length === 0 ? 100 : Math.round((translated / expected.length) * 1000) / 10,
    });
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;

  return {
    locales: activeLocales,
    defaultLocale,
    stats,
    issues,
    totals: {
      expectedKeys: expected.length,
      issues: issues.length,
      errors,
      warnings,
    },
  };
}
