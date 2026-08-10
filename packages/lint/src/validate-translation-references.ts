// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0072 — reference resolvability] Translation-bundle reference integrity
 * and option-key validation (issue #3583, assessment R6).
 *
 * The i18n gate has always run in ONE direction: `computeI18nCoverage` asks
 * "which keys does the metadata expect that no bundle carries?" Nothing asks the
 * reverse — "which keys does a bundle carry that no metadata claims?" — even
 * though the spec already names the answer: `TranslationDiffStatus 'redundant'`
 * and `TranslationCoverageResult.redundantKeys` are declared and have no
 * producer.
 *
 * The HotCRM audit found that direction shipping broken metadata:
 *
 *   - bundles keyed to fields the object never declares (`assigned_to`,
 *     `budget`, `image_url`) — usually a rename that moved the field and left
 *     the translation behind;
 *   - select-option translations keyed by the option's DISPLAY LABEL instead of
 *     its stored value, or by a near-miss of the value (`direct-mail` for
 *     `direct_mail`, `planned` for `planning`).
 *
 * Both fail the same way: the resolver looks up the key it derives from the
 * metadata, finds nothing, and renders the untranslated source string. The app
 * looks *translated* — every other label on the screen resolves — so the hole is
 * invisible until a reader in that locale hits the one field or one picklist
 * value that stayed English.
 *
 * ── Severity ─────────────────────────────────────────────────────────────
 *
 * All findings are **warnings**. An orphan key is inert, not broken: it costs a
 * few bytes and one untranslated string, and nothing crashes. That is a weaker
 * failure than the dead references `validate-object-references` /
 * `validate-action-name-refs` report as errors, and the severity should say so
 * (ADR-0072 D1 — a linter that over-states is a linter authors stop reading).
 *
 * ── What this rule deliberately does NOT check ───────────────────────────
 *
 *   - `messages`, `validationMessages`, `settings`, `settingsCommon` — keyed by
 *     free-form message ids / namespaces owned by code and plugins, not by
 *     stack metadata. There is no enumerable universe to resolve against, so a
 *     rule here would be guessing.
 *   - `metadataForms` — keyed by the platform's own metadata-type registry, not
 *     by this stack. Owned by the platform packages; a stack translating them is
 *     correct, not orphaned.
 *   - leaf attribute names (`labl:` instead of `label:`) — Zod strips unknown
 *     keys at parse, so they never reach a consumer with a value; that is a
 *     schema-shape concern, not a reference.
 *   - the object-first `AppTranslationBundle` (`o.<object>` …) — that shape is
 *     the `translation` METADATA TYPE (records persisted through the metadata
 *     store), not `stack.translations`, which is `TranslationBundle[]`
 *     (locale → `TranslationData`). Its keys are simply not visited here: an
 *     unrecognised top-level namespace is skipped, never reported.
 *
 * ── Cross-package objects ────────────────────────────────────────────────
 *
 * A stack legitimately translates objects it does not define — `sys_user`'s
 * labels are exactly the kind of thing an app localizes. Resolution follows the
 * §4 ladder of the assessment, with the field-level S3 rule intact:
 *
 *   1. own object                          → check its fields/views/actions/sections
 *   2. platform object in the registry     → skip WHOLLY (we cannot see its
 *                                             fields, so we cannot judge them)
 *   3. platform-prefixed, not in registry  → warn on the object key only
 *   4. unresolved, unprefixed              → warn on the object key only
 */

import { expandViewContainer } from '@objectstack/spec';
import { hasPlatformObjectPrefix, isPlatformProvidedObjectName } from '@objectstack/spec/system';
import { walkPageComponents } from './page-walk.js';
import { SYSTEM_FIELDS } from './system-fields.js';
import { viewObjectName } from './view-walk.js';

export const TRANSLATION_TARGET_UNKNOWN = 'translation-target-unknown';
export const TRANSLATION_OPTION_KEY_UNKNOWN = 'translation-option-key-unknown';

export type TranslationRefSeverity = 'warning';

export interface TranslationRefFinding {
  /** Always `warning` — an orphan translation key is inert, not broken. */
  severity: TranslationRefSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `locale "zh-CN" · object "crm_lead"`. */
  where: string;
  /** Config path, e.g. `translations[0]["zh-CN"].objects.crm_lead.fields.campaign`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Coerce a collection (array or name-keyed map) to an array of records,
 *  injecting `name` from the map key — mirrors the sibling authoring lints so
 *  the rule works on both the parsed (array) and normalized (map) stack shapes. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (isRec(v)) return Object.entries(v).map(([name, def]) => ({ name, ...(isRec(def) ? def : {}) }));
  return [];
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function distance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i, ...new Array<number>(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

/**
 * "Did you mean?" over the known names — Levenshtein-bounded, plus a namespace
 * pass the distance metric cannot see.
 *
 * A stack prefixes its object names (`todo_task`, `crm_lead`), and the orphan
 * key is routinely the bare noun the author had in mind (`task`). That is 5
 * edits from `todo_task` — far outside the typo bound, and exactly the case
 * where the suggestion is most useful — so a candidate that differs only by a
 * snake_case namespace segment is offered before falling back to edit distance.
 */
function suggest(target: string, known: Iterable<string>): string {
  const names = [...known];
  const segmentMatch = names.find(
    (candidate) => candidate.endsWith(`_${target}`) || candidate.startsWith(`${target}_`),
  );
  if (segmentMatch) return ` Did you mean "${segmentMatch}"?`;

  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of names) {
    const d = distance(target, candidate);
    if (d < bestScore) {
      bestScore = d;
      best = candidate;
    }
  }
  const limit = Math.max(2, Math.floor(target.length / 3));
  return best && bestScore <= limit ? ` Did you mean "${best}"?` : '';
}

/** At most `max` names, sorted, for the "known values are …" tail of a hint. */
function listNames(names: Iterable<string>, max = 12): string {
  const all = [...names].sort();
  if (all.length === 0) return '';
  const shown = all.slice(0, max).join(', ');
  return all.length > max ? `${shown}, … (${all.length} total)` : shown;
}

/**
 * Fields a bundle may translate without reading as orphans: the package-shared
 * registry-injected columns (`system-fields.ts`, #4330) plus three exemptions
 * this rule has carried since it landed — `_id` and `space` are legacy
 * physical spellings older bundles still key, and `name` is an ordinary
 * authored field on most objects. None of the three is a system column in the
 * spec's sense, so they stay rule-local (see the shared module's note) instead
 * of widening every field-existence rule in the package.
 */
const IMPLICIT_FIELDS: ReadonlySet<string> = new Set([
  ...SYSTEM_FIELDS,
  '_id', 'name', 'space',
]);

/** Everything a bundle may legally name under one object. */
interface ObjectFacts {
  fields: Map<string, AnyRec>;
  views: Set<string>;
  actions: Map<string, AnyRec>;
  sections: Set<string>;
}

interface Universe {
  objects: Map<string, ObjectFacts>;
  /** App name → every navigation item id declared by that app. */
  apps: Map<string, Set<string>>;
  dashboards: Map<string, { widgets: Set<string>; actions: Set<string> }>;
  /** Object-less actions — the ones `globalActions.*` may name. */
  globalActions: Map<string, AnyRec>;
  /** Action name → owning object, so a misfiled `globalActions` key can say where it belongs. */
  actionOwners: Map<string, string>;
}

function emptyFacts(): ObjectFacts {
  return { fields: new Map(), views: new Set(), actions: new Map(), sections: new Set() };
}

/**
 * Register everything ONE view record contributes: the `_views` names it makes
 * legal, and the `_sections` names its form views declare — each under the
 * object that container actually binds.
 *
 * Two things about the real shape make this more than "read `view.name`", and
 * both were learned from the HotCRM corpus (~18k lines of shipped metadata),
 * where a first pass reported ~40 correct keys as orphans:
 *
 *  1. A view record is a CONTAINER, not a view. The default list sits at
 *     `list`; the named tabs at `listViews.<key>` and `formViews.<key>`.
 *  2. The object binding lives INSIDE the container (`list.data.object`), not
 *     at the record root. A record-level lookup alone resolves to nothing on
 *     the canonical shape, which silently drops the whole record — a rule that
 *     then reports every view key the app ships.
 *
 * NOWHERE here is the author's inner `name` a `_views` key. This rule used to
 * read it on the named branches too ("authors write either", from the HotCRM
 * corpus) — but the composer constructs every named entry's runtime identity
 * from the MAP KEY alone and ignores `name` entirely, so an inner `name` that
 * diverges from its map key is a key the runtime never resolves, and #5164
 * (ruled 2026-08-06: canonical = the runtime identity's bare key) applies to
 * the named branches exactly as it applies to the default `list` (#6422).
 * Every `_views` key therefore comes from the composer: the default list's
 * via {@link defaultListViewKey}, the named entries' via {@link namedViewKeys}
 * — asked, never re-derived. See those functions for the composer facts that
 * live there and nowhere else (collision renames included: `formViews.default`
 * beside a default `list` is registered as `default_2`, because the rename IS
 * the registry key — the map key it was written under resolves to the OTHER
 * view).
 *
 * A third thing was learned later, from the showcase (#5415): the container's
 * DEFAULT form (`form`) is a section anchor too. It is not one of the
 * `formViews.*` entries and it is not the record's own `sections` either, so
 * its named sections contributed NOTHING to the fact set — and a
 * bundle that correctly translated one of them was reported as keyed to a
 * section "nothing declares", with a hint advising the author to delete a
 * translation that renders. `ObjectForm` reads that form and resolves its
 * headings through the same `sectionLabel(object, section.name, …)` convention
 * as any named form view, so every anchor below feeds ONE collector: the list
 * of anchors is now a list of call sites, not four copies of a loop that can
 * drift apart one at a time.
 */
function collectViewRecord(view: AnyRec, factsFor: (objectName: string) => ObjectFacts): void {
  const recordObject = viewObjectName(view);
  const bindingOf = (container: AnyRec): string | undefined =>
    viewObjectName(container) ?? recordObject;

  const addView = (objectName: string | undefined, name: string | undefined) => {
    if (objectName && name) factsFor(objectName).views.add(name);
  };

  /**
   * Register the `_sections` names one form-ish container declares.
   *
   * Form sections carry an OPTIONAL `name` that exists purely for the
   * `_sections` lookup (`ui/view.zod.ts`: "Stable section identifier for i18n
   * lookup"). A section without one cannot be translated at all, so it
   * contributes nothing here.
   */
  const addSections = (container: AnyRec, binding: string | undefined) => {
    if (!binding) return;
    for (const section of asArray(container.sections)) {
      const sectionName = strName(section.name);
      if (sectionName) factsFor(binding).sections.add(sectionName);
    }
  };

  const listBinding = isRec(view.list) ? bindingOf(view.list) : undefined;
  if (isRec(view.list)) addView(listBinding, defaultListViewKey(listBinding, view));
  addView(recordObject ?? listBinding, strName(view.name));

  const named = namedViewKeys(view);
  for (const family of ['listViews', 'formViews'] as const) {
    const container = view[family];
    if (!isRec(container)) continue;
    const registryKeys = family === 'listViews' ? named.list : named.form;
    let at = 0;
    for (const sub of Object.values(container)) {
      // Advance in lockstep with the composer: it makes an item for every
      // object-typed value (arrays included), so the index moves for each.
      if (!sub || typeof sub !== 'object') continue;
      const registryKey = registryKeys[at++];
      if (!isRec(sub)) continue;
      const binding = bindingOf(sub) ?? listBinding;
      addView(binding, registryKey);
      addSections(sub, binding);
    }
  }

  // The container's default form — the one `defineView({ form: … })` declares
  // and `ObjectForm` renders when no named form view is asked for. Bound the
  // way the CLI i18n walker's `viewObjectName` resolves `view.form.data.object`
  // (#5415), so the two agree on which object the headings belong to.
  //
  // Deliberately sections only, and #5164 is now settled enough to say WHY
  // rather than defer: the composer does give the default form a runtime
  // identity (`<object>.form`), but `_views.*` is a LIST-view convention —
  // `viewLabel` / `viewDescription` resolve view tabs, and the i18n walker
  // emits no `_views` entry for any form view (`i18n-extract.ts`: "form views
  // have no counterpart in the `viewLabel` / `_views.*` resolver convention").
  // A `_views` name registered here for the default form would make a key
  // legal that no consumer ever reads. Its SECTIONS are a different matter —
  // `ObjectForm` resolves those, which is exactly what #5415 established.
  if (isRec(view.form)) addSections(view.form, bindingOf(view.form) ?? listBinding);

  addSections(view, recordObject ?? listBinding);
}

/**
 * The bare `_views` key the RUNTIME assigns to a container's default `list` —
 * the only key a bundle can legally spell for that view.
 *
 * Asked of the composer (`expandViewContainer`, `spec/src/ui/view.zod.ts`)
 * rather than re-derived here. This rule used to read `view.list.name` and
 * register nothing when the author wrote none, while the composer named that
 * very same view `<object>.default` — so a container declaring only a default
 * `list` produced a registry entry keyed `default` and a lint fact set that
 * knew no such view. The CLI i18n walker demanded `_views.default.label`
 * (#6124, leg 1) and this rule called the key an orphan, in ONE `os lint` run:
 * six instances on the showcase, and no author action could make both green.
 * Ruled 2026-08-06 (#5164): canonical = the runtime identity's bare key.
 * Leg 1's `defaultListViewKey` in `packages/cli/src/utils/i18n-extract.ts` is
 * this function's twin — deliberately, both are thin readers of the composer
 * rather than a third and fourth derivation of the key.
 *
 * Three facts live in the composer and nowhere else, all load-bearing here:
 *
 *  1. a nameless default list is keyed **`default`** (never `list`), and a
 *     named one keeps the author's `list.name`;
 *  2. a default list whose STRUCTURE merely restates a `listViews` entry is
 *     **collapsed into that entry** and has no key of its own — the
 *     `examples/app-crm` shape. The surviving `listViews` key is returned (the
 *     `listViews` loop registers it anyway, so the set is unchanged), and the
 *     collapsed-away `list.name` correctly stops being a legal key: nothing
 *     resolves it;
 *  3. a key renamed by a collision (`default` → `default_2`, when another view
 *     already claimed `default`) is returned as renamed, because the rename is
 *     the registry key too.
 *
 * Returns `undefined` when the record declares no default `list`, or when no
 * object binding resolved — the caller cannot file a fact without one.
 */
function defaultListViewKey(object: string | undefined, container: AnyRec): string | undefined {
  if (!object || !isRec(container.list)) return undefined;
  const item = expandViewContainer(object, container).find(
    (i) => i.viewKind === 'list' && i.isDefault,
  );
  if (!item) return undefined;
  const prefix = `${object}.`;
  return item.name.startsWith(prefix) ? item.name.slice(prefix.length) : item.name;
}

/**
 * The bare `_views` keys the RUNTIME assigns to a container's NAMED entries —
 * `listViews.<key>` / `formViews.<key>` — in authoring order per family.
 *
 * {@link defaultListViewKey}'s sibling, and a thin reader of the same composer
 * (#6422, the named-branch limb of the #5164 ruling): the composer constructs
 * each named entry's identity from the MAP KEY alone — the inner `name` is
 * ignored — and renames on collision (`<object>.default` already claimed by
 * the default `list` ⇒ `formViews.default` is registered as
 * `<object>.default_2`). Both facts live in the composer and nowhere else, so
 * both are asked of it, never re-derived. The rename matters even though the
 * view-ref lint makes collisions a hard error: this rule must agree with the
 * registry, not with another rule staying strict — under a collision the map
 * key spelled by the author resolves to the OTHER view, and the renamed key is
 * the one the bundle must spell.
 *
 * Alignment with the composer is positional and rests on two documented facts
 * of `expandViewContainerWithDiagnostics`: each family expands its named map's
 * entries FIRST (defaults are appended after), and it makes an item for every
 * object-typed value in the map, in `Object.entries` order. So the first N
 * items of a family are the named entries, index-aligned with the map.
 *
 * The object passed to the composer is a fixed probe: every identity it
 * assigns is `${object}.${key}` with the SAME object, so the bare key —
 * renames included — does not depend on it, and a container whose entries bind
 * different objects still gets each key filed under its own entry's binding by
 * the caller.
 */
function namedViewKeys(container: AnyRec): {
  list: Array<string | undefined>;
  form: Array<string | undefined>;
} {
  const object = 'probe';
  const prefix = `${object}.`;
  const bare = (name: string) => (name.startsWith(prefix) ? name.slice(prefix.length) : name);
  const countEntries = (v: unknown) =>
    isRec(v) ? Object.values(v).filter((e) => !!e && typeof e === 'object').length : 0;
  const listCount = countEntries(container.listViews);
  const formCount = countEntries(container.formViews);
  if (!listCount && !formCount) return { list: [], form: [] };
  const items = expandViewContainer(object, container);
  const keysOf = (kind: 'list' | 'form', count: number) =>
    items
      .filter((i) => i.viewKind === kind)
      .slice(0, count)
      .map((i) => bare(i.name));
  return { list: keysOf('list', listCount), form: keysOf('form', formCount) };
}

/**
 * Declared select options for a field, or `undefined` when the field declares
 * none at all. Handles the canonical `{value,label}[]` shape plus the two
 * legacy shapes the extractor also tolerates (bare `string[]`, and a
 * `value → label` record).
 */
function readOptions(field: AnyRec): { values: Set<string>; byLabel: Map<string, string> } | undefined {
  const raw = field.options;
  const values = new Set<string>();
  const byLabel = new Map<string, string>();
  if (Array.isArray(raw)) {
    for (const opt of raw) {
      if (typeof opt === 'string') {
        values.add(opt);
        continue;
      }
      if (!isRec(opt)) continue;
      const value = strName(opt.value);
      if (!value) continue;
      values.add(value);
      const label = strName(opt.label);
      if (label) byLabel.set(label.toLowerCase(), value);
    }
  } else if (isRec(raw)) {
    for (const [value, label] of Object.entries(raw)) {
      values.add(value);
      if (typeof label === 'string' && label.length > 0) byLabel.set(label.toLowerCase(), value);
    }
  } else {
    return undefined;
  }
  return values.size > 0 ? { values, byLabel } : undefined;
}

/**
 * Collect every name a translation bundle may resolve against. Built once per
 * run: the same universe answers all bundles and all locales.
 */
function buildUniverse(stack: AnyRec): Universe {
  const objects = new Map<string, ObjectFacts>();
  const factsFor = (name: string): ObjectFacts => {
    let facts = objects.get(name);
    if (!facts) {
      facts = emptyFacts();
      objects.set(name, facts);
    }
    return facts;
  };

  // ── Objects: fields, embedded actions/views, fieldGroups (the `_sections` anchor) ──
  for (const obj of asArray(stack.objects)) {
    const objectName = strName(obj.name);
    if (!objectName) continue;
    const facts = factsFor(objectName);

    for (const field of asArray(obj.fields)) {
      const fieldName = strName(field.name);
      if (fieldName) facts.fields.set(fieldName, field);
    }
    for (const action of asArray(obj.actions)) {
      const actionName = strName(action.name);
      if (actionName) facts.actions.set(actionName, action);
    }
    // An object can carry views directly, including the `objects[].listViews`
    // container the chart rule also walks. `{ ...view, object: objectName }`
    // pins the binding: an embedded view inherits its owner, and nothing here
    // depends on the container repeating it.
    for (const view of asArray(obj.views)) {
      collectViewRecord({ ...view, object: strName(view.object) ?? objectName }, factsFor);
    }
    collectViewRecord({ object: objectName, listViews: obj.listViews }, factsFor);
    // ADR-0085: `fieldGroups[].key` is the i18n anchor for `_sections`.
    for (const group of asArray(obj.fieldGroups)) {
      const key = strName(group.key) ?? strName(group.name);
      if (key) facts.sections.add(key);
    }
  }

  // ── Stack-level views: `_views` names + form-section names ──
  for (const view of asArray(stack.views)) {
    collectViewRecord(view, factsFor);
  }

  // ── Pages: `record:details` sections are the other `_sections` anchor ──
  const pages = asArray(stack.pages);
  for (let pi = 0; pi < pages.length; pi++) {
    for (const walked of walkPageComponents(pages[pi], `pages[${pi}]`)) {
      if (!walked.objectName) continue;
      const props = isRec(walked.component.properties) ? walked.component.properties : undefined;
      if (!props) continue;
      for (const section of asArray(props.sections)) {
        const sectionName = strName(section.name);
        if (sectionName) factsFor(walked.objectName).sections.add(sectionName);
      }
    }
  }

  // ── Actions: object-bound ones join their object; the rest are global ──
  const globalActions = new Map<string, AnyRec>();
  const actionOwners = new Map<string, string>();
  for (const action of asArray(stack.actions)) {
    const actionName = strName(action.name);
    if (!actionName) continue;
    const owner = strName(action.objectName) ?? strName(action.object);
    if (owner) {
      factsFor(owner).actions.set(actionName, action);
      actionOwners.set(actionName, owner);
    } else {
      globalActions.set(actionName, action);
    }
  }
  for (const [objectName, facts] of objects) {
    for (const actionName of facts.actions.keys()) {
      if (!actionOwners.has(actionName)) actionOwners.set(actionName, objectName);
    }
  }

  // ── Apps: navigation item ids (`apps.<app>.navigation.<id>.label`) ──
  const apps = new Map<string, Set<string>>();
  for (const app of asArray(stack.apps)) {
    const appName = strName(app.name);
    if (!appName) continue;
    const navIds = apps.get(appName) ?? new Set<string>();
    const walkNav = (items: unknown) => {
      for (const item of asArray(items)) {
        const id = strName(item.id);
        if (id) navIds.add(id);
        if (item.children) walkNav(item.children);
      }
    };
    walkNav(app.navigation);
    for (const area of asArray(app.areas)) {
      const areaId = strName(area.id);
      if (areaId) navIds.add(areaId);
      walkNav(area.navigation);
    }
    apps.set(appName, navIds);
  }

  // ── Dashboards: widget ids + header action urls ──
  const dashboards = new Map<string, { widgets: Set<string>; actions: Set<string> }>();
  for (const dash of asArray(stack.dashboards)) {
    const dashName = strName(dash.name);
    if (!dashName) continue;
    const widgets = new Set<string>();
    for (const widget of asArray(dash.widgets)) {
      const id = strName(widget.id) ?? strName(widget.name);
      if (id) widgets.add(id);
    }
    const actions = new Set<string>();
    const headerActions = [
      ...asArray(isRec(dash.header) ? dash.header.actions : undefined),
      ...asArray(dash.actions),
    ];
    for (const action of headerActions) {
      const key = strName(action.actionUrl) ?? strName(action.url) ?? strName(action.name);
      if (key) actions.add(key);
    }
    dashboards.set(dashName, { widgets, actions });
  }

  return { objects, apps, dashboards, globalActions, actionOwners };
}

/** Quote a locale for the config path — BCP-47 tags carry `-`. */
function localePath(bundleIndex: number, locale: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(locale)
    ? `translations[${bundleIndex}].${locale}`
    : `translations[${bundleIndex}]["${locale}"]`;
}

/**
 * Validate every reference a translation bundle makes against the metadata it
 * claims to translate. Returns findings (empty = clean).
 */
export function validateTranslationReferences(stack: AnyRec): TranslationRefFinding[] {
  const findings: TranslationRefFinding[] = [];
  if (!isRec(stack)) return findings;

  const bundles = Array.isArray(stack.translations) ? stack.translations : [];
  if (bundles.length === 0) return findings;

  const universe = buildUniverse(stack);

  const orphan = (where: string, path: string, message: string, hint: string) => {
    findings.push({ severity: 'warning', rule: TRANSLATION_TARGET_UNKNOWN, where, path, message, hint });
  };

  for (let bi = 0; bi < bundles.length; bi++) {
    const bundle = bundles[bi];
    if (!isRec(bundle)) continue;

    for (const [locale, rawData] of Object.entries(bundle)) {
      if (!isRec(rawData)) continue;
      const base = localePath(bi, locale);
      const inLocale = `locale "${locale}"`;

      // ── objects.<name>.… ──────────────────────────────────────────────
      for (const [objectName, rawNode] of Object.entries(asRecord(rawData.objects))) {
        if (!isRec(rawNode)) continue;
        const objPath = `${base}.objects.${objectName}`;
        const facts = universe.objects.get(objectName);

        if (!facts) {
          // Not this stack's object. Platform objects are translated by their
          // owning package but a stack may override them, so a registered
          // platform name is legitimate — and unreadable from here, which is
          // why the whole subtree is skipped rather than half-checked.
          if (isPlatformProvidedObjectName(objectName)) continue;
          orphan(
            `${inLocale} · object "${objectName}"`,
            objPath,
            hasPlatformObjectPrefix(objectName)
              ? `Translations are keyed to "${objectName}", which carries a platform namespace ` +
                `prefix but is registered by no platform package, official plugin, or cloud ` +
                `runtime object — and this stack does not define it either. Nothing resolves ` +
                `these keys.` + suggest(objectName, universe.objects.keys())
              : `Translations are keyed to "${objectName}", which no object in this stack ` +
                `defines. The resolver looks up keys derived from the metadata, so this whole ` +
                `subtree is dead weight — every label it carries renders untranslated.` +
                suggest(objectName, universe.objects.keys()),
            `Rename the key to the object it was written for, drop it, or ignore this if the ` +
              `object is contributed by another installed package.` +
              (universe.objects.size > 0 ? ` Defined objects: ${listNames(universe.objects.keys())}.` : ''),
          );
          continue;
        }

        // fields.<name>[.options.<value>]
        for (const [fieldName, rawField] of Object.entries(asRecord(rawNode.fields))) {
          const fieldPath = `${objPath}.fields.${fieldName}`;
          const field = facts.fields.get(fieldName);
          if (!field) {
            if (IMPLICIT_FIELDS.has(fieldName)) continue;
            orphan(
              `${inLocale} · object "${objectName}" · field "${fieldName}"`,
              fieldPath,
              `Translations are keyed to field "${fieldName}", which object "${objectName}" ` +
                `does not declare. The label renders untranslated in this locale — and because ` +
                `every neighbouring field DOES resolve, the hole reads as a styling quirk ` +
                `rather than a missing translation.` + suggest(fieldName, facts.fields.keys()),
              `Point the key at a declared field, or drop it if the field was removed or renamed.` +
                (facts.fields.size > 0 ? ` Declared fields: ${listNames(facts.fields.keys())}.` : ''),
            );
            continue;
          }
          if (!isRec(rawField)) continue;
          checkOptionKeys(findings, {
            optionMap: rawField.options,
            field,
            fieldName,
            objectName,
            path: `${fieldPath}.options`,
            where: `${inLocale} · object "${objectName}" · field "${fieldName}"`,
          });
        }

        // _views.<name>
        for (const viewName of Object.keys(asRecord(rawNode._views))) {
          if (facts.views.has(viewName)) continue;
          orphan(
            `${inLocale} · object "${objectName}" · view "${viewName}"`,
            `${objPath}._views.${viewName}`,
            `Translations are keyed to view "${viewName}", which no view of object ` +
              `"${objectName}" declares. The view tab keeps its source-locale label.` +
              suggest(viewName, facts.views),
            `Match the key to the view's \`name\` (not its label), or drop it.` +
              (facts.views.size > 0 ? ` Declared views: ${listNames(facts.views)}.` : ''),
          );
        }

        // _sections.<key>
        for (const sectionName of Object.keys(asRecord(rawNode._sections))) {
          if (facts.sections.has(sectionName)) continue;
          orphan(
            `${inLocale} · object "${objectName}" · section "${sectionName}"`,
            `${objPath}._sections.${sectionName}`,
            `Translations are keyed to section "${sectionName}", which nothing on object ` +
              `"${objectName}" declares — no \`fieldGroups[].key\`, no named form-view section, ` +
              `no named \`record:details\` section. The section heading stays in the source locale.` +
              suggest(sectionName, facts.sections),
            `Sections are translatable only through a STABLE NAME: give the group/section a ` +
              `\`key\`/\`name\` and use it here, or drop the translation.` +
              (facts.sections.size > 0
                ? ` Declared sections: ${listNames(facts.sections)}.`
                : ` Object "${objectName}" declares no named section at all.`),
          );
        }

        // _actions.<name>[.params.<name>]
        for (const [actionName, rawAction] of Object.entries(asRecord(rawNode._actions))) {
          const actionPath = `${objPath}._actions.${actionName}`;
          const action = facts.actions.get(actionName);
          if (!action) {
            orphan(
              `${inLocale} · object "${objectName}" · action "${actionName}"`,
              actionPath,
              `Translations are keyed to action "${actionName}", which is defined by neither ` +
                `object "${objectName}"'s \`actions\` nor a \`stack.actions\` entry bound to it. ` +
                `The button keeps its source-locale label.` + suggest(actionName, facts.actions.keys()),
              `Match the key to a defined action name, move it under the object that owns the ` +
                `action, or drop it.` +
                (facts.actions.size > 0 ? ` Actions on this object: ${listNames(facts.actions.keys())}.` : ''),
            );
            continue;
          }
          checkActionParams(findings, {
            rawAction,
            action,
            path: actionPath,
            where: `${inLocale} · object "${objectName}" · action "${actionName}"`,
            subject: `action "${actionName}"`,
          });
        }
      }

      // ── globalActions.<name> ──────────────────────────────────────────
      for (const [actionName, rawAction] of Object.entries(asRecord(rawData.globalActions))) {
        const actionPath = `${base}.globalActions.${actionName}`;
        const action = universe.globalActions.get(actionName);
        if (!action) {
          const owner = universe.actionOwners.get(actionName);
          orphan(
            `${inLocale} · global action "${actionName}"`,
            actionPath,
            owner
              ? `Action "${actionName}" is bound to object "${owner}", so the resolver looks it ` +
                `up under \`objects.${owner}._actions.${actionName}\` — never under ` +
                `\`globalActions\`, which is only consulted for object-less actions. This key ` +
                `is never read.`
              : `Translations are keyed to global action "${actionName}", which no object-less ` +
                `action in this stack defines. The button keeps its source-locale label.` +
                suggest(actionName, universe.globalActions.keys()),
            owner
              ? `Move these keys under \`objects.${owner}._actions.${actionName}\`.`
              : `Match the key to an object-less action's name, or drop it.` +
                (universe.globalActions.size > 0
                  ? ` Object-less actions: ${listNames(universe.globalActions.keys())}.`
                  : ''),
          );
          continue;
        }
        checkActionParams(findings, {
          rawAction,
          action,
          path: actionPath,
          where: `${inLocale} · global action "${actionName}"`,
          subject: `action "${actionName}"`,
        });
      }

      // ── apps.<name>[.navigation.<id>] ─────────────────────────────────
      for (const [appName, rawApp] of Object.entries(asRecord(rawData.apps))) {
        const appPath = `${base}.apps.${appName}`;
        const navIds = universe.apps.get(appName);
        if (!navIds) {
          orphan(
            `${inLocale} · app "${appName}"`,
            appPath,
            `Translations are keyed to app "${appName}", which this stack does not define. ` +
              `The app launcher shows the source-locale label.` + suggest(appName, universe.apps.keys()),
            `Match the key to an app's \`name\`, or drop it.` +
              (universe.apps.size > 0 ? ` Defined apps: ${listNames(universe.apps.keys())}.` : ''),
          );
          continue;
        }
        if (!isRec(rawApp)) continue;
        for (const navId of Object.keys(asRecord(rawApp.navigation))) {
          if (navIds.has(navId)) continue;
          orphan(
            `${inLocale} · app "${appName}" · navigation "${navId}"`,
            `${appPath}.navigation.${navId}`,
            `Translations are keyed to navigation item "${navId}", which app "${appName}" ` +
              `does not declare. The menu entry keeps its source-locale label.` +
              suggest(navId, navIds),
            `Match the key to the navigation item's \`id\`, or drop it.` +
              (navIds.size > 0 ? ` Declared navigation ids: ${listNames(navIds)}.` : ''),
          );
        }
      }

      // ── dashboards.<name>[.widgets.<id> | .actions.<url>] ─────────────
      for (const [dashName, rawDash] of Object.entries(asRecord(rawData.dashboards))) {
        const dashPath = `${base}.dashboards.${dashName}`;
        const dash = universe.dashboards.get(dashName);
        if (!dash) {
          orphan(
            `${inLocale} · dashboard "${dashName}"`,
            dashPath,
            `Translations are keyed to dashboard "${dashName}", which this stack does not ` +
              `define. The dashboard title stays in the source locale.` +
              suggest(dashName, universe.dashboards.keys()),
            `Match the key to a dashboard's \`name\`, or drop it.` +
              (universe.dashboards.size > 0 ? ` Defined dashboards: ${listNames(universe.dashboards.keys())}.` : ''),
          );
          continue;
        }
        if (!isRec(rawDash)) continue;
        for (const widgetId of Object.keys(asRecord(rawDash.widgets))) {
          if (dash.widgets.has(widgetId)) continue;
          orphan(
            `${inLocale} · dashboard "${dashName}" · widget "${widgetId}"`,
            `${dashPath}.widgets.${widgetId}`,
            `Translations are keyed to widget "${widgetId}", which dashboard "${dashName}" ` +
              `does not declare. The widget title stays in the source locale.` +
              suggest(widgetId, dash.widgets),
            `Match the key to the widget's \`id\`, or drop it.` +
              (dash.widgets.size > 0 ? ` Declared widget ids: ${listNames(dash.widgets)}.` : ''),
          );
        }
        for (const actionKey of Object.keys(asRecord(rawDash.actions))) {
          if (dash.actions.has(actionKey)) continue;
          orphan(
            `${inLocale} · dashboard "${dashName}" · action "${actionKey}"`,
            `${dashPath}.actions.${actionKey}`,
            `Translations are keyed to header action "${actionKey}", which dashboard ` +
              `"${dashName}" does not declare. The button keeps its source-locale label.` +
              suggest(actionKey, dash.actions),
            `Header-action translations are keyed by the action's \`actionUrl\`, not its label.` +
              (dash.actions.size > 0 ? ` Declared header actions: ${listNames(dash.actions)}.` : ''),
          );
        }
      }
    }
  }

  return findings;
}

/** `v` as a record of sub-nodes, or an empty record when absent/malformed. */
function asRecord(v: unknown): Record<string, unknown> {
  return isRec(v) ? v : {};
}

/**
 * Option translations are keyed by the option's STORED VALUE. Keying them by
 * the display label — or by a near-miss of the value — is the second half of
 * issue #3583's option-key class: the map parses, ships, and never resolves.
 */
function checkOptionKeys(
  findings: TranslationRefFinding[],
  ctx: {
    optionMap: unknown;
    field: AnyRec;
    fieldName: string;
    objectName: string;
    path: string;
    where: string;
  },
): void {
  const optionKeys = Object.keys(asRecord(ctx.optionMap));
  if (optionKeys.length === 0) return;

  const declared = readOptions(ctx.field);
  if (!declared) {
    findings.push({
      severity: 'warning',
      rule: TRANSLATION_OPTION_KEY_UNKNOWN,
      where: ctx.where,
      path: ctx.path,
      message:
        `Option translations are keyed under field "${ctx.fieldName}" of object ` +
        `"${ctx.objectName}", which declares no \`options\` at all (field type ` +
        `"${strName(ctx.field.type) ?? 'unknown'}"). Nothing reads this map.`,
      hint:
        `Declare the options on the field, move the translations to the field that owns ` +
        `them, or drop them.`,
    });
    return;
  }

  for (const key of optionKeys) {
    if (declared.values.has(key)) continue;
    const byLabel = declared.byLabel.get(key.toLowerCase());
    findings.push({
      severity: 'warning',
      rule: TRANSLATION_OPTION_KEY_UNKNOWN,
      where: ctx.where,
      path: `${ctx.path}.${key}`,
      message: byLabel
        ? `Option translation is keyed by the DISPLAY LABEL "${key}" instead of the stored ` +
          `value "${byLabel}". The resolver looks the option up by value, so this entry is ` +
          `never found and the option renders with its source-locale label.`
        : `Option translation is keyed by "${key}", which is not one of the values declared ` +
          `by field "${ctx.objectName}.${ctx.fieldName}". The option renders untranslated.` +
          suggest(key, declared.values),
      hint: byLabel
        ? `Rename the key to "${byLabel}".`
        : `Option keys are the stored \`value\`, not the label and not a variant spelling ` +
          `(\`direct_mail\`, not \`direct-mail\`). Declared values: ${listNames(declared.values)}.`,
    });
  }
}

/** Action-parameter translations are keyed by the param's `name`. */
function checkActionParams(
  findings: TranslationRefFinding[],
  ctx: { rawAction: unknown; action: AnyRec; path: string; where: string; subject: string },
): void {
  const rawParams = Object.keys(asRecord(isRec(ctx.rawAction) ? ctx.rawAction.params : undefined));
  if (rawParams.length === 0) return;

  const declared = new Set<string>();
  for (const param of asArray(ctx.action.params)) {
    const name = strName(param.name) ?? strName(param.field);
    if (name) declared.add(name);
  }

  for (const paramName of rawParams) {
    if (declared.has(paramName)) continue;
    findings.push({
      severity: 'warning',
      rule: TRANSLATION_TARGET_UNKNOWN,
      where: `${ctx.where} · param "${paramName}"`,
      path: `${ctx.path}.params.${paramName}`,
      message:
        `Translations are keyed to parameter "${paramName}", which ${ctx.subject} does not ` +
        `declare. The parameter's label and help text render untranslated in the action dialog.` +
        suggest(paramName, declared),
      hint:
        `Match the key to a declared param \`name\`, or drop it.` +
        (declared.size > 0 ? ` Declared params: ${listNames(declared)}.` : ''),
    });
  }
}
