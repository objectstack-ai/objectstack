// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// React-tier component index (ADR-0081). Maps each curated public block that is
// injected into `kind:'react'` page source to (a) the SPEC zod schema that
// already defines its declarative/config props — the authoritative source, do
// not re-author — and (b) a thin hand-authored React-interaction overlay: the
// binding/controlled/callback props that are inherently React (objectName,
// recordId, mode, onSuccess, onRowClick, …) and so are absent from the
// declarative metadata schema.
//
// The contract the AI authors against (skills/objectstack-ui/references/
// react-blocks.md + .contract.json) is GENERATED from this index by
// `scripts/build-react-blocks-contract.ts` — never hand-edited.

import type { ZodTypeAny } from 'zod';
import { ListViewSchema, FormViewSchema } from './view.zod';
import { ComponentPropsMap } from './component.zod';
import { ChartConfigSchema } from './chart.zod';

export type ReactPropKind = 'data' | 'binding' | 'controlled' | 'callback';

/**
 * One hand-authored overlay prop.
 *
 * ⚠️ An overlay entry that shares a NAME with a prop of the block's spec schema
 * SHADOWS it: `build-react-blocks-contract` publishes the overlay's type and
 * description and drops the schema's, so the two can mean different things and
 * nothing says so. That is not hypothetical — see {@link REACT_OVERLAY_SHADOWS}
 * for the one that shipped. Add an overlay prop only when the schema does not
 * declare it; when a restatement really is wanted, ledger it there.
 */
export interface ReactInteractionProp {
  name: string;
  type: string;
  kind: 'binding' | 'controlled' | 'callback';
  required?: boolean;
  description: string;
}

/**
 * Overlay props that deliberately RESTATE a prop the block's spec schema also
 * declares, per block tag. Anything not listed here must be absent from the
 * schema — `react-blocks.test.ts` asserts the ledger equals the real collision
 * set, so the next accidental shadow fails a test instead of shipping.
 *
 * ## Why the ledger exists (#4340)
 *
 * `RecordRelatedListProps.objectName` is the RELATED (child) object — that is
 * what `record:related_list` means on every metadata surface, what
 * `validate-page-field-bindings` resolves its `columns` against, and what the
 * one registry component behind both surfaces consumes. The React overlay
 * nonetheless declared `objectName` a second time, glossed "The parent object"
 * by analogy with the blocks whose schema genuinely has no `objectName`. The
 * generated contract published only that gloss, so the react surface both
 * contradicted the spec AND lost any way to name the object it renders — and
 * the one live page authored against the gloss listed the wrong object.
 *
 * A shadow is therefore allowed only when it is deliberate and
 * MEANING-PRESERVING, and the reason has to be written down next to it.
 */
export const REACT_OVERLAY_SHADOWS: Readonly<Record<string, readonly string[]>> = {
  // Same prop, same meaning. The overlay restates it to publish the JSX
  // shorthand an author writes (`navigation={{ mode: 'none' }}`) together with
  // the React-side rule that pairs it with `onRowClick` — neither of which the
  // declarative schema has anywhere to say.
  ListView: ['navigation'],
};

/**
 * The `record:*` family is NOT part of the react tier, and never was in the
 * runtime (#4413). This is the ledger of that exclusion — the reason, and what
 * an author writes instead.
 *
 * ## Why they are out
 *
 * These blocks are RECORD-PAGE COMPOSITION blocks, not data blocks. Every one
 * of them reads its record from the shared record context a record page mounts
 * once (`RecordDetailView` fetches the record; N blocks render it), and they
 * are coupled THROUGH that context: `record:details` drops the fields a
 * mounted `record:highlights` registered, and the record-level inline-edit save
 * bar commits one draft for all of them under a single `ifMatch` version.
 *
 * A `kind:'react'` page mounts no such context, so `useRecordContext()` returns
 * null and each block renders its "bind a record to preview" placeholder — or,
 * for `record:related_list` (the one that reads `schema.objectName`), a list
 * that refuses to fetch because the parent id never arrives.
 *
 * The react tier nonetheless published `objectName` / `recordId` overlay props
 * on four of them, which no renderer reads. That contract was not merely
 * unimplemented, it was the wrong SHAPE: per-block bindings describe four
 * independent fetches of one record, which is precisely the coupling the shared
 * context exists to prevent. Implementing it would have fossilized that
 * (ADR-0082 D1 / Prime Directive #12), so the props were withdrawn instead —
 * ADR-0080 "capability ≠ contract".
 *
 * The react tier already has blocks that DO bind by their own props
 * (`<ObjectForm>` reads `schema.objectName`/`schema.recordId`, `<ListView>`
 * reads `schema.objectName` + `filters`), and on a react page the parent record
 * is ordinary React state — so the scenarios these blocks served are expressible
 * without a context to fake. {@link REACT_RECORD_BLOCK_ALTERNATIVES} is what the
 * lint tells an author who reaches for one.
 *
 * If the family is ever wanted here, the shape is a record SCOPE provider block
 * an author wraps around them (one fetch, shared context) — not per-block props.
 */
export const RECORD_CONTEXT_TYPE_PREFIX = 'record:';

/** Whether a registry component type needs the record page's record context. */
export function isRecordContextBlockType(type: string): boolean {
  return type.startsWith(RECORD_CONTEXT_TYPE_PREFIX);
}

/**
 * PascalCase tag the react scope injects for a registry type — objectui's
 * `toPascal` in `renderers/layout/react-page.tsx`, which builds the scope from
 * EVERY public non-container block. Restated here because that is what makes a
 * withdrawn block still reachable as `<RecordHighlights>`, and so what the
 * publish gate has to recognise.
 */
export function reactBlockTagFor(schemaType: string): string {
  return schemaType
    .split(/[-_:]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

/**
 * Every `record:*` type the spec declares, keyed by the tag the react scope
 * injects for it. Derived from `ComponentPropsMap` rather than restated, so a
 * record component added to the spec is covered by the publish gate the day it
 * lands.
 */
export const RECORD_CONTEXT_BLOCK_TAGS: ReadonlyMap<string, string> = new Map(
  Object.keys(ComponentPropsMap)
    .filter(isRecordContextBlockType)
    .map((type) => [reactBlockTagFor(type), type]),
);

/**
 * What to write instead, per withdrawn block. Read by the publish gate
 * (`react-block-needs-record-context`) so the error names the working prop-bound
 * block rather than only the broken one. Types without an entry fall back to the
 * generic advice: author the page as `type:'record'`.
 */
export const REACT_RECORD_BLOCK_ALTERNATIVES: Readonly<Record<string, string>> = {
  'record:details':
    '<ObjectForm objectName="…" mode="view" recordId={…} fields={[…]} /> — it binds by its own props.',
  'record:highlights':
    '<ObjectForm objectName="…" mode="view" recordId={…} fields={[…]} />, or read the record with useAdapter().findOne and lay the strip out in JSX.',
  'record:related_list':
    '<ListView objectName="<child object>" filters={[\'<lookup field>\', \'=\', parentId]} columns={[…]} /> — the parent binding is an ordinary filter on a react page.',
  'record:path':
    'read the record with useAdapter().findOne and render the stage bar in JSX (layout is this tier\'s job).',
};

export interface ReactBlockDef {
  /** PascalCase name the author writes in JSX, e.g. `<ObjectForm>`. */
  tag: string;
  /** The registry/render type, e.g. `object-form`. */
  schemaType: string;
  summary: string;
  /**
   * Spec zod schema that defines this block's declarative (config) props. The
   * generator extracts these as `data` props — authoritative, with descriptions.
   * Omit for blocks with no spec schema (then only the overlay is published).
   */
  schema?: ZodTypeAny;
  /**
   * Curate which spec-schema props to surface (high-signal subset; ADR-0080
   * "capability ≠ contract"). Definitions still come from the schema — this only
   * selects + orders. Omit to surface all of the schema's props.
   */
  dataProps?: string[];
  /** React-only props absent from the declarative schema (hand-authored). */
  interactions: ReactInteractionProp[];
}

// Shared overlays ----------------------------------------------------------
const OBJECT_NAME: ReactInteractionProp = {
  name: 'objectName',
  type: 'string',
  kind: 'binding',
  required: true,
  description: 'The object this block binds to (server-connected).',
};

export const REACT_BLOCKS: ReactBlockDef[] = [
  {
    tag: 'ObjectForm',
    schemaType: 'object-form',
    summary: "Server-connected create/edit/view form for one object. Config props come from the spec FormView schema; bind + wire it with the React props below.",
    schema: FormViewSchema,
    dataProps: ['layout', 'columns', 'tabPosition', 'drawerSide', 'drawerWidth', 'modalSize', 'splitDirection', 'sections', 'subforms', 'submitBehavior'],
    interactions: [
      OBJECT_NAME,
      { name: 'mode', type: "'create' | 'edit' | 'view'", kind: 'controlled', description: 'Create a new record, or edit/view an existing one — drive from React state.' },
      { name: 'formType', type: "'simple' | 'tabbed' | 'wizard' | 'split' | 'drawer' | 'modal'", kind: 'binding', description: 'Form presentation; drawer/modal render the form in a built-in overlay (use drawerSide/drawerWidth/modalSize).' },
      { name: 'recordId', type: 'string | number', kind: 'controlled', description: 'Which record to load (edit/view). The hook for master/detail.' },
      { name: 'fields', type: 'string[]', kind: 'binding', description: 'Limit/order the fields shown (defaults to the object form fields).' },
      { name: 'initialValues', type: 'Record<string, any>', kind: 'binding', description: 'Prefill values in create mode.' },
      // #9392 — catch-up with the registry inputs objectui#4648/#4901 published
      // for keys ObjectFormRenderer already read (descriptions adapted from the
      // `object-form` registration in objectui `plugin-form/src/index.tsx`, the
      // one registration both parity channels enumerate). Published from the
      // OVERLAY, not FormViewSchema `dataProps`, for the same reason as
      // `<ObjectChart drillDown>` above: FormViewSchema is also what a
      // declarative form VIEW parses, and only the react/registry tier
      // measurably reads these. Three registry inputs are deliberately NOT
      // declared (baselined in react-declaration-parity.baseline.json):
      // `initialData` (alias spelling of `initialValues` — aliases are not
      // promoted into spec), `mobile` (internal override, not an authoring
      // surface), `navigateOnSuccess` (parked pending the action-success-
      // navigation family ruling — see the baseline note on #9392).
      { name: 'customFields', type: 'any[]', kind: 'binding', description: 'Field definitions merged over the set generated from object metadata. With inline definitions and no data source, this becomes the only field source.' },
      { name: 'readOnly', type: 'boolean', kind: 'binding', description: 'Render every field read-only, whatever `mode` says.' },
      { name: 'modalCloseButton', type: 'boolean', kind: 'binding', description: "Show the modal presentation's close button (formType 'modal'; honoured by the modal form)." },
      { name: 'contentLayout', type: "'simple' | 'tabbed'", kind: 'binding', description: "How the modal presentation lays out sections; 'tabbed' needs more than one section to differ from 'simple'." },
      { name: 'confirmOnDiscard', type: 'boolean', kind: 'binding', description: 'Ask before discarding unsaved edits when a drawer/modal form is dismissed. Set false to close immediately.' },
      { name: 'submitText', type: 'string', kind: 'binding', description: 'Label of the submit button.' },
      { name: 'cancelText', type: 'string', kind: 'binding', description: 'Label of the cancel button.' },
      { name: 'nextText', type: 'string', kind: 'binding', description: 'Label of the next-step button (wizard).' },
      { name: 'prevText', type: 'string', kind: 'binding', description: 'Label of the previous-step button (wizard).' },
      { name: 'showSubmit', type: 'boolean', kind: 'binding', description: 'Show the submit button.' },
      { name: 'showCancel', type: 'boolean', kind: 'binding', description: 'Show the cancel button.' },
      { name: 'showReset', type: 'boolean', kind: 'binding', description: 'Show the reset button.' },
      { name: 'successMessage', type: 'string', kind: 'binding', description: 'Toast shown after a successful submit. Ignored when `submitBehavior` is set.' },
      { name: 'resetOnSuccess', type: 'boolean', kind: 'binding', description: 'Clear the form after a successful submit instead of keeping the saved values.' },
      { name: 'onSuccess', type: '(record) => void', kind: 'callback', description: 'Called after a successful save with the saved record (e.g. close a panel + reload).' },
      { name: 'onError', type: '(error: Error) => void', kind: 'callback', description: 'Called when the save fails.' },
      { name: 'onCancel', type: '() => void', kind: 'callback', description: 'Called when the user cancels.' },
      { name: 'submitHandler', type: '(values) => any | Promise<any>', kind: 'callback', description: 'Custom persistence instead of the default create/update.' },
    ],
  },
  {
    tag: 'ListView',
    schemaType: 'list-view',
    summary: "Server-connected object table with toolbar and switchable visualizations (grid/kanban/calendar/gantt/…). Config props come from the spec ListView schema.",
    schema: ListViewSchema,
    dataProps: ['columns', 'sort', 'searchableFields', 'userFilters', 'pagination', 'grouping', 'rowHeight', 'selection', 'rowActions', 'inlineEdit'],
    interactions: [
      OBJECT_NAME,
      { name: 'viewType', type: "'grid' | 'kanban' | 'gallery' | 'calendar' | 'timeline' | 'gantt' | 'map'", kind: 'binding', description: 'Which visualization to render (default grid). How you get a kanban/calendar/gantt of the object.' },
      { name: 'filters', type: "FilterArray e.g. ['status','=','active']", kind: 'controlled', description: 'ObjectQL base filter; drive from React state for tabbed/searched lists. ([field, op, value]; ops =, !=, >, <, contains, in; compound: [\"and\", […], […]]).' },
      { name: 'navigation', type: "{ mode: 'page' | 'drawer' | 'modal' | 'split' | 'none' }", kind: 'binding', description: 'What a row click does. Use { mode: \"none\" } when you handle clicks via onRowClick.' },
      { name: 'onRowClick', type: '(record) => void', kind: 'callback', description: "Called with the clicked row's record — the hook for master/detail." },
      { name: 'onNavigate', type: "(recordId, action: 'view' | 'edit') => void", kind: 'callback', description: 'Called for page-level navigation.' },
      { name: 'fields', type: 'string[]', kind: 'binding', description: 'Limit/order the columns shown (defaults to the object list fields).' },
      { name: 'options', type: 'Record<string, any>', kind: 'binding', description: 'View-type-specific options bag (kanban/calendar/gantt extras); prefer the typed spec props where they exist.' },
    ],
  },
  {
    tag: 'ObjectChart',
    schemaType: 'object-chart',
    summary: 'Chart over an object’s aggregated data. Bind objectName + aggregate; the axes name the aggregate’s RESULT COLUMNS (see chartAggregateResultKeys).',
    schema: ChartConfigSchema,
    // The spec ChartConfig shape IS the author contract again (#3729): the
    // renderer honors `type`/`xAxis.field`/`yAxis[].field`/`series[].name`
    // plus the axis presentation props (objectui#2880). #3701 had trimmed
    // them out because they were silently inert — that was a record of the
    // runtime gap, not the target state (ADR-0082 D1: spec is the protocol).
    //
    // `type` is the one field that cannot ride the props bag: it is the SDUI
    // envelope's component discriminator on every FLATTENED surface, so the
    // react-page wrapper parks an author `type` beside it and the renderer
    // reads it back. It is published here as the spec spells it; the internal
    // `chartType` spelling is no longer part of the author contract.
    dataProps: ['type', 'title', 'subtitle', 'description', 'height', 'xAxis', 'yAxis', 'series', 'colors', 'showLegend', 'showDataLabels', 'annotations', 'interaction'],
    interactions: [
      OBJECT_NAME,
      { name: 'filter', type: 'FilterArray', kind: 'controlled', description: 'ObjectQL filter scoping the data; drive from React state.' },
      { name: 'aggregate', type: "{ field?: string; function: 'count' | 'sum' | 'avg' | 'min' | 'max'; groupBy: string | { field: string; dateGranularity?: 'day' | 'week' | 'month' | 'quarter' | 'year' } }", kind: 'binding', description: 'Aggregation run against objectName. Result rows are keyed by the RAW FIELD NAMES: one column named after groupBy (the category) and one named after field (the value; the literal "count" for a fieldless count). Bind xAxis.field / yAxis[].field / series[].name to those names.' },
      { name: 'data', type: 'any[]', kind: 'binding', description: 'Static/precomputed data to chart directly instead of binding via objectName + aggregate.' },
      // #5022 — the segment drill. Published from the OVERLAY, not from
      // `dataProps`, and that placement is the whole point of the issue.
      //
      // `dataProps` reads `block.schema`, which is `ChartConfigSchema`, which is
      // also what a DASHBOARD widget's `chartConfig` parses. Declaring the drill
      // there would make `widget.chartConfig.drillDown` legal metadata that no
      // dashboard renderer reads (objectui `DatasetWidget` forwards exactly one
      // chartConfig key, `showLegend`) — the declared-but-not-delivered shape
      // this campaign removes elsewhere. The overlay publishes it on the react
      // tier ONLY, which is the tier that measurably reads it.
      //
      // The type string is not a second source of truth: `react-blocks.test.ts`
      // derives the key set from `ChartDrillDownSchema` and fails if this string
      // drifts from it. `renderType` would flatten the nested object to the
      // useless `'object'` anyway, which is why `aggregate` above is spelled out
      // the same way.
      { name: 'drillDown', type: "{ enabled?: boolean; filter?: Record<string, unknown>; title?: string; target?: 'drawer' | 'dialog' | 'navigate'; columns?: string[]; maxRows?: number }", kind: 'binding', description: "Click a segment to open the underlying records, filtered by the clicked category, in a drawer (or 'dialog', or 'navigate' to open the object's full list page instead — that arm needs host drill navigation and falls back to the drawer without it). Present = on; {} is enough. `filter`/`title` support ${event.*} interpolation; omit `filter` to derive it from aggregate.groupBy. Declared by ChartDrillDownSchema — NOT a dashboard widget key (a dataset-bound widget drills through the semantic layer instead), and not ReportSchema.drilldown (that is lowercase, boolean, report-only)." },
    ],
  },
  // NOTE: `<RecordDetails>` / `<RecordHighlights>` / `<RecordRelatedList>` /
  // `<RecordPath>` were published here until #4413 and are deliberately gone —
  // no renderer read the `objectName`/`recordId` this index declared for them.
  // See REACT_RECORD_BLOCK_ALTERNATIVES above for the ledger and the blocks
  // that replace them; the publish gate rejects them on a react page.
  {
    tag: 'Block',
    schemaType: '(any)',
    summary: 'Escape hatch — render any registered component by type. <Block type="object-kanban" objectName="task" /> etc. Not a way back to the record:* family: those need a record page\'s record context and are rejected here too (#4413).',
    interactions: [
      { name: 'type', type: 'string', kind: 'binding', required: true, description: 'The registered component type to render.' },
    ],
  },
];
