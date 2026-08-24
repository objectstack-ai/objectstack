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
  page: 'Page',
  flow: 'Flow',
  metadataForm: 'Metadata form',
};

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
    };
  });
}

// ─── Lookup ────────────────────────────────────────────────────────────

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
  const authoredInBundle = (path: string[]): boolean =>
    Object.values(merged).some((data) => lookupKey(data, path) !== undefined);
  const expected = collectExpectedKeys(config).filter(
    (key) => key.inline !== undefined || authoredInBundle(key.path),
  );
  const issues: CoverageIssue[] = [];
  const stats: CoverageStats[] = [];

  for (const locale of activeLocales) {
    const data = merged[locale];
    let translated = 0;
    for (const key of expected) {
      // The inline `label:` IS the default-locale text — the runtime resolver
      // falls back to it (i18n-resolver `translateObject`), and `os i18n
      // extract` seeds bundles from it. Demanding a default-locale bundle entry
      // that merely restates it reports a gap that does not exist.
      const value = lookupKey(data, key.path) ?? (locale === defaultLocale ? key.inline : undefined);
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
