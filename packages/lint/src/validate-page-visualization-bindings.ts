// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14073] `appearance.allowedVisualizations` on an interface `list` page,
 * resolved against a binding that actually exists — the #13748 ruling's
 * loud-over-silent half, on the PAGE door.
 *
 * ## The door, and why it has no `calendar:` key to check
 *
 * `InterfacePageConfigSchema` is a CLOSED shape with no per-visualization
 * binding key at all: an author whitelists `calendar` under
 * `appearance.allowedVisualizations` and has nowhere on the page to say WHICH
 * field supplies the event date. That is deliberate (ADR-0047's 2026-06-19
 * revision leaves the per-viz bindings on the object view), and it is why
 * #13817's parse-time refinement — which demands a `calendar:` block on a
 * LIST VIEW that whitelists `calendar` — was correctly not extended here: a
 * requirement the page surface cannot satisfy would be unauthorable.
 *
 * So the page door gets the check one layer out. The renderer DERIVES the
 * binding from the source object's fields; this rule asks the same question
 * the renderer asks, at authoring time, and reports the two outcomes an author
 * cannot otherwise see.
 *
 * ## What was measured on the renderer (the facts this rule mirrors)
 *
 * Measured on objectui `f0f774b0` (after objectui#7029 removed the invented
 * `due_date` default), `packages/app-shell/src/views/InterfaceListPage.tsx`:
 *
 *   - `:409-419` — for each whitelisted visualization the binding is
 *     `view.<viz> ?? deriveFromObject(objectDef)`. The referenced view's own
 *     block WINS; the derivation is the fallback, and it yields a REAL field
 *     name or `undefined` — never a literal. (`timeline` borrows
 *     `defaultCalendarFromObject`, `:414`.)
 *   - `:460` — `viewType` is `allowed[0]`, force-pushed into the switcher's
 *     resolvable set by `ListView` (`plugin-list/src/ListView.tsx:2137-2140`,
 *     "always allow switching back to the viewType") even when its binding did
 *     not resolve. So the LEADING entry with no binding mounts its renderer
 *     with no field, and `ObjectCalendar`'s `getCalendarConfig`
 *     (`plugin-calendar/src/ObjectCalendar.tsx:142-165`) returns `null` — the
 *     user lands on the refusal screen "Calendar configuration required".
 *   - A NON-leading entry with no binding is filtered out of the switcher
 *     SILENTLY; the switcher chrome still appears, because `showViewSwitcher`
 *     reads the whitelist's LENGTH (`:482`). Nothing says why the type is
 *     missing, at build time or at run time.
 *
 * Hence the two severities, tracking what the user actually sees: `error` when
 * the unbound entry is `allowedVisualizations[0]` (the refusal screen is the
 * whole page), `warning` otherwise (a whitelisted type that silently is not
 * there). Both name `sourceView` as the remedy, because on this door it is the
 * only schema-legal channel for a per-visualization binding — exactly how the
 * shipped showcase map page binds its `locationField`.
 *
 * ## ⚠️ Drift risk, stated because it is real and unguarded by any build edge
 *
 * The predicate table below is a MIRROR of objectui's derivation, hand-carried
 * across a repository boundary. Nothing compiles the two together, so an edit
 * to `InterfaceListPage.tsx`'s helpers silently makes this rule wrong — in
 * whichever direction the edit moves. {@link OBJECTUI_DERIVATION_PREDICATES}
 * is exported and pinned VERBATIM by a fixture test
 * (`validate-page-visualization-bindings.test.ts`) so at least a change on
 * THIS side cannot be silent; a change on the objectui side is caught by the
 * showcase regression pin in that same file, which fails when a page that
 * renders today stops deriving.
 *
 * Mirroring BOTH of the renderer's predicates — the field TYPE first, then the
 * NAME regex fallback — rather than the type half alone is the ruled shape
 * (2026-09-03, on the measurement): the #13748 ruling targets silent WRONG
 * screens, not working derivations, so a lint stricter than the runtime would
 * refuse pages that render correctly today. Every skip below is written in
 * that direction.
 *
 * ## The skips
 *
 *   1. A page that is not `type: 'list'`, or carries no `interfaceConfig`.
 *      Only a `list` page mounts `InterfaceListPage`.
 *   2. An object this stack does not define, or one with no readable field map
 *      (ADR-0015 `external`) — the same skips every field-resolving rule in
 *      this package takes (ADR-0072 D1).
 *   3. `grid`, which needs no binding, and every whitelisted value the
 *      renderer does not derive a binding for at all — `chart` and `tree` have
 *      no deriver on this seam, so this rule has NO measured verdict about
 *      them and says nothing rather than guessing. That gap is honest
 *      under-coverage, not an assertion that they are fine.
 *   4. A `sourceView` that names no view THIS stack declares. The runtime
 *      hydrates a stored view body over the network
 *      (`InterfaceListPage.tsx:370-384`), so a build-time miss here is
 *      "unknowable", never "unbound".
 *
 * ## System / hidden fields
 *
 * The renderer skips hidden and framework-managed fields before applying any
 * predicate (`firstFieldMatching`, `InterfaceListPage.tsx:137-147`, via
 * `@object-ui/types`' `isSystemManagedField`). This rule takes the same skip
 * through THIS package's shared answer — the `system` flag, else
 * {@link SYSTEM_FIELDS} — rather than hand-copying objectui's name list, which
 * is the drift `system-fields.ts` exists to prevent. The two sets differ on a
 * handful of legacy spellings objectui also lists (`_id`, `createdAt`,
 * `modified`, `locked`, `space`, `company_id`); every one of those differences
 * makes THIS side skip FEWER fields, i.e. derive more and report less, which
 * is the safe direction under the ruling above.
 */

import { SYSTEM_FIELDS } from './system-fields.js';
import { recordsOf } from './object-graph.js';

export const PAGE_VISUALIZATION_WITHOUT_BINDING = 'page/visualization-without-binding';

export type PageVisualizationSeverity = 'error' | 'warning';

export interface PageVisualizationFinding {
  /**
   * `error` when the entry leads `allowedVisualizations` — it becomes the
   * forced `viewType` and the runtime reaches its renderer's refusal screen.
   * `warning` otherwise — the type is filtered out of the switcher silently.
   */
  severity: PageVisualizationSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `page "showcase_task_calendar" · interfaceConfig.appearance`. */
  where: string;
  /** Config path, e.g. `pages[0].interfaceConfig.appearance.allowedVisualizations[1]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

/**
 * One row of the renderer's derivation, transcribed.
 *
 * `types` is the TYPE predicate (checked first, in the object's declaration
 * order); `namePattern` is the NAME fallback's regex SOURCE, or `null` where
 * the renderer has no name fallback for that visualization. `viewBlocks` are
 * the keys on the referenced view that supply the binding directly — read
 * ahead of any derivation, exactly as `view.<viz> ?? derived` does.
 */
export interface VisualizationPredicate {
  visualization: string;
  /** The binding key the renderer would produce (what the message names). */
  binding: string;
  types: readonly string[];
  namePattern: string | null;
  viewBlocks: readonly string[];
}

/**
 * The mirrored table — objectui `f0f774b0`,
 * `packages/app-shell/src/views/InterfaceListPage.tsx`:
 * `SELECT_TYPES`/`DATE_TYPES`/`IMAGE_TYPES`/`LOCATION_TYPES` at `:149-151`
 * and `:203`, `defaultKanbanFromObject` `:153`, `defaultDateField` `:163`,
 * `defaultCalendarFromObject` `:170`, `defaultGalleryFromObject` `:175`,
 * `defaultGanttFromObject` `:185`, `defaultMapFromObject` `:253`.
 *
 * ⛔ Pinned verbatim by the fixture test. Editing a row here without editing
 * that pin is the drift this table's whole purpose is to make loud.
 */
export const OBJECTUI_DERIVATION_PREDICATES: readonly VisualizationPredicate[] = [
  {
    visualization: 'kanban',
    binding: 'groupByField',
    types: ['select', 'multiselect', 'radio', 'enum', 'boolean'],
    namePattern: 'status|stage|state|priority|category|kind',
    viewBlocks: ['kanban'],
  },
  {
    visualization: 'calendar',
    binding: 'startDateField',
    types: ['date', 'datetime', 'time'],
    namePattern: 'date|due|start|end|deadline|schedule',
    viewBlocks: ['calendar'],
  },
  {
    // `timeline` borrows `defaultCalendarFromObject` verbatim
    // (`InterfaceListPage.tsx:414`), and `resolveTimelineDateBinding`
    // (`plugin-list/src/ListView.tsx:411-433`) additionally accepts a
    // CALENDAR block's `startDateField` as the timeline axis — so a view that
    // declares only `calendar:` binds the timeline too.
    visualization: 'timeline',
    binding: 'startDateField',
    types: ['date', 'datetime', 'time'],
    namePattern: 'date|due|start|end|deadline|schedule',
    viewBlocks: ['timeline', 'calendar'],
  },
  {
    visualization: 'gallery',
    binding: 'coverField',
    types: ['image', 'file', 'attachment', 'avatar', 'photo'],
    namePattern: null,
    viewBlocks: ['gallery'],
  },
  {
    // Two DISTINCT date fields. The start leg prefers a
    // `/start|begin|kickoff/i` name and the end leg a
    // `/end|due|finish|deadline|close/i` name, each falling back to the next
    // date-typed field; either leg coming up empty yields no binding at all.
    visualization: 'gantt',
    binding: 'startDateField + endDateField',
    types: ['date', 'datetime', 'time'],
    namePattern: null,
    viewBlocks: ['gantt'],
  },
  {
    visualization: 'map',
    binding: 'locationField',
    types: ['location', 'geo', 'geolocation', 'geopoint', 'point'],
    namePattern: 'location|address|geo|coords?|place|venue',
    viewBlocks: ['map'],
  },
];

/** Needs no binding — always renders. */
const ALWAYS_BOUND = 'grid';

/** `visualization -> its row`, for the per-entry lookup. */
const PREDICATE_BY_VIZ: ReadonlyMap<string, VisualizationPredicate> = new Map(
  OBJECTUI_DERIVATION_PREDICATES.map((p) => [p.visualization, p]),
);

/** The gantt legs, kept next to the table they refine. */
const GANTT_START_NAME = /start|begin|kickoff/i;
const GANTT_END_NAME = /end|due|finish|deadline|close/i;

type AnyRec = Record<string, unknown>;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** The slice of one field the predicates read, in DECLARATION order. */
interface DerivableField {
  name: string;
  type?: string;
}

/**
 * The renderer's pre-filter, transcribed: hidden and framework-managed fields
 * never reach a predicate (`InterfaceListPage.tsx:137-147`).
 *
 * `undefined` is skip 2 — the object declares NO readable field map, so no
 * question about it can be answered (the `graphObjectOf` verdict in
 * `object-graph.ts`, spelled the same way: zero declared names is "unknowable",
 * not "nothing derives"). An EMPTY array is a real answer: the object declares
 * business fields and none of them satisfies any predicate.
 */
function derivableFields(obj: AnyRec): DerivableField[] | undefined {
  const declared = obj.fields;
  if (!isRec(declared) && !Array.isArray(declared)) return undefined;
  let declaredNames = 0;
  const out: DerivableField[] = [];
  for (const f of recordsOf(declared)) {
    const name = strName(f.name);
    if (!name) continue;
    declaredNames++;
    if (f.hidden === true || f.system === true || SYSTEM_FIELDS.has(name)) continue;
    out.push({ name, type: strName(f.type) });
  }
  return declaredNames === 0 ? undefined : out;
}

/** `firstFieldMatching` — first field, in declaration order, satisfying `pred`. */
function firstMatch(
  fields: readonly DerivableField[],
  pred: (f: DerivableField) => boolean,
): string | undefined {
  return fields.find(pred)?.name;
}

/** `types` first, then the `namePattern` fallback — the renderer's order. */
function deriveSimple(
  fields: readonly DerivableField[],
  predicate: VisualizationPredicate,
): string | undefined {
  const typed = firstMatch(fields, (f) => !!f.type && predicate.types.includes(f.type));
  if (typed) return typed;
  if (predicate.namePattern === null) return undefined;
  const byName = new RegExp(predicate.namePattern, 'i');
  return firstMatch(fields, (f) => byName.test(f.name));
}

/** `defaultGanttFromObject` — two distinct date fields, or nothing. */
function deriveGantt(
  fields: readonly DerivableField[],
  dateTypes: readonly string[],
): string | undefined {
  const dated = (f: DerivableField) => !!f.type && dateTypes.includes(f.type);
  const start =
    firstMatch(fields, (f) => dated(f) && GANTT_START_NAME.test(f.name))
    ?? firstMatch(fields, dated);
  if (!start) return undefined;
  const end =
    firstMatch(fields, (f) => dated(f) && f.name !== start && GANTT_END_NAME.test(f.name))
    ?? firstMatch(fields, (f) => dated(f) && f.name !== start);
  if (!end) return undefined;
  return `${start} + ${end}`;
}

/** The derivation for one visualization, or `undefined` when nothing resolves. */
function deriveBinding(
  fields: readonly DerivableField[],
  predicate: VisualizationPredicate,
): string | undefined {
  return predicate.visualization === 'gantt'
    ? deriveGantt(fields, predicate.types)
    : deriveSimple(fields, predicate);
}

/**
 * Every named list view addressable on one object, keyed the way
 * `resolveSourceView` (`InterfaceListPage.tsx:56-74`) reads them.
 *
 * The renderer reads `objectDef.listViews` on the MERGED object definition —
 * the metadata registry has already folded the stack's `defineView` aggregates
 * onto it by then. A lint stack has not, so the aggregates in `stack.views`
 * that target this object are folded in here, under the same keys, so the
 * page's `sourceView: 'map'` resolves to the same view both sides.
 */
function namedViewsFor(stack: AnyRec, obj: AnyRec | undefined, objectName: string): Map<string, AnyRec> {
  const views = new Map<string, AnyRec>();
  const add = (key: string, view: unknown) => {
    if (isRec(view) && !views.has(key)) views.set(key, view);
  };
  // The object's own declarations. `list_views` is a compatibility READ for
  // stored pre-settlement documents, exactly as the renderer spells it.
  const own = isRec(obj?.listViews) ? obj.listViews : isRec(obj?.list_views) ? obj.list_views : undefined;
  if (own) for (const [key, lv] of Object.entries(own)) add(key, lv);
  if (obj && isRec(obj.list)) add('list', obj.list);

  // `defineView` aggregates that target this object. A per-view
  // `data.object` binding wins over the aggregate's own, the resolution order
  // `validate-list-view-field-refs` reads.
  for (const view of recordsOf(stack.views)) {
    const aggregateObject = strName(view.objectName) ?? strName(view.object);
    const boundTo = (lv: AnyRec): string | undefined =>
      (isRec(lv.data) ? strName(lv.data.object) : undefined) ?? aggregateObject;
    if (isRec(view.listViews)) {
      for (const [key, lv] of Object.entries(view.listViews)) {
        if (isRec(lv) && boundTo(lv) === objectName) add(key, lv);
      }
    }
    if (isRec(view.list) && boundTo(view.list) === objectName) add('list', view.list);
  }
  return views;
}

/** A view "carries columns" only when its column list is non-empty (the renderer's test). */
function hasColumns(v: AnyRec): boolean {
  return Array.isArray(v.columns) && v.columns.length > 0;
}

/**
 * `resolveSourceView`, transcribed: the qualified `<object>.<key>` spelling
 * ADR-0017 expansion produces, then the bare key, then the object's default
 * `list` for the two default spellings; among the present candidates prefer
 * one that actually carries columns.
 */
function resolveSourceView(
  named: ReadonlyMap<string, AnyRec>,
  objectName: string,
  sourceView: string,
): AnyRec | undefined {
  const candidates = [
    named.get(`${objectName}.${sourceView}`),
    named.get(sourceView),
    ...(sourceView === 'default' || sourceView === 'list' ? [named.get('list')] : []),
  ].filter(isRec);
  return candidates.find(hasColumns) ?? candidates[0];
}

/**
 * Does the referenced view supply this visualization's binding directly?
 *
 * Block PRESENCE is the test, not block completeness: the renderer takes
 * `view.<viz>` whole (`view.<viz> ?? derived`), and whether that block is
 * itself complete is the VIEW door's question, already owned by
 * `view/layout-without-binding` and by `ListViewSchema`'s own
 * `allowedVisualizations` ⇄ `calendar` refinement. Asking it twice here would
 * report one defect on two doors with two different remedies.
 *
 * `options.<viz>` is read alongside the spec-canonical key because `ListView`
 * merges the legacy `options` twin (`ListView.tsx:411-433` for the date axis,
 * and the `options.map` bag `InterfaceListPage.tsx:432` forwards).
 */
function viewSuppliesBinding(view: AnyRec, predicate: VisualizationPredicate): boolean {
  const options = isRec(view.options) ? view.options : undefined;
  return predicate.viewBlocks.some((key) => isRec(view[key]) || (!!options && isRec(options[key])));
}

/** What the derivation looked for, in the author's vocabulary. */
function describeSearch(predicate: VisualizationPredicate): string {
  const types = `a field typed ${predicate.types.join(' / ')}`;
  const byName =
    predicate.namePattern === null
      ? ''
      : `, then a field whose NAME matches /${predicate.namePattern}/i`;
  return predicate.visualization === 'gantt'
    ? `two distinct fields typed ${predicate.types.join(' / ')} (a start and an end)`
    : `${types}${byName}`;
}

export function validatePageVisualizationBindings(stack: AnyRec): PageVisualizationFinding[] {
  const findings: PageVisualizationFinding[] = [];
  if (!isRec(stack)) return findings;

  const objects = new Map<string, AnyRec>();
  for (const obj of recordsOf(stack.objects)) {
    const name = strName(obj.name);
    if (name && !objects.has(name)) objects.set(name, obj);
  }

  const pages = recordsOf(stack.pages);
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    // Skip 1 — only a `list` page mounts `InterfaceListPage`.
    if (page.type !== 'list') continue;
    const cfg = isRec(page.interfaceConfig) ? page.interfaceConfig : undefined;
    if (!cfg) continue;

    const appearance = isRec(cfg.appearance) ? cfg.appearance : undefined;
    const allowed = appearance?.allowedVisualizations;
    if (!Array.isArray(allowed) || allowed.length === 0) continue;

    const objectName = strName(cfg.source) ?? strName(page.object);
    if (!objectName) continue;
    // Skip 2 — an object this stack does not define, or one with no readable
    // field map. Both are unknowable here, never a miss.
    const obj = objects.get(objectName);
    if (!obj) continue;
    const fields = derivableFields(obj);
    if (!fields) continue;

    // Skip 4 — a `sourceView` naming a view this stack does not declare. The
    // runtime hydrates a stored body over the network, so the block may exist
    // where no build can see it.
    const sourceView = strName(cfg.sourceView);
    let referencedView: AnyRec | undefined;
    if (sourceView) {
      referencedView = resolveSourceView(namedViewsFor(stack, obj, objectName), objectName, sourceView);
      if (!referencedView) continue;
    }

    const pageName = strName(page.name) ?? `#${pi}`;
    const where = `page "${pageName}" · interfaceConfig.appearance`;

    for (let ai = 0; ai < allowed.length; ai++) {
      const viz = strName(allowed[ai]);
      // Skip 3 — `grid` needs no binding; a value with no deriver on this seam
      // (`chart`, `tree`, or anything unregistered) gets no verdict at all.
      if (!viz || viz === ALWAYS_BOUND) continue;
      const predicate = PREDICATE_BY_VIZ.get(viz);
      if (!predicate) continue;

      if (referencedView && viewSuppliesBinding(referencedView, predicate)) continue;
      if (deriveBinding(fields, predicate)) continue;

      const leading = ai === 0;
      findings.push({
        severity: leading ? 'error' : 'warning',
        rule: PAGE_VISUALIZATION_WITHOUT_BINDING,
        where,
        path: `pages[${pi}].interfaceConfig.appearance.allowedVisualizations[${ai}]`,
        message:
          `page "${pageName}" whitelists the '${viz}' visualization, but nothing supplies its `
          + `\`${predicate.binding}\`: the renderer derives that binding from "${objectName}"'s `
          + `fields — it looks for ${describeSearch(predicate)} — and "${objectName}" has none`
          + (sourceView
            ? `, while the referenced view "${sourceView}" declares no \`${predicate.viewBlocks[0]}:\` block either.`
            : ', and this page references no view that declares it.')
          + ' '
          + (leading
            ? `'${viz}' LEADS \`allowedVisualizations\`, so it becomes the page's forced view type: `
              + 'every visitor lands on the renderer\'s "configuration required" refusal screen.'
            : `'${viz}' is filtered out of the visualization switcher SILENTLY — the switcher still `
              + 'appears (it is shown on whitelist length), the type is simply never there, with no '
              + 'message at build time or at run time.'),
        hint:
          `An interface page has no per-visualization binding key of its own — \`sourceView\` is the `
          + `one schema-legal channel. Point this page at a "${objectName}" list view that declares a `
          + `\`${predicate.viewBlocks[0]}:\` block (\`interfaceConfig.sourceView: '<view_key>'\`), give `
          + `"${objectName}" a field the derivation can find (${describeSearch(predicate)}), or drop `
          + `'${viz}' from \`appearance.allowedVisualizations\`.`,
      });
    }
  }

  return findings;
}
