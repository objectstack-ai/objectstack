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
 *    [#18835] A third consequence belongs to this tier and the two sentences
 *    above did not name it: a binding whose job is to RESTRICT or to ROUTE,
 *    where the miss is read as "no restriction" / "no route" on every row.
 *    Nothing is missing from the picture — which is exactly why it gates: a
 *    `gantt.lockField` that resolves to nothing unfreezes every row the author
 *    declared view-only, and a `gantt.objectField` that resolves to nothing
 *    makes every row answer the renderer's synthetic-row test, so no bar in
 *    the chart opens anything. Both are the shape Prime Directive #10 names —
 *    a capability advertised in the metadata and not delivered by the runtime
 *    — and both are worse DECLARED than omitted, because each renderer guards
 *    its behaviour on the key's mere presence.
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
 *  - **Filter** — the view's own `filter`, its `userFilters.tabs[].filter`,
 *    and the position that DECLARES which names the end user may filter on
 *    (`userFilters.fields`; objectui folds the resulting conditions into the
 *    fetched query through `buildEffectiveFilter`). The second such position,
 *    `filterableFields`, retired in @objectstack/spec 18 and is no longer a
 *    field position here: it is reported by name instead — see
 *    {@link LIST_VIEW_KEY_RETIRED}. Here the door does NOT
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
 *  - **`addRecord.formView`** — a view name, owned by `lintViewRefs`.
 *    (`pageName` was here too until #17063 retired the `type: 'page'` view
 *    mount, and `tabs[].view` until the list view's own `tabs` was retired; a
 *    list view carries neither reference now.)
 *  - **The `data.object` binding itself** — `validateObjectReferences` owns
 *    object-name reference sites, with the curated cross-package severity
 *    ladder a local "not in this stack ⇒ error" would not have. When the bound
 *    object does not resolve, this rule skips the whole list view (skip 1
 *    below) so one typo yields one finding rather than one per position.
 *    TWO exceptions, both this rule's own and both at the runtime save door,
 *    where the snapshot's `objects` is a set the door can name: a binding
 *    judged under a package closure (the next section), and a binding judged
 *    against the whole collection (the section after it).
 *
 * ## [#24563] A binding outside the written package's closure is REFUSED
 *
 * At the runtime save door, a write into a package is judged against that
 * package's closure (ruling #9612, `RuntimePackageScope` in
 * `runtime-gate.ts`): the package's own objects, its declared dependencies',
 * platform/system objects and provenance-less overlay rows. Every other object
 * is dropped from the snapshot before any rule runs. Skip 1 then read such a
 * binding as "an object this stack does not define" and skipped the whole
 * list view — so a list view written into a package and bound to an object
 * the package never declared a dependency on (or to an object that exists
 * nowhere) was stored with every field reference unjudged: `200`, no
 * advisory, and an unknown `columns` field the overlay door refuses `422`.
 * And no other rule judged the binding there: `validateObjectReferences`
 * does not run on a `view` write.
 *
 * So when the gate states the closure it narrowed to
 * (`ListViewFieldRefOptions.packageScope`), an unresolvable binding is
 * reported here, once per list view, as
 * {@link LIST_VIEW_OBJECT_OUTSIDE_CLOSURE} — never skipped:
 *
 *  - **`error`**, so the save door refuses the publish-mode write (`422`):
 *    the package's declared `dependencies` bound what it MAY reference, so the
 *    binding is not resolvable BY DECLARATION. It is the verdict the dataset
 *    door already gives the same reference under the same closure
 *    (`object-reference-unknown` on `datasets[].object`), and [#24669] the
 *    one the flow door gives a trigger object outside the same closure
 *    (`flow-trigger-unknown-object`, an `error` there and only there). An
 *    object that exists nowhere lands on the same verdict, because the
 *    closure is all this snapshot can see. The
 *    door judges writes only: a stored row is judged at its next save, and a
 *    draft is never gated.
 *  - **The field positions stay unjudged** for that list view. Judging them
 *    against the whole collection would judge the package against objects
 *    ruling #9612 says it may not reference; the remedy the hint names —
 *    declare the dependency — is what puts the object, and with it the field
 *    judgement, inside the closure.
 *  - **Only under a stated closure.** The CLI commands pass no scope and keep
 *    skip 1 exactly as before: there an unresolved binding may come from
 *    another package, and `defineStack`'s cross-reference check and
 *    `validateObjectReferences` own it. A write that names no package passes
 *    no scope either; it is judged against the whole collection, which is the
 *    next section.
 *
 * Skip 2 is unchanged under a closure: an object that IS in the closure but
 * declares no readable field map is still unjudgeable, never a finding.
 *
 * ## [#24668] A binding that exists nowhere in the whole collection is REFUSED
 *
 * A runtime write that names no package (an overlay write, `PUT
 * /api/v1/meta/view/:name` with no `?package=`) is judged against the WHOLE
 * collection: the host hands the gate every object the deployment serves —
 * the registry's (every installed package's, enabled or not, and the
 * platform's) folded with the stored rows, the merge `GET /meta/object`
 * answers from — and nothing narrows it (`resolveWritePackageScope` answers
 * no closure). Skip 1 read an unresolvable binding there as "another
 * package's object", which is the CLI's question and not the door's: there is
 * no other package for it to come from. So the list view was stored with
 * every field reference unjudged — `200`, no advisory — and failed only at
 * render, while the same body written into a package is refused
 * `list-view-object-outside-closure` and a dataset over an unknown object is
 * refused `object-reference-unknown`.
 *
 * So when the caller states the snapshot is that whole collection
 * (`ListViewFieldRefOptions.wholeCollection`, which the reference-integrity
 * suite sets for a runtime write with no closure in force), an unresolvable
 * binding is reported here, once per list view, at the key the binding was
 * read from, as {@link LIST_VIEW_OBJECT_UNKNOWN}:
 *
 *  - **`error`**, so the save door refuses the publish-mode write (`422`) —
 *    the verdict the two doors above give. The door judges writes only: a
 *    stored row is judged at its next save, and a draft is never gated.
 *  - **The field positions stay unjudged**, as under a closure: there is no
 *    field map to judge them against.
 *  - **The nearest name is in the hint, never the message.** The gate's
 *    differential fingerprints `rule`, `where`, `path` and `message`, and the
 *    suggestion is computed over the snapshot's object names, which an
 *    `object` write changes by one. In the message, a stored object's list
 *    view bound to `crm_acount` would read differently in the candidate once
 *    an unrelated write creates `crm_account`, and that write would be
 *    refused for a finding it did not make.
 *  - **⛔ An EMPTY collection is not a whole one.** No deployment serves zero
 *    objects — the platform's own are always there — so an empty graph means
 *    the host supplied no universe, and the rule judges nothing, exactly as
 *    before.
 *  - **⛔ Never on the CLI.** `os validate` / `os build` / `os lint` do not
 *    state it: a stack there is one app, and an unresolved binding may be a
 *    dependency package's object the app's stack does not carry.
 *
 * A closure wins over the statement when both are given: it is the narrower
 * set, and its remedy (declare the dependency) is the one that applies.
 *
 * ## Skips — the same three every field-existence rule in this package takes
 *
 * Resolution is {@link resolveFieldPath}'s and its `unknowable` verdicts are
 * never reported (ADR-0072 D1: one dead finding and authors stop trusting the
 * linter): an object this stack does not define, an object that declares no
 * readable field map (ADR-0015 `external`, datasource-introspected schemas),
 * and a hop THROUGH a registry-injected system column. A fourth skip is this
 * surface's own: a list view whose `data.provider` is not `object` binds to no
 * object graph at all, so none of its field names is resolvable here.
 *
 * [#16340] An injected column at the HEAD of a dotted filter key is not a skip
 * and never was — it resolves. What used to be missing was its TYPE, so
 * `classifyDottedFilterHead` read an unreadable head and this rule stayed
 * silent on `created_at.x` while `assertFilterIsMaterializable` refused it at
 * the door with the registry's own field map in hand. The graph now carries
 * the registry's definition for each injected column, so the two answer alike.
 * `id` remains unreadable — the DRIVER provisions the primary key and no
 * definition table describes it — and the door serves it, so this rule does too.
 */

import { classifyDottedFilterHead } from '@objectstack/spec/data';
import { ListViewSchema } from '@objectstack/spec/ui';

import { walkFilterFieldKeys } from './filter-walk.js';
import { retiredKeyRemedy } from './validate-retired-permission-residue.js';
import {
  describeFieldPathVerdict,
  indexObjectGraph,
  isUnjudgeable,
  resolveFieldPath,
  suggestName,
  type ObjectGraph,
} from './object-graph.js';

/** A list-view field reference that resolves to no field on the bound object. */
export const LIST_VIEW_FIELD_UNKNOWN = 'list-view-field-unknown';

/**
 * [#24563] A list view, judged under a package closure, whose bound object is
 * not in that closure — see the section of that name on this module.
 */
export const LIST_VIEW_OBJECT_OUTSIDE_CLOSURE = 'list-view-object-outside-closure';

/**
 * [#24668] A list view, judged against the whole collection the runtime save
 * door serves, whose bound object exists nowhere in it — see the section of
 * that name on this module.
 */
export const LIST_VIEW_OBJECT_UNKNOWN = 'list-view-object-unknown';

/**
 * [#14282] A list-view field reference written as a DOTTED path at a position
 * whose name reaches a query door — where the door refuses it by name. See the
 * second-class section on this module for the scope and the measurements.
 */
export const LIST_VIEW_FIELD_DOTTED = 'list-view-field-dotted';

/**
 * A list view that still carries a key `@objectstack/spec` retired — reported
 * BY NAME, with the tombstone's own prescription, never as a field reference.
 *
 * ## Why `os lint` needs it
 *
 * `retiredKey()` puts the refusal in the PARSE: `os validate` and `os build`
 * refuse such a list view with the prescription before any rule runs. `os
 * lint` never parses — it judges the `normalizeStackInput` output — and the
 * D2 conversion that strips the key is retired from the load path, so on a
 * non-`defineStack` source (JSON, YAML, a raw object) the key reaches this
 * rule as written. Until the key retired, this rule walked it as a field
 * position, so on that input `os lint` passed a list view the other two
 * commands refuse, or named a stale entry as an unknown FIELD rather than
 * naming the retirement. This finding is that missing channel: one `error`
 * per list view, at the key, whatever its value and whatever the binding
 * resolves to.
 *
 * ## The wording is READ, never retyped
 *
 * The prescription is the tombstone's published `description`
 * (`[REMOVED] <guidance>`) on `ListViewSchema`, the one wording the parse
 * raises too, so an author refused through either door is told the same
 * thing. The `hint` is its "Delete the key" sentence, cut by
 * {@link retiredKeyRemedy} exactly as the permission-residue rule cuts its
 * own. An unresolvable description yields NO finding rather than a hint this
 * module invented.
 *
 * ## Which keys
 *
 * {@link LIST_VIEW_RETIRED_KEYS_REPORTED} — the retired keys this rule used to
 * read as field positions. The other list-view tombstones were never field
 * positions here, so nothing in this rule ever gave them a wrong answer.
 */
export const LIST_VIEW_KEY_RETIRED = 'list-view-key-retired';

/**
 * The retired list-view keys reported by name (see {@link LIST_VIEW_KEY_RETIRED}).
 * `validate-react-page-props.ts` reads the same list for `<ListView>`'s props.
 */
export const LIST_VIEW_RETIRED_KEYS_REPORTED: readonly string[] = Object.freeze(['filterableFields']);

/** Strip the `[REMOVED] ` marker `retiredKey()` prefixes onto its guidance. */
const REMOVED_MARKER = /^\[REMOVED\]\s*/;

/**
 * The retirement's own prescription for a list-view `key`, read from the
 * tombstone's published description on `ListViewSchema`. `null` when the key
 * is not a tombstone there, or its description cannot be resolved.
 */
export function listViewRetiredKeyPrescription(key: string): string | null {
  const shape = (ListViewSchema as unknown as { shape?: Record<string, { description?: unknown }> }).shape;
  const described = shape?.[key]?.description;
  if (typeof described !== 'string' || !REMOVED_MARKER.test(described)) return null;
  const prescription = described.replace(REMOVED_MARKER, '').trim();
  return prescription.length > 0 ? prescription : null;
}

/**
 * The verdict head of a retirement prescription: its first clause, up to the
 * first ` — `, without the trailing period. Cut, never rewritten.
 */
export function retiredKeyVerdictHead(prescription: string): string {
  const dash = prescription.indexOf(' — ');
  const head = dash > 0 ? prescription.slice(0, dash) : prescription;
  return head.replace(/\.$/, '');
}

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

/**
 * What the caller states about the snapshot it hands this rule.
 *
 * `packageScope` — [#24563] the package closure the runtime publish gate
 * narrowed `stack.objects` to (`RuntimePackageScope`), present only when one
 * was in force. Absent on the CLI commands and on a write that names no
 * package.
 *
 * `wholeCollection` — [#24668] `true` when `stack.objects` is the whole
 * collection the deployment serves: the runtime publish gate with no closure
 * in force. Absent on the CLI commands, which keep skip 1 as before. Ignored
 * when `packageScope` is given.
 */
export interface ListViewFieldRefOptions {
  packageScope?: { readonly packageId: string; readonly dependencies: readonly string[] };
  wholeCollection?: boolean;
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
    lists: { hiddenFields: 'warning', fieldOrder: 'warning' },
    entries: { columns: 'error' },
  },
  grouping: { entries: { fields: 'error' } },
  // The colour drops and every row still renders.
  rowColor: { scalars: { field: 'warning' } },
  userFilters: { entries: { fields: 'error' } },
  kanban: {
    // `columns` here are the fields shown ON a card, not the board's columns:
    // a stale entry leaves one blank line on the card and the board renders.
    //
    // [#18565] `titleField` takes CALENDAR's level, not the level of the two
    // siblings that spell the key required. `KanbanConfigSchema` declares it
    // OPTIONAL (#16894, which copied `CalendarConfigSchema` for this exact key
    // and names `TimelineConfigSchema` / `GanttConfigSchema` — the two whose
    // rows below read `error` — as the siblings it deliberately does NOT
    // copy), and the board resolves a name no record carries through the
    // ADR-0079 display-name chain: measured in objectui `dda8f3815`,
    // `resolveKanbanTitleField` returns the written name, the card reads
    // `rec[titleField]`, finds nothing and falls to `getRecordDisplayName`.
    // Every card still renders, titled from a value the author did not ask
    // for — the warning tier's own case (one decoration dropped, the rest
    // rendered), where `groupByField` above is the error tier's (every card
    // collapses into one uncolumned lane).
    scalars: { groupByField: 'error', summarizeField: 'warning', titleField: 'warning' },
    lists: { columns: 'warning' },
  },
  calendar: {
    scalars: {
      startDateField: 'error',
      endDateField: 'warning',
      titleField: 'warning',
      colorField: 'warning',
      // [#18835] `allDayField` names a BOOLEAN field, and a declared one is
      // ABSOLUTE — the spec's own `⛔ No default field name` note. Measured in
      // objectui `dda8f3815`: `ObjectCalendar` maps every event with
      // `allDay: allDayField ? Boolean(record[allDayField]) : !endDate`, so a
      // name no record carries reads `undefined` on every row, `Boolean()`
      // answers false for all of them, AND the `!endDate` inference that would
      // have banded a dateless event is switched off by the key's mere
      // presence. Every event still renders and is still placed at its start:
      // what is lost is the all-day BAND, one decoration, which is this tier
      // and not `startDateField`'s (nothing to place at all). Not the error
      // tier's third consequence either — no restriction and no route rides on
      // it; a wrongly-banded event is still an event the user can click.
      allDayField: 'warning',
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
      // ── [#18835] Three of the ten objectui-lifted members (#15469) are
      // field bindings, and they share only their `.optional()`. Each is tiered
      // by what its own renderer does with a name no record carries, measured
      // in objectui `dda8f3815` (`plugin-gantt/src/ObjectGantt.tsx`).
      //
      // The stroke is opt-in and exceptional, and the renderer says so:
      // `borderColorRaw = borderColorField ? record[borderColorField] :
      // undefined` leaves `borderColor` undefined for every task, so every bar
      // keeps its fill and renders without an outline. `colorField`'s case,
      // eight rows up — one decoration dropped, the chart intact.
      borderColorField: 'warning',
      // ⛔ NOT a decoration: a declared WRITE GUARD that fails OPEN.
      // `locked: lockField ? !!record[lockField] : undefined` reads `undefined`
      // on every row and the drawer's `recLocked` falls the same way, so every
      // row the author froze becomes draggable, resizable, progress-draggable,
      // link-able, inline-editable and deletable — and the drag PERSISTS. The
      // chart looks perfect and the restriction the author declared is simply
      // not in force, which is the error tier's third consequence above.
      lockField: 'error',
      // The row's OWN object api name, and a miss takes the whole detail
      // surface with it: `isSyntheticRow` is `!!objectField &&
      // !String(rec[objectField] ?? '').trim()`, so a name no record carries
      // answers TRUE for every row. `onTaskClick` then never calls
      // `navigation.handleClick` and `renderRecordOverlay` returns null — no
      // bar in the chart opens a drawer or a detail page, uniformly and
      // silently. Strictly worse than omitting the key, which is what the
      // `!!objectField &&` guard exists to make safe.
      objectField: 'error',
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
  '': { columns: 'projection' },
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

/**
 * [#18836] Every field-naming position the two declarative tables above make
 * this rule walk, as `block.key` — a bare key for the list view's own top
 * level, and `columns.<block>.<key>` for a position nested inside a `columns[]`
 * entry.
 *
 * DERIVED, never hand-written: `validate-list-view-field-refs.test.ts` asserts
 * that its own case tables cover exactly this set, so a position added to
 * {@link POSITIONS} with no row over there fails that assertion on the commit
 * that adds it. The floor it replaced counted the test table's own rows, which
 * a position added HERE never moves — the direction #18565 came in through.
 *
 * Deliberately NOT re-exported from the package barrel, and deliberately a
 * FUNCTION rather than a frozen const. Both halves were measured on this
 * branch, `pnpm --filter @objectstack/lint build`, grepping `dist/` with
 * `validateListViewFieldRefs` as the bright control:
 *
 *  - Barrel: `src/index.ts` re-exports this module by NAME (no `export *`), so
 *    an export added here reaches no published entry — 0 occurrences in the
 *    `export {}` clause of `dist/index.js`, 0 in the `__export` map of
 *    `dist/index.cjs`, and 0 in all six `.d.ts`/`.d.cts` files, against 1, 1
 *    and 2 for the control (whose own 0 in the four `runtime*.d.*` files is
 *    what those entries declare, not a dead instrument).
 *  - Const vs function: as `const X = Object.freeze([...])` esbuild kept the
 *    initializer as dead weight — 1 occurrence in each of `dist/index.js`,
 *    `dist/runtime.js` and both `.cjs` siblings. As the function below it is
 *    tree-shaken: 0 occurrences in all 14 `dist/` artifacts, and 10 of the 14
 *    are byte-identical to a build of this package from the pre-export source
 *    — the four JS bundles and all six type files.
 *  - ⛔ The other 4 DO move, and `files[]` ships `dist` whole, so the honest
 *    statement is not "nothing in dist changed": `index.js.map`,
 *    `index.cjs.map`, `runtime.js.map` and `runtime.cjs.map` differ in
 *    `mappings` and `names` only, with `sources` equal and this symbol absent
 *    from `names`. A line offset, not a surface — but a measured one.
 *
 * It names positions only — no severity, no shape — so reading it can never
 * stand in for reading the tables.
 *
 * The two filter walks further down (`listView.filter`,
 * `userFilters.tabs[].filter`) are deliberately absent: they are open code, not
 * table rows, so there is nothing HERE to derive them from. ⛔ Absent from this
 * list is not absent from the test's account of itself — the test declares those
 * two as an explicit list and asserts it exactly, because a row of theirs
 * deleted in silence is the one thing the row-counting floor this replaced did
 * cover.
 */
export function listViewWalkedPositions(): string[] {
  return [
    ...Object.entries(POSITIONS).flatMap(([block, spec]) =>
      [
        ...Object.keys(spec.scalars ?? {}),
        ...Object.keys(spec.lists ?? {}),
        ...Object.keys(spec.entries ?? {}),
      ].map((key) => (block === '' ? key : `${block}.${key}`)),
    ),
    ...COLUMN_ENTRY_POSITIONS.map(({ block, key }) => `columns.${block}.${key}`),
  ];
}

/**
 * [#14282] The message and hint for a dotted reference at a position whose
 * name reaches a query door, or `undefined` when the door itself leaves the
 * path unjudged.
 *
 * The wording deliberately borrows the DOORS' own sentences ("no backend
 * serves the path"; "denormalise the value onto '<object>' … and name that").
 * One vocabulary across the doors is a stated value of both refusals — an
 * author refused at author time and one refused at request time must not be
 * sent two different ways about one string.
 *
 * [#22161] The message is one verdict sentence; which positions reach which
 * door, how each door judges a head, and what is left unjudged are
 * `os explain list-view-field-dotted`.
 */
function describeDottedRefusal(
  axis: Exclude<DottedAxis, undefined>,
  written: string,
  head: string,
  object: string,
  meta: { type?: string; multiple?: boolean } | undefined,
  subject: string,
): { message: string; hint: string } | undefined {
  // [#22161] One remedy line per door, still in the doors' words ("denormalise
  // the value onto … and name that"); what a denormalised field is (stored,
  // written when the source changes) is `os explain list-view-field-dotted`.
  const denormalise = `denormalise the value onto "${object}" and name that`;

  if (axis === 'projection') {
    // No classification: `assertProjectionHasNoDottedPaths` filters on
    // `f.includes('.')` and refuses every dotted entry, whatever the head is.
    return {
      message:
        `${subject} "${written}" is a dotted path, so the query projection refuses it ` +
        `(\`assertProjectionHasNoDottedPaths\`) and the view's first fetch answers 400 INVALID_FIELD`,
      hint:
        `Name the whole column "${head}" and read into it in the client, read the related record ` +
        `with \`expand\`, or ${denormalise}`,
    };
  }

  // The FILTER door judges by head class and deliberately serves the rest.
  const headClass = classifyDottedFilterHead(meta);
  if (headClass === null) return undefined;
  const type = meta?.type ? `\`${meta.type}\`` : 'an unreadable';
  const because =
    headClass === 'relation'
      ? "it stores the related record's id"
      : headClass === 'virtual'
        ? 'computed on read, never stored'
        : 'a single scalar value';
  return {
    message:
      `${subject} "${written}" is a dotted path whose head "${head}" is a ${type} field on ` +
      `"${object}" (${because}), so no backend serves the path (400 INVALID_FIELD)`,
    hint: `Filter on a column of "${object}" itself, or ${denormalise}`,
  };
}

/**
 * Validate every list view's field references against the object graph.
 * Returns findings (empty = clean). Pure `(stack) => Finding[]`; no I/O, and
 * safe on both the schema-parsed stack and the raw config the `lint` path
 * carries.
 */
export function validateListViewFieldRefs(
  stack: AnyRec,
  options?: ListViewFieldRefOptions,
): ListViewFieldRefFinding[] {
  const findings: ListViewFieldRefFinding[] = [];
  if (!isRec(stack)) return findings;

  const graph: ObjectGraph = indexObjectGraph(stack);
  const scope = options?.packageScope;
  // [#24668] The whole collection, stated — and only without a closure, which
  // is the narrower set and wins.
  const whole = !scope && options?.wholeCollection === true;
  // [#24563] Under a stated closure an empty graph is still a verdict: every
  // object binding is then outside it, and is refused below. [#24668] An empty
  // WHOLE collection is not: no deployment serves zero objects, so it means
  // the host supplied no universe (see the section of that name).
  // The retired-key finding below does not depend on any field map, so an
  // empty graph only switches the field positions off.
  const noUniverse = graph.size === 0 && !scope;

  /**
   * [#24563] One list view whose binding is not in the stated closure — see
   * the section of that name on this module. One finding per list view, at
   * the key the binding was read from.
   */
  const reportOutsideClosure = (
    closure: NonNullable<ListViewFieldRefOptions['packageScope']>,
    object: string,
    where: string,
    path: string,
  ): void => {
    const pkg = closure.packageId;
    findings.push({
      // `error`: the save door refuses it — see the section of that name on
      // this module for why, and for the flow door's matching verdict.
      severity: 'error',
      rule: LIST_VIEW_OBJECT_OUTSIDE_CLOSURE,
      where,
      path,
      message:
        `binds object "${object}", which is outside package "${pkg}"'s closure (its own objects, the objects of ` +
        `the packages its manifest declares in \`dependencies\`, and platform objects), so none of the view's ` +
        `field references are checked.` +
        suggestName(object, graph.keys()),
      hint:
        `Declare a dependency on the package that defines "${object}" in the \`dependencies\` of "${pkg}"'s ` +
        `manifest, or bind the view to an object inside that closure`,
    });
  };

  /**
   * [#24668] One list view whose binding exists nowhere in the whole
   * collection — see the section of that name on this module. One finding per
   * list view, at the key the binding was read from; the nearest name rides
   * the hint so the differential's fingerprint does not move with the
   * snapshot's object names.
   */
  const reportUnknownObject = (object: string, where: string, path: string): void => {
    findings.push({
      severity: 'error',
      rule: LIST_VIEW_OBJECT_UNKNOWN,
      where,
      path,
      message:
        `binds object "${object}", which exists nowhere in this deployment (no installed package, platform ` +
        `object or saved object has that name), so none of the view's field references are checked.`,
      hint:
        `Bind the view to an object that exists, or save the object "${object}" before you publish the view.` +
        suggestName(object, graph.keys()),
    });
  };

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
      // [#22161] The shared field-path verdict, plus which written reference
      // it judged when that was dotted. What the miss costs at each position,
      // and why only the head is judged, are `os explain list-view-field-unknown`.
      message:
        account.message
        + (dotted ? ` (the head of "${written}": a list view compiles no joins)` : ''),
      // [#22161] The remedy alone: the verdict's "Did you mean" names the
      // nearest field, so the object's field list (`account.detail`) is not
      // echoed.
      hint: `Name a field that exists on "${object}", or drop the entry`,
    });
  };

  /**
   * Every position on ONE list view record. `bindingPath` is the key the
   * binding `object` was read from, where an unresolvable binding is reported.
   */
  const checkListView = (
    listView: AnyRec,
    object: string | undefined,
    where: string,
    path: string,
    bindingPath: string,
  ): void => {
    if (!isRec(listView)) return;

    // ── A retired key, reported by name before any skip: its verdict does
    // not depend on the binding or on a field map (see LIST_VIEW_KEY_RETIRED).
    for (const key of LIST_VIEW_RETIRED_KEYS_REPORTED) {
      if (!Object.prototype.hasOwnProperty.call(listView, key)) continue;
      const prescription = listViewRetiredKeyPrescription(key);
      if (prescription === null) continue;
      findings.push({
        severity: 'error',
        rule: LIST_VIEW_KEY_RETIRED,
        where,
        path: `${path}.${key}`,
        message: `\`${key}\` is a retired list-view key: ${retiredKeyVerdictHead(prescription)}, so \`os validate\` and \`os build\` refuse this list view`,
        hint: retiredKeyRemedy(prescription),
      });
    }
    if (noUniverse) return;

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
    // [#24563] Except under a stated package closure, where the base object
    // was dropped by the closure or exists nowhere: refused once, and the
    // positions stay unjudged (see the section of that name on this module).
    // [#24668] And against the stated whole collection, where it exists
    // nowhere: refused once the same way.
    if (!graph.has(object)) {
      if (scope) reportOutsideClosure(scope, object, where, bindingPath);
      else if (whole) reportUnknownObject(object, where, bindingPath);
      return;
    }
    if (!graph.get(object)) return;
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

    // ── Filter KEYS: the view's own filter and the tab presets inside
    // `userFilters`. `walkFilterFieldKeys` handles all three authored filter
    // shapes (Mongo condition object, `{ field, operator, value }` rules,
    // `[field, op, value]` triples) so a filter authored one way is not judged
    // while another is silently skipped (#3574's own failure mode).
    //
    // The list view's OWN `tabs` is not walked: it is a `retiredKey` tombstone
    // on every list-view shape, and this rule judges the PARSED stack
    // (`input: 'parsed'` in the authoring-rule registry), where the key can
    // never arrive — the parse refuses it with its prescription first.
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

  /**
   * [#24563] The key a list view's binding was read from: its own
   * `data.object` when it declares one, otherwise the fallback the caller
   * resolved the binding through.
   */
  const bindingPathOf = (listView: AnyRec, path: string, fallback: string): string =>
    listViewObject(listView) !== undefined ? `${path}.data.object` : fallback;

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
        bindingPathOf(lv, `objects[${oi}].listViews.${key}`, `objects[${oi}].name`),
      );
    }
  }

  // ── `defineView` aggregates, plus the two standalone `views[]` shapes the
  // `PUT /api/v1/meta/view` door carries and the runtime publish gate
  // snapshots. Recognisers mirrored from the sort/search twins, which carry
  // the full notes: the flattened list overlay (#9313, `viewKind: 'list'` with
  // no nested `config`) and the ViewItem record (commit f1b5ad39a, one level down
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
    const viewObjectPath = strName(view.objectName) ? `views[${vi}].objectName` : `views[${vi}].object`;

    if (view.viewKind === 'list' && !isRec(view.config)) {
      checkListView(
        view,
        listViewObject(view) ?? viewObject,
        `view "${viewLabel}" (flattened list overlay)`,
        `views[${vi}]`,
        bindingPathOf(view, `views[${vi}]`, viewObjectPath),
      );
    }

    if (view.viewKind === 'list' && isRec(view.config)) {
      checkListView(
        view.config,
        listViewObject(view.config) ?? viewObject,
        `view "${viewLabel}" (ViewItem record)`,
        `views[${vi}].config`,
        bindingPathOf(view.config, `views[${vi}].config`, viewObjectPath),
      );
    }

    if (isRec(view.list)) {
      checkListView(
        view.list,
        listViewObject(view.list) ?? viewObject,
        `view "${viewLabel}" › list`,
        `views[${vi}].list`,
        bindingPathOf(view.list, `views[${vi}].list`, viewObjectPath),
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
          bindingPathOf(lv, `views[${vi}].listViews.${key}`, viewObjectPath),
        );
      }
    }
  }

  return findings;
}
