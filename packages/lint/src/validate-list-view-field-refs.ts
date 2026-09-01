// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14107 — list-view field reference integrity] Every field a list view names
 * — its columns, its filter keys, its grouping, its row colour, its user
 * filters and every binding inside a `kanban` / `calendar` / `gantt` /
 * `timeline` / `gallery` / `map` / `tree` block — must name a field the bound
 * object actually has.
 *
 * ## The state this rule ends
 *
 * Measured on `@objectstack/cli` 17.2.0 against a real app, each mutation
 * applied on its own and confirmed on disk: `os validate` answered
 * `valid: true, warnings: []` and `os build` exited 0 with `✓ Build complete`
 * for a `columns[].field`, a `filter[].field`, a `grouping.fields[].field`, a
 * `kanban.groupByField` and a `gantt.startDateField` that named nothing on the
 * bound object. Re-measured on this branch's base (`origin/main`, both family
 * landings present) by running the whole reference-integrity suite and the
 * whole authoring-rule table over one mutated list view per position: every
 * position below reported NOTHING, with two exceptions that already have
 * owners and are excluded here — see "What this rule deliberately does NOT
 * own".
 *
 * ## Why a dangling list-view field reference is not merely inert
 *
 * The platform already ships the HARDER half of this check.
 * `view/layout-without-binding` (`packages/spec/src/kernel/
 * functional-completeness.ts`) warns when a binding block is **absent**,
 * on the reasoning that the renderer then falls back to literal default field
 * names and *the view renders empty while authoring reports success*. A block
 * that is PRESENT but names a field that does not exist reaches the identical
 * end state and, until this rule, got nothing. This is not a new category of
 * check; it is the same check, missing its easier case — the object is named
 * right there in `data.object`.
 *
 * ## Severity: two tiers, the `validateFlowTemplatePaths` precedent
 *
 * The suite's contract is severity-agnostic and one of its members already
 * carries both (`validate-flow-template-paths.ts`: a filter-position miss
 * gates, every other position advises). The line is the one
 * `validate-searchable-fields.ts` states for this whole family — *a consumer
 * that SKIPS an unknown name and renders the rest may be warned about; a
 * declaration that selects the wrong set, empties the surface or is refused
 * outright must not ship*:
 *
 *  - **`error`** — the miss changes what data the view returns, or collapses
 *    the layout it configures. A `filter` key that names nothing is compiled
 *    into the query as written and matches no record, so the list is an empty
 *    result indistinguishable from a true zero; the same for a user-filter
 *    field and a gantt quick filter. A `columns` entry is echoed by clients as
 *    the projection, where the REST ingress answers `400 INVALID_FIELD` for an
 *    unknown plain column (`assertProjectionFieldsExist`, #7532) — a refused
 *    first fetch, not a blank cell. A `kanban.groupByField` collapses every
 *    card into the uncolumned bucket; a `gantt` / `calendar` / `timeline`
 *    required date field leaves the renderer nothing to place, so the chart is
 *    blank; a map with no resolvable coordinate field plots no marker.
 *  - **`warning`** — the renderer drops one decoration and renders the rest:
 *    an optional colour / title / tooltip / cover binding, a stale
 *    `hiddenFields` entry that hides nothing, a stale `fieldOrder` entry that
 *    orders nothing.
 *
 * Every position in the card's measured table lands in the `error` tier, so
 * the rule fails `validate` AND `build` exactly where the card measured them
 * passing.
 *
 * ## Dotted paths — the HEAD segment is judged, hops are NOT walked
 *
 * The seam ({@link resolveFieldPath}) can walk `relationship.relationship.field`
 * hops, and its two other consumers do (#14105's dataset positions, #14148's
 * widget filter keys). **This rule deliberately does not**, and the reason is
 * the runtime, not economy of effort:
 *
 *  - A list view compiles **no joins**. `ListViewSchema` declares no
 *    ADR-0021 `include`, so there is no declaration that could make a
 *    relationship prefix joinable — the clause that makes hop-walking
 *    meaningful at a dataset position has no counterpart here.
 *  - All three query axes a list view reaches **refuse** a dotted path by
 *    name. Projection: `assertProjectionFieldsExist` at the REST ingress
 *    (#7532) and `assertProjectionHasNoDottedPaths` on the engine's own
 *    boundary (#7589) — measured byte-identical to *no projection at all*
 *    before the refusal landed. Filter: the #8371 dotted-head door, "no
 *    backend serves the path, so the predicate can only match zero records".
 *    Sort: `assertSortFieldsExist`'s `unknown` > `dotted` > unmaterializable
 *    ladder (#6994).
 *
 * So walking hops here would BLESS `owner.name` in a list view's columns — a
 * reference all three runtime doors refuse — which is the fail-open direction
 * the seam's own docblock reserves to the caller's judgement ("this function
 * answers EXISTENCE only"). It would also teach an AI author that a traversal
 * works on this surface when nothing implements it. Judging the HEAD segment
 * instead is the call `validate-sortable-fields.ts` (#9257) already made on
 * this same surface, for the same stated reason: linter and ingress gate must
 * agree about which names are "unknown" rather than disagreeing on dotted
 * paths.
 *
 * The result is strictly WIDER than the card's suggestion ("skip dotted
 * paths, as the chart rule already does"): a dotted path whose head resolves
 * to nothing (`ownr.name`) is reported here, where a skip would have passed
 * it. What stays unreported is a dotted path whose head DOES resolve — a
 * separate, larger accept-set narrowing ("a list view compiles no joins, so
 * any dotted reference is refused at query time") whose failure mode is a LOUD
 * 400 rather than the silent-empty class this card gates. Filed as a follow-up
 * rather than folded in.
 *
 * ## What this rule deliberately does NOT own
 *
 *  - **`sort[]`** — `validate-sortable-fields.ts` (#9257) owns it, on every
 *    one of the surfaces walked here, and adds a virtuality verdict this rule
 *    has no business restating. Re-measured on this base: a bad `sort[].field`
 *    already reports `sort-field-unknown`.
 *  - **`searchableFields[]`** — `validate-searchable-fields.ts` (#6674 /
 *    #4830) owns it, with a runtime-admissibility verdict on top of existence.
 *    Re-measured: a bad entry already reports `searchable-field-unknown`.
 *  - **`chart`** (`dataset` / `dimensions` / `values`) — those are ADR-0021
 *    dataset, dimension and measure NAMES, not fields on the bound object;
 *    `validateChartBindings` and `validateDatasetReferences` own that axis.
 *  - **`rowActions` / `bulkActions` / `columns[].action`** — action names,
 *    owned by `validateActionNameRefs`.
 *  - **`conditionalFormatting[].condition`** — a CEL predicate, owned by the
 *    expression rules.
 *  - **`pageName` / `tabs[].view` / `addRecord.formView`** — page and view
 *    names, owned by `validateViewPageRefs` and `lintViewRefs`.
 *  - **The `data.object` binding itself** — `validateObjectReferences` owns
 *    object-name reference sites, with the curated cross-package severity
 *    ladder a local "not in this stack ⇒ error" would not have. When the bound
 *    object does not resolve, this rule skips the whole list view (skip 1
 *    below) so one typo yields one finding rather than one per position.
 *
 * ## Skips — the same three every field-existence rule in this package takes
 *
 * Resolution is {@link resolveFieldPath}'s and its `unknowable` verdicts are
 * never reported (ADR-0072 D1: one dead finding and authors stop trusting the
 * linter): an object this stack does not define, an object that declares no
 * readable field map (ADR-0015 `external`, datasource-introspected schemas),
 * and a registry-injected system column. A fourth skip is this surface's own:
 * a list view whose `data.provider` is not `object` binds to no object graph
 * at all, so none of its field names is resolvable here.
 */

import { walkFilterFieldKeys } from './filter-walk.js';
import {
  describeFieldPathVerdict,
  indexObjectGraph,
  isUnjudgeable,
  resolveFieldPath,
  type ObjectGraph,
} from './object-graph.js';

/** A list-view field reference that resolves to no field on the bound object. */
export const LIST_VIEW_FIELD_UNKNOWN = 'list-view-field-unknown';

export type ListViewFieldRefSeverity = 'error' | 'warning';

export interface ListViewFieldRefFinding {
  /** See the two-tier note on this module. */
  severity: ListViewFieldRefSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `view "task" › list › kanban`. */
  where: string;
  /** Config path, e.g. `views[0].list.kanban.groupByField`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;
type Sev = ListViewFieldRefSeverity;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

/**
 * The field-naming positions on a list view, grouped by the block they live
 * under (`''` = the list view's own top level).
 *
 * Declarative on purpose: the failure this whole family exists to end is a
 * position nobody remembered to walk, and a table can be read against
 * `ListViewShapeSchema` key by key. Each entry carries its own severity
 * because the tier is a per-position judgement (see the module note), not a
 * per-rule one.
 *
 *  - `scalars` — the key holds ONE field name.
 *  - `lists` — the key holds an array of bare field names.
 *  - `entries` — the key holds an array whose members are either a bare field
 *    name or a record with a `field` key (`columns`, `grouping.fields`,
 *    `userFilters.fields`, `gantt.tooltipFields`, `gantt.quickFilters`).
 */
interface BlockPositions {
  scalars?: Record<string, Sev>;
  lists?: Record<string, Sev>;
  entries?: Record<string, Sev>;
}

const POSITIONS: Record<string, BlockPositions> = {
  // ── The list view's own top level ──
  '': {
    // A stale `hiddenFields` / `fieldOrder` entry hides and orders nothing —
    // the inert case, warned rather than gated.
    lists: { filterableFields: 'error', hiddenFields: 'warning', fieldOrder: 'warning' },
    entries: { columns: 'error' },
  },
  grouping: { entries: { fields: 'error' } },
  // The colour drops and every row still renders.
  rowColor: { scalars: { field: 'warning' } },
  userFilters: { entries: { fields: 'error' } },
  kanban: {
    // `columns` here are the fields shown ON a card, not the board's columns:
    // a stale entry leaves one blank line on the card and the board renders.
    scalars: { groupByField: 'error', summarizeField: 'warning' },
    lists: { columns: 'warning' },
  },
  calendar: {
    scalars: {
      startDateField: 'error',
      endDateField: 'warning',
      titleField: 'warning',
      colorField: 'warning',
    },
  },
  gantt: {
    scalars: {
      startDateField: 'error',
      endDateField: 'error',
      titleField: 'error',
      progressField: 'warning',
      dependenciesField: 'warning',
      colorField: 'warning',
      parentField: 'warning',
      typeField: 'warning',
      baselineStartField: 'warning',
      baselineEndField: 'warning',
      groupByField: 'warning',
      assigneeField: 'warning',
      effortField: 'warning',
    },
    // A quick filter is a FILTER: a stale one filters on a column that does
    // not exist and empties the chart.
    entries: { tooltipFields: 'warning', quickFilters: 'error' },
  },
  timeline: {
    scalars: {
      startDateField: 'error',
      titleField: 'error',
      endDateField: 'warning',
      groupByField: 'warning',
      colorField: 'warning',
    },
  },
  gallery: {
    scalars: { coverField: 'warning', titleField: 'warning' },
    lists: { visibleFields: 'warning' },
  },
  map: {
    // No resolvable coordinate ⇒ no marker is plotted at all.
    scalars: {
      latitudeField: 'error',
      longitudeField: 'error',
      locationField: 'error',
      titleField: 'warning',
      descriptionField: 'warning',
    },
  },
  tree: {
    // The parent pointer IS the hierarchy: a stale one flattens the tree.
    scalars: { parentField: 'error', labelField: 'warning' },
    lists: { fields: 'warning' },
  },
};

/** The nested field positions inside one `columns[]` entry record. */
const COLUMN_ENTRY_POSITIONS: Array<{ block: string; key: string; severity: Sev }> = [
  // `summary` aggregates a column; a stale name aggregates nothing and the
  // footer shows a number for a column nobody asked about.
  { block: 'summary', key: 'field', severity: 'error' },
  { block: 'prefix', key: 'field', severity: 'warning' },
];

/** Filter positions on a list view, as `[key path from the view, where suffix]`. */
const SILENT_EMPTY =
  'Nothing resolves the name at render time: the view renders successfully with a blank, ' +
  'empty or wrong result, and no gate reports the miss.';

/**
 * Validate every list view's field references against the object graph.
 * Returns findings (empty = clean). Pure `(stack) => Finding[]`; no I/O, and
 * safe on both the schema-parsed stack and the raw config the `lint` path
 * carries.
 */
export function validateListViewFieldRefs(stack: AnyRec): ListViewFieldRefFinding[] {
  const findings: ListViewFieldRefFinding[] = [];
  if (!isRec(stack)) return findings;

  const graph: ObjectGraph = indexObjectGraph(stack);
  if (graph.size === 0) return findings;

  /**
   * Judge ONE written reference at one position.
   *
   * The HEAD segment is what is resolved — see the dotted-path note on this
   * module. `written` is carried into the message so the author reads back the
   * string they typed rather than the segment the rule judged.
   */
  const check = (
    raw: unknown,
    object: string,
    severity: Sev,
    where: string,
    path: string,
    subject: string,
  ): void => {
    const written = strName(raw);
    if (!written) return;
    const head = written.split('.')[0];
    if (!head) return;
    const verdict = resolveFieldPath(graph, object, head);
    if (isUnjudgeable(verdict) || !verdict) return;
    const account = describeFieldPathVerdict(verdict, head, subject);
    if (!account) return;

    const dotted = head !== written;
    findings.push({
      severity,
      rule: LIST_VIEW_FIELD_UNKNOWN,
      where,
      path,
      message:
        account.message
        + (dotted
          ? ` (the head segment of the written reference "${written}"; a list view compiles `
            + 'no joins, so only the head can name a column here)'
          : '')
        + ` ${SILENT_EMPTY}`,
      hint:
        `Name a field that exists on "${object}", or drop the entry. ${account.detail}`,
    });
  };

  /** Every position on ONE list view record. */
  const checkListView = (listView: AnyRec, object: string | undefined, where: string, path: string): void => {
    if (!isRec(listView)) return;

    // ── Skip 4 (this surface's own): a list view bound to a non-`object`
    // provider names no fields on any object graph.
    const data = listView.data;
    if (isRec(data)) {
      const provider = strName(data.provider);
      if (provider && provider !== 'object') return;
    }
    if (!object) return;

    // ── Skips 1 & 2, once for the whole list view ──
    // An unresolvable base object is `validate-object-references.ts`' finding;
    // resolving anything against it here would turn one typo into a finding
    // per position.
    if (!graph.has(object) || !graph.get(object)) return;
    // Bound to a `const` so the narrowing survives into the nested closures
    // below (a parameter's narrowing does not).
    const bound: string = object;

    for (const [block, spec] of Object.entries(POSITIONS)) {
      const host = block === '' ? listView : listView[block];
      if (!isRec(host)) continue;
      const hostPath = block === '' ? path : `${path}.${block}`;
      const hostWhere = block === '' ? where : `${where} › ${block}`;

      for (const [key, severity] of Object.entries(spec.scalars ?? {})) {
        check(host[key], bound, severity, hostWhere, `${hostPath}.${key}`, key);
      }

      for (const [key, severity] of Object.entries(spec.lists ?? {})) {
        const list = host[key];
        if (!Array.isArray(list)) continue;
        list.forEach((entry, i) => {
          check(entry, bound, severity, hostWhere, `${hostPath}.${key}[${i}]`, `${key}[${i}]`);
        });
      }

      for (const [key, severity] of Object.entries(spec.entries ?? {})) {
        const list = host[key];
        if (!Array.isArray(list)) continue;
        list.forEach((entry, i) => {
          const entryPath = `${hostPath}.${key}[${i}]`;
          if (typeof entry === 'string') {
            check(entry, bound, severity, hostWhere, entryPath, `${key}[${i}]`);
            return;
          }
          if (!isRec(entry)) return;
          check(entry.field, bound, severity, hostWhere, `${entryPath}.field`, `${key}[${i}].field`);
          // The nested positions a `columns[]` entry carries.
          if (block !== '' || key !== 'columns') return;
          for (const nested of COLUMN_ENTRY_POSITIONS) {
            const sub = entry[nested.block];
            if (!isRec(sub)) continue;
            check(
              sub[nested.key],
              bound,
              nested.severity,
              `${hostWhere} › ${key}[${i}].${nested.block}`,
              `${entryPath}.${nested.block}.${nested.key}`,
              `${nested.block}.${nested.key}`,
            );
          }
        });
      }
    }

    // ── Filter KEYS: the view's own filter, its tabs' filters, and the tab
    // presets inside `userFilters`. `walkFilterFieldKeys` handles all three
    // authored filter shapes (Mongo condition object, `{ field, operator,
    // value }` rules, `[field, op, value]` triples) so a filter authored one
    // way is not judged while another is silently skipped (#3574's own
    // failure mode).
    const checkFilter = (filter: unknown, filterWhere: string, filterPath: string): void => {
      if (filter === undefined || filter === null) return;
      walkFilterFieldKeys(filter, filterPath, ({ field, path: at }) => {
        check(field, bound, 'error', filterWhere, at, 'filter key');
      });
    };

    checkFilter(listView.filter, `${where} › filter`, `${path}.filter`);

    const checkTabs = (tabs: unknown, tabsWhere: string, tabsPath: string): void => {
      if (!Array.isArray(tabs)) return;
      tabs.forEach((tab, i) => {
        if (!isRec(tab)) return;
        const name = strName(tab.name) ?? `#${i}`;
        checkFilter(tab.filter, `${tabsWhere}[${i}] "${name}" › filter`, `${tabsPath}[${i}].filter`);
      });
    };

    checkTabs(listView.tabs, `${where} › tabs`, `${path}.tabs`);
    if (isRec(listView.userFilters)) {
      checkTabs(
        listView.userFilters.tabs,
        `${where} › userFilters.tabs`,
        `${path}.userFilters.tabs`,
      );
    }
  };

  /** A list view's own object binding: `data: { provider: 'object', object }`. */
  const listViewObject = (listView: AnyRec): string | undefined => {
    const data = listView.data;
    return isRec(data) ? strName(data.object) : undefined;
  };

  // ── An object's built-in named list views ──
  // The same rungs `validate-searchable-fields` and `validate-sortable-fields`
  // walk, so the three field axes on this surface cannot cover different sets
  // of list views.
  const objects = asArray(stack.objects);
  for (let oi = 0; oi < objects.length; oi++) {
    const obj = objects[oi];
    if (!isRec(obj)) continue;
    const objName = strName(obj.name);
    const label = objName ? `object "${objName}"` : `objects[${oi}]`;
    if (!isRec(obj.listViews)) continue;
    for (const [key, lv] of Object.entries(obj.listViews)) {
      if (!isRec(lv)) continue;
      checkListView(
        lv,
        // A built-in list view belongs to its object; an inline `data.object`
        // may still retarget it (ADR-0047 allows the explicit binding).
        listViewObject(lv) ?? objName,
        `${label} › listViews.${key}`,
        `objects[${oi}].listViews.${key}`,
      );
    }
  }

  // ── `defineView` aggregates, plus the two standalone `views[]` shapes the
  // `PUT /api/v1/meta/view` door carries and the runtime publish gate
  // snapshots. Recognisers mirrored from the sort/search twins, which carry
  // the full notes: the flattened list overlay (#9313, `viewKind: 'list'` with
  // no nested `config`) and the ViewItem record (#10001, one level down
  // inside `config`).
  const views = asArray(stack.views);
  for (let vi = 0; vi < views.length; vi++) {
    const view = views[vi];
    if (!isRec(view)) continue;
    const viewLabel = strName(view.name) ?? strName(view.objectName) ?? `#${vi}`;
    // The aggregate's own binding is the fallback for a list view that
    // declares none — the same resolution order `validate-list-view-mode`
    // reads.
    const viewObject = strName(view.objectName) ?? strName(view.object);

    if (view.viewKind === 'list' && !isRec(view.config)) {
      checkListView(
        view,
        listViewObject(view) ?? viewObject,
        `view "${viewLabel}" (flattened list overlay)`,
        `views[${vi}]`,
      );
    }

    if (view.viewKind === 'list' && isRec(view.config)) {
      checkListView(
        view.config,
        listViewObject(view.config) ?? viewObject,
        `view "${viewLabel}" (ViewItem record)`,
        `views[${vi}].config`,
      );
    }

    if (isRec(view.list)) {
      checkListView(
        view.list,
        listViewObject(view.list) ?? viewObject,
        `view "${viewLabel}" › list`,
        `views[${vi}].list`,
      );
    }

    if (isRec(view.listViews)) {
      for (const [key, lv] of Object.entries(view.listViews)) {
        if (!isRec(lv)) continue;
        checkListView(
          lv,
          listViewObject(lv) ?? viewObject,
          `view "${viewLabel}" › listViews.${key}`,
          `views[${vi}].listViews.${key}`,
        );
      }
    }
  }

  return findings;
}
