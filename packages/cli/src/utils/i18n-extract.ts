// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * I18n Extractor
 *
 * Walks a normalized stack config and produces ready-to-edit `TranslationData`
 * skeletons for every requested locale, pre-populated with the source labels
 * from the schema for the default locale.
 *
 * {@link collectExpectedEntries} is also the **single** definition of what is
 * translatable at all: `i18n-coverage.ts` consumes it to decide what `os lint`
 * gates, instead of keeping the parallel walk the two used to maintain. They
 * had drifted — inline object `actions` and object-nested `listViews` were
 * scaffoldable but ungated, which is how English approval buttons shipped into
 * a zh-CN workspace unnoticed (#3370). Add a surface here and both sides get it.
 *
 * Two axes per entry, and they are not the same question:
 *   `sourceValue` — what extract seeds the skeleton with; may be a derived
 *                   fallback (an object's own name, a humanized field path).
 *   `inline`      — what the reader actually sees in the source locale; drives
 *                   the coverage gate, so a string nobody authored is never
 *                   reported as an untranslated one.
 *
 * Walk surface:
 *
 *   objects.<name>.label
 *   objects.<name>.pluralLabel
 *   objects.<name>.description
 *   objects.<name>.fields.<field>.label
 *   objects.<name>.fields.<field>.help
 *   objects.<name>.fields.<field>.placeholder
 *   objects.<name>.fields.<field>.options.<value>
 *   objects.<name>._sections.<section>.label
 *   objects.<name>._views.<view>.label
 *   objects.<name>._views.<view>.description
 *   objects.<name>._views.<view>.emptyState.title / .message
 *   objects.<name>._actions.<action>.label
 *   objects.<name>._actions.<action>.description
 *   objects.<name>._actions.<action>.confirmText
 *   objects.<name>._actions.<action>.successMessage
 *   objects.<name>._actions.<action>.params.<param>.label / .helpText / .placeholder
 *   objects.<name>._actions.<action>.params.<param>.options.<value>
 *   objects.<name>._actions.<action>.resultDialog.title / .description / .acknowledge
 *   objects.<name>._actions.<action>.resultDialog.fields.<path>
 *   globalActions.<action>.label / .description / .confirmText / .successMessage
 *   globalActions.<action>.params.<param>.* / .resultDialog.* (same shape as object actions)
 *   apps.<app>.label / .description
 *   apps.<app>.navigation.<id>.label
 *   dashboards.<dash>.label / .description
 *   dashboards.<dash>.widgets.<w>.title / .description
 *   pages.<page>.label / .description
 *   pages.<page>.title / .subtitle   (from the page's `page:header` component)
 *   pages.<page>.components.<id>.<key>  (per-component copy, #6080)
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
import { METADATA_FORM_REGISTRY, PAGE_COMPONENT_COPY_KEYS } from '@objectstack/spec/system';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { deriveFieldGroupLayout } from '@objectstack/spec/data';
import { expandViewContainer } from '@objectstack/spec/ui';
import { walkPageComponents } from '@objectstack/lint';

// ─── Public types ──────────────────────────────────────────────────────

/** A single translation entry — path + source value carried from the schema. */
export interface ExpectedEntry {
  /** Lookup path expressed as an array of segments. */
  path: string[];
  /**
   * Value `os i18n extract` seeds the default-locale skeleton with — the
   * English literal on the schema, or the fallback the renderer displays when
   * the author omitted one (an object's own name, a humanized field path).
   *
   * `undefined` means there is nothing to scaffold: the key is recorded only so
   * the coverage gate can notice a bundle that authors it anyway.
   */
  sourceValue?: string;
  /**
   * The text a reader actually sees in the source locale. Drives the coverage
   * gate: a key with no `inline` and no bundle entry has no text to translate
   * at all, so demanding a translation for it would be noise (a *missing* label
   * is `required/label`'s finding, not an i18n gap).
   *
   * Narrower than {@link sourceValue} wherever the seed is a derived fallback
   * the author never wrote.
   */
  inline?: string;
  /** What kind of metadata this entry was harvested from. */
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

/**
 * The object a view binds to.
 *
 * The last two arms cover the aggregated View CONTAINER (`{ list, listViews,
 * formViews }`), which per spec carries no object of its own and is keyed
 * implicitly by its inner data source — the same fallback chain objectql's
 * `resolveMetadataItemName` uses to register it.
 */
function viewObjectName(view: any): string | undefined {
  return (
    view?.objectName ??
    view?.object ??
    view?.data?.object ??
    view?.list?.data?.object ??
    view?.form?.data?.object
  );
}

/**
 * The bare `_views` key the RUNTIME assigns to a container's default `list`.
 *
 * Asked of the composer (`expandViewContainer`, `spec/src/ui/view.zod.ts`)
 * rather than re-derived here — that function is the single producer of a
 * view's runtime identity, and the whole point of #5164 is that a second
 * derivation drifts from it. This walker used to spell the key
 * `view.list.name ?? 'list'` while the composer named the very same view
 * `<object>.default`, so a container declaring only a default `list` got a
 * bundle skeleton keyed `list`, a registry entry keyed `default`, and an
 * English label on screen forever. Ruled 2026-08-06 (#5164): canonical = the
 * runtime identity's bare key.
 *
 * Two facts live in the composer and nowhere else, both load-bearing here:
 *
 *  1. a nameless default list is keyed **`default`** (never `list`), and a
 *     named one keeps the author's `list.name`;
 *  2. a default list whose STRUCTURE merely restates a `listViews` entry is
 *     **collapsed into that entry** and has no key of its own — the
 *     `examples/app-crm` shape, where `list` is signature-identical to
 *     `listViews.all` and the live key is therefore `all`. This returns `all`
 *     there, and the caller skips the emit because the `listViews` loop
 *     already covered it. Emitting a second key for the collapsed view would
 *     scaffold a translation no lookup can reach — the same defect one shape
 *     over.
 *
 * A key renamed by a collision (`default` → `default_2`, when `listViews`
 * already claimed `default`) is returned as renamed, because that rename is
 * the registry key too.
 *
 * Returns `undefined` when the container declares no default `list`.
 */
function defaultListViewKey(object: string, container: any): string | undefined {
  if (!container?.list || typeof container.list !== 'object') return undefined;
  const item = expandViewContainer(object, container).find(
    (i) => i.viewKind === 'list' && i.isDefault,
  );
  if (!item) return undefined;
  const prefix = `${object}.`;
  return item.name.startsWith(prefix) ? item.name.slice(prefix.length) : item.name;
}

/**
 * Emit label / description / emptyState for ONE view under
 * `objects.<object>._views.<viewName>.*` — the convention the runtime resolver
 * reads (`viewLabel` / `viewDescription` / `viewEmptyState` in
 * @object-ui/i18n) and the one the shipped platform bundles already carry
 * (`en.objects.generated.ts`: `sys_user._views.all_users.label`).
 */
function pushViewEntries(out: ExpectedEntry[], objectName: string, viewName: string, view: any): void {
  const root = ['objects', objectName, '_views', viewName];
  pushDerived(out, [...root, 'label'], view?.label ?? viewName, inlineText(view?.label), 'view', { objectName });
  pushOptional(out, [...root, 'description'], view?.description, 'view', { objectName });
  pushViewEmptyState(out, root, view, objectName);
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

type EntryScope = Pick<ExpectedEntry, 'objectName' | 'appName' | 'metadataType'>;

/** Narrow to a usable source string; an empty string is not authored text. */
function inlineText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Record a key whose displayed text *is* its seed — the common case, where the
 * author wrote the literal we scaffold from.
 */
function pushEntry(
  out: ExpectedEntry[],
  path: string[],
  sourceValue: string | undefined,
  source: ExpectedEntry['source'],
  extra?: EntryScope,
): void {
  if (typeof sourceValue !== 'string') return;
  out.push({ path, sourceValue, inline: sourceValue, source, ...extra });
}

/**
 * Record a key whose seed is *derived* — an object's own name standing in for a
 * missing label, a param's machine name rendered as its caption. The seed keeps
 * the extracted skeleton usable, but `inline` stays unset so the coverage gate
 * does not demand translations of a string nobody authored.
 */
function pushDerived(
  out: ExpectedEntry[],
  path: string[],
  seed: string,
  authored: string | undefined,
  source: ExpectedEntry['source'],
  extra?: EntryScope,
): void {
  out.push({ path, sourceValue: seed, inline: authored, source, ...extra });
}

/**
 * Record an optional authored string: seeds the skeleton when present, and
 * still records the key when absent so the coverage gate notices a bundle that
 * authors it without an inline counterpart.
 */
function pushOptional(
  out: ExpectedEntry[],
  path: string[],
  value: unknown,
  source: ExpectedEntry['source'],
  extra?: EntryScope,
): void {
  const text = inlineText(value);
  if (text === undefined) out.push({ path, source, ...extra });
  else pushEntry(out, path, text, source, extra);
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
    const literalLabel = inlineText(param.label);
    if (param.field) {
      pushOptional(out, [...base, 'label'], literalLabel, kind, { objectName });
    } else {
      pushDerived(out, [...base, 'label'], literalLabel ?? pname, literalLabel, kind, { objectName });
    }
    pushOptional(out, [...base, 'helpText'], param.helpText, kind, { objectName });
    pushOptional(out, [...base, 'placeholder'], param.placeholder, kind, { objectName });
    if (Array.isArray(param.options)) {
      for (const opt of param.options) {
        if (opt && typeof opt === 'object' && 'value' in opt && typeof opt.label === 'string') {
          pushEntry(out, [...base, 'options', String(opt.value)], opt.label, kind, { objectName });
        }
      }
    }
  }
}

/**
 * Emit `resultDialog.{title,description,acknowledge}` and
 * `resultDialog.fields.<path>` entries under an action's translation root.
 * Mirrors `ActionResultDialogTranslationSchema` in @objectstack/spec and the
 * client-side `actionResultDialog` resolver. Field entries are keyed by the
 * LITERAL result-field path (`"user.email"`) — the dot stays inside a single
 * path segment, matching how resolvers index the record without splitting.
 */
function pushActionResultDialog(
  out: ExpectedEntry[],
  actionRoot: string[],
  action: any,
  kind: ExpectedEntry['source'],
  objectName?: string,
): void {
  const dialog = action?.resultDialog;
  if (!dialog || typeof dialog !== 'object') return;
  const base = [...actionRoot, 'resultDialog'];
  pushOptional(out, [...base, 'title'], dialog.title, kind, { objectName });
  pushOptional(out, [...base, 'description'], dialog.description, kind, { objectName });
  pushOptional(out, [...base, 'acknowledge'], dialog.acknowledge, kind, { objectName });
  if (Array.isArray(dialog.fields)) {
    for (const field of dialog.fields) {
      if (!field || typeof field !== 'object') continue;
      if (typeof field.path !== 'string' || field.path.length === 0) continue;
      if (typeof field.label !== 'string' || field.label.length === 0) continue;
      pushEntry(out, [...base, 'fields', field.path], field.label, kind, { objectName });
    }
  }
}

// ─── Object sections (`objects.<o>._sections.<section>.label`) ─────────
//
// A section heading is authored in TWO independent places and rendered from
// both, so a walk that reads only one of them under-reports (#5405):
//
//   (a) the object's `fieldGroups` semantic role (ADR-0085 §5) — the fields
//       are the authority for which sections exist (a declared group nothing
//       references never renders), `fieldGroups[].label` supplies the source
//       text. Rendered by `RecordDetailView` via
//       `deriveFieldGroupDetailSections` and by `ObjectFormDesigner`, both of
//       which look the heading up as `sectionLabel(object, group.key, …)`.
//
//   (b) authored `sections[]` on a form view or inside a record page's
//       component tree, keyed by the section's own `name`. Rendered by
//       `plugin-form`'s `ObjectForm`/`ModalForm` and `plugin-detail`'s
//       `record:details`.
//
// Both resolve through the SAME convention —
// `objects.<object>._sections.<name>.label`, `useObjectLabel.sectionLabel` in
// `@object-ui/i18n` — against the `_sections` slot `ObjectTranslationDataSchema`
// declares. So one expected key per (object, section), whichever source found
// it first.
//
// A section with no `name` is deliberately skipped: every renderer guards the
// lookup on it (`s?.name ? sectionLabel(...) : s?.label`), so a nameless
// section is untranslatable by construction and demanding a bundle entry for
// it would be noise. The `_sections` schema says the same ("Each section in
// the page schema must declare a stable `name` for the lookup to fire").

/** object name → section name → source label (undefined = none authored). */
type SectionIndex = Map<string, Map<string, string | undefined>>;

/**
 * Record one (object, section) pair.
 *
 * One heading, one key — however many surfaces declare it. The first AUTHORED
 * label wins, and a later authored one upgrades an entry recorded without any
 * (a group that declares no `label` of its own, whose heading text the page
 * section carries): `inline` must report the text the reader actually sees,
 * whichever surface happens to be walked first.
 */
function addSection(index: SectionIndex, objectName: unknown, sectionName: unknown, label: unknown): void {
  if (typeof objectName !== 'string' || objectName.length === 0) return;
  if (typeof sectionName !== 'string' || sectionName.length === 0) return;
  let sections = index.get(objectName);
  if (!sections) index.set(objectName, (sections = new Map()));
  const authored = inlineText(label);
  if (!sections.has(sectionName)) sections.set(sectionName, authored);
  else if (sections.get(sectionName) === undefined && authored !== undefined) {
    sections.set(sectionName, authored);
  }
}

/** Read a `sections[]` array (form view / component props) into the index. */
function addSectionList(index: SectionIndex, sections: unknown, objectName: unknown): void {
  if (!Array.isArray(sections)) return;
  for (const section of sections) {
    if (!section || typeof section !== 'object') continue;
    const s = section as Record<string, unknown>;
    // `label` is the ONE heading spelling both surfaces declare —
    // `RecordDetailsProps.sections[]` and `FormSectionSchema` (#5611, #5730).
    // A `title` here is off-spec and deliberately unread: reading it would
    // scaffold a bundle key for a heading the schema rejects, which is how a
    // consumer-side tolerance grows into a second de-facto contract (PD #12).
    // A localized-map label (`{ en, 'zh-CN' }`) is already multilingual and
    // `inlineText` drops it to "nothing authored in plain text".
    addSection(index, objectName, s.name, s.label);
  }
}

/**
 * Emit `objects.<object>._sections.<section>.label` for every section the
 * stack renders, from both authoring surfaces.
 */
function walkObjectSections(config: any, out: ExpectedEntry[]): void {
  const index: SectionIndex = new Map();

  // (a) `fieldGroups` × field `group` membership. `deriveFieldGroupLayout` is
  //     the shared derivation the renderers themselves consume, so "which
  //     groups become sections" is decided in exactly one place: a group no
  //     visible field references, or one that is referenced but never
  //     declared, produces no heading and therefore no expected key.
  const objects: any[] = Array.isArray(config?.objects) ? config.objects : [];
  for (const obj of objects) {
    if (!obj?.name) continue;
    const derived = deriveFieldGroupLayout(obj);
    if (!derived) continue;
    // The derivation substitutes the key for a missing label; read the
    // declared label back so `inline` stays honest about what was authored.
    const declaredLabels = new Map<string, unknown>();
    for (const group of Array.isArray(obj.fieldGroups) ? obj.fieldGroups : []) {
      if (group && typeof group === 'object' && typeof group.key === 'string') {
        declaredLabels.set(group.key, group.label);
      }
    }
    for (const section of derived) {
      // The trailing ungrouped bucket carries no key — it renders without
      // chrome, so there is no heading to translate.
      if (section.key === undefined) continue;
      addSection(index, obj.name, section.key, declaredLabels.get(section.key));
    }
  }

  // (b) authored form-view sections.
  const views: any[] = Array.isArray(config?.views) ? config.views : [];
  for (const view of views) {
    const containerObject = viewObjectName(view);
    addSectionList(index, view?.sections, containerObject);
    if (view?.form && typeof view.form === 'object') {
      addSectionList(index, view.form.sections, viewObjectName(view.form) ?? containerObject);
    }
    if (view?.formViews && typeof view.formViews === 'object') {
      for (const form of Object.values<any>(view.formViews)) {
        if (!form || typeof form !== 'object') continue;
        addSectionList(index, form.sections, viewObjectName(form) ?? containerObject);
      }
    }
  }

  // (b) authored page sections — a record page's `record:details`.
  //
  // Reuses `@objectstack/lint`'s shared page traversal rather than growing a
  // private copy. That walk exists precisely because duplicating it produced a
  // dead rule once already (#3583): components hang off `regions[].components`
  // AND `slots.<slot>` (which may be a bare component, not an array), sub-trees
  // live inside the untyped `properties` bag (`page:tabs` →
  // `properties.items[].children`, `page:card` → `properties.body`/`.footer`),
  // and source-authored pages (`kind: 'html' | 'react' | 'jsx'`) hold only a
  // DERIVED region cache that the author never wrote — scaffolding translation
  // keys off that cache would invent an authoring surface.
  //
  // It also resolves each component's OWN binding
  // (`dataSource.object` → `properties.object` → the page's `object`), which a
  // page-level-only binding would get wrong rather than merely miss: a
  // `record:details` retargeted at another object would key its headings under
  // the page's object, and no bundle entry there would ever resolve.
  const pages: any[] = Array.isArray(config?.pages) ? config.pages : [];
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    if (!page || typeof page !== 'object') continue;
    for (const walked of walkPageComponents(page, `pages[${pi}]`)) {
      if (!walked.objectName) continue;
      const props = walked.component.properties;
      if (!props || typeof props !== 'object' || Array.isArray(props)) continue;
      addSectionList(index, (props as Record<string, unknown>).sections, walked.objectName);
    }
  }

  for (const [objectName, sections] of index) {
    for (const [sectionName, label] of sections) {
      pushDerived(
        out,
        ['objects', objectName, '_sections', sectionName, 'label'],
        // Seed mirrors the renderer's own fallback (`s.label || s.name`).
        label ?? sectionName,
        label,
        'section',
        { objectName },
      );
    }
  }
}

// ─── Object filter-preset tabs (`objects.<o>._tabs.<tab>.label`) ───────
//
// The writing half of the `_tabs` slot `ObjectTranslationDataSchema` declares
// and `resolveTabLabel` reads (#5377). Declared, written and read in one PR,
// which is the whole point: a slot with no extractor is a key a translator has
// to know exists, and that is most of why the tab bar stayed English.
//
// Scope matches the resolver exactly — a list page's
// `interfaceConfig.userFilters.tabs`, the one `ViewTabSchema` carrier anything
// renders. `ListViewSchema.tabs` has no reader in either repo; scaffolding keys
// for it would fill every bundle with entries no screen can ever show, and the
// coverage gate would then demand translations for them.
//
// A tab that references a saved view still gets its own entry. The resolver
// falls back to the referenced view's label when `_tabs` is empty, so the key
// is genuinely optional — but it is the only way to give a tab a label that
// DIFFERS from the view it opens, and a skeleton that omitted it would hide
// that from the translator.

/** Emit `objects.<object>._tabs.<tab>.label` for every rendered preset tab. */
function walkObjectTabs(config: any, out: ExpectedEntry[]): void {
  const pages: any[] = Array.isArray(config?.pages) ? config.pages : [];
  // One tab name may be authored on several pages over the same object (a
  // shared "urgent" preset); collect first so the key is emitted once, the
  // same way `walkObjectSections` de-duplicates a heading.
  const index = new Map<string, Map<string, string | undefined>>();

  for (const page of pages) {
    if (!page || typeof page !== 'object') continue;
    const cfg = page.interfaceConfig;
    const tabs = cfg?.userFilters?.tabs;
    if (!Array.isArray(tabs)) continue;
    // The page's own source binding first, then its record binding — the order
    // `translatePage` resolves the object in.
    const objectName = inlineText(cfg?.source) ?? inlineText(page.object);
    if (objectName === undefined) continue;

    let tabsForObject = index.get(objectName);
    if (!tabsForObject) index.set(objectName, (tabsForObject = new Map()));

    for (const tab of tabs) {
      if (!tab || typeof tab !== 'object') continue;
      const tabName = inlineText(tab.name);
      if (tabName === undefined) continue;
      // A localized-map label is already multilingual — `inlineText` drops it,
      // so the entry is emitted with no seed and coverage does not demand a
      // translation for a string nobody authored in plain text.
      const authored = inlineText(tab.label);
      if (!tabsForObject.has(tabName)) tabsForObject.set(tabName, authored);
      else if (tabsForObject.get(tabName) === undefined && authored !== undefined) {
        tabsForObject.set(tabName, authored);
      }
    }
  }

  for (const [objectName, tabs] of index) {
    for (const [tabName, label] of tabs) {
      pushDerived(
        out,
        ['objects', objectName, '_tabs', tabName, 'label'],
        // Seed mirrors the renderer's own fallback (`tab.label || tab.name`).
        label ?? tabName,
        label,
        'view',
        { objectName },
      );
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

    pushDerived(out, ['objects', objectName, 'label'], obj.label ?? objectName, inlineText(obj.label), 'object', { objectName });
    pushOptional(out, ['objects', objectName, 'pluralLabel'], obj.pluralLabel, 'object', { objectName });
    pushOptional(out, ['objects', objectName, 'description'], obj.description, 'object', { objectName });

    // Fields (always a record on normalized schemas)
    if (obj.fields && typeof obj.fields === 'object') {
      for (const [fieldName, raw] of Object.entries<any>(obj.fields)) {
        const field = raw ?? {};
        pushDerived(
          out,
          ['objects', objectName, 'fields', fieldName, 'label'],
          field.label ?? fieldName,
          inlineText(field.label),
          'field',
          { objectName },
        );

        pushOptional(out, ['objects', objectName, 'fields', fieldName, 'help'], field.help ?? field.description, 'field', { objectName });
        pushOptional(out, ['objects', objectName, 'fields', fieldName, 'placeholder'], field.placeholder, 'field', { objectName });

        // Options — accept either `{value, label}[]` arrays or a record map.
        //
        // An option whose label is absent — or byte-equal to its own machine
        // value, which is what `Field.select(['pending'])` normalizes a bare
        // string into — is seeded from the value but recorded as DERIVED
        // (#8543): the seed keeps the skeleton usable, while `inline` stays
        // unset so the coverage gate never demands a translation of a machine
        // identifier, and nothing downstream mistakes the copied value for
        // deliberately-authored display text. Authored English for a select
        // belongs on the option (or in the contract beside the vocabulary —
        // see `APPROVAL_STATUS_LABELS` in @objectstack/spec/contracts), where
        // this walk sees it as a real label.
        const pushOption = (value: string, label: unknown): void => {
          const path = ['objects', objectName, 'fields', fieldName, 'options', value];
          const authored = inlineText(label);
          if (authored !== undefined && authored !== value) {
            pushEntry(out, path, authored, 'option', { objectName });
          } else {
            pushDerived(out, path, value, undefined, 'option', { objectName });
          }
        };
        const opts = field.options;
        if (Array.isArray(opts)) {
          for (const opt of opts) {
            if (opt && typeof opt === 'object' && 'value' in opt) {
              pushOption(String(opt.value), opt.label);
            } else if (typeof opt === 'string') {
              pushOption(opt, undefined);
            }
          }
        } else if (opts && typeof opts === 'object') {
          for (const [value, label] of Object.entries<any>(opts)) {
            pushOption(value, label);
          }
        }
      }
    }

    // Object-nested listViews (object-protocol view bundle).
    if (obj.listViews && typeof obj.listViews === 'object') {
      for (const [viewName, raw] of Object.entries<any>(obj.listViews)) {
        pushViewEntries(out, objectName, viewName, raw ?? {});
      }
    }

    // Inline object-level actions (some schemas declare them on the object).
    if (Array.isArray(obj.actions)) {
      for (const action of obj.actions) {
        if (!action?.name) continue;
        const aname = action.name as string;
        const aroot = ['objects', objectName, '_actions', aname];
        pushDerived(out, [...aroot, 'label'], action.label ?? aname, inlineText(action.label), 'action', { objectName });
        pushOptional(out, [...aroot, 'description'], action.description, 'action', { objectName });
        pushOptional(out, [...aroot, 'confirmText'], action.confirmText, 'action', { objectName });
        pushOptional(out, [...aroot, 'successMessage'], action.successMessage, 'action', { objectName });
        pushActionParams(out, ['objects', objectName, '_actions', aname], action, 'action', objectName);
        pushActionResultDialog(out, ['objects', objectName, '_actions', aname], action, 'action', objectName);
      }
    }
  }

  // ── Top-level views ──────────────────────────────────────────────
  // Two shapes reach `config.views`, and only one of them has a `name`:
  //
  //   1. An independent ViewItem — carries a top-level `name` and binds to its
  //      object via `object`.
  //
  //   2. The aggregated View CONTAINER `defineView()` emits:
  //      `{ list, listViews, formViews }`. Per spec (`view.zod.ts`) it has NO
  //      top-level `name` — it is keyed implicitly by its target object, which
  //      lives at `list.data.object` (objectql's `resolveMetadataItemName`
  //      says the same).
  //
  // Guarding the loop on `view.name` therefore skipped every container, and a
  // container is what `defineView()` — i.e. every example and every app that
  // authors views this way — actually produces. Objects do not carry
  // `listViews` once compiled either, so BOTH view branches were dead and
  // `i18n/missing-view` had zero producers repo-wide while the ratchet
  // reported green (#4123).
  //
  // `formViews` stays uncovered: form views have no counterpart in the
  // `viewLabel` / `_views.*` resolver convention, so emitting keys for them
  // would expect translations nothing reads.
  const views: any[] = Array.isArray(config?.views) ? config.views : [];
  for (const view of views) {
    const containerObject = viewObjectName(view);
    if (!containerObject) continue;

    if (view.name) {
      pushViewEntries(out, containerObject, view.name, view);
      continue;
    }

    // The container's default list, keyed exactly as the runtime registry keys
    // it — see `defaultListViewKey`. `undefined` means the container declares
    // no default list; a key the container's own `listViews` also declares
    // means the composer collapsed the two, and the loop below emits it.
    if (view.list && typeof view.list === 'object') {
      const key = defaultListViewKey(containerObject, view);
      const collapsedIntoListViews =
        key !== undefined
        && view.listViews
        && typeof view.listViews === 'object'
        && Object.prototype.hasOwnProperty.call(view.listViews, key);
      if (key !== undefined && !collapsedIntoListViews) {
        pushViewEntries(out, viewObjectName(view.list) ?? containerObject, key, view.list);
      }
    }
    if (view.listViews && typeof view.listViews === 'object') {
      for (const [viewName, raw] of Object.entries<any>(view.listViews)) {
        // A named list view may retarget another object via its own `data`.
        pushViewEntries(out, viewObjectName(raw) ?? containerObject, viewName, raw ?? {});
      }
    }
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
    pushDerived(out, [...root, 'label'], action.label ?? action.name, inlineText(action.label), kind, { objectName });
    // `description` is OPTIONAL-not-derived, exactly like confirmText: the
    // param dialog falls back to its own generic `actionDialog.description`
    // string when the action declares none, so an undeclared description is
    // not an i18n gap to seed (`pushDerived` would invent an English source
    // string nothing authored). #7367.
    pushOptional(out, [...root, 'description'], action.description, kind, { objectName });
    pushOptional(out, [...root, 'confirmText'], action.confirmText, kind, { objectName });
    pushOptional(out, [...root, 'successMessage'], action.successMessage, kind, { objectName });
    pushActionParams(out, root, action, kind, objectName);
    pushActionResultDialog(out, root, action, kind, objectName);
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

  // ── Pages + their `page:header` copy ──────────────────────────────
  const pages: any[] = Array.isArray(config?.pages) ? config.pages : [];
  for (const page of pages) {
    if (!page?.name) continue;
    const name = page.name as string;
    if (page.label) pushEntry(out, ['pages', name, 'label'], page.label, 'page');
    if (page.description) {
      pushEntry(out, ['pages', name, 'description'], page.description, 'page');
    }
    // Header copy is authored inside the page's `page:header` component but
    // is addressed by page name — `translatePage` overlays it back onto every
    // header in the page's regions.
    const regions: any[] = Array.isArray(page.regions) ? page.regions : [];
    for (const region of regions) {
      const components: any[] = Array.isArray(region?.components) ? region.components : [];
      for (const component of components) {
        if (component?.type !== 'page:header') continue;
        const props = component.properties ?? {};
        // `title` duplicating `label` is the common case and resolves via the
        // label fallback — only emit it when the two genuinely differ.
        if (typeof props.title === 'string' && props.title && props.title !== page.label) {
          pushEntry(out, ['pages', name, 'title'], props.title, 'page');
        }
        if (typeof props.subtitle === 'string' && props.subtitle) {
          pushEntry(out, ['pages', name, 'subtitle'], props.subtitle, 'page');
        }
      }
    }

    // Per-component copy, addressed by the component's own id (#6080). Without
    // this pass the face exists but nothing writes the skeleton, so a
    // translator would have to know the keys to hand-write them — which is
    // most of the reason the copy went untranslated in the first place.
    //
    // `page:header` is deliberately skipped: its copy is addressed by page
    // name above, and emitting it here too would offer one string under two
    // keys.
    for (const region of regions) {
      const components: any[] = Array.isArray(region?.components) ? region.components : [];
      for (const component of components) {
        if (component?.type === 'page:header') continue;
        const id = component?.id;
        if (typeof id !== 'string' || !id) continue;
        const props = component.properties ?? {};
        for (const key of PAGE_COMPONENT_COPY_KEYS) {
          // `label` may be authored on the component itself or in its props —
          // the same either/or `translatePage` resolves back onto.
          const value = key === 'label' && typeof component.label === 'string' && component.label
            ? component.label
            : props[key];
          if (typeof value === 'string' && value) {
            pushEntry(out, ['pages', name, 'components', id, key], value, 'page');
          }
        }
      }
    }
  }

  // ── Object sections (fieldGroups + authored form/page sections) ───
  // Deliberately a pass of its own: the two authoring surfaces live in
  // `objects`, `views` and `pages`, and one section may be declared by more
  // than one of them — collecting first and emitting once keeps a heading
  // from being counted twice against coverage.
  walkObjectSections(config, out);

  // ── Object filter-preset tabs (`objects.<o>._tabs.<tab>.label`) ───
  walkObjectTabs(config, out);

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
    pushOptional(out, ['metadataForms', type, 'description'], (entry as any).description, 'metadataType', { metadataType: type });
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
      if (sectionName) {
        pushOptional(out, ['metadataForms', type, 'sections', sectionName, 'label'], section.label, 'metadataFormSection', { metadataType: type });
        pushOptional(out, ['metadataForms', type, 'sections', sectionName, 'description'], section.description, 'metadataFormSection', { metadataType: type });
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
    // A form field that omits `label` is still labelled on screen — the
    // renderer humanizes its path ("name" → "Name"). That derived text IS the
    // source string, so other locales genuinely owe it a translation.
    pushEntry(out, ['metadataForms', type, 'fields', path, 'label'], inlineText(field.label) ?? humanizeFieldPath(path), 'metadataFormField', { metadataType: type });
    pushOptional(out, ['metadataForms', type, 'fields', path, 'helpText'], field.helpText, 'metadataFormField', { metadataType: type });
    pushOptional(out, ['metadataForms', type, 'fields', path, 'placeholder'], field.placeholder, 'metadataFormField', { metadataType: type });
  }
  if (Array.isArray(field.fields)) {
    for (const child of field.fields) walkFormField(child, type, path, out);
  }
}

/** Match the metadata form renderer's fallback label for fields without an explicit label. */
export function humanizeFieldPath(path: string): string {
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

  // Seed-less entries exist only so the coverage gate can spot a bundle that
  // authors a key the metadata never writes inline — there is nothing to
  // scaffold from, so they never reach a generated skeleton.
  const allEntries = collectExpectedEntries(config).filter((e) => e.sourceValue !== undefined);
  const entries = allEntries.filter((e) => passesFilter(e, opts.filter));

  const existingBundles: TranslationBundle[] = Array.isArray(config?.translations) ? config.translations : [];
  const existing = mergeBundles(existingBundles);

  const bundles: Record<string, TranslationData> = {};
  const counts: Record<string, number> = {};

  for (const locale of locales) {
    const data: TranslationData = {};
    let count = 0;
    for (const entry of entries) {
      // Guaranteed by the seed-less filter above; narrows for the branches below.
      const seed = entry.sourceValue ?? '';
      let value: string | undefined;
      // If a translation already exists for this locale, carry it through
      // verbatim so the generated file remains a complete, self-contained
      // bundle (not just the missing-key delta). Set --no-merge to skip
      // baselines entirely.
      //
      // The default locale is deliberately NOT merged (#8543): it is a copy of
      // the source, not a translation, so "never overwrite an existing entry"
      // protects the wrong thing there — an author edits a field description,
      // the regeneration keeps the stale entry, and the served text drifts from
      // the source silently while the drift gate reports OK (measured at 53
      // stale entries across 6 packages when this branch ran for every locale).
      // The seed IS the source text for the default locale (line below), so it
      // always wins; translated locales keep merge semantics exactly as before.
      if (opts.mergeExisting !== false && locale !== defaultLocale) {
        const existingValue = lookupDeep(existing[locale], entry.path);
        if (existingValue !== undefined && existingValue !== '') {
          value = String(existingValue);
        }
      }
      if (value === undefined) {
        if (locale === defaultLocale) {
          value = seed;
        } else if (fill === 'default') {
          value = seed;
        } else if (fill === 'todo') {
          value = `[TODO] ${seed}`;
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
