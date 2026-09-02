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
 * it.
 *
 * ## [#14282] The SECOND finding class — a dotted reference the doors REFUSE
 *
 * #14107 left one half unreported: a dotted path whose head DOES resolve
 * (`owner.name`, `title.x`). That is a larger accept-set narrowing whose
 * failure mode is the OPPOSITE one — a loud `400 INVALID_FIELD` on the first
 * fetch rather than the silent blank this rule's first class gates — so it
 * was filed as #14282 and ruled there rather than folded in. This is that
 * ruling, landed: {@link LIST_VIEW_FIELD_DOTTED}.
 *
 * The class is scoped by the DOOR, not by the position table. A list view
 * compiles no joins, but that alone does not make every dotted binding a
 * defect: some list-view positions are read CLIENT-SIDE out of the fetched
 * row, and those walk a dotted path perfectly well when the payload carries
 * an embedded record. So only the positions whose name reaches a query door
 * are judged, and each is judged by the door's OWN verdict:
 *
 *  - **Projection** — `columns[]`. objectui's `ListView.tsx` builds the
 *    `$select` projection out of `schema.columns` ("Build a `$select`
 *    projection from the columns the listview actually shows"). Both doors
 *    refuse a dotted entry UNCONDITIONALLY, with no carve-out:
 *    `assertProjectionHasNoDottedPaths` filters `fields` on
 *    `typeof f === 'string' && f.includes('.')` and throws
 *    `INVALID_FIELD` / 400 (`packages/objectql/src/engine.ts`, #7589), and
 *    `assertProjectionFieldsExist` answers the same at the REST ingress
 *    (#7532). So every dotted column is reported, whatever its head's type.
 *  - **Filter** — the view's own `filter`, its `tabs[].filter`, its
 *    `userFilters.tabs[].filter`, and the two positions that DECLARE which
 *    names the end user may filter on (`filterableFields`, spelled by the
 *    spec as "bare field names enabled for end-user filtering", and
 *    `userFilters.fields`; objectui folds the resulting conditions into the
 *    fetched query through `buildEffectiveFilter`). Here the door does NOT
 *    refuse everything: `assertFilterIsMaterializable` judges a dotted key
 *    only when `classifyDottedFilterHead` classifies its head as `relation`,
 *    `virtual` or `scalar`, and deliberately passes structured/JSON heads
 *    (the #8371 ruling's carve-out — live on memory and mongodb), array
 *    (`multiple: true`) heads, file heads and heads it cannot read. This rule
 *    therefore asks that SAME classifier — imported, never re-listed — so the
 *    linter cannot refuse at author time what the door serves at run time.
 *
 * Positions deliberately NOT in this class, each for a measured reason:
 *
 *  - **`gantt.quickFilters[].field`** — the card's own named exception, and
 *    the measurement went the other way. The spec describes it as "Record
 *    field / dot-path", and objectui's `ObjectGantt.tsx` applies these filters
 *    IN MEMORY over the already-fetched rows ("Apply the active filters in
 *    memory"), resolving each through a walker that splits on `.` and steps
 *    through the record object (`resolveFilterKey`). No query door is
 *    involved, so a dot-path here is served, not refused. Excluded, and
 *    pinned.
 *  - **`gantt.tooltipFields[]`** — the same measurement: read client-side
 *    through `resolvePath(record, fieldName)`, which walks dots. Excluded.
 *  - **Every renderer binding** (`kanban` / `calendar` / `timeline` /
 *    `gallery` / `map` / `tree` scalars, `rowColor.field`, `hiddenFields`,
 *    `fieldOrder`, `grouping.fields`, `columns[].summary.field`,
 *    `columns[].prefix.field`). These reach no door this card measured. A
 *    dotted name at one of them is very likely still wrong — the gantt
 *    scalars, for instance, read `record[startDateField]` flat — but "likely
 *    wrong" is not the verdict a gate may invent (ADR-0072 D1), and the
 *    failure would be the SILENT class rather than this loud one. Recorded as
 *    a follow-up rather than guessed at here.
 *
 * `sort[]` keeps its owner: `validate-sortable-fields.ts` records that it
 * "deliberately does not add a third finding" for a dotted name because the
 * dotted verdict is "a posture shared with the FILTER and PROJECTION axes".
 * This card is that posture being ruled for the LIST-VIEW surface, on the two
 * axes this rule owns; the sort axis is untouched, and no finding here
 * duplicates one of its.
 *
 * A new rule id rather than a second use of the first one, per the family's
 * own convention: `validate-sortable-fields` ships `sort-field-unknown` /
 * `sort-field-unsortable` / `sort-field-unprovisioned`, and
 * `validate-searchable-fields` and `validate-dataset-references` do the same
 * — one id per finding CLASS, because `suppressWarnings: ['<rule-id>']` and
 * Studio's renderer filter on that string and must be able to name one class
 * without silencing the other.
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

import { classifyDottedFilterHead } from '@objectstack/spec/data';

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

/**
 * [#14282] A list-view field reference written as a DOTTED path at a position
 * whose name reaches a query door — where the door refuses it by name. See the
 * second-class section on this module for the scope and the measurements.
 */
export const LIST_VIEW_FIELD_DOTTED = 'list-view-field-dotted';

/**
 * Which query door a position's written name reaches, for the #14282 verdict.
 * `undefined` (the default for every position) means "no door this card
 * measured" — the position is judged for head existence only, exactly as
 * before.
 */
type DottedAxis = 'projection' | 'filter' | undefined;

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

/**
 * [#14282] The positions whose written name reaches a query DOOR, and which
 * door — the scope of {@link LIST_VIEW_FIELD_DOTTED}.
 *
 * Deliberately a SEPARATE table from {@link POSITIONS} rather than a third key
 * on `BlockPositions`: `POSITIONS` is the surface map (read key-by-key against
 * `ListViewShapeSchema`, and every field-naming key belongs in it), whereas
 * this is the much smaller set of positions whose runtime destination was
 * measured. Keeping them apart means a position added to the surface map does
 * NOT silently acquire a dotted verdict nobody measured — it defaults to
 * unjudged, the fail-open direction the seam and both doors document.
 *
 * `gantt.quickFilters` is the conspicuous absence and the card's named
 * exception: measured client-side, it ACCEPTS a dot-path. See the module note.
 */
const DOTTED_AXIS: Record<string, Record<string, DottedAxis>> = {
  '': { columns: 'projection', filterableFields: 'filter' },
  userFilters: { fields: 'filter' },
};

/** The door a position reaches, or `undefined` (unjudged for dotted paths). */
function dottedAxisAt(block: string, key: string): DottedAxis {
  return DOTTED_AXIS[block]?.[key];
}

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
 * [#14282] The message and hint for a dotted reference at a position whose
 * name reaches a query door, or `undefined` when the door itself leaves the
 * path unjudged.
 *
 * The wording deliberately borrows the DOORS' own sentences ("no backend
 * serves the path, so the predicate can only match zero records";
 * "denormalise the value onto '<object>' … and name that"). One vocabulary
 * across the doors is a stated value of both refusals — an author refused at
 * author time and one refused at request time must not be sent two different
 * ways about one string.
 */
function describeDottedRefusal(
  axis: Exclude<DottedAxis, undefined>,
  written: string,
  head: string,
  object: string,
  meta: { type?: string; multiple?: boolean } | undefined,
  subject: string,
): { message: string; hint: string } | undefined {
  const denormalise =
    `Denormalise the value onto "${object}" (a stored field, written when the source changes) ` +
    'and name that.';

  if (axis === 'projection') {
    // No classification: `assertProjectionHasNoDottedPaths` filters on
    // `f.includes('.')` and refuses every dotted entry, whatever the head is.
    return {
      message:
        `${subject} "${written}" is a dotted path. A list view declares no ADR-0021 \`include\`, ` +
        `so it compiles no joins, and the columns are sent as the query's projection — where a ` +
        `dotted entry is refused by name: \`assertProjectionHasNoDottedPaths\` on the engine ` +
        `boundary and \`assertProjectionFieldsExist\` at the REST ingress, both ` +
        `\`400 INVALID_FIELD\`. The view's FIRST fetch is refused, not rendered.`,
      hint:
        `Name a whole column of "${object}" — "${head}" — and read into its value in the client, ` +
        `or read the related record with \`expand\`. ${denormalise}`,
    };
  }

  // The FILTER door judges by head class and deliberately serves the rest.
  const headClass = classifyDottedFilterHead(meta);
  if (headClass === null) return undefined;
  const type = meta?.type ? `\`${meta.type}\`` : 'an unreadable';
  const because =
    headClass === 'relation'
      ? `whose head "${head}" is a ${type} field on object "${object}" — it stores the related ` +
        "record's id, not an embedded document, and a list view compiles no joins to traverse it"
      : headClass === 'virtual'
        ? `whose head "${head}" is a ${type} field on object "${object}" — its value is computed ` +
          'on read, so no driver materialises a column for the path to reach into'
        : `whose head "${head}" is a ${type} field on object "${object}" that stores a single ` +
          'scalar value — there is nothing beneath it for a path to reach';
  return {
    message:
      `${subject} "${written}" is a dotted path ${because}. No backend serves the path, so the ` +
      'predicate can only match zero records: the query is REFUSED rather than answered with an ' +
      'empty list (`assertFilterIsMaterializable` and the REST ingress both answer ' +
      '`400 INVALID_FIELD`).',
    hint: `Filter on a column of "${object}" itself. ${denormalise}`,
  };
}

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
    axis: DottedAxis = undefined,
  ): void => {
    const written = strName(raw);
    if (!written) return;
    const head = written.split('.')[0];
    if (!head) return;
    const verdict = resolveFieldPath(graph, object, head);
    if (isUnjudgeable(verdict) || !verdict) return;
    const account = describeFieldPathVerdict(verdict, head, subject);
    const dotted = head !== written;

    if (!account) {
      // The head resolves, so the FIRST class (#14107) has nothing to say.
      // The SECOND class (#14282) does, at the positions whose name reaches a
      // door — see the module note.
      if (!dotted || !axis) return;
      // `meta` is absent for a leaf resolved as a registry-injected column;
      // the filter classifier answers `null` for it, which is the fail-open
      // the seam documents. The projection door needs no head type at all.
      const refusal = describeDottedRefusal(
        axis,
        written,
        head,
        object,
        verdict.kind === 'ok' ? verdict.meta : undefined,
        subject,
      );
      if (!refusal) return;
      findings.push({
        // Always `error`, and not the position's own tier: the family's
        // severity line puts "refused outright" in the gating tier, and every
        // position in `DOTTED_AXIS` is refused outright by its door. (It
        // coincides with each of their declared tiers today; a position added
        // to that table with a `warning` tier would need this re-read.)
        severity: 'error',
        rule: LIST_VIEW_FIELD_DOTTED,
        where,
        path,
        message: refusal.message,
        hint: refusal.hint,
      });
      return;
    }

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
        const axis = dottedAxisAt(block, key);
        list.forEach((entry, i) => {
          check(entry, bound, severity, hostWhere, `${hostPath}.${key}[${i}]`, `${key}[${i}]`, axis);
        });
      }

      for (const [key, severity] of Object.entries(spec.entries ?? {})) {
        const list = host[key];
        if (!Array.isArray(list)) continue;
        const axis = dottedAxisAt(block, key);
        list.forEach((entry, i) => {
          const entryPath = `${hostPath}.${key}[${i}]`;
          if (typeof entry === 'string') {
            check(entry, bound, severity, hostWhere, entryPath, `${key}[${i}]`, axis);
            return;
          }
          if (!isRec(entry)) return;
          check(entry.field, bound, severity, hostWhere, `${entryPath}.field`, `${key}[${i}].field`, axis);
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
        check(field, bound, 'error', filterWhere, at, 'filter key', 'filter');
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
