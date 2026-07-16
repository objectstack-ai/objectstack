// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * I18n Extractor
 *
 * Companion to `i18n-coverage.ts`. Where coverage *detects* missing keys,
 * extract *scaffolds* the bundle: it walks a normalized stack config and
 * produces ready-to-edit `TranslationData` skeletons for every requested
 * locale, pre-populated with the source labels from the schema for the
 * default locale.
 *
 * Walk surface (kept superset-aligned with the coverage detector plus the
 * known coverage gap of object-nested `listViews` / inline `actions`):
 *
 *   objects.<name>.label
 *   objects.<name>.pluralLabel
 *   objects.<name>.description
 *   objects.<name>.fields.<field>.label
 *   objects.<name>.fields.<field>.help
 *   objects.<name>.fields.<field>.placeholder
 *   objects.<name>.fields.<field>.options.<value>
 *   objects.<name>._views.<view>.label
 *   objects.<name>._views.<view>.description
 *   objects.<name>._views.<view>.emptyState.title / .message
 *   objects.<name>._actions.<action>.label
 *   objects.<name>._actions.<action>.confirmText
 *   objects.<name>._actions.<action>.successMessage
 *   objects.<name>._actions.<action>.params.<param>.label / .helpText / .placeholder
 *   objects.<name>._actions.<action>.params.<param>.options.<value>
 *   globalActions.<action>.label / .confirmText / .successMessage
 *   globalActions.<action>.params.<param>.* (same shape as object actions)
 *   apps.<app>.label / .description
 *   apps.<app>.navigation.<id>.label
 *   dashboards.<dash>.label / .description
 *   dashboards.<dash>.widgets.<w>.title / .description
 *   metadataForms.<type>.label / .description
 *   metadataForms.<type>.sections.<section>.label / .description
 *   metadataForms.<type>.fields.<dotPath>.label / .helpText / .placeholder
 *
 * The `metadataForms.*` surface is registry-driven (sourced from
 * `METADATA_FORM_REGISTRY` + `DEFAULT_METADATA_TYPE_REGISTRY` in
 * `@objectstack/spec`) — it is included unconditionally, independent of
 * the supplied stack config.
 *
 * Pure: no filesystem or network. Safe to call from the CLI, IDE tooling
 * and unit tests.
 */

import type { TranslationBundle, TranslationData } from '@objectstack/spec/system';
import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';

// ─── Public types ──────────────────────────────────────────────────────

/** A single translation entry — path + source value carried from the schema. */
export interface ExpectedEntry {
  /** Lookup path expressed as an array of segments. */
  path: string[];
  /** Source-of-truth string (typically the English literal on the schema). */
  sourceValue: string;
  /** What kind of metadata this entry was harvested from. */
  source:
    | 'object'
    | 'field'
    | 'option'
    | 'view'
    | 'action'
    | 'globalAction'
    | 'app'
    | 'navigation'
    | 'dashboard'
    | 'widget'
    | 'metadataType'
    | 'metadataFormSection'
    | 'metadataFormField';
  /** Object name when applicable (for `--filter` matching). */
  objectName?: string;
  /** App name when applicable (for `--filter` matching). */
  appName?: string;
  /** Metadata type name when applicable (for `--filter` matching). */
  metadataType?: string;
}

export type FillStrategy = 'empty' | 'default' | 'todo';

export interface ExtractOptions {
  /** Default locale (filled with source values). Defaults to `'en'`. */
  defaultLocale?: string;
  /** Locales to emit. Defaults to `[defaultLocale]`. */
  locales?: string[];
  /**
   * How to populate values for non-default locales:
   *  - `'empty'`  → empty string (default)
   *  - `'default'` → copy source value verbatim
   *  - `'todo'`   → source value with a `[TODO] ` prefix
   */
  fill?: FillStrategy;
  /**
   * Regex filter applied against `objectName` / `appName` / `dashboard` / view
   * / action identifiers. When provided, only matching entries are emitted.
   */
  filter?: RegExp;
  /**
   * When true, entries that already exist in any of the stack's
   * `translations` bundles for a given locale are *omitted* for that locale.
   * This makes extract idempotent — re-running only fills the gaps.
   */
  mergeExisting?: boolean;
}

export interface ExtractResult {
  /** Locale → TranslationData skeleton (only the entries we emitted). */
  bundles: Record<string, TranslationData>;
  /** Locale → number of keys emitted. */
  counts: Record<string, number>;
  /** Total expected entries before per-locale merge filtering. */
  totalExpected: number;
}

// ─── Walk helpers ──────────────────────────────────────────────────────

function viewObjectName(view: any): string | undefined {
  return view?.objectName ?? view?.object ?? view?.data?.object;
}

/**
 * Emit `_views.<view>.emptyState.{title,message}` entries when the view
 * declares empty-state copy. Mirrors the client-side resolver convention
 * (`viewEmptyState` in @object-ui/i18n) and `ObjectTranslationDataSchema`.
 */
function pushViewEmptyState(out: ExpectedEntry[], viewPath: string[], view: any, objectName: string): void {
  const emptyState = view?.emptyState;
  if (!emptyState || typeof emptyState !== 'object') return;
  if (typeof emptyState.title === 'string' && emptyState.title.length > 0) {
    pushEntry(out, [...viewPath, 'emptyState', 'title'], emptyState.title, 'view', { objectName });
  }
  if (typeof emptyState.message === 'string' && emptyState.message.length > 0) {
    pushEntry(out, [...viewPath, 'emptyState', 'message'], emptyState.message, 'view', { objectName });
  }
}

function pushEntry(
  out: ExpectedEntry[],
  path: string[],
  sourceValue: string | undefined,
  source: ExpectedEntry['source'],
  extra?: Pick<ExpectedEntry, 'objectName' | 'appName' | 'metadataType'>,
): void {
  if (typeof sourceValue !== 'string') return;
  out.push({ path, sourceValue, source, ...extra });
}

/**
 * Emit `params.<param>.{label,helpText,placeholder}` and
 * `params.<param>.options.<value>` entries under an action's translation root.
 * Mirrors the client-side resolver convention (`actionParamText` /
 * `actionParamOptionLabel` in @object-ui/i18n) and the `params` slot on
 * `ObjectTranslationDataSchema._actions`.
 *
 * Field-backed params (`{ field: 'email' }`) inherit the referenced field's
 * translated label/help at runtime, so a label entry is emitted only when the
 * author overrode it with a literal string. Inline params (name-based) always
 * emit a label — falling back to the param name, matching the dialog render.
 * Localized-map labels (`{ en, 'zh-CN' }`) are already multilingual and are
 * skipped.
 */
function pushActionParams(
  out: ExpectedEntry[],
  actionRoot: string[],
  action: any,
  kind: ExpectedEntry['source'],
  objectName?: string,
): void {
  if (!Array.isArray(action?.params)) return;
  for (const param of action.params) {
    if (!param || typeof param !== 'object') continue;
    const pname = param.name ?? param.field;
    if (typeof pname !== 'string' || pname.length === 0) continue;
    const base = [...actionRoot, 'params', pname];
    const literalLabel = typeof param.label === 'string' ? param.label : undefined;
    if (param.field) {
      if (literalLabel) pushEntry(out, [...base, 'label'], literalLabel, kind, { objectName });
    } else {
      pushEntry(out, [...base, 'label'], literalLabel ?? pname, kind, { objectName });
    }
    if (typeof param.helpText === 'string' && param.helpText.length > 0) {
      pushEntry(out, [...base, 'helpText'], param.helpText, kind, { objectName });
    }
    if (typeof param.placeholder === 'string' && param.placeholder.length > 0) {
      pushEntry(out, [...base, 'placeholder'], param.placeholder, kind, { objectName });
    }
    if (Array.isArray(param.options)) {
      for (const opt of param.options) {
        if (opt && typeof opt === 'object' && 'value' in opt && typeof opt.label === 'string') {
          pushEntry(out, [...base, 'options', String(opt.value)], opt.label, kind, { objectName });
        }
      }
    }
  }
}

/** Collect every translatable entry from a normalized stack config. */
export function collectExpectedEntries(config: any): ExpectedEntry[] {
  const out: ExpectedEntry[] = [];

  // ── Objects ───────────────────────────────────────────────────────
  const objects: any[] = Array.isArray(config?.objects) ? config.objects : [];
  for (const obj of objects) {
    if (!obj?.name) continue;
    const objectName = obj.name as string;

    pushEntry(out, ['objects', objectName, 'label'], obj.label ?? objectName, 'object', { objectName });
    if (obj.pluralLabel) {
      pushEntry(out, ['objects', objectName, 'pluralLabel'], obj.pluralLabel, 'object', { objectName });
    }
    if (obj.description) {
      pushEntry(out, ['objects', objectName, 'description'], obj.description, 'object', { objectName });
    }

    // Fields (always a record on normalized schemas)
    if (obj.fields && typeof obj.fields === 'object') {
      for (const [fieldName, raw] of Object.entries<any>(obj.fields)) {
        const field = raw ?? {};
        pushEntry(out, ['objects', objectName, 'fields', fieldName, 'label'], field.label ?? fieldName, 'field', { objectName });

        const help = field.help ?? field.description;
        if (help) {
          pushEntry(out, ['objects', objectName, 'fields', fieldName, 'help'], help, 'field', { objectName });
        }
        if (field.placeholder) {
          pushEntry(out, ['objects', objectName, 'fields', fieldName, 'placeholder'], field.placeholder, 'field', { objectName });
        }

        // Options — accept either `{value, label}[]` arrays or a record map.
        const opts = field.options;
        if (Array.isArray(opts)) {
          for (const opt of opts) {
            if (opt && typeof opt === 'object' && 'value' in opt) {
              pushEntry(
                out,
                ['objects', objectName, 'fields', fieldName, 'options', String(opt.value)],
                String(opt.label ?? opt.value),
                'option',
                { objectName },
              );
            } else if (typeof opt === 'string') {
              pushEntry(out, ['objects', objectName, 'fields', fieldName, 'options', opt], opt, 'option', { objectName });
            }
          }
        } else if (opts && typeof opts === 'object') {
          for (const [value, label] of Object.entries<any>(opts)) {
            pushEntry(
              out,
              ['objects', objectName, 'fields', fieldName, 'options', value],
              typeof label === 'string' ? label : String(value),
              'option',
              { objectName },
            );
          }
        }
      }
    }

    // Object-nested listViews (object-protocol view bundle).
    if (obj.listViews && typeof obj.listViews === 'object') {
      for (const [viewName, raw] of Object.entries<any>(obj.listViews)) {
        const view = raw ?? {};
        pushEntry(out, ['objects', objectName, '_views', viewName, 'label'], view.label ?? viewName, 'view', { objectName });
        if (view.description) {
          pushEntry(out, ['objects', objectName, '_views', viewName, 'description'], view.description, 'view', { objectName });
        }
        pushViewEmptyState(out, ['objects', objectName, '_views', viewName], view, objectName);
      }
    }

    // Inline object-level actions (some schemas declare them on the object).
    if (Array.isArray(obj.actions)) {
      for (const action of obj.actions) {
        if (!action?.name) continue;
        const aname = action.name as string;
        pushEntry(out, ['objects', objectName, '_actions', aname, 'label'], action.label ?? aname, 'action', { objectName });
        if (action.confirmText) {
          pushEntry(out, ['objects', objectName, '_actions', aname, 'confirmText'], action.confirmText, 'action', { objectName });
        }
        if (action.successMessage) {
          pushEntry(out, ['objects', objectName, '_actions', aname, 'successMessage'], action.successMessage, 'action', { objectName });
        }
        pushActionParams(out, ['objects', objectName, '_actions', aname], action, 'action', objectName);
      }
    }
  }

  // ── Top-level views (legacy / cross-object) ──────────────────────
  const views: any[] = Array.isArray(config?.views) ? config.views : [];
  for (const view of views) {
    if (!view?.name) continue;
    const objectName = viewObjectName(view);
    if (!objectName) continue;
    pushEntry(out, ['objects', objectName, '_views', view.name, 'label'], view.label ?? view.name, 'view', { objectName });
    if (view.description) {
      pushEntry(out, ['objects', objectName, '_views', view.name, 'description'], view.description, 'view', { objectName });
    }
    pushViewEmptyState(out, ['objects', objectName, '_views', view.name], view, objectName);
  }

  // ── Top-level actions ────────────────────────────────────────────
  const actions: any[] = Array.isArray(config?.actions) ? config.actions : [];
  for (const action of actions) {
    if (!action?.name) continue;
    const objectName = action.objectName ?? action.object;
    const root = objectName
      ? ['objects', objectName as string, '_actions', action.name]
      : ['globalActions', action.name];
    const kind: ExpectedEntry['source'] = objectName ? 'action' : 'globalAction';
    pushEntry(out, [...root, 'label'], action.label ?? action.name, kind, { objectName });
    if (action.confirmText) {
      pushEntry(out, [...root, 'confirmText'], action.confirmText, kind, { objectName });
    }
    if (action.successMessage) {
      pushEntry(out, [...root, 'successMessage'], action.successMessage, kind, { objectName });
    }
    pushActionParams(out, root, action, kind, objectName);
  }

  // ── Apps + navigation ────────────────────────────────────────────
  const apps: any[] = Array.isArray(config?.apps) ? config.apps : [];
  for (const app of apps) {
    if (!app?.name) continue;
    const appName = app.name as string;
    if (app.label) pushEntry(out, ['apps', appName, 'label'], app.label, 'app', { appName });
    if (app.description) {
      pushEntry(out, ['apps', appName, 'description'], app.description, 'app', { appName });
    }
    const nav: any[] = Array.isArray(app.navigation) ? app.navigation : [];
    walkNavigation(nav, appName, out);
  }

  // ── Dashboards + widgets ─────────────────────────────────────────
  const dashboards: any[] = Array.isArray(config?.dashboards) ? config.dashboards : [];
  for (const dash of dashboards) {
    if (!dash?.name) continue;
    const name = dash.name as string;
    if (dash.label) pushEntry(out, ['dashboards', name, 'label'], dash.label, 'dashboard');
    if (dash.description) {
      pushEntry(out, ['dashboards', name, 'description'], dash.description, 'dashboard');
    }
    const widgets: any[] = Array.isArray(dash.widgets) ? dash.widgets : [];
    for (const w of widgets) {
      if (!w?.id && !w?.name) continue;
      const wid = (w.id ?? w.name) as string;
      if (w.title) pushEntry(out, ['dashboards', name, 'widgets', wid, 'title'], w.title, 'widget');
      if (w.description) {
        pushEntry(out, ['dashboards', name, 'widgets', wid, 'description'], w.description, 'widget');
      }
    }
  }

  // ── Metadata configuration forms (Studio admin UI) ────────────────
  // Registry-driven: always included, independent of stack config. These
  // emit under `metadataForms.<type>.*` so the generic renderer can pick
  // up localized labels for the admin editor that authors objects, agents,
  // flows, etc.
  walkMetadataForms(out);

  return out;
}

/**
 * Iterate the canonical metadata form registry and emit translation entries
 * for every metadata type's display label/description, plus the section and
 * field labels of any registered {@link FormView} layout.
 *
 * Mirrors the lookup contract enforced by `resolveMetadataFormLabels` /
 * `resolveMetadataTypeLabel` in `@objectstack/spec/system/i18n-resolver`:
 *
 *   metadataForms.<type>.label
 *   metadataForms.<type>.description
 *   metadataForms.<type>.sections.<sectionName>.label
 *   metadataForms.<type>.sections.<sectionName>.description
 *   metadataForms.<type>.fields.<dotPath>.label
 *   metadataForms.<type>.fields.<dotPath>.helpText
 *   metadataForms.<type>.fields.<dotPath>.placeholder
 *
 * Section names follow the same normalization rule the resolver uses when
 * `section.name` is absent: `label.toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')`.
 *
 * Composite / repeater sub-fields are walked recursively with dot-path
 * accumulation (`fields.items.label` etc.), matching the runtime
 * `translateFormField` walker.
 */
function walkMetadataForms(out: ExpectedEntry[]): void {
  // 1) Type-level labels (covers every registry entry, not just types
  //    that have a form — the resolver translates `/meta` entry labels
  //    even for form-less types like `datasource`, `job`, `translation`).
  for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
    const type = entry.type;
    pushEntry(out, ['metadataForms', type, 'label'], entry.label ?? type, 'metadataType', { metadataType: type });
    const desc = (entry as any).description;
    if (typeof desc === 'string' && desc.length > 0) {
      pushEntry(out, ['metadataForms', type, 'description'], desc, 'metadataType', { metadataType: type });
    }
  }

  // 2) Section + field labels for every registered form.
  for (const [type, form] of Object.entries(METADATA_FORM_REGISTRY)) {
    const sections: any[] = [
      ...(Array.isArray(form?.sections) ? form.sections : []),
      ...(Array.isArray((form as any)?.groups) ? (form as any).groups : []),
    ];
    for (const section of sections) {
      if (!section || typeof section !== 'object') continue;
      const sectionName = normalizeSectionName(section);
      if (sectionName && typeof section.label === 'string') {
        pushEntry(out, ['metadataForms', type, 'sections', sectionName, 'label'], section.label, 'metadataFormSection', { metadataType: type });
      }
      if (sectionName && typeof section.description === 'string' && section.description.length > 0) {
        pushEntry(out, ['metadataForms', type, 'sections', sectionName, 'description'], section.description, 'metadataFormSection', { metadataType: type });
      }
      if (Array.isArray(section.fields)) {
        for (const child of section.fields) walkFormField(child, type, '', out);
      }
    }
  }
}

/** Recursive walker for FormField nodes, accumulating dot-path. */
function walkFormField(field: any, type: string, parentPath: string, out: ExpectedEntry[]): void {
  if (!field || typeof field !== 'object') return;
  const name = typeof field.field === 'string' ? field.field : undefined;
  const path = name ? (parentPath ? `${parentPath}.${name}` : name) : parentPath;
  if (path) {
    const label = typeof field.label === 'string' && field.label.length > 0
      ? field.label
      : humanizeFieldPath(path);
    pushEntry(out, ['metadataForms', type, 'fields', path, 'label'], label, 'metadataFormField', { metadataType: type });
    if (typeof field.helpText === 'string' && field.helpText.length > 0) {
      pushEntry(out, ['metadataForms', type, 'fields', path, 'helpText'], field.helpText, 'metadataFormField', { metadataType: type });
    }
    if (typeof field.placeholder === 'string' && field.placeholder.length > 0) {
      pushEntry(out, ['metadataForms', type, 'fields', path, 'placeholder'], field.placeholder, 'metadataFormField', { metadataType: type });
    }
  }
  if (Array.isArray(field.fields)) {
    for (const child of field.fields) walkFormField(child, type, path, out);
  }
}

/** Match the metadata form renderer's fallback label for fields without an explicit label. */
function humanizeFieldPath(path: string): string {
  const leaf = path.split('.').pop() ?? path;
  return leaf
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Section-name derivation mirroring `resolveMetadataFormLabels` so the
 * extractor emits keys at the exact same paths the resolver looks them up.
 */
function normalizeSectionName(section: any): string | undefined {
  if (typeof section.name === 'string' && section.name.length > 0) return section.name;
  if (typeof section.label !== 'string') return undefined;
  return section.label
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function walkNavigation(nav: any[], appName: string, out: ExpectedEntry[]): void {
  for (const item of nav) {
    if (!item) continue;
    const id = item.id ?? item.name;
    if (id && item.label) {
      pushEntry(out, ['apps', appName, 'navigation', id, 'label'], item.label, 'navigation', { appName });
    }
    if (Array.isArray(item.items)) walkNavigation(item.items, appName, out);
    if (Array.isArray(item.children)) walkNavigation(item.children, appName, out);
  }
}

// ─── Filter + bundle assembly ──────────────────────────────────────────

function passesFilter(entry: ExpectedEntry, filter?: RegExp): boolean {
  if (!filter) return true;
  if (entry.objectName && filter.test(entry.objectName)) return true;
  if (entry.appName && filter.test(entry.appName)) return true;
  if (entry.metadataType && filter.test(entry.metadataType)) return true;
  // Allow matching against the joined path so users can target e.g. ^dashboards\.system_
  return filter.test(entry.path.join('.'));
}

function setDeep(data: TranslationData, path: string[], value: string): void {
  let cur: any = data;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (typeof cur[seg] !== 'object' || cur[seg] === null) cur[seg] = {};
    cur = cur[seg];
  }
  cur[path[path.length - 1]] = value;
}

function lookupDeep(data: TranslationData | undefined, path: string[]): string | undefined {
  let cur: any = data;
  for (const seg of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return typeof cur === 'string' && cur.length > 0 ? cur : undefined;
}

function mergeBundles(bundles: TranslationBundle[]): Record<string, TranslationData> {
  const out: Record<string, TranslationData> = {};
  for (const bundle of bundles) {
    if (!bundle || typeof bundle !== 'object') continue;
    for (const [locale, data] of Object.entries(bundle)) {
      if (!data || typeof data !== 'object') continue;
      out[locale] = deepMerge(out[locale] ?? {}, data as TranslationData);
    }
  }
  return out;
}

function deepMerge<T extends Record<string, any>>(target: T, source: T): T {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      target[k as keyof T] = deepMerge(((target as any)[k] ?? {}) as any, v as any);
    } else {
      (target as any)[k] = v;
    }
  }
  return target;
}

/**
 * Build per-locale skeleton bundles from a normalized stack config.
 */
export function extractTranslations(config: any, opts: ExtractOptions = {}): ExtractResult {
  const defaultLocale = opts.defaultLocale ?? 'en';
  const locales = opts.locales && opts.locales.length > 0
    ? Array.from(new Set([defaultLocale, ...opts.locales]))
    : [defaultLocale];
  const fill: FillStrategy = opts.fill ?? 'empty';

  const allEntries = collectExpectedEntries(config);
  const entries = allEntries.filter((e) => passesFilter(e, opts.filter));

  const existingBundles: TranslationBundle[] = Array.isArray(config?.translations) ? config.translations : [];
  const existing = mergeBundles(existingBundles);

  const bundles: Record<string, TranslationData> = {};
  const counts: Record<string, number> = {};

  for (const locale of locales) {
    const data: TranslationData = {};
    let count = 0;
    for (const entry of entries) {
      let value: string | undefined;
      // If a translation already exists for this locale, carry it through
      // verbatim so the generated file remains a complete, self-contained
      // bundle (not just the missing-key delta). Set --no-merge to skip
      // baselines entirely.
      if (opts.mergeExisting !== false) {
        const existingValue = lookupDeep(existing[locale], entry.path);
        if (existingValue !== undefined && existingValue !== '') {
          value = String(existingValue);
        }
      }
      if (value === undefined) {
        if (locale === defaultLocale) {
          value = entry.sourceValue;
        } else if (fill === 'default') {
          value = entry.sourceValue;
        } else if (fill === 'todo') {
          value = `[TODO] ${entry.sourceValue}`;
        } else {
          value = '';
        }
      }
      setDeep(data, entry.path, value);
      count += 1;
    }
    bundles[locale] = data;
    counts[locale] = count;
  }

  return { bundles, counts, totalExpected: entries.length };
}

// ─── Serialization ─────────────────────────────────────────────────────

/**
 * Render a TranslationData skeleton as a TypeScript module body.
 *
 * The module exports a single named const (`<exportName>`) typed against
 * the chosen sub-tree of `TranslationData`:
 *
 *   kind: 'objects'        → `NonNullable<TranslationData['objects']>`
 *   kind: 'metadataForms'  → `NonNullable<TranslationData['metadataForms']>`
 *   kind: 'full'           → `TranslationData`
 *
 * `objectsOnly: true` (default) is a legacy alias for `kind: 'objects'`.
 */
export function renderTranslationModule(
  data: TranslationData,
  options: {
    locale: string;
    exportName?: string;
    /** Legacy: when true, emit only the `objects` sub-tree (typed accordingly). */
    objectsOnly?: boolean;
    /** Explicit sub-tree selector. Overrides `objectsOnly` when provided. */
    kind?: 'objects' | 'metadataForms' | 'full';
    /** Header comment lines. */
    header?: string[];
  },
): string {
  const kind: 'objects' | 'metadataForms' | 'full' =
    options.kind ?? (options.objectsOnly === false ? 'full' : 'objects');
  const defaultExport =
    kind === 'metadataForms'
      ? `${camelize(options.locale)}MetadataForms`
      : kind === 'full'
      ? `${camelize(options.locale)}Translations`
      : `${camelize(options.locale)}Objects`;
  const exportName = options.exportName ?? defaultExport;
  const payload =
    kind === 'metadataForms'
      ? (data.metadataForms ?? {})
      : kind === 'objects'
      ? (data.objects ?? {})
      : data;
  const typeSig =
    kind === 'metadataForms'
      ? "NonNullable<TranslationData['metadataForms']>"
      : kind === 'objects'
      ? "NonNullable<TranslationData['objects']>"
      : 'TranslationData';
  const header = options.header ?? [
    `Auto-generated by 'os i18n extract' for locale '${options.locale}'.`,
    'Edit translations in place; re-run extract (with --merge) to fill new gaps.',
    'Do not hand-edit the structure — only the leaf string values.',
  ];

  const lines: string[] = [];
  lines.push('// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.');
  lines.push('');
  lines.push('/**');
  for (const h of header) lines.push(` * ${h}`);
  lines.push(' */');
  lines.push('');
  lines.push("import type { TranslationData } from '@objectstack/spec/system';");
  lines.push('');
  lines.push(`export const ${exportName}: ${typeSig} = ${stringifyTs(payload, 0)};`);
  lines.push('');
  return lines.join('\n');
}

function camelize(locale: string): string {
  // 'zh-CN' → 'zhCN', 'ja-JP' → 'jaJP', 'es-ES' → 'esES'
  return locale.replace(/-(.)/g, (_m, c) => c.toUpperCase());
}

function stringifyTs(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  const pad2 = '  '.repeat(indent + 1);
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return '[\n' + value.map((v) => pad2 + stringifyTs(v, indent + 1)).join(',\n') + `\n${pad}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return '{\n' + entries.map(([k, v]) => `${pad2}${formatKey(k)}: ${stringifyTs(v, indent + 1)}`).join(',\n') + `\n${pad}}`;
  }
  return JSON.stringify(value);
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
function formatKey(key: string): string {
  return IDENT_RE.test(key) ? key : JSON.stringify(key);
}
