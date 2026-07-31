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
import {
  RecordDetailsProps,
  RecordRelatedListProps,
  RecordHighlightsProps,
  RecordPathProps,
} from './component.zod';
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
  // Same prop, same meaning as the schema's "Related object name". Kept in the
  // overlay because it IS this block's data binding (`kind: 'binding'`, and
  // required, as the schema declares it) and because the trap #4340 found is
  // worth spelling out where an author reads it.
  RecordRelatedList: ['objectName'],
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
    ],
  },
  {
    tag: 'RecordDetails',
    schemaType: 'record:details',
    summary: 'Field-detail panel for the bound record. Config props from the spec RecordDetails schema.',
    schema: RecordDetailsProps,
    interactions: [
      { name: 'recordId', type: 'string | number', kind: 'controlled', description: 'The record to show.' },
      { name: 'objectName', type: 'string', kind: 'binding', description: 'The record’s object.' },
    ],
  },
  {
    tag: 'RecordHighlights',
    schemaType: 'record:highlights',
    summary: 'Highlights panel — a strip of key fields. Config props from the spec RecordHighlights schema.',
    schema: RecordHighlightsProps,
    interactions: [
      { name: 'recordId', type: 'string | number', kind: 'controlled', description: 'The record to summarize.' },
      { name: 'objectName', type: 'string', kind: 'binding', description: 'The record’s object.' },
    ],
  },
  {
    tag: 'RecordRelatedList',
    schemaType: 'record:related_list',
    summary:
      'Related child records via a lookup. `objectName` is the RELATED (child) object whose records are listed — NOT the parent; the parent record is bound by `recordId`, and `relationshipField` is the child field pointing back at it. Config props from the spec RecordRelatedList schema.',
    schema: RecordRelatedListProps,
    interactions: [
      { name: 'recordId', type: 'string | number', kind: 'controlled', description: 'The parent record whose children are listed.' },
      // Restates RecordRelatedListProps.objectName — ledgered in
      // REACT_OVERLAY_SHADOWS. This block is the ONE whose spec schema already
      // declares `objectName`, and it means the CHILD object; the overlay used
      // to gloss it as the parent, which is the contract conflict #4340 opened
      // on. Same meaning as the schema now, said in the words that keep an
      // author from writing the parent here.
      { name: 'objectName', type: 'string', kind: 'binding', required: true, description: 'The RELATED (child) object whose records this list renders — e.g. objectName="invoice" on an account page. NOT the parent object: the parent record is bound by recordId.' },
    ],
  },
  {
    tag: 'RecordPath',
    schemaType: 'record:path',
    summary: 'Stage/progress bar driven by a status field. Config props from the spec RecordPath schema.',
    schema: RecordPathProps,
    interactions: [
      { name: 'recordId', type: 'string | number', kind: 'controlled', description: 'The record whose stage to show.' },
      { name: 'objectName', type: 'string', kind: 'binding', description: 'The record’s object.' },
    ],
  },
  {
    tag: 'Block',
    schemaType: '(any)',
    summary: 'Escape hatch — render any registered component by type. <Block type="object-kanban" objectName="task" /> etc.',
    interactions: [
      { name: 'type', type: 'string', kind: 'binding', required: true, description: 'The registered component type to render.' },
    ],
  },
];
