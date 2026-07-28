// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * I18n Resolver
 *
 * Convention-based label lookup helpers for views and actions.
 *
 * Developers author plain English `label`s in metadata
 * (`*.view.ts`, `*.actions.ts`); these helpers translate at render time using
 * the standardized keys:
 *
 *   objects.<object>._views.<view_name>.label
 *   objects.<object>._views.<view_name>.description
 *   objects.<object>._actions.<action_name>.label
 *   objects.<object>._actions.<action_name>.confirmText
 *   objects.<object>._actions.<action_name>.successMessage
 *
 * For object-less actions (no `objectName`), helpers fall back to:
 *
 *   globalActions.<action_name>.label / .confirmText / .successMessage
 *
 * Lookup order: requested locale → each entry of `fallbackChain` (defaults to
 * `['en']`) → literal `label` from the metadata. Helpers never throw — they
 * always return at minimum the metadata literal so unconfigured languages
 * gracefully degrade.
 */

import type { TranslationBundle, TranslationData } from './translation.zod';

/** Minimal view shape consumed by `resolveViewLabel`. */
export interface ViewLike {
  name: string;
  label?: string;
  description?: string;
  /** Object the view is bound to. Required for translation lookup. */
  objectName?: string;
  /** Some view definitions name the bound object via `data.object`. */
  data?: { object?: string };
}

/** Minimal action shape consumed by the action resolvers. */
export interface ActionLike {
  name: string;
  label?: string;
  confirmText?: string;
  successMessage?: string;
  /** When omitted, the action is treated as global. */
  objectName?: string;
  /** Post-success reveal dialog (see `Action.resultDialog` in ui/action.zod). */
  resultDialog?: ResultDialogLike;
}

/** Minimal result-dialog shape consumed by `resolveActionResultDialog`. */
export interface ResultDialogLike {
  title?: string;
  description?: string;
  acknowledge?: string;
  fields?: Array<{ path: string; label?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/** Optional resolver settings. */
export interface ResolveOptions {
  /** BCP-47 locale code; defaults to `'en'`. */
  locale?: string;
  /**
   * Ordered fallback locales to consult after `locale` and before returning
   * the literal label. Defaults to `['en']`.
   */
  fallbackChain?: string[];
}

/**
 * Resolve a requested locale code against the locales actually present in a
 * bundle, applying BCP-47 fallback so callers that pass a base language
 * (e.g. `zh`) or a differently-cased / region-qualified variant still hit the
 * available data (e.g. `zh-CN`). Mirrors `resolveLocale` in
 * `@objectstack/core` but is inlined here so `@objectstack/spec` stays
 * dependency-free.
 *
 * Order: exact → case-insensitive → base-language → variant-expansion.
 * Returns the matched bundle key, or `undefined` when nothing matches.
 */
function resolveBundleLocale(
  bundle: Record<string, unknown>,
  requested: string,
): string | undefined {
  // 1. Exact match (fast path).
  if (bundle[requested] !== undefined) return requested;

  const available = Object.keys(bundle);
  if (available.length === 0) return undefined;

  const lower = requested.toLowerCase();
  // 2. Case-insensitive match (e.g. `zh-cn` → `zh-CN`).
  const caseMatch = available.find((code) => code.toLowerCase() === lower);
  if (caseMatch) return caseMatch;

  const base = lower.split('-')[0];
  // 3. Base-language match (e.g. `zh-CN` → `zh`).
  const baseMatch = available.find((code) => code.toLowerCase() === base);
  if (baseMatch) return baseMatch;

  // 4. Variant expansion (e.g. `zh` → `zh-CN`; first registered variant wins).
  const variantMatch = available.find((code) => code.toLowerCase().split('-')[0] === base);
  if (variantMatch) return variantMatch;

  return undefined;
}

function pickData(
  bundle: TranslationBundle | undefined,
  locale: string,
): TranslationData | undefined {
  if (!bundle) return undefined;
  const exact = bundle[locale];
  if (exact !== undefined) return exact;
  const resolved = resolveBundleLocale(bundle, locale);
  return resolved !== undefined ? bundle[resolved] : undefined;
}

function localeChain(opts?: ResolveOptions): string[] {
  const locale = opts?.locale ?? 'en';
  const fallbacks = opts?.fallbackChain ?? ['en'];
  // Preserve order, drop duplicates.
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const code of [locale, ...fallbacks]) {
    if (!seen.has(code)) {
      seen.add(code);
      chain.push(code);
    }
  }
  return chain;
}

function viewObjectName(view: ViewLike): string | undefined {
  return view.objectName ?? view.data?.object;
}

/**
 * Resolve a translated view label, falling back to the literal `view.label`
 * (or `view.name`) when no translation is available.
 */
export function resolveViewLabel(
  bundle: TranslationBundle | undefined,
  view: ViewLike,
  opts?: ResolveOptions,
): string {
  const fallback = view.label ?? view.name;
  const objectName = viewObjectName(view);
  if (!bundle || !objectName) return fallback;
  for (const code of localeChain(opts)) {
    const data = pickData(bundle, code);
    const candidate = data?.objects?.[objectName]?._views?.[view.name]?.label;
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return fallback;
}

/**
 * Resolve a translated view description, returning `undefined` when neither a
 * translation nor a literal description is set.
 */
export function resolveViewDescription(
  bundle: TranslationBundle | undefined,
  view: ViewLike,
  opts?: ResolveOptions,
): string | undefined {
  const objectName = viewObjectName(view);
  if (bundle && objectName) {
    for (const code of localeChain(opts)) {
      const data = pickData(bundle, code);
      const candidate =
        data?.objects?.[objectName]?._views?.[view.name]?.description;
      if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    }
  }
  return view.description;
}

function lookupActionField(
  bundle: TranslationBundle | undefined,
  action: ActionLike,
  field: 'label' | 'confirmText' | 'successMessage',
  opts?: ResolveOptions,
): string | undefined {
  if (!bundle) return undefined;
  for (const code of localeChain(opts)) {
    const data = pickData(bundle, code);
    if (!data) continue;
    const fromObject = action.objectName
      ? data.objects?.[action.objectName]?._actions?.[action.name]?.[field]
      : undefined;
    if (typeof fromObject === 'string' && fromObject.length > 0) return fromObject;
    const fromGlobal = data.globalActions?.[action.name]?.[field];
    if (typeof fromGlobal === 'string' && fromGlobal.length > 0) return fromGlobal;
  }
  return undefined;
}

/**
 * Resolve a translated action label, falling back to the literal `action.label`
 * (or `action.name`) when no translation is available.
 */
export function resolveActionLabel(
  bundle: TranslationBundle | undefined,
  action: ActionLike,
  opts?: ResolveOptions,
): string {
  return (
    lookupActionField(bundle, action, 'label', opts) ??
    action.label ??
    action.name
  );
}

/**
 * Resolve a translated confirmation prompt for an action, returning
 * `undefined` if neither the bundle nor the action defines one.
 */
export function resolveActionConfirm(
  bundle: TranslationBundle | undefined,
  action: ActionLike,
  opts?: ResolveOptions,
): string | undefined {
  return lookupActionField(bundle, action, 'confirmText', opts) ?? action.confirmText;
}

/**
 * Look up the translated `resultDialog` node for an action in a single
 * locale's data (object-scoped first, then global). The node's `fields`
 * record is keyed by the LITERAL result-field path (`"user.email"`), so it
 * is indexed directly — never split on `.`.
 */
function lookupActionResultDialogNode(
  data: TranslationData | undefined,
  action: ActionLike,
): { title?: string; description?: string; acknowledge?: string; fields?: Record<string, string> } | undefined {
  if (!data) return undefined;
  const fromObject = action.objectName
    ? data.objects?.[action.objectName]?._actions?.[action.name]?.resultDialog
    : undefined;
  if (fromObject) return fromObject;
  return data.globalActions?.[action.name]?.resultDialog;
}

function lookupActionResultDialogText(
  bundle: TranslationBundle | undefined,
  action: ActionLike,
  pick: (node: NonNullable<ReturnType<typeof lookupActionResultDialogNode>>) => string | undefined,
  opts?: ResolveOptions,
): string | undefined {
  if (!bundle) return undefined;
  for (const code of localeChain(opts)) {
    const node = lookupActionResultDialogNode(pickData(bundle, code), action);
    if (!node) continue;
    const value = pick(node);
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Resolve a translated copy of an action's `resultDialog`, overlaying
 * `title` / `description` / `acknowledge` and per-field `label`s (keyed by
 * the literal field path) when translations exist. Returns the original
 * spec untouched (same reference) when the action has no `resultDialog`;
 * otherwise a shallow copy with translated strings merged in.
 */
export function resolveActionResultDialog<T extends ResultDialogLike>(
  bundle: TranslationBundle | undefined,
  action: ActionLike & { resultDialog?: T },
  opts?: ResolveOptions,
): T | undefined {
  const spec = action.resultDialog;
  if (!spec) return spec;
  const title = lookupActionResultDialogText(bundle, action, (n) => n.title, opts) ?? spec.title;
  const description =
    lookupActionResultDialogText(bundle, action, (n) => n.description, opts) ?? spec.description;
  const acknowledge =
    lookupActionResultDialogText(bundle, action, (n) => n.acknowledge, opts) ?? spec.acknowledge;
  const fields = Array.isArray(spec.fields)
    ? spec.fields.map((field) => {
        if (!field || typeof field.path !== 'string') return field;
        const label =
          lookupActionResultDialogText(bundle, action, (n) => n.fields?.[field.path], opts) ??
          field.label;
        return label !== undefined ? { ...field, label } : field;
      })
    : spec.fields;
  return {
    ...spec,
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(acknowledge !== undefined ? { acknowledge } : {}),
    ...(fields !== undefined ? { fields } : {}),
  };
}

/**
 * Resolve a translated success message for an action, returning `undefined`
 * if neither the bundle nor the action defines one.
 */
export function resolveActionSuccess(
  bundle: TranslationBundle | undefined,
  action: ActionLike,
  opts?: ResolveOptions,
): string | undefined {
  return (
    lookupActionField(bundle, action, 'successMessage', opts) ??
    action.successMessage
  );
}

/**
 * Apply the active locale to a view metadata document by overwriting `label`
 * and `description` with translated values when available. The original
 * document is not mutated; a shallow copy is returned. Useful for translating
 * metadata at the API boundary so any client (Studio, app-shell, plain HTTP)
 * receives already-localized labels.
 */
export function translateView<T extends ViewLike>(
  view: T,
  bundle: TranslationBundle | undefined,
  opts?: ResolveOptions,
): T {
  const label = resolveViewLabel(bundle, view, opts);
  const description = resolveViewDescription(bundle, view, opts);
  return { ...view, label, ...(description !== undefined ? { description } : {}) };
}

/**
 * Apply the active locale to an action metadata document by overwriting
 * `label`, `confirmText`, `successMessage`, and the `resultDialog` copy with
 * translated values when available. The original document is not mutated; a
 * shallow copy is returned.
 */
export function translateAction<T extends ActionLike>(
  action: T,
  bundle: TranslationBundle | undefined,
  opts?: ResolveOptions,
): T {
  const label = resolveActionLabel(bundle, action, opts);
  const confirmText = resolveActionConfirm(bundle, action, opts);
  const successMessage = resolveActionSuccess(bundle, action, opts);
  const resultDialog = resolveActionResultDialog(bundle, action, opts);
  return {
    ...action,
    label,
    ...(confirmText !== undefined ? { confirmText } : {}),
    ...(successMessage !== undefined ? { successMessage } : {}),
    ...(resultDialog !== undefined ? { resultDialog } : {}),
  };
}

/**
 * Generic metadata translator: dispatches to `translateView` /
 * `translateAction` based on metadata type. Returns the original document
 * unchanged for unrecognised types.
 *
 * @param type Canonical metadata type string (see `MetadataTypeSchema`).
 * @param doc The metadata document to translate.
 * @param bundle Translation bundle (typically loaded from the i18n service).
 * @param opts Locale + fallback chain.
 */
export function translateMetadataDocument(
  type: string,
  doc: any,
  bundle: TranslationBundle | undefined,
  opts?: ResolveOptions,
): any {
  if (!doc || typeof doc !== 'object') return doc;
  if (type === 'view') return translateView(doc, bundle, opts);
  if (type === 'action') return translateAction(doc, bundle, opts);
  if (type === 'object') return translateObject(doc, bundle, opts);
  if (type === 'app') return translateApp(doc, bundle, opts);
  if (type === 'dashboard') return translateDashboard(doc, bundle, opts);
  if (type === 'page') return translatePage(doc, bundle, opts);
  return doc;
}

// ────────────────────────────────────────────────────────────────────────────
// App metadata resolvers (label / description / navigation labels)
// ────────────────────────────────────────────────────────────────────────────

/** Minimal navigation-node shape consumed by `translateApp`. */
export interface NavNodeLike {
  id?: string;
  label?: string;
  children?: NavNodeLike[];
  [key: string]: any;
}

/** Minimal app metadata shape consumed by `translateApp`. */
export interface AppLike {
  name: string;
  label?: string;
  description?: string;
  navigation?: NavNodeLike[];
  [key: string]: any;
}

function lookupAppAttr(
  bundle: TranslationBundle | undefined,
  appName: string,
  attr: 'label' | 'description',
  opts?: ResolveOptions,
): string | undefined {
  if (!bundle) return undefined;
  for (const code of localeChain(opts)) {
    const candidate = pickData(bundle, code)?.apps?.[appName]?.[attr];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

function lookupNavLabel(
  bundle: TranslationBundle | undefined,
  appName: string,
  navId: string,
  opts?: ResolveOptions,
): string | undefined {
  if (!bundle) return undefined;
  for (const code of localeChain(opts)) {
    const candidate = pickData(bundle, code)?.apps?.[appName]?.navigation?.[navId]?.label;
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

/**
 * Apply the active locale to an app metadata document — translates the app's
 * `label` / `description` and walks the (possibly nested) `navigation` tree,
 * replacing each node's `label` with `apps.<app>.navigation.<id>.label` when a
 * translation exists. The input document is not mutated.
 *
 * Translation keys are addressed by the stable navigation-node `id`
 * (e.g. `group_overview`, `nav_users`) — the same flat keyspace used by the
 * `apps.<app>.navigation` map, regardless of tree depth.
 */
export function translateApp<T extends AppLike>(
  doc: T,
  bundle: TranslationBundle | undefined,
  opts?: ResolveOptions,
): T {
  if (!doc || typeof doc !== 'object') return doc;
  const appName = doc.name;
  if (!appName || !bundle) return doc;

  const label = lookupAppAttr(bundle, appName, 'label', opts) ?? doc.label;
  const description = lookupAppAttr(bundle, appName, 'description', opts) ?? doc.description;

  const translateNav = (node: NavNodeLike): NavNodeLike => {
    if (!node || typeof node !== 'object') return node;
    const next: NavNodeLike = { ...node };
    if (typeof node.id === 'string') {
      const translated = lookupNavLabel(bundle, appName, node.id, opts);
      if (translated) next.label = translated;
    }
    if (Array.isArray(node.children)) {
      next.children = node.children.map(translateNav);
    }
    return next;
  };

  const navigation = Array.isArray(doc.navigation)
    ? doc.navigation.map(translateNav)
    : doc.navigation;

  return {
    ...doc,
    ...(label !== undefined ? { label } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(navigation !== undefined ? { navigation } : {}),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Dashboard metadata resolvers (label / description / widget titles)
// ────────────────────────────────────────────────────────────────────────────

/** Minimal widget shape consumed by `translateDashboard`. */
export interface WidgetLike {
  id?: string;
  title?: string;
  description?: string;
  [key: string]: any;
}

/** Minimal dashboard metadata shape consumed by `translateDashboard`. */
export interface DashboardLike {
  name: string;
  label?: string;
  description?: string;
  widgets?: WidgetLike[];
  [key: string]: any;
}

function lookupDashboardAttr(
  bundle: TranslationBundle | undefined,
  name: string,
  attr: 'label' | 'description',
  opts?: ResolveOptions,
): string | undefined {
  if (!bundle) return undefined;
  for (const code of localeChain(opts)) {
    const candidate = pickData(bundle, code)?.dashboards?.[name]?.[attr];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

function lookupWidgetAttr(
  bundle: TranslationBundle | undefined,
  dashboardName: string,
  widgetId: string,
  attr: 'title' | 'description',
  opts?: ResolveOptions,
): string | undefined {
  if (!bundle) return undefined;
  for (const code of localeChain(opts)) {
    const candidate =
      pickData(bundle, code)?.dashboards?.[dashboardName]?.widgets?.[widgetId]?.[attr];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

/**
 * Apply the active locale to a dashboard metadata document — translates the
 * dashboard's `label` / `description` and each widget's `title` /
 * `description` against `dashboards.<name>.widgets.<id>.*`. The input document
 * is not mutated.
 */
export function translateDashboard<T extends DashboardLike>(
  doc: T,
  bundle: TranslationBundle | undefined,
  opts?: ResolveOptions,
): T {
  if (!doc || typeof doc !== 'object') return doc;
  const name = doc.name;
  if (!name || !bundle) return doc;

  const label = lookupDashboardAttr(bundle, name, 'label', opts) ?? doc.label;
  const description = lookupDashboardAttr(bundle, name, 'description', opts) ?? doc.description;

  const widgets = Array.isArray(doc.widgets)
    ? doc.widgets.map((w) => {
        if (!w || typeof w !== 'object' || typeof w.id !== 'string') return w;
        const next: WidgetLike = { ...w };
        const title = lookupWidgetAttr(bundle, name, w.id, 'title', opts);
        if (title) next.title = title;
        const desc = lookupWidgetAttr(bundle, name, w.id, 'description', opts);
        if (desc) next.description = desc;
        return next;
      })
    : doc.widgets;

  return {
    ...doc,
    ...(label !== undefined ? { label } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(widgets !== undefined ? { widgets } : {}),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Page metadata resolvers (label / description / page:header title + subtitle)
// ────────────────────────────────────────────────────────────────────────────

/** Minimal page-component shape consumed by `translatePage`. */
export interface PageComponentLike {
  type?: string;
  properties?: Record<string, any>;
  [key: string]: any;
}

/** Minimal page-region shape consumed by `translatePage`. */
export interface PageRegionLike {
  name?: string;
  components?: PageComponentLike[];
  [key: string]: any;
}

/** Minimal page metadata shape consumed by `translatePage`. */
export interface PageLike {
  name: string;
  label?: string;
  description?: string;
  regions?: PageRegionLike[];
  [key: string]: any;
}

/** The component type whose header copy `translatePage` localizes. */
const PAGE_HEADER_COMPONENT = 'page:header';

function lookupPageAttr(
  bundle: TranslationBundle | undefined,
  name: string,
  attr: 'label' | 'description' | 'title' | 'subtitle',
  opts?: ResolveOptions,
): string | undefined {
  if (!bundle) return undefined;
  for (const code of localeChain(opts)) {
    const candidate = pickData(bundle, code)?.pages?.[name]?.[attr];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

/**
 * Apply the active locale to a page metadata document — translates the page's
 * own `label` / `description` and the `properties.title` / `properties.subtitle`
 * of every `page:header` component in its regions, against
 * `pages.<name>.{label,description,title,subtitle}`. The input document is not
 * mutated.
 *
 * Header copy is addressed by **page name** rather than by component id because
 * `page:header` instances carry no stable id in practice. `title` falls back to
 * `pages.<name>.label` so translators need not repeat a string that is normally
 * identical to the page's nav label.
 *
 * Only region-level components are visited: `page:header` is a top-level
 * layout block by convention, and components nested inside another component's
 * `properties` (tabs, sections) are untyped free-form props.
 */
export function translatePage<T extends PageLike>(
  doc: T,
  bundle: TranslationBundle | undefined,
  opts?: ResolveOptions,
): T {
  if (!doc || typeof doc !== 'object') return doc;
  const name = doc.name;
  if (!name || !bundle) return doc;

  const label = lookupPageAttr(bundle, name, 'label', opts) ?? doc.label;
  const description = lookupPageAttr(bundle, name, 'description', opts) ?? doc.description;
  const headerTitle = lookupPageAttr(bundle, name, 'title', opts)
    ?? lookupPageAttr(bundle, name, 'label', opts);
  const headerSubtitle = lookupPageAttr(bundle, name, 'subtitle', opts);

  const translateComponent = (component: PageComponentLike): PageComponentLike => {
    if (!component || typeof component !== 'object') return component;
    if (component.type !== PAGE_HEADER_COMPONENT) return component;
    if (headerTitle === undefined && headerSubtitle === undefined) return component;
    return {
      ...component,
      properties: {
        ...component.properties,
        ...(headerTitle !== undefined ? { title: headerTitle } : {}),
        ...(headerSubtitle !== undefined ? { subtitle: headerSubtitle } : {}),
      },
    };
  };

  const regions = Array.isArray(doc.regions)
    ? doc.regions.map((region) => {
        if (!region || typeof region !== 'object' || !Array.isArray(region.components)) return region;
        return { ...region, components: region.components.map(translateComponent) };
      })
    : doc.regions;

  return {
    ...doc,
    ...(label !== undefined ? { label } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(regions !== undefined ? { regions } : {}),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Object metadata resolvers (label / pluralLabel / description / fields / options)
// ────────────────────────────────────────────────────────────────────────────

/** Minimal object metadata shape consumed by `translateObject`. */
export interface ObjectLike {
  name: string;
  label?: string;
  pluralLabel?: string;
  description?: string;
  fields?: Record<string, ObjectFieldLike> | ObjectFieldLike[];
  /** Actions declared inline on the object (`Object.actions`). */
  actions?: ActionLike[];
}

export interface ObjectFieldLike {
  name?: string;
  label?: string;
  help?: string;
  description?: string;
  options?: Array<{ label?: string; value: string | number | boolean }>;
  [key: string]: any;
}

function lookupObjectField<K extends 'label' | 'pluralLabel' | 'description'>(
  bundle: TranslationBundle | undefined,
  objectName: string,
  field: K,
  opts?: ResolveOptions,
): string | undefined {
  if (!bundle) return undefined;
  for (const code of localeChain(opts)) {
    const data = pickData(bundle, code);
    const candidate = data?.objects?.[objectName]?.[field];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

function lookupObjectFieldAttr(
  bundle: TranslationBundle | undefined,
  objectName: string,
  fieldName: string,
  attr: 'label' | 'help' | 'description',
  opts?: ResolveOptions,
): string | undefined {
  if (!bundle) return undefined;
  for (const code of localeChain(opts)) {
    const data = pickData(bundle, code);
    const candidate = (data?.objects?.[objectName]?.fields?.[fieldName] as any)?.[attr];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

export interface LocaleDescriptor {
  /** BCP-47 locale code. */
  code: string;
  /** Display name. Falls back to the code — nothing in the tree carries one. */
  label: string;
  /** Whether this is the stack's default locale. */
  isDefault: boolean;
}

/**
 * Turn `II18nService.getLocales()` — a bare `string[]` — into the descriptor
 * list `GetLocalesResponseSchema` declares for `GET /i18n/locales`.
 *
 * Shared for the same reason `resolveObjectFieldLabels` is: both the
 * dispatcher domain and service-i18n serve this route, and when each kept its
 * own copy they diverged. service-i18n mapped to descriptors; the dispatcher
 * passed the raw `string[]` straight through, so the SAME endpoint returned
 * `['en','zh-CN']` or `[{code,label,isDefault}]` depending on which provider
 * happened to mount it — and the dispatcher's form contradicted both the
 * declared schema and the SDK's `GetLocalesResponse` type. Exactly the split
 * #3833 found in the field-labels derivation, one route over.
 *
 * `label` is the code: no locale display-name source exists in the tree, and
 * the schema requires the field. Inventing one here (an ICU display-name
 * table) would be a product decision, not an implementation detail.
 */
export function toLocaleDescriptors(
  codes: readonly string[] | undefined,
  defaultLocale?: string,
): LocaleDescriptor[] {
  if (!codes) return [];
  return codes.map((code) => ({ code, label: code, isDefault: code === defaultLocale }));
}

/**
 * Enumerate an object's translated field labels out of ONE locale's
 * `TranslationData` — the `GET /i18n/labels/:object/:locale` body.
 *
 * Distinct from `lookupObjectFieldAttr` above, which answers "what is this
 * one field called" against a whole bundle and a locale chain. This answers
 * "which fields does this locale translate at all", which is what the
 * endpoint returns and what no per-field lookup can produce.
 *
 * Shared deliberately. Both serving surfaces derive this map — the dispatcher
 * domain body and service-i18n's autonomous route — and they are the only
 * path there is: `getFieldLabels` is optional on `II18nService` and NOTHING
 * implements it (neither `memory-i18n` nor `file-i18n-adapter`), so the
 * "dedicated method" branch both surfaces check first is dead and this
 * derivation always runs. Keeping one copy each is how the dispatcher was
 * left scanning the retired flat `o.<object>.fields.<field>` dialect after
 * #3778 converged the tree on nested `objects.<object>.fields.<field>.label`
 * and fixed only service-i18n's copy — a scan that cannot match a real bundle,
 * so that route returned `{}` for every provider (#3833).
 *
 * Fields with no non-empty `label` are omitted rather than emitted blank:
 * partial translation is the normal state (see `ObjectTranslationDataSchema`),
 * and a caller merges what comes back over its source labels. That rule is
 * also what lets `ResolvedFieldLabel.label` be required — an entry exists
 * precisely because a label was found, so a field carrying only `help` yields
 * no entry rather than one with a blank label.
 *
 * Each entry carries `help` and `options` alongside `label`, which is what
 * `GetFieldLabelsResponseSchema` has always declared. Both surfaces used to
 * emit a bare `Record<string, string>` instead, so the endpoint contradicted
 * its own response schema AND discarded translations the bundle already
 * carried — `FieldTranslationSchema` populates `help` and `options`, and
 * objectui reads exactly those (as `fieldOptions.<obj>.<fld>.<value>`) off the
 * full-bundle route, because this endpoint could not give them to it (#3847).
 */
export interface ResolvedFieldLabel {
  /** Translated field label. Required — an entry exists only because it has one. */
  label: string;
  /** Translated help text, when the bundle carries one. */
  help?: string;
  /** Option value → translated option label, when the bundle carries them. */
  options?: Record<string, string>;
}

export function resolveObjectFieldLabels(
  data: TranslationData | undefined,
  objectName: string,
): Record<string, ResolvedFieldLabel> {
  const fields = data?.objects?.[objectName]?.fields;
  const labels: Record<string, ResolvedFieldLabel> = {};
  if (!fields) return labels;
  for (const [fieldName, field] of Object.entries(fields)) {
    const label = field?.label;
    if (typeof label !== 'string' || label.length === 0) continue;
    const entry: ResolvedFieldLabel = { label };
    if (typeof field.help === 'string' && field.help.length > 0) entry.help = field.help;
    // Only a non-empty map — an empty `options: {}` would claim the field has
    // translated options and hand back none.
    if (field.options && Object.keys(field.options).length > 0) entry.options = { ...field.options };
    labels[fieldName] = entry;
  }
  return labels;
}

function lookupObjectFieldOption(
  bundle: TranslationBundle | undefined,
  objectName: string,
  fieldName: string,
  optionValue: string | number | boolean,
  opts?: ResolveOptions,
): string | undefined {
  if (!bundle) return undefined;
  const key = String(optionValue);
  for (const code of localeChain(opts)) {
    const data = pickData(bundle, code);
    const map = data?.objects?.[objectName]?.fields?.[fieldName]?.options as
      | Record<string, string>
      | undefined;
    const candidate = map?.[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

/**
 * Built-in labels for the platform-injected system fields (the ObjectQL
 * registry stamps `owner_id` / `created_*` / `updated_*` onto every object
 * with English labels). Custom objects carry no per-object translation
 * entries for these, so without a fallback every localized surface — list
 * headers, export files, import templates — leaks the English default (e.g.
 * an otherwise fully-Chinese import template with an `Owner` column).
 *
 * Wording matches the generated platform bundles (`*.objects.generated.ts`)
 * so a system field reads the same on custom and platform objects.
 */
const SYSTEM_FIELD_LABELS: Record<string, Record<string, string>> = {
  owner_id: { en: 'Owner', 'zh-CN': '所有者', 'ja-JP': '所有者', 'es-ES': 'Propietario' },
  created_at: { en: 'Created At', 'zh-CN': '创建时间', 'ja-JP': '作成日時', 'es-ES': 'Creado el' },
  created_by: { en: 'Created By', 'zh-CN': '创建人', 'ja-JP': '作成者', 'es-ES': 'Creado por' },
  updated_at: { en: 'Last Modified At', 'zh-CN': '更新时间', 'ja-JP': '更新日時', 'es-ES': 'Actualizado el' },
  updated_by: { en: 'Last Modified By', 'zh-CN': '更新人', 'ja-JP': '更新者', 'es-ES': 'Actualizado por' },
};

/**
 * Fallback label for a platform-injected system field, honouring the same
 * locale-matching rules as bundle lookup (exact → case-insensitive → base
 * language → variant). Applied only when the field still carries its injected
 * English default — an author's custom label is never overridden.
 */
function builtinSystemFieldLabel(
  fieldName: string,
  currentLabel: string | undefined,
  opts?: ResolveOptions,
): string | undefined {
  const entry = SYSTEM_FIELD_LABELS[fieldName];
  if (!entry) return undefined;
  if (currentLabel !== undefined && currentLabel !== entry.en) return undefined;
  for (const code of localeChain(opts)) {
    const resolved = resolveBundleLocale(entry, code);
    if (resolved !== undefined) return entry[resolved];
  }
  return undefined;
}

/**
 * Apply the active locale to an object metadata document. Translates the
 * object's `label` / `pluralLabel` / `description`, walks each field to
 * translate its `label`, `help`, and per-option `label`s, and walks any
 * inline-declared `actions` through {@link translateAction}. The input document
 * is not mutated; a structural clone of the touched branches is returned.
 *
 * Field maps come in two shapes across the codebase: a `Record<string, Field>`
 * (preferred — the canonical authored shape) and an `Array<Field>` (some REST
 * responses flatten the record). Both are supported; the function returns the
 * same shape it was given.
 *
 * Actions were the long-standing hole here: `sys_approval_request` declares its
 * decision actions inline, so an object document went out with English
 * Approve / Reject buttons even though the plugin ships `_actions` translations
 * for them. The Console papered over it by re-resolving labels client-side
 * against a separately fetched bundle, which left every other consumer — mobile,
 * plain HTTP, SDUI — rendering the source language (#3370).
 */
export function translateObject<T extends ObjectLike>(
  doc: T,
  bundle: TranslationBundle | undefined,
  opts?: ResolveOptions,
): T {
  if (!doc || typeof doc !== 'object') return doc;
  const objectName = doc.name;
  // Proceed even without a bundle: the built-in system-field labels below
  // still apply (custom objects typically ship no translation entries).
  if (!objectName) return doc;

  const label = lookupObjectField(bundle, objectName, 'label', opts) ?? doc.label;
  const pluralLabel =
    lookupObjectField(bundle, objectName, 'pluralLabel', opts) ?? doc.pluralLabel;
  const description =
    lookupObjectField(bundle, objectName, 'description', opts) ?? doc.description;

  const translateField = (name: string, def: ObjectFieldLike): ObjectFieldLike => {
    const next: ObjectFieldLike = { ...def };
    const translatedLabel =
      lookupObjectFieldAttr(bundle, objectName, name, 'label', opts) ??
      builtinSystemFieldLabel(name, def.label, opts);
    if (translatedLabel) next.label = translatedLabel;
    const translatedHelp = lookupObjectFieldAttr(bundle, objectName, name, 'help', opts);
    if (translatedHelp) next.help = translatedHelp;
    if (Array.isArray(def.options)) {
      next.options = def.options.map((opt) => {
        if (!opt || typeof opt !== 'object' || opt.value === undefined) return opt;
        const translated = lookupObjectFieldOption(bundle, objectName, name, opt.value, opts);
        return translated ? { ...opt, label: translated } : opt;
      });
    }
    return next;
  };

  let fields: ObjectLike['fields'] = doc.fields;
  if (Array.isArray(doc.fields)) {
    fields = doc.fields.map((f) => translateField(f.name ?? '', f));
  } else if (doc.fields && typeof doc.fields === 'object') {
    const next: Record<string, ObjectFieldLike> = {};
    for (const [name, def] of Object.entries(doc.fields)) {
      next[name] = translateField(name, def);
    }
    fields = next;
  }

  const actions = Array.isArray(doc.actions)
    ? doc.actions.map((action) => {
        if (!action || typeof action !== 'object' || !action.name) return action;
        if (action.objectName) return translateAction(action, bundle, opts);
        // An inline action carries no `objectName` of its own — it is addressed
        // by the object that declares it, which is what `_actions` keys on. Scope
        // it for the lookup, then hand back the shape the document came in with
        // rather than stamping a synthetic field onto the response.
        const { objectName: _scoped, ...translated } = translateAction(
          { ...action, objectName },
          bundle,
          opts,
        );
        return translated as typeof action;
      })
    : undefined;

  return {
    ...doc,
    ...(label !== undefined ? { label } : {}),
    ...(pluralLabel !== undefined ? { pluralLabel } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(fields !== undefined ? { fields } : {}),
    ...(actions !== undefined ? { actions } : {}),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Settings (SettingsManifest) resolvers
// ────────────────────────────────────────────────────────────────────────────

function pickSettingsEntry(
  bundle: TranslationBundle | undefined,
  namespace: string,
  locale: string,
) {
  return pickData(bundle, locale)?.settings?.[namespace];
}

function resolveOptionalString(
  bundle: TranslationBundle | undefined,
  namespace: string,
  pick: (entry: NonNullable<ReturnType<typeof pickSettingsEntry>>) => string | undefined,
  opts?: ResolveOptions,
): string | undefined {
  if (!bundle) return undefined;
  for (const code of localeChain(opts)) {
    const entry = pickSettingsEntry(bundle, namespace, code);
    if (!entry) continue;
    const value = pick(entry);
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/** Resolve manifest title; falls back to literal. */
export function resolveSettingsTitle(
  bundle: TranslationBundle | undefined,
  namespace: string,
  fallback: string,
  opts?: ResolveOptions,
): string {
  return resolveOptionalString(bundle, namespace, (e) => e.title, opts) ?? fallback;
}

/** Resolve manifest description. Returns literal (possibly undefined) when no translation found. */
export function resolveSettingsDescription(
  bundle: TranslationBundle | undefined,
  namespace: string,
  fallback: string | undefined,
  opts?: ResolveOptions,
): string | undefined {
  return resolveOptionalString(bundle, namespace, (e) => e.description, opts) ?? fallback;
}

/** Resolve a group title under `settings.<namespace>.groups.<group>.title`. */
export function resolveSettingsGroupTitle(
  bundle: TranslationBundle | undefined,
  namespace: string,
  groupKey: string,
  fallback: string,
  opts?: ResolveOptions,
): string {
  return (
    resolveOptionalString(bundle, namespace, (e) => e.groups?.[groupKey]?.title, opts)
    ?? fallback
  );
}

export function resolveSettingsGroupDescription(
  bundle: TranslationBundle | undefined,
  namespace: string,
  groupKey: string,
  fallback: string | undefined,
  opts?: ResolveOptions,
): string | undefined {
  return (
    resolveOptionalString(bundle, namespace, (e) => e.groups?.[groupKey]?.description, opts)
    ?? fallback
  );
}

/** Resolve a setting field label under `settings.<namespace>.keys.<key>.label`. */
export function resolveSettingsFieldLabel(
  bundle: TranslationBundle | undefined,
  namespace: string,
  key: string,
  fallback: string,
  opts?: ResolveOptions,
): string {
  return (
    resolveOptionalString(bundle, namespace, (e) => e.keys?.[key]?.label, opts) ?? fallback
  );
}

export function resolveSettingsFieldHelp(
  bundle: TranslationBundle | undefined,
  namespace: string,
  key: string,
  fallback: string | undefined,
  opts?: ResolveOptions,
): string | undefined {
  return (
    resolveOptionalString(bundle, namespace, (e) => e.keys?.[key]?.help, opts) ?? fallback
  );
}

export function resolveSettingsFieldPlaceholder(
  bundle: TranslationBundle | undefined,
  namespace: string,
  key: string,
  fallback: string | undefined,
  opts?: ResolveOptions,
): string | undefined {
  return (
    resolveOptionalString(bundle, namespace, (e) => e.keys?.[key]?.placeholder, opts)
    ?? fallback
  );
}

/** Resolve an enum option label under `settings.<namespace>.keys.<key>.options.<value>`. */
export function resolveSettingsOptionLabel(
  bundle: TranslationBundle | undefined,
  namespace: string,
  key: string,
  optionValue: string,
  fallback: string,
  opts?: ResolveOptions,
): string {
  return (
    resolveOptionalString(
      bundle,
      namespace,
      (e) => e.keys?.[key]?.options?.[optionValue],
      opts,
    ) ?? fallback
  );
}

/** Resolve an action button label under `settings.<namespace>.actions.<actionId>.label`. */
export function resolveSettingsActionLabel(
  bundle: TranslationBundle | undefined,
  namespace: string,
  actionId: string,
  fallback: string,
  opts?: ResolveOptions,
): string {
  return (
    resolveOptionalString(bundle, namespace, (e) => e.actions?.[actionId]?.label, opts)
    ?? fallback
  );
}

export function resolveSettingsActionConfirm(
  bundle: TranslationBundle | undefined,
  namespace: string,
  actionId: string,
  fallback: string | undefined,
  opts?: ResolveOptions,
): string | undefined {
  return (
    resolveOptionalString(bundle, namespace, (e) => e.actions?.[actionId]?.confirmText, opts)
    ?? fallback
  );
}

export function resolveSettingsActionSuccess(
  bundle: TranslationBundle | undefined,
  namespace: string,
  actionId: string,
  fallback: string | undefined,
  opts?: ResolveOptions,
): string | undefined {
  return (
    resolveOptionalString(bundle, namespace, (e) => e.actions?.[actionId]?.successMessage, opts)
    ?? fallback
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SettingsCommon — cross-namespace UI strings (source badges, etc.)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the human label for a `ResolvedSettingValue.source` value.
 * Walks the locale chain and falls back to the literal source key
 * (capitalised by the caller if desired) when no translation exists.
 */
export function resolveSettingsSourceLabel(
  bundle: TranslationBundle | undefined,
  source: 'env' | 'global' | 'tenant' | 'user' | 'default',
  fallback: string,
  opts?: ResolveOptions,
): string {
  if (!bundle) return fallback;
  for (const code of localeChain(opts)) {
    const label = pickData(bundle, code)?.settingsCommon?.sourceLabels?.[source];
    if (typeof label === 'string' && label.length > 0) return label;
  }
  return fallback;
}

// ────────────────────────────────────────────────────────────────────────────
// MetadataForms — metadata-type configuration form resolvers
// ────────────────────────────────────────────────────────────────────────────
//
// Translates the `form` payload returned by `getMetaTypes()` (the editor
// layout for authoring objects/fields/agents/flows/etc.) against the
// `metadataForms.<type>` namespace of the active translation bundle.
//
// Naming conventions:
//
//   metadataForms.<type>.label                          -- type display label
//   metadataForms.<type>.description                    -- type description
//   metadataForms.<type>.sections.<section_name>.label  -- section header
//   metadataForms.<type>.sections.<section_name>.description
//   metadataForms.<type>.fields.<field_path>.label      -- field label
//   metadataForms.<type>.fields.<field_path>.helpText
//   metadataForms.<type>.fields.<field_path>.placeholder
//
// `field_path` is dot-notation for nested fields. Top-level form fields use
// just the field name (e.g. `"name"`, `"description"`). Composite and
// repeater children are addressed via parent path:
//
//   "capabilities.trackHistory"  // composite "capabilities" → "trackHistory"
//   "fields.items.label"         // repeater "fields" → row → "label"
//
// All helpers are pure (immutable) — they return a new form object with
// the translated branches when matches exist, or the input unchanged when
// no bundle / no locale match.

function lookupMetadataForm(
  bundle: TranslationBundle | undefined,
  type: string,
  opts?: ResolveOptions,
): { entry: any; locale: string } | undefined {
  if (!bundle) return undefined;
  for (const code of localeChain(opts)) {
    const entry = pickData(bundle, code)?.metadataForms?.[type];
    if (entry && typeof entry === 'object') return { entry, locale: code };
  }
  return undefined;
}

function lookupMetadataFormSection(
  bundle: TranslationBundle | undefined,
  type: string,
  sectionName: string,
  attr: 'label' | 'description',
  opts?: ResolveOptions,
): string | undefined {
  if (!bundle) return undefined;
  for (const code of localeChain(opts)) {
    const candidate = pickData(bundle, code)?.metadataForms?.[type]?.sections?.[sectionName]?.[attr];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

function lookupMetadataFormField(
  bundle: TranslationBundle | undefined,
  type: string,
  fieldPath: string,
  attr: 'label' | 'helpText' | 'placeholder',
  opts?: ResolveOptions,
): string | undefined {
  if (!bundle) return undefined;
  for (const code of localeChain(opts)) {
    const candidate = pickData(bundle, code)?.metadataForms?.[type]?.fields?.[fieldPath]?.[attr];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

/**
 * Find direct child field names recorded in the bundle for a given parent
 * path. Used to synthesize a `fields[]` array for composite/repeater nodes
 * whose form authors did not enumerate sub-fields — so translations still
 * flow through to the client renderer.
 *
 * Walks every locale in the chain and unions the direct-child names so
 * partial localisations don't drop fields.
 */
function listMetadataFormDirectChildren(
  bundle: TranslationBundle | undefined,
  type: string,
  parentPath: string,
  opts?: ResolveOptions,
): string[] {
  if (!bundle || !parentPath) return [];
  const prefix = parentPath + '.';
  const seen = new Set<string>();
  for (const code of localeChain(opts)) {
    const fields = pickData(bundle, code)?.metadataForms?.[type]?.fields;
    if (!fields || typeof fields !== 'object') continue;
    for (const key of Object.keys(fields)) {
      if (!key.startsWith(prefix)) continue;
      const tail = key.slice(prefix.length);
      // Only direct children — skip deeper descendants (they'll be picked
      // up recursively when we visit the direct child node).
      if (tail.includes('.')) continue;
      if (tail.length > 0) seen.add(tail);
    }
  }
  return Array.from(seen);
}

/**
 * Resolve the display label for a metadata type.
 * Falls back to the literal label (typically the English label from
 * `DEFAULT_METADATA_TYPE_REGISTRY`) when no translation is available.
 */
export function resolveMetadataTypeLabel(
  bundle: TranslationBundle | undefined,
  type: string,
  fallback: string,
  opts?: ResolveOptions,
): string {
  if (!bundle) return fallback;
  for (const code of localeChain(opts)) {
    const candidate = pickData(bundle, code)?.metadataForms?.[type]?.label;
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return fallback;
}

/**
 * Resolve the description for a metadata type, returning the literal
 * (possibly `undefined`) when no translation is available.
 */
export function resolveMetadataTypeDescription(
  bundle: TranslationBundle | undefined,
  type: string,
  fallback: string | undefined,
  opts?: ResolveOptions,
): string | undefined {
  if (!bundle) return fallback;
  for (const code of localeChain(opts)) {
    const candidate = pickData(bundle, code)?.metadataForms?.[type]?.description;
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return fallback;
}

/**
 * Translate a single form-field node, walking into nested
 * composite/repeater children. `parentPath` is the dot-notation prefix
 * accumulated from ancestor field names.
 */
function translateFormField(
  field: any,
  type: string,
  bundle: TranslationBundle | undefined,
  parentPath: string,
  opts?: ResolveOptions,
): any {
  // Legacy: bare-string field reference. Nothing to translate.
  if (typeof field === 'string') return field;
  if (!field || typeof field !== 'object') return field;

  const name = typeof field.field === 'string' ? field.field : undefined;
  const path = name ? (parentPath ? `${parentPath}.${name}` : name) : parentPath;

  const next: any = { ...field };
  if (path) {
    const tLabel = lookupMetadataFormField(bundle, type, path, 'label', opts);
    if (tLabel) next.label = tLabel;
    const tHelp = lookupMetadataFormField(bundle, type, path, 'helpText', opts);
    if (tHelp) next.helpText = tHelp;
    const tPlaceholder = lookupMetadataFormField(bundle, type, path, 'placeholder', opts);
    if (tPlaceholder) next.placeholder = tPlaceholder;
  }

  // Recurse into composite / repeater sub-fields. The `fields` array on
  // a FormField mirrors the section's `fields` array shape, so reuse the
  // same walker. Children inherit the parent path via dot-notation.
  if (Array.isArray(field.fields)) {
    next.fields = field.fields.map((child: any) =>
      translateFormField(child, type, bundle, path, opts),
    );
  } else if (path && (field.type === 'composite' || field.type === 'repeater' || field.type === 'record')) {
    // No explicit `fields` enumeration — synthesize from bundle entries so
    // sub-field labels still reach the client renderer (which would
    // otherwise fall back to derivePropertyNames + humanize-case).
    const childNames = listMetadataFormDirectChildren(bundle, type, path, opts);
    if (childNames.length > 0) {
      next.fields = childNames.map((childName) =>
        translateFormField({ field: childName }, type, bundle, path, opts),
      );
    }
  }

  return next;
}

/**
 * Translate the labels, descriptions, helpTexts, and placeholders of a
 * metadata-type configuration form against the active translation bundle.
 *
 * Sections without a stable `name` are returned unchanged for section-level
 * attributes — only field labels are translated (field names are always
 * stable identifiers).
 *
 * Returns a new form object; the input is not mutated.
 *
 * @example
 * ```ts
 * const localized = resolveMetadataFormLabels(objectForm, 'object', bundle, { locale: 'zh-CN' });
 * ```
 */
export function resolveMetadataFormLabels<T extends Record<string, any>>(
  form: T,
  type: string,
  bundle: TranslationBundle | undefined,
  opts?: ResolveOptions,
): T {
  if (!form || typeof form !== 'object') return form;
  // Cheap escape hatch: if no bundle entry exists for this type at any
  // locale in the chain, return the form unchanged to avoid the allocation
  // cost of the recursive walker.
  if (!lookupMetadataForm(bundle, type, opts)) return form;

  const translateSection = (section: any): any => {
    if (!section || typeof section !== 'object') return section;
    const next: any = { ...section };
    const sectionName: string | undefined =
      typeof section.name === 'string'
        ? section.name
        : typeof section.label === 'string'
        ? section.label
            .toLowerCase()
            .replace(/&/g, 'and')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
        : undefined;
    if (sectionName) {
      const tLabel = lookupMetadataFormSection(bundle, type, sectionName, 'label', opts);
      if (tLabel) next.label = tLabel;
      const tDesc = lookupMetadataFormSection(bundle, type, sectionName, 'description', opts);
      if (tDesc) next.description = tDesc;
    }
    if (Array.isArray(section.fields)) {
      next.fields = section.fields.map((f: any) =>
        translateFormField(f, type, bundle, '', opts),
      );
    }
    return next;
  };

  const next: any = { ...form };
  if (Array.isArray(form.sections)) {
    next.sections = form.sections.map(translateSection);
  }
  // Legacy alias — some forms use `groups` instead of `sections`.
  if (Array.isArray(form.groups)) {
    next.groups = form.groups.map(translateSection);
  }
  return next as T;
}
