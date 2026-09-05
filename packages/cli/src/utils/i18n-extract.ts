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
 * Three axes per entry, and they are not the same question:
 *   `sourceValue`   — what extract seeds the skeleton with; may be a derived
 *                     fallback (an object's own name, a humanized field path).
 *   `inline`        — what the reader actually sees in the source locale;
 *                     drives the coverage gate, so a string nobody authored is
 *                     never reported as an untranslated one.
 *   `inlineLocales` — the inline LOCALE MAP the author wrote at this prop, if
 *                     they wrote one; authored text that no bundle row can be
 *                     scaffolded from. See the note below.
 *
 * ## Inline locale maps are NOT extracted — and are not "unauthored" either
 *
 * `I18nLabelSchema` authorizes two forms of a display label: a plain string,
 * whose translations live in a bundle under the key this walk emits, and an
 * inline locale map — `{ en: 'Members', 'zh-CN': '成员' }` — which the author
 * writes out in place and the renderer picks from (`pickLocalized` /
 * `resolveI18nLabel`). Rulings #5728, #10926 and #14412 make the map the ONE
 * localisation route for the props that have no bundle key at all
 * (`element:text`'s `content` among them), so a page localised that way is
 * fully localised.
 *
 * **The map stays out of the bundle.** Nothing here scaffolds a row for it, no
 * key family is added for one, and ⛔ no key is synthesised from a node's
 * position in the component tree — an array index promoted to a bundle key
 * turns reordering two sibling components into a silent, all-green swap of
 * their translations, and `page:accordion` already delivers index identity as
 * a contract (`component.zod.ts`, `panel-INDEX`). Maintainer ruling
 * 2026-09-03 (#14749, Q3 = C3) settles that as a refusal, and records the
 * direction if inline maps are ever to be extracted: **identity first** —
 * `component.id` / `section.name` / `tabs item.value` made mandatory and
 * gate-enforced, then the existing `pages.<page>.components.<id>.<key>` family
 * reused. ⛔ Never array-index keys.
 *
 * **What the map does get is an honest coverage record** (#14749, Q2 = B1).
 * The key this walk emits for the prop already exists; what was missing was
 * evidence that the author had written anything at it. `inlineText` narrows a
 * map to `undefined` — the same value an absent prop produces — so the two
 * arrived here indistinguishable, and a prop written out in four languages was
 * recorded exactly like one nobody had written. `inlineLocales` is that third
 * axis: it says the prop IS authored and in which locales, so the gate can
 * count the locales present as covered and the absent ones as gaps, with no
 * bundle row and no new key. ⛔ Do not re-narrow an authored value with
 * `inlineText` before handing it to a `push*` helper — that is precisely how
 * the map used to be lost.
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
 *   objects.<name>._views.<view>.bulkActions.<def>.label / .confirmText
 *                                                       / .confirmLabel
 *   objects.<name>._views.<view>.bulkActions.<def>.params.<param>.label
 *                                                       / .help / .placeholder
 *     ^ a bulk param spells its hint `help`; an ACTION param spells the same
 *       idea `helpText` (`ui/bulk-action.zod.ts`'s known divergence)
 *   objects.<name>._validations.<rule>.message
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
 *   datasets.<dataset>.label / .description
 *   datasets.<dataset>.dimensions.<dim>.label
 *   datasets.<dataset>.measures.<measure>.label
 *   pages.<page>.label / .description
 *   pages.<page>.title / .subtitle   (from the page's `page:header` component)
 *   pages.<page>.components.<id>.<key>  (per-component copy, #6080)
 *   flows.<flow>.label
 *   flows.<flow>.screens.<node_id>.title                       (#7646 / #11287)
 *   flows.<flow>.screens.<node_id>.fields.<field>.label
 *   flows.<flow>.screens.<node_id>.fields.<field>.placeholder
 *     ^ gated: `flows` is `planned` + `authorWarn` in the liveness ledger, so
 *       these are walked only once the row goes `live` (#11624 — see
 *       `authorWarnedTranslationGroups`)
 *   metadataForms.<type>.label / .description
 *   metadataForms.<type>.sections.<section>.label / .description
 *   metadataForms.<type>.fields.<dotPath>.label / .helpText / .placeholder
 *
 * The `metadataForms.*` surface is registry-driven (sourced from
 * `METADATA_FORM_REGISTRY` + `DEFAULT_METADATA_TYPE_REGISTRY` in
 * `@objectstack/spec`) — it is included unconditionally, independent of
 * the supplied stack config.
 *
 * Pure given its inputs: no network, and the only filesystem read is the
 * shipped liveness ledger behind {@link authorWarnedTranslationGroups} —
 * injectable as `warnedGroups`, so the walk itself stays a pure function of
 * `config`. Safe to call from the CLI, IDE tooling and unit tests.
 */

import type { TranslationBundle, TranslationData } from '@objectstack/spec/system';
import {
  METADATA_FORM_REGISTRY,
  PAGE_COMPONENT_COPY_KEYS,
  FLOW_SCREEN_COPY_KEYS,
  FLOW_SCREEN_FIELD_COPY_KEYS,
  walkAddressedPageComponents,
} from '@objectstack/spec/system';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { deriveFieldGroupLayout } from '@objectstack/spec/data';
import { expandViewContainer, InlineLocaleMapSchema } from '@objectstack/spec/ui';
import { authorWarnedProperties, walkPageComponents } from '@objectstack/lint';
import { collectFilledFromHashes } from '@objectstack/platform-objects/apps';

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
  /**
   * The **inline locale map** the author wrote at this prop, verbatim
   * (`{ en: 'Members', 'zh-CN': '成员' }`) — the second form
   * `I18nLabelSchema` authorizes, kept as a third axis beside
   * {@link sourceValue} and {@link inline} because it answers a question
   * neither of those can (#14749, maintainer ruling 2026-09-03, Q2 = B1).
   *
   * `inline` is a *plain-string* reading: `inlineText` narrows a map away to
   * `undefined`, which is the same value an absent prop produces. That made
   * one diagnostic carry two opposite facts — a label written out in four
   * languages and a label nobody wrote were recorded identically, and the
   * coverage gate reported the first as if it were the second.
   *
   * Set ⇒ the prop **is** authored, and the map says in which locales. Unset
   * ⇒ nothing (or nothing map-shaped) is there. `sourceValue` stays
   * `undefined` for a map-only entry on purpose: this is a *coverage* record,
   * not a bundle row — see the "inline maps are not extracted" note in the
   * module header.
   *
   * Only non-empty string values survive here, and only if
   * `InlineLocaleMapSchema` accepts the object: the schema's own key
   * refinement is the authority on what a locale tag is, so the retired
   * `{ key, defaultValue }` key-reference dialect it rejects is not laundered
   * into "authored" by this walk either.
   */
  inlineLocales?: Readonly<Record<string, string>>;
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
    | 'dataset'
    | 'page'
    | 'flow'
    | 'metadataType'
    | 'metadataFormSection'
    | 'metadataFormField';
  /** Object name when applicable (for `--filter` matching). */
  objectName?: string;
  /** App name when applicable (for `--filter` matching). */
  appName?: string;
  /** Metadata type name when applicable (for `--filter` matching). */
  metadataType?: string;
  /** Flow name when applicable (for `--filter` matching). */
  flowName?: string;
}

export type FillStrategy = 'empty' | 'default' | 'todo';

export interface ExtractOptions extends ExpectedEntryOptions {
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
  /**
   * The `<locale>.source-hashes.generated.ts` tables already committed beside
   * the bundles, keyed by locale.
   *
   * This is the mechanism's ONLY memory (#11671 / #12069 Option A): a leaf that
   * is a byte copy of a source revision keeps its record across runs, which is
   * what makes the drift detectable after the source moves. Passing nothing
   * makes the run behave like a first extract — every record is re-derived from
   * the tree, so leaves that already drifted stay legacy-trusted rather than
   * being reported.
   */
  previousSourceHashes?: Record<string, Record<string, string>>;
}

export interface ExtractResult {
  /** Locale → TranslationData skeleton (only the entries we emitted). */
  bundles: Record<string, TranslationData>;
  /** Locale → number of keys emitted. */
  counts: Record<string, number>;
  /** Total expected entries before per-locale merge filtering. */
  totalExpected: number;
  /**
   * Per translated locale, the digest of the source revision each GENERATED
   * leaf is still a byte copy of — the content of
   * `<locale>.source-hashes.generated.ts`.
   *
   * Computed by `collectFilledFromHashes` in
   * `@objectstack/platform-objects/apps`, the module maintainer ruling #8765
   * Option B put the mechanism in; the extractor supplies the tree and the
   * previous records and owns none of the rule. The default locale gets no
   * entry: it is the source, not a copy of one.
   */
  sourceHashes: Record<string, Record<string, string>>;
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
  pushDerived(out, [...root, 'label'], inlineText(view?.label) ?? viewName, view?.label, 'view', { objectName });
  pushOptional(out, [...root, 'description'], view?.description, 'view', { objectName });
  pushViewEmptyState(out, root, view, objectName);
  pushBulkActionDefs(out, root, view, objectName);
}

/**
 * Emit `_views.<view>.bulkActions.<def>.*` for a list view's authored
 * `bulkActionDefs[]` (#14253's resolver, #14376's walk).
 *
 * **Why this hangs off the VIEW and not the action pass.** A `bulkActionDefs`
 * entry is authored inside the view and is not an action document, so it never
 * reaches `translateAction` and no other pass here would ever see it. That is
 * the same reason `translateView` — not `translateAction` — is where the
 * resolver overlays it, and the reason `ObjectTranslationDataSchema` puts the
 * group under `_views.<view>` rather than beside `_actions`.
 *
 * **The view key is the caller's, deliberately.** `translateBulkActionDefs` is
 * called by `translateView` with `viewTranslationKey(view, objectName)` — the
 * bare `_views` key — so emitting under the same `root` this function already
 * built for `label` / `description` keeps the two halves keyed by construction
 * rather than by a second derivation (the #5164 lesson one surface over).
 *
 * **Read from the AUTHORED address.** The resolver reads
 * `config.bulkActionDefs` because a SERVED `ViewItem` nests the whole
 * `ListViewSchema` under `config`; this walker is handed the authored stack
 * config, where the defs sit on the list view itself — the same authored
 * addresses the rest of this file reads (`view.list.data.object`,
 * `obj.listViews`). Accepting the served spelling here as well would be a
 * tolerant alias for a shape this walk is never given.
 *
 * Three deliberate exclusions, each measured against `BulkActionDefSchema`
 * rather than mirrored from the report:
 *
 *   - `successMessage` — a def declares none (the run reports a per-record
 *     outcome summary the console words from its own catalog);
 *   - `description` — a def declares none either; the sentence above the
 *     affected-record summary IS `confirmText`;
 *   - per-param `options` — `BulkActionParamTranslationSchema` carries
 *     `guidance` against them instead of a key, so scaffolding them would
 *     write keys `.strict()` then rejects.
 *
 * ⚠️ `help`, not `helpText`. A bulk param spells its hint `help`
 * (`BulkActionParamSchema.help`) where an ACTION param spells it `helpText` —
 * the known divergence `ui/bulk-action.zod.ts` names, and the one spelling the
 * translation face declares.
 */
function pushBulkActionDefs(out: ExpectedEntry[], viewRoot: string[], view: any, objectName: string): void {
  const defs = view?.bulkActionDefs;
  if (!Array.isArray(defs)) return;
  for (const def of defs) {
    if (!def || typeof def !== 'object') continue;
    const defName = def.name;
    if (typeof defName !== 'string' || defName.length === 0) continue;
    const base = [...viewRoot, 'bulkActions', defName];
    // The selection bar renders `def.label ?? formatActionLabel(def.name)`
    // (objectui `BulkActionBar.tsx`), so the humanized name is what a reader
    // actually sees when the author omitted a label — a usable seed, with
    // `inline` left unset so coverage never demands a translation of a string
    // nobody wrote.
    const authoredLabel = inlineText(def.label);
    pushDerived(out, [...base, 'label'], authoredLabel ?? humanizeFieldPath(defName), def.label, 'view', { objectName });
    pushOptional(out, [...base, 'confirmText'], def.confirmText, 'view', { objectName });
    pushOptional(out, [...base, 'confirmLabel'], def.confirmLabel, 'view', { objectName });
    if (!Array.isArray(def.params)) continue;
    for (const param of def.params) {
      if (!param || typeof param !== 'object') continue;
      const pname = param.name;
      if (typeof pname !== 'string' || pname.length === 0) continue;
      const pbase = [...base, 'params', pname];
      // The dialog renders `param.label ?? param.name` — the bare name, the
      // same fallback `pushActionParams` seeds an inline action param from.
      const literalLabel = inlineText(param.label);
      pushDerived(out, [...pbase, 'label'], literalLabel ?? pname, param.label, 'view', { objectName });
      pushOptional(out, [...pbase, 'help'], param.help, 'view', { objectName });
      pushOptional(out, [...pbase, 'placeholder'], param.placeholder, 'view', { objectName });
    }
  }
}

/**
 * Emit `_views.<view>.emptyState.{title,message}` entries when the view
 * declares empty-state copy. Mirrors the client-side resolver convention
 * (`viewEmptyState` in @object-ui/i18n) and `ObjectTranslationDataSchema`.
 */
function pushViewEmptyState(out: ExpectedEntry[], viewPath: string[], view: any, objectName: string): void {
  const emptyState = view?.emptyState;
  if (!emptyState || typeof emptyState !== 'object') return;
  // No `typeof === 'string'` pre-filter: `pushEntry` is the one place that
  // decides what counts as authored, and it accepts BOTH authorized forms of
  // an `I18nLabel`. A guard here would re-narrow the map away (#14749).
  pushEntry(out, [...viewPath, 'emptyState', 'title'], emptyState.title, 'view', { objectName });
  pushEntry(out, [...viewPath, 'emptyState', 'message'], emptyState.message, 'view', { objectName });
}

type EntryScope = Pick<ExpectedEntry, 'objectName' | 'appName' | 'metadataType' | 'flowName'>;

/** Narrow to a usable source string; an empty string is not authored text. */
function inlineText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Narrow to the **inline locale map** form of an `I18nLabel`, or `undefined`.
 *
 * ⛔ Deliberately not a hand-written "looks like a locale map" test. The one
 * definition of that shape is `InlineLocaleMapSchema` in
 * `spec/src/ui/i18n.zod.ts`, whose key refinement is doing real work: it
 * rejects the retired `{ key, defaultValue }` key-reference dialect BY NAME,
 * because a map keyed that way reaches both resolvers' last-resort limb and
 * renders the raw i18n key on screen (#5055 / #9925 / #10492). A second
 * predicate here would be a second contract — the failure Prime Directive #12
 * describes — and the one that drifted would be this one, silently promoting a
 * shape the schema refuses into "authored".
 *
 * Two narrowings on top of a clean parse, both matching how this file already
 * counts on the *bundle* side (`lookupKey` in `i18n-coverage.ts`):
 *
 *  - an empty-string value is not a translation, so those entries are dropped;
 *  - a map left with no entries is not authored text, so it answers
 *    `undefined` rather than an empty record — `{}` parses fine, and reporting
 *    it as "authored in zero locales" would invent an authoring act.
 */
function inlineLocaleMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (!InlineLocaleMapSchema.safeParse(value).success) return undefined;
  const map: Record<string, string> = {};
  for (const [tag, text] of Object.entries(value as Record<string, unknown>)) {
    if (typeof text === 'string' && text.length > 0) map[tag] = text;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

/**
 * The evidence an authored value carries, read once so that every `push*`
 * helper below files a locale map the same way. `authored` is the RAW prop —
 * ⛔ never pre-narrowed with `inlineText` at the call site, which is precisely
 * how a written map used to arrive here already flattened to `undefined`.
 */
function authoredEvidence(authored: unknown): Pick<ExpectedEntry, 'inline' | 'inlineLocales'> {
  const inline = inlineText(authored);
  if (inline !== undefined) return { inline };
  const inlineLocales = inlineLocaleMap(authored);
  return inlineLocales ? { inlineLocales } : {};
}

/**
 * Record a key whose displayed text *is* its seed — the common case, where the
 * author wrote the literal we scaffold from.
 *
 * A value in the inline-map form is recorded as **authored, with no seed**: it
 * is already multilingual, so there is nothing for `os i18n extract` to
 * scaffold (`sourceValue` unset ⇒ no bundle row), while `inlineLocales` tells
 * the coverage gate which locales the author actually wrote.
 */
function pushEntry(
  out: ExpectedEntry[],
  path: string[],
  sourceValue: unknown,
  source: ExpectedEntry['source'],
  extra?: EntryScope,
): void {
  if (typeof sourceValue === 'string') {
    out.push({ path, sourceValue, inline: sourceValue, source, ...extra });
    return;
  }
  const inlineLocales = inlineLocaleMap(sourceValue);
  if (inlineLocales) out.push({ path, inlineLocales, source, ...extra });
}

/**
 * Record a key whose seed is *derived* — an object's own name standing in for a
 * missing label, a param's machine name rendered as its caption. The seed keeps
 * the extracted skeleton usable, but `inline` stays unset so the coverage gate
 * does not demand translations of a string nobody authored.
 *
 * `authored` is the raw prop, not a pre-narrowed string: a derived seed and an
 * inline locale map co-exist (the map is what a reader sees; the seed is what
 * a skeleton would show), and only the raw value can tell the two apart from
 * "the author wrote nothing".
 */
function pushDerived(
  out: ExpectedEntry[],
  path: string[],
  seed: string,
  authored: unknown,
  source: ExpectedEntry['source'],
  extra?: EntryScope,
): void {
  out.push({ path, sourceValue: seed, ...authoredEvidence(authored), source, ...extra });
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
  const evidence = authoredEvidence(value);
  if (evidence.inline !== undefined) pushEntry(out, path, evidence.inline, source, extra);
  else out.push({ path, ...evidence, source, ...extra });
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
      pushOptional(out, [...base, 'label'], param.label, kind, { objectName });
    } else {
      pushDerived(out, [...base, 'label'], literalLabel ?? pname, param.label, kind, { objectName });
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
      pushEntry(out, [...base, 'fields', field.path], field.label, kind, { objectName });
    }
  }
}

/**
 * How deep a `conditional` chain is followed. `ValidationRuleSchema` is
 * recursive with no declared bound, and this walker is handed hand-authored
 * TypeScript — a shared branch object appearing under its own ancestor would
 * otherwise loop forever. Real nesting is two or three deep (the schema's own
 * worked examples stop at two).
 */
const MAX_VALIDATION_DEPTH = 10;

/**
 * Emit `objects.<object>._validations.<rule>.message` for an object's custom
 * validation rules (#14253's resolver, #14376's walk).
 *
 * `object.validations[].message` is the sentence a rejected write returns, and
 * the ObjectQL rule evaluator now resolves it through the engine's existing
 * `i18nService` channel at exactly this address
 * (`objectValidationMessageKey`, `spec/system/i18n-resolver.ts`). Without this
 * pass the address has a reader and a schema slot but nothing writes the
 * skeleton, so a deployment gets platform-generated refusals in the caller's
 * language and author-written ones in the source language, side by side in one
 * error envelope.
 *
 * **A `conditional` wrapper contributes no key of its own.** `checkConditional`
 * evaluates `when` and then returns `evaluateRule(branch, …)` — the BRANCH
 * supplies the violation, so the wrapper's own `message` never reaches a user.
 * Scaffolding it would offer a translator a string no rejected write can ever
 * show. The branches carry their own `name` and are addressed by it, which is
 * what both the resolver's JSDoc and `_validations`' schema note state.
 *
 * **`active: false` is not a reason to skip a rule.** It is a toggle on a
 * surface that exists, not the absence of one, and no other family in this
 * walker consults a runtime toggle — this walk reports what a config
 * DECLARES. Flipping the toggle back on must not silently owe a translation.
 */
function pushValidationMessages(
  out: ExpectedEntry[],
  objectName: string,
  rules: unknown,
  depth: number,
): void {
  if (!Array.isArray(rules) || depth >= MAX_VALIDATION_DEPTH) return;
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue;
    const ruleName = (rule as any).name;
    if (typeof ruleName !== 'string' || ruleName.length === 0) continue;
    if ((rule as any).type === 'conditional') {
      pushValidationMessages(out, objectName, [(rule as any).then, (rule as any).otherwise], depth + 1);
      continue;
    }
    pushEntry(
      out,
      ['objects', objectName, '_validations', ruleName, 'message'],
      (rule as any).message,
      'object',
      { objectName },
    );
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

/**
 * object name → section name → the authored label, RAW (undefined = none
 * authored). Raw rather than narrowed to a string because an inline locale map
 * is authored text too, and narrowing it here would erase that fact before the
 * entry is ever built — the #14749 defect, one layer up from `pushDerived`.
 */
type SectionIndex = Map<string, Map<string, AuthoredLabel>>;

/** Either authorized form of an `I18nLabel`, or nothing authored at all. */
type AuthoredLabel = string | Record<string, unknown> | undefined;

/** Is this value authored text in either authorized form? */
function isAuthored(label: unknown): boolean {
  return inlineText(label) !== undefined || inlineLocaleMap(label) !== undefined;
}

/** Narrow an arbitrary value to {@link AuthoredLabel} — anything else is nothing. */
function asAuthoredLabel(label: unknown): AuthoredLabel {
  return isAuthored(label) ? (label as AuthoredLabel) : undefined;
}

/**
 * Do two authored labels say the same thing — in either authorized form?
 *
 * Used for the `page:header` de-duplication, whose rule is "a title that
 * merely restates the page label resolves through the label's own key, so
 * offering it a second key would offer one string under two keys". That rule
 * is about the TEXT, not about the JavaScript value: two inline locale maps
 * written out identically are the duplicate the rule means, and `!==` on two
 * object references would answer `false` for every one of them.
 *
 * Key ORDER is deliberately not significant (the maps are compared as sets of
 * entries) — `pickLocalized`'s insertion-order limbs decide which entry is
 * shown for an unlisted locale, but two maps carrying the same entries show
 * the same text for every locale either of them lists, which is the question
 * here.
 */
function sameAuthored(a: unknown, b: unknown): boolean {
  const aText = inlineText(a);
  const bText = inlineText(b);
  if (aText !== undefined || bText !== undefined) return aText === bText;
  const aMap = inlineLocaleMap(a);
  const bMap = inlineLocaleMap(b);
  if (!aMap || !bMap) return aMap === bMap;
  const aKeys = Object.keys(aMap).sort();
  const bKeys = Object.keys(bMap).sort();
  return aKeys.length === bKeys.length && aKeys.every((k, i) => bKeys[i] === k && aMap[k] === bMap[k]);
}

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
  const authored = asAuthoredLabel(label);
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
        inlineText(label) ?? sectionName,
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
  const index = new Map<string, Map<string, AuthoredLabel>>();

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
      // A localized-map label is already multilingual, so it seeds nothing —
      // but it IS authored, and is carried through as such so coverage counts
      // the locales it holds instead of filing it as a label nobody wrote
      // (#14749).
      const authored = asAuthoredLabel(tab.label);
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
        inlineText(label) ?? tabName,
        label,
        'view',
        { objectName },
      );
    }
  }
}

/**
 * Translation groups the shipped liveness ledger warns an author for authoring
 * — today exactly `flows` (`status: planned`, `authorWarn: true`).
 *
 * ## Why the walk surface is gated on this at all (#11624)
 *
 * `os lint` runs the coverage gate built on this walker AND
 * `lintLivenessProperties` in ONE pass, and before this gate existed they
 * pointed opposite ways on the same keys: omit `flows.<f>.screens.<n>.title`
 * from a bundle and the coverage gate reported `i18n/missing-flow`; author it
 * and the liveness rule reported `liveness-planned-property` ("sets `flows` but
 * this translation property is planned"). Measured on one stack, one run: 4
 * demand-side findings against 2 warn-side findings, and no third option — the
 * CLI has no per-rule suppression, only `--skip-i18n`, which silences the whole
 * `i18n/missing-*` family. Under `--i18n-strict` the demand side is an error,
 * so a project could be *forced* to author keys it is then warned for.
 *
 * ⛔ The warn side is not the bug and must not be softened: no shipped runner
 * reads the group, so a translated wizard string really is stored and never
 * shown. The demand is the half that is premature.
 *
 * ## Shape
 *
 * Group-general, not `flows`-specific, and read from the ledger rather than a
 * switch of our own: the day the objectui screen-flow runner lands and the row
 * flips to `live` (dropping its `authorWarn`), the bucket turns itself back on
 * with no edit here — and any FUTURE group that acquires a warn is covered on
 * the day it is marked, rather than re-opening this collision one group at a
 * time.
 *
 * The join is on the group (`path[0]`) and stops there deliberately: for
 * file-authored bundles the warn side only ever fires at that depth. Its
 * `getNested` fans out over ARRAYS, and a translation group is a record keyed
 * by target name, so a warned child row (`flows.label`) resolves
 * `data.flows.label` — a path no real bundle has — and warns nobody. Matching
 * deeper here would suppress keys nothing warns about.
 *
 * Unreadable ledger ⇒ empty set ⇒ nothing is gated, which is also the state in
 * which the warn side warns on nothing. The two halves go quiet together; the
 * one thing that must never happen is one of them speaking alone.
 */
export function authorWarnedTranslationGroups(): ReadonlySet<string> {
  const warned = authorWarnedProperties('translation');
  // Top-level groups only — see the `getNested` note above.
  return new Set([...warned].filter((path) => !path.includes('.')));
}

/**
 * Write `pages.<page>.components.<id>.<key>` for every component
 * `translatePage` addresses — and only those (#13109).
 *
 * BOTH halves of that sentence are imported from `@objectstack/spec`, so
 * neither can drift. The KEY list is {@link PAGE_COMPONENT_COPY_KEYS}; the
 * WALK — which components carry those keys — is `walkAddressedPageComponents`,
 * the same traversal `translatePage` itself runs (#13218, completing the key
 * list's precedent). The walk owns the roots (`regions[].components[]` only),
 * the descent (`properties.children` only, depth-capped, cycle-guarded) and
 * the ruled collision arbitration (#12961: region level wins outright; among
 * nested components, document-order first sighting) — this function used to
 * hand-mirror all five and now owns none of them. What it still owns:
 *
 *   - the emission exception: a REGION-LEVEL `page:header` emits nothing here
 *     (its copy is offered under `pages.<page>.title` / `.subtitle` instead —
 *     emitting both would offer one string under two keys), but the walk still
 *     counts its id as region-level, so a nested namesake stays blocked;
 *   - the `label` either/or: `label` may be authored on the component itself
 *     or in its props — the same either/or `translatePage` resolves back onto.
 *
 * ⛔ Deliberately NOT `@objectstack/lint`'s `walkPageComponents`, which is
 * WIDER than the resolver in four ways (`slots.<slot>` roots,
 * `properties.items[].children`, `properties.body`, `properties.footer`) and
 * NARROWER in one (it skips `kind: 'html' | 'react' | 'jsx'` pages, which
 * `translatePage` walks) — either direction of that mismatch is one half of
 * the failure pair `PAGE_COMPONENT_COPY_KEYS`' own JSDoc names.
 */
function emitPageComponentCopy(out: ExpectedEntry[], page: any, name: string): void {
  walkAddressedPageComponents(page, (component, { id, nested, addressed }) => {
    if (addressed && (nested || component.type !== PAGE_HEADER_COMPONENT_TYPE)) {
      const props = component.properties ?? {};
      for (const key of PAGE_COMPONENT_COPY_KEYS) {
        const value = key === 'label' && isAuthored(component.label)
          ? component.label
          : props[key];
        // `pushEntry` filters: a plain string seeds a bundle row, an inline
        // locale map is recorded as authored-with-no-seed, anything else
        // records nothing (#14749).
        pushEntry(out, ['pages', name, 'components', id as string, key], value, 'page');
      }
    }
    return component;
  });
}

/** The one component type whose copy is addressed by PAGE name, not by id. */
const PAGE_HEADER_COMPONENT_TYPE = 'page:header';

/** Options shared by the two surfaces built on {@link collectExpectedEntries}. */
export interface ExpectedEntryOptions {
  /**
   * Translation groups to leave out of the walk. Defaults to
   * {@link authorWarnedTranslationGroups}. Pass an empty set to walk the whole
   * declared surface — what the gated groups look like the day their ledger row
   * goes `live`.
   */
  warnedGroups?: ReadonlySet<string>;
}

/**
 * Collect every translatable entry from a normalized stack config.
 *
 * Groups the liveness ledger warns authors for authoring are left out — see
 * {@link authorWarnedTranslationGroups}. This is the single place the gate
 * lives, so `os lint`'s coverage report and `os i18n extract`'s skeleton can
 * never disagree about which keys an author is being asked for.
 */
export function collectExpectedEntries(
  config: any,
  opts: ExpectedEntryOptions = {},
): ExpectedEntry[] {
  const out: ExpectedEntry[] = [];

  // ── Objects ───────────────────────────────────────────────────────
  const objects: any[] = Array.isArray(config?.objects) ? config.objects : [];
  for (const obj of objects) {
    if (!obj?.name) continue;
    const objectName = obj.name as string;

    pushDerived(out, ['objects', objectName, 'label'], inlineText(obj.label) ?? objectName, obj.label, 'object', { objectName });
    pushOptional(out, ['objects', objectName, 'pluralLabel'], obj.pluralLabel, 'object', { objectName });
    pushOptional(out, ['objects', objectName, 'description'], obj.description, 'object', { objectName });

    // Fields (always a record on normalized schemas)
    if (obj.fields && typeof obj.fields === 'object') {
      for (const [fieldName, raw] of Object.entries<any>(obj.fields)) {
        const field = raw ?? {};
        pushDerived(
          out,
          ['objects', objectName, 'fields', fieldName, 'label'],
          inlineText(field.label) ?? fieldName,
          field.label,
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
            // A locale-map option label is authored text in every locale it
            // carries — it cannot be "byte-equal to the machine value", so the
            // #8543 derived rule above has nothing to say about it.
            pushDerived(out, path, value, inlineLocaleMap(label) ? label : undefined, 'option', { objectName });
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
        pushDerived(out, [...aroot, 'label'], inlineText(action.label) ?? aname, action.label, 'action', { objectName });
        pushOptional(out, [...aroot, 'description'], action.description, 'action', { objectName });
        pushOptional(out, [...aroot, 'confirmText'], action.confirmText, 'action', { objectName });
        pushOptional(out, [...aroot, 'successMessage'], action.successMessage, 'action', { objectName });
        pushActionParams(out, ['objects', objectName, '_actions', aname], action, 'action', objectName);
        pushActionResultDialog(out, ['objects', objectName, '_actions', aname], action, 'action', objectName);
      }
    }

    // Custom validation-rule rejection messages (`_validations.<rule>.message`).
    pushValidationMessages(out, objectName, obj.validations, 0);
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
    pushDerived(out, [...root, 'label'], inlineText(action.label) ?? action.name, action.label, kind, { objectName });
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

  // ── Analytics datasets (`datasets.<name>.…`) ─────────────────────
  walkDatasets(config, out);

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
        if (component?.type !== PAGE_HEADER_COMPONENT_TYPE) continue;
        const props = component.properties ?? {};
        // `title` duplicating `label` is the common case and resolves via the
        // label fallback — only emit it when the two genuinely differ.
        if (!sameAuthored(props.title, page.label)) {
          pushEntry(out, ['pages', name, 'title'], props.title, 'page');
        }
        pushEntry(out, ['pages', name, 'subtitle'], props.subtitle, 'page');
      }
    }

    // Per-component copy, addressed by the component's own id (#6080). Without
    // this pass the face exists but nothing writes the skeleton, so a
    // translator would have to know the keys to hand-write them — which is
    // most of the reason the copy went untranslated in the first place.
    //
    // `page:header` is deliberately skipped AT REGION LEVEL: its copy is
    // addressed by page name above, and emitting it here too would offer one
    // string under two keys. A NESTED `page:header` is a different component —
    // `translatePage`'s page-name route stops at region level, so a nested one
    // is reachable by the id route ONLY and must be offered here (#13109).
    emitPageComponentCopy(out, page, name);
  }

  // ── Screen flows (`flows.<flow>.screens.<node>.…`, #7646 / #11287) ─
  walkScreenFlows(config, out);

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

  const warnedGroups = opts.warnedGroups ?? authorWarnedTranslationGroups();
  const walked = warnedGroups.size === 0 ? out : out.filter((entry) => !warnedGroups.has(entry.path[0]));
  return dedupeByPath(walked);
}

/**
 * Collapse entries that address the same key to one.
 *
 * **One path is one demand.** A translation bundle has exactly one slot per
 * path, so an author owes exactly one string for it no matter how many places
 * in the walk arrived at that slot. The walk does not have that property on its
 * own, because a translation key is derived from *where the string is
 * addressed*, not from *which declaration was being read* when it was reached
 * — and two declarations can address one slot:
 *
 *   - **Two carriers, one action.** The normalized config attaches an object's
 *     actions to the object (`obj.actions`) *and* to the top-level `actions`
 *     list — measured to be the SAME object reference, not a copy — so the two
 *     action branches above both emit `objects.<o>._actions.<a>.*`.
 *   - **Two declarations, one form field.** `field.form.ts` and
 *     `object.form.ts` each declare `deleteBehavior` twice, gated on
 *     `visibleWhen` (`lookup` vs `master_detail`). Both variants render into
 *     the same key, because {@link walkFormField} keys on the field path.
 *     Config-independent: it duplicates six entries on *every* config,
 *     including an empty one.
 *
 * Neither is an authoring mistake and neither is fixable where it originates —
 * they are two correct declarations of one displayed string. So the walker owns
 * the collapse.
 *
 * **De-duplicating HERE rather than in the report** is what makes both
 * consumers honest with one change. `computeI18nCoverage` counted the same
 * missing key twice, so translating one string moved
 * `pnpm check:i18n-coverage`'s ratchet by two while its report called the
 * number "untranslated declared strings". `extractTranslations` counted them
 * twice too, in `totalExpected` and in the per-locale `counts` it prints —
 * over-reporting by 101 keys on app-showcase against the 1531 leaves it
 * actually wrote, because `setDeep` had already collapsed them on the way into
 * the bundle. A de-duplication at the reporting seam would have fixed the first
 * and left the second, and would have left the registry-driven family
 * duplicated in perpetuity — it never reaches `os lint`'s report, which hides
 * the `metadataForms` bucket unless `--include-platform` is passed.
 *
 * **First emission wins.** Walk order is deterministic, so the rule is
 * deterministic. It is also lossless on everything measured: all 372 duplicate
 * paths across the three baselined example configs, and all 6 registry ones,
 * carry byte-identical {@link ExpectedEntry} records — for the action family
 * necessarily so, since both carriers hold one reference. Where two emissions
 * ever *do* disagree, the disagreement is already unresolvable downstream: one
 * bundle slot can serve only one string, so the choice is which of two
 * colliding declarations to seed from, not whether to drop a demand.
 */
function dedupeByPath(entries: ExpectedEntry[]): ExpectedEntry[] {
  const seen = new Set<string>();
  const out: ExpectedEntry[] = [];
  for (const entry of entries) {
    // `\u0000` cannot occur in a path segment, so joining on it cannot make two
    // different paths collide the way a `.` join would (`['a.b']` vs `['a','b']`).
    const key = entry.path.join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

// ─── Analytics datasets (`datasets.<name>.…`) ──────────────────────────

/**
 * Emit the dataset copy surface (#14253's resolver, #14376's walk):
 *
 *   datasets.<name>.label
 *   datasets.<name>.description
 *   datasets.<name>.dimensions.<dimension>.label
 *   datasets.<name>.measures.<measure>.label
 *
 * **Why a dataset is a display surface at all.** It reads like a back-office
 * definition, but a measure label is drawn ON THE DASHBOARD — under every
 * metric tile and on every chart axis. `translateDataset` is registered in
 * `METADATA_DOCUMENT_TRANSLATORS`, so a served dataset is already localized at
 * the REST boundary; this pass is the half that writes the skeleton.
 *
 * **Top level, not under `dashboards`.** A dataset is the one definition every
 * presentation binds to BY REFERENCE (ADR-0021 D1): the same measure is drawn
 * by N widgets across M dashboards, so addressing it under a dashboard would
 * ask for the same string once per presentation and leave a dataset no
 * dashboard references unaddressable.
 *
 * **`pushOptional`, not `pushDerived`, for every key here.** These four are
 * `I18nLabelSchema` at the authoring site, so a value may already be an inline
 * `{ en, 'zh-CN' }` map (#5728) — not source text to scaffold from, and
 * `inlineText` narrows it away. And no renderer fallback is measured for a
 * member that declares no `label` at all, so there is no reader-visible string
 * to seed one from: recording the key without an `inline` keeps the coverage
 * gate quiet about a string nobody wrote while still noticing a bundle that
 * authors it. It is the same posture the resolver takes — `translateDataset`
 * writes only where the bundle answered.
 *
 * The face stops at `label` below the dataset: `DatasetDimensionSchema` and
 * `DatasetMeasureSchema` declare no `description` and say so in their own
 * authoring guidance, so a `dimensions.<d>.description` key would parse clean
 * and translate nothing.
 */
function walkDatasets(config: any, out: ExpectedEntry[]): void {
  const datasets: any[] = Array.isArray(config?.datasets) ? config.datasets : [];
  for (const dataset of datasets) {
    if (!dataset || typeof dataset !== 'object') continue;
    const name = dataset.name;
    if (typeof name !== 'string' || name.length === 0) continue;
    pushOptional(out, ['datasets', name, 'label'], dataset.label, 'dataset');
    pushOptional(out, ['datasets', name, 'description'], dataset.description, 'dataset');
    for (const group of ['dimensions', 'measures'] as const) {
      const members: any[] = Array.isArray(dataset[group]) ? dataset[group] : [];
      for (const member of members) {
        if (!member || typeof member !== 'object') continue;
        const memberName = member.name;
        if (typeof memberName !== 'string' || memberName.length === 0) continue;
        pushOptional(out, ['datasets', name, group, memberName, 'label'], member.label, 'dataset');
      }
    }
  }
}

// ─── Screen flows (`flows.<flow>.screens.<node_id>.…`) ─────────────────

/**
 * The one flow-node type whose copy the bundle addresses. Spelled once here
 * rather than at each guard; the resolver's own constant is module-private,
 * and `translateScreenNode` filters on exactly this value.
 */
const SCREEN_NODE_TYPE = 'screen';

/**
 * Emit the screen-flow copy surface (#7646, resolver landed in #11287).
 *
 * **The hole this closes.** A `type: 'screen'` flow is a wizard the user
 * reads — a heading and a list of labelled inputs — and this walker had no
 * pass for it, so `os lint` could not report a screen-flow copy gap and
 * `os i18n extract` never scaffolded the keys. HotCRM measured
 * `0 i18n/missing-*` on a tree whose six screen dialogs rendered English in
 * all four locales: the gate was green because the surface was invisible to
 * it, not because the app was translated.
 *
 * **The key face is IMPORTED, never restated.** {@link FLOW_SCREEN_COPY_KEYS}
 * and {@link FLOW_SCREEN_FIELD_COPY_KEYS} are exported by
 * `@objectstack/spec/system` precisely so this scaffolder and the resolver
 * that reads the bundle cannot drift — a local copy, however correct on the
 * day it is written, is the drift the export exists to make impossible. The
 * schema↔list agreement is pinned spec-side in `translation.test.ts`.
 *
 * Addressing (`translation.zod.ts`, `flows`): flow by `Flow.name`, screen by
 * `FlowNode.id` (the client's `ScreenSpec.nodeId`), field by
 * `ScreenFieldConfig.name` — every level an identifier some consumer already
 * holds at render time.
 *
 * Two seeding rules worth stating, both measured against what the reader sees
 * rather than against which key the author happened to fill in:
 *
 * - **A screen's `title` falls back to the node `label`.** The executor builds
 *   the wire title as `config.title ?? node.label` (`ScreenSpec.title`), and
 *   `translateFlow` overlays the bundle onto `config.title` for that reason —
 *   one key covers whichever of the two the runner draws. So the seed, and the
 *   `inline` the coverage gate judges, is that same pair: a screen with only a
 *   canvas label still shows English text a translator owes a translation for.
 * - **A field's `label` falls back to its `name`.** `ScreenFieldConfig.label`
 *   is optional and forwarded as-is (`ScreenFieldSpec.label`), so the runner
 *   renders the field name when the author wrote no label. That is a derived
 *   fallback nobody authored — {@link pushDerived}, so the skeleton stays
 *   usable while the gate demands no translation of a string that does not
 *   exist.
 *
 * A screen node whose `waitForInput` is `false` is deliberately NOT skipped:
 * `translateFlow` overlays every screen node, and a walker that skipped one
 * would re-open the extractable-but-ungated gap in miniature.
 */
function walkScreenFlows(config: any, out: ExpectedEntry[]): void {
  const flows: any[] = Array.isArray(config?.flows) ? config.flows : [];
  for (const flow of flows) {
    const flowName = typeof flow?.name === 'string' && flow.name.length > 0 ? flow.name : undefined;
    if (!flowName) continue;
    const scope: EntryScope = { flowName };

    // `flows.<flow>.label` — `lookupFlowLabel`'s key. `Flow.label` is required
    // by the schema, so this is authored text in practice; `pushOptional`
    // keeps a label-less flow from seeding an empty string anyway.
    pushOptional(out, ['flows', flowName, 'label'], flow.label, 'flow', scope);

    const nodes: any[] = Array.isArray(flow.nodes) ? flow.nodes : [];
    for (const node of nodes) {
      if (!node || typeof node !== 'object' || node.type !== SCREEN_NODE_TYPE) continue;
      const nodeId = typeof node.id === 'string' && node.id.length > 0 ? node.id : undefined;
      // No id, no key: `translateScreenNode` cannot address the node either.
      if (!nodeId) continue;
      const cfg = node.config && typeof node.config === 'object' ? node.config : {};
      const screenRoot = ['flows', flowName, 'screens', nodeId];

      for (const key of FLOW_SCREEN_COPY_KEYS) {
        // Raw, not `inlineText`-narrowed: the fallback still picks the FIRST
        // authored value, in either authorized form (#14749).
        const authored = key === 'title'
          ? (asAuthoredLabel(cfg[key]) ?? asAuthoredLabel(node.label))
          : asAuthoredLabel(cfg[key]);
        pushOptional(out, [...screenRoot, key], authored, 'flow', scope);
      }

      const fields: any[] = Array.isArray(cfg.fields) ? cfg.fields : [];
      for (const field of fields) {
        const fieldName = typeof field?.name === 'string' && field.name.length > 0 ? field.name : undefined;
        // An item with an empty name is dropped by the runner too.
        if (!fieldName) continue;
        const fieldRoot = [...screenRoot, 'fields', fieldName];
        for (const key of FLOW_SCREEN_FIELD_COPY_KEYS) {
          const authored = asAuthoredLabel(field[key]);
          if (key === 'label') {
            pushDerived(out, [...fieldRoot, key], inlineText(authored) ?? fieldName, authored, 'flow', scope);
          } else {
            pushOptional(out, [...fieldRoot, key], authored, 'flow', scope);
          }
        }
      }
    }
  }
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
  if (entry.flowName && filter.test(entry.flowName)) return true;
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
  // `warnedGroups` rides through: a group the ledger warns authors for
  // authoring must not be scaffolded either. Scaffolding it would hand the
  // author a skeleton whose every filled-in key draws a warning — the same
  // collision the coverage gate has, arriving by a different door (#11624).
  const allEntries = collectExpectedEntries(config, { warnedGroups: opts.warnedGroups })
    .filter((e) => e.sourceValue !== undefined);
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

  const sourceHashes: Record<string, Record<string, string>> = {};
  const sourceBundle = bundles[defaultLocale];
  for (const locale of locales) {
    if (locale === defaultLocale) continue;
    sourceHashes[locale] = collectFilledFromHashes(
      bundles[locale],
      sourceBundle,
      opts.previousSourceHashes?.[locale],
    );
  }

  return { bundles, counts, totalExpected: entries.length, sourceHashes };
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
    'Merge only fills gaps: correcting a source label/description does not',
    'push the correction into a leaf here that already holds a translation —',
    'a present-but-stale string is not a gap, so it is left as-is. Re-translate',
    'it by hand when its source changes; nothing here or in `os i18n check`',
    'tells a leaf a translator updated on purpose from one nobody has looked',
    'at since the source moved.',
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

/**
 * Render one locale's generated source-hash table as a TypeScript module body —
 * the `<locale>.source-hashes.generated.ts` companion.
 *
 * Deliberately types the export STRUCTURALLY (`Readonly<Record<string,
 * string>>`) instead of importing `SourceHashes`. The companion is written into
 * whichever package owns the bundles, and only one of those packages can spell
 * the type with a relative import; an import path guessed per package is a
 * portability bug waiting for the second package to use this. The structural
 * type is what `SourceHashes` is defined as, so nothing is lost.
 *
 * Keys are emitted sorted, and every key is quoted (they are dotted paths, so
 * `formatKey` would quote them anyway). Both are load-bearing for `--check`:
 * the comparison is byte-for-byte, so a table that reordered with the walk
 * would fail on a tree that is in fact in sync.
 */
export function renderSourceHashModule(
  hashes: Record<string, string>,
  options: { locale: string; exportName?: string },
): string {
  const exportName = options.exportName ?? `${camelize(options.locale)}GeneratedSourceHashes`;
  const keys = Object.keys(hashes).sort();
  const lines: string[] = [];
  lines.push('// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.');
  lines.push('');
  lines.push('/**');
  lines.push(` * Auto-generated by 'os i18n extract' for locale '${options.locale}'. Do not hand-edit.`);
  lines.push(' *');
  lines.push(" * Each entry is the digest of the SOURCE REVISION that this locale's leaf at");
  lines.push(' * that path is still a byte copy of — provenance for the generated half of the');
  lines.push(' * bundles (#11671, maintainer ruling #12069 Option A, extending #8765 Option B).');
  lines.push(' *');
  lines.push(' * An entry exists only while the leaf IS such a copy. Re-translate the leaf in');
  lines.push(' * `<locale>.objects.generated.ts` and the next extract drops its entry by');
  lines.push(' * itself — the table makes no claim about text a translator wrote. A path with');
  lines.push(' * no entry is LEGACY-TRUSTED and never reported stale.');
  lines.push(' *');
  lines.push(' * ⚠️ Do not "fix" a staleness report by editing this file. Refreshing a digest');
  lines.push(' * records that the current text was copied from the current source, which is');
  lines.push(' * the false claim the mechanism exists to detect. Fix the TRANSLATION.');
  lines.push(' */');
  lines.push('');
  lines.push(`export const ${exportName}: Readonly<Record<string, string>> = {`);
  for (const key of keys) lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(hashes[key])},`);
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

/**
 * Narrow a provenance table to the generated sections a run actually COMMITS
 * (#12559).
 *
 * {@link extractTranslations} computes the table over every generated section it
 * built — `objects` and `metadataForms` both — because the rule that fills it
 * (`collectFilledFromHashes`) is a statement about generated leaves, not about
 * files. Which of those sections becomes a committed bundle is the command
 * layer's decision, and the two must agree: a record describes the leaf sitting
 * in a bundle beside it, so a record for a section this package does not commit
 * describes nothing that exists there.
 *
 * The mismatch is measured, not hypothetical. A package that owns only its own
 * objects passes `--no-metadata-forms`, and the emitter's own note says why:
 * "without it, `--check` demands a baseline copy the package deliberately does
 * not commit". Its `metadataForms` subtree is built anyway, and — having no
 * entry in that package's merge baseline — arrives as a fresh `--fill=default`
 * copy of `en`, so EVERY leaf of it satisfies `value === currentSource` and is
 * recorded. Measured on `@objectstack/plugin-audit` while rolling the companion
 * out in #12559: 763 records, of which **2** were its own objects and 761 were
 * digests of the Studio metadata-form baseline `@objectstack/platform-objects`
 * owns — unreadable in that package (no `metadataForms` bundle exists there for
 * them to be about) and re-written in all three of its companions every time an
 * unrelated `*.form.ts` in `packages/spec` moved. That is the cross-package
 * coupling ADR-0029 D8 and each package's `bundle-ownership.test.ts` keep out of
 * the committed bundles; the companion is not exempt from it.
 *
 * A section is named by a leaf path's FIRST dotted segment — the same identity
 * `collectGeneratedLeaves` seeds its walk with, so the two cannot disagree about
 * what section a path belongs to. Callers pass the sections they are committing;
 * this function invents none, so a set that commits both (`platform-objects` is
 * the one today) keeps every record it had.
 */
export function narrowToCommittedSections(
  hashes: Record<string, string>,
  committedSections: Iterable<string>,
): Record<string, string> {
  const committed = new Set(committedSections);
  return Object.fromEntries(
    Object.entries(hashes).filter(([leafPath]) => committed.has(leafPath.split('.', 1)[0])),
  );
}

/**
 * Read a committed `<locale>.source-hashes.generated.ts` back into a table.
 *
 * The module body is written by {@link renderSourceHashModule}, which quotes
 * every key and every value, so the object literal is already valid JSON — the
 * parse needs no TypeScript and no evaluation. A file that does not parse is a
 * hard `undefined` (treated as "no previous records", i.e. everything
 * legacy-trusted) rather than a guess: inventing records from a file we cannot
 * read is how a mechanism starts asserting provenance it does not have.
 */
export function parseSourceHashModule(source: string): Record<string, string> | undefined {
  const marker = source.indexOf('export const');
  const open = marker < 0 ? -1 : source.indexOf('= {', marker);
  if (open < 0) return undefined;
  const literal = source.slice(open + 2).replace(/;\s*$/, '');
  try {
    const parsed = JSON.parse(literal.replace(/,(\s*})/g, '$1'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    for (const value of Object.values(parsed)) if (typeof value !== 'string') return undefined;
    return parsed as Record<string, string>;
  } catch {
    return undefined;
  }
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
