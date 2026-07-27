// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * I18n Coverage Detector
 *
 * Walks a normalized stack config and computes the set of translation keys
 * that *should* exist for every registered locale (object labels & plural
 * labels, field labels, select-option labels, view labels, action labels +
 * confirm + success messages, including object-less actions resolved through
 * the top-level `globalActions` namespace). Compares the expected set against
 * the actual translation bundles attached to the stack and reports any keys
 * that are missing or set to an empty string.
 *
 * The inline `label:` in the metadata is the *source* string, authored in the
 * default locale: the runtime resolver falls back to it when a bundle carries
 * no entry, and `os i18n extract` seeds bundles from it. So an inline label
 * satisfies the default locale on its own — a bundle is what other locales
 * need. Keys with no source string anywhere are not reported here; a missing
 * label is `required/label`'s finding.
 *
 * Pure: no filesystem or network. Safe to invoke from `os lint`, `os i18n
 * check`, IDE tooling, and unit tests.
 */

import type { TranslationBundle, TranslationData } from '@objectstack/spec/system';
import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { humanizeFieldPath } from './i18n-extract.js';

export type CoverageSeverity = 'error' | 'warning';

export interface CoverageIssue {
  severity: CoverageSeverity;
  /** BCP-47 locale code where the key is missing. */
  locale: string;
  /** Dot-path of the missing key (e.g. `objects.account._views.all_accounts.label`). */
  key: string;
  /** Source kind: object / field / option / view / action / globalAction / metadataForm. */
  source: 'object' | 'field' | 'option' | 'view' | 'action' | 'globalAction' | 'metadataForm';
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

function viewObjectName(view: any): string | undefined {
  return view?.objectName ?? view?.object ?? view?.data?.object;
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
   * The source string authored inline in the metadata (`label: 'Note'`), when
   * there is one. This *is* the default-locale text — see `computeI18nCoverage`.
   */
  inline?: string;
}

function pushKey(
  out: ExpectedKey[],
  path: string[],
  source: CoverageIssue['source'],
  context: string,
  inline?: string,
): void {
  out.push({ source, path, displayKey: path.join('.'), context, inline });
}

/** Narrow to a usable source string; empty strings are not authored text. */
function inlineText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Collects every key a translation bundle *may* carry, paired with the inline
 * source string the metadata already authors for it. Callers drop the keys that
 * are authored nowhere — see `computeI18nCoverage`.
 */
function collectExpectedKeys(config: any): ExpectedKey[] {
  const keys: ExpectedKey[] = [];
  const objects: any[] = Array.isArray(config?.objects) ? config.objects : [];

  for (const obj of objects) {
    if (!obj?.name) continue;
    const objectName = obj.name as string;
    pushKey(keys, ['objects', objectName, 'label'], 'object', `Object "${objectName}" label`, inlineText(obj.label));
    pushKey(
      keys,
      ['objects', objectName, 'pluralLabel'],
      'object',
      `Object "${objectName}" pluralLabel`,
      inlineText(obj.pluralLabel),
    );
    if (obj.fields && typeof obj.fields === 'object') {
      for (const [fieldName, field] of Object.entries<any>(obj.fields)) {
        pushKey(
          keys,
          ['objects', objectName, 'fields', fieldName, 'label'],
          'field',
          `Field ${objectName}.${fieldName} label`,
          inlineText(field?.label),
        );
        // Options — accept BOTH shapes, exactly as `i18n-extract.ts` does.
        // `FieldSchema.options` is canonically a `{value, label}[]` ARRAY, but
        // this only ever handled the record map, so option coverage silently
        // never fired for a canonically-shaped select field (issue #3583).
        const opts = field?.options;
        const optionEntries: Array<[string, unknown]> = Array.isArray(opts)
          ? opts.flatMap((opt: any) =>
              opt && typeof opt === 'object' && 'value' in opt
                ? [[String(opt.value), opt.label ?? opt.value] as [string, unknown]]
                : typeof opt === 'string'
                  ? [[opt, opt] as [string, unknown]]
                  : [],
            )
          : opts && typeof opts === 'object'
            ? Object.entries<any>(opts)
            : [];
        for (const [optionKey, optionLabel] of optionEntries) {
          // Mirrors the extractor: an option's source text is its label, or
          // its own value when no label string is present.
          pushKey(
            keys,
            ['objects', objectName, 'fields', fieldName, 'options', optionKey],
            'option',
            `Option ${objectName}.${fieldName}.${optionKey}`,
            inlineText(optionLabel) ?? optionKey,
          );
        }
      }
    }
  }

  const views: any[] = Array.isArray(config?.views) ? config.views : [];
  for (const view of views) {
    if (!view?.name) continue;
    const objectName = viewObjectName(view);
    if (!objectName) continue;
    pushKey(
      keys,
      ['objects', objectName, '_views', view.name, 'label'],
      'view',
      `View ${objectName}.${view.name} label`,
      inlineText(view.label),
    );
  }

  const actions: any[] = Array.isArray(config?.actions) ? config.actions : [];
  for (const action of actions) {
    if (!action?.name) continue;
    const objectName = action.objectName ?? action.object;
    const root = objectName ? ['objects', objectName, '_actions', action.name] : ['globalActions', action.name];
    const source: CoverageIssue['source'] = objectName ? 'action' : 'globalAction';
    const ctxOwner = objectName ? `${objectName}.${action.name}` : action.name;
    pushKey(keys, [...root, 'label'], source, `Action ${ctxOwner} label`, inlineText(action.label));
    pushKey(keys, [...root, 'confirmText'], source, `Action ${ctxOwner} confirmText`, inlineText(action.confirmText));
    pushKey(
      keys,
      [...root, 'successMessage'],
      source,
      `Action ${ctxOwner} successMessage`,
      inlineText(action.successMessage),
    );
  }

  collectMetadataFormKeys(keys);
  return keys;
}

/**
 * Walks the canonical METADATA_FORM_REGISTRY + DEFAULT_METADATA_TYPE_REGISTRY
 * and pushes every translation key the resolver may look up under
 * `metadataForms.*`. Mirrors the extractor walker so coverage stays in lock-
 * step with what `os i18n extract` generates.
 */
function collectMetadataFormKeys(out: ExpectedKey[]): void {
  for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
    const type = entry.type;
    pushKey(
      out,
      ['metadataForms', type, 'label'],
      'metadataForm',
      `Metadata form "${type}" label`,
      inlineText((entry as any).label) ?? type,
    );
    pushKey(
      out,
      ['metadataForms', type, 'description'],
      'metadataForm',
      `Metadata form "${type}" description`,
      inlineText((entry as any).description),
    );
  }
  for (const [type, form] of Object.entries(METADATA_FORM_REGISTRY)) {
    const sections: any[] = [
      ...(Array.isArray((form as any)?.sections) ? (form as any).sections : []),
      ...(Array.isArray((form as any)?.groups) ? (form as any).groups : []),
    ];
    for (const section of sections) {
      if (!section || typeof section !== 'object') continue;
      const sectionName = normalizeMetadataSectionName(section);
      if (sectionName) {
        pushKey(out, ['metadataForms', type, 'sections', sectionName, 'label'], 'metadataForm', `Metadata form ${type}.sections.${sectionName} label`, inlineText(section.label));
        pushKey(out, ['metadataForms', type, 'sections', sectionName, 'description'], 'metadataForm', `Metadata form ${type}.sections.${sectionName} description`, inlineText(section.description));
      }
      if (Array.isArray(section.fields)) {
        for (const child of section.fields) walkMetadataFormField(child, type, '', out);
      }
    }
  }
}

function walkMetadataFormField(field: any, type: string, parentPath: string, out: ExpectedKey[]): void {
  if (!field || typeof field !== 'object') return;
  const name = typeof field.field === 'string' ? field.field : undefined;
  const path = name ? (parentPath ? `${parentPath}.${name}` : name) : parentPath;
  if (path) {
    // Platform form fields routinely omit `label` and let the renderer
    // humanize the field path ("name" → "Name"). That derived text is the
    // source string — the field is not unlabelled — so other locales still
    // owe it a translation. Mirrors the extractor's seed value.
    pushKey(out, ['metadataForms', type, 'fields', path, 'label'], 'metadataForm', `Metadata form ${type}.fields.${path} label`, inlineText(field.label) ?? humanizeFieldPath(path));
    pushKey(out, ['metadataForms', type, 'fields', path, 'helpText'], 'metadataForm', `Metadata form ${type}.fields.${path} helpText`, inlineText(field.helpText));
    pushKey(out, ['metadataForms', type, 'fields', path, 'placeholder'], 'metadataForm', `Metadata form ${type}.fields.${path} placeholder`, inlineText(field.placeholder));
  }
  if (Array.isArray(field.fields)) {
    for (const child of field.fields) walkMetadataFormField(child, type, path, out);
  }
}

function normalizeMetadataSectionName(section: any): string | undefined {
  if (typeof section.name === 'string' && section.name.length > 0) return section.name;
  if (typeof section.label !== 'string') return undefined;
  return section.label
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
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
  const defaultLocale = opts.defaultLocale ?? 'en';
  const bundles: TranslationBundle[] = Array.isArray(config?.translations) ? config.translations : [];
  const { merged, locales: discovered } = flattenBundles(bundles);

  let activeLocales: string[];
  if (opts.locales && opts.locales.length > 0) {
    const set = new Set<string>([defaultLocale, ...opts.locales]);
    activeLocales = Array.from(set);
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
