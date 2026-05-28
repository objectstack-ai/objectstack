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
 * Pure: no filesystem or network. Safe to invoke from `os lint`, `os i18n
 * check`, IDE tooling, and unit tests.
 */

import type { TranslationBundle, TranslationData } from '@objectstack/spec/system';
import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';

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
}

function pushKey(out: ExpectedKey[], path: string[], source: CoverageIssue['source'], context: string): void {
  out.push({ source, path, displayKey: path.join('.'), context });
}

function collectExpectedKeys(config: any): ExpectedKey[] {
  const keys: ExpectedKey[] = [];
  const objects: any[] = Array.isArray(config?.objects) ? config.objects : [];

  for (const obj of objects) {
    if (!obj?.name) continue;
    const objectName = obj.name as string;
    pushKey(keys, ['objects', objectName, 'label'], 'object', `Object "${objectName}" label`);
    if (obj.pluralLabel || obj.label) {
      pushKey(keys, ['objects', objectName, 'pluralLabel'], 'object', `Object "${objectName}" pluralLabel`);
    }
    if (obj.fields && typeof obj.fields === 'object') {
      for (const [fieldName, field] of Object.entries<any>(obj.fields)) {
        pushKey(keys, ['objects', objectName, 'fields', fieldName, 'label'], 'field', `Field ${objectName}.${fieldName} label`);
        const opts = field?.options;
        if (opts && typeof opts === 'object' && !Array.isArray(opts)) {
          for (const optionKey of Object.keys(opts)) {
            pushKey(
              keys,
              ['objects', objectName, 'fields', fieldName, 'options', optionKey],
              'option',
              `Option ${objectName}.${fieldName}.${optionKey}`,
            );
          }
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
    );
  }

  const actions: any[] = Array.isArray(config?.actions) ? config.actions : [];
  for (const action of actions) {
    if (!action?.name) continue;
    const objectName = action.objectName ?? action.object;
    const root = objectName ? ['objects', objectName, '_actions', action.name] : ['globalActions', action.name];
    const source: CoverageIssue['source'] = objectName ? 'action' : 'globalAction';
    const ctxOwner = objectName ? `${objectName}.${action.name}` : action.name;
    pushKey(keys, [...root, 'label'], source, `Action ${ctxOwner} label`);
    if (action.confirmText) {
      pushKey(keys, [...root, 'confirmText'], source, `Action ${ctxOwner} confirmText`);
    }
    if (action.successMessage) {
      pushKey(keys, [...root, 'successMessage'], source, `Action ${ctxOwner} successMessage`);
    }
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
    pushKey(out, ['metadataForms', type, 'label'], 'metadataForm', `Metadata form "${type}" label`);
    const desc = (entry as any).description;
    if (typeof desc === 'string' && desc.length > 0) {
      pushKey(out, ['metadataForms', type, 'description'], 'metadataForm', `Metadata form "${type}" description`);
    }
  }
  for (const [type, form] of Object.entries(METADATA_FORM_REGISTRY)) {
    const sections: any[] = [
      ...(Array.isArray((form as any)?.sections) ? (form as any).sections : []),
      ...(Array.isArray((form as any)?.groups) ? (form as any).groups : []),
    ];
    for (const section of sections) {
      if (!section || typeof section !== 'object') continue;
      const sectionName = normalizeMetadataSectionName(section);
      if (sectionName && typeof section.label === 'string') {
        pushKey(out, ['metadataForms', type, 'sections', sectionName, 'label'], 'metadataForm', `Metadata form ${type}.sections.${sectionName} label`);
      }
      if (sectionName && typeof section.description === 'string' && section.description.length > 0) {
        pushKey(out, ['metadataForms', type, 'sections', sectionName, 'description'], 'metadataForm', `Metadata form ${type}.sections.${sectionName} description`);
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
    if (typeof field.label === 'string' && field.label.length > 0) {
      pushKey(out, ['metadataForms', type, 'fields', path, 'label'], 'metadataForm', `Metadata form ${type}.fields.${path} label`);
    }
    if (typeof field.helpText === 'string' && field.helpText.length > 0) {
      pushKey(out, ['metadataForms', type, 'fields', path, 'helpText'], 'metadataForm', `Metadata form ${type}.fields.${path} helpText`);
    }
    if (typeof field.placeholder === 'string' && field.placeholder.length > 0) {
      pushKey(out, ['metadataForms', type, 'fields', path, 'placeholder'], 'metadataForm', `Metadata form ${type}.fields.${path} placeholder`);
    }
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

  const expected = collectExpectedKeys(config);
  const issues: CoverageIssue[] = [];
  const stats: CoverageStats[] = [];

  for (const locale of activeLocales) {
    const data = merged[locale];
    let translated = 0;
    for (const key of expected) {
      const value = lookupKey(data, key.path);
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
