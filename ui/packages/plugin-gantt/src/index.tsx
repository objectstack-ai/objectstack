/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { ComponentRegistry, elementDataSourceBlock } from '@object-ui/core';
import {
  ElementDataSourceGate,
  useSchemaContext,
  type ElementDataSourceMapping,
} from '@object-ui/react';
import { useObjectTranslation } from '@object-ui/i18n';
import { ObjectGantt } from './ObjectGantt';

export { ObjectGantt };
export type { ObjectGanttProps, QuickFilterDef } from './ObjectGantt';

export { QuickFilterBar } from './QuickFilterBar';
export type {
  QuickFilterBarProps,
  QuickFilterField,
  QuickFilterOption,
  QuickFilterLabels,
} from './QuickFilterBar';

export { GanttView } from './GanttView';
export type {
  GanttViewProps,
  GanttTask,
  GanttTaskType,
  GanttViewMode,
  GanttDependency,
  GanttDependencyObject,
  GanttLinkType,
  GanttMarker,
} from './GanttView';
export { normalizeDependencies, normalizeTaskType } from './ObjectGantt';

export { normalizeShiftSegments, parseHHMM, shiftDayStart, bandAt } from './shifts';
export type {
  ShiftSegmentsConfig,
  ShiftBandConfig,
  NormShiftSegments,
  NormShiftBand,
} from './shifts';

export { ResourceWorkload } from './ResourceWorkload';
export type { ResourceWorkloadProps } from './ResourceWorkload';
export { computeWorkload } from './workload';
export type {
  WorkloadColumn,
  WorkloadOptions,
  ResourceCell,
  ResourceLoad,
} from './workload';

/**
 * What `ObjectGantt` reads for its own query: `objectName` (via `getDataConfig`,
 * which turns it into the `provider: 'object'` config the fetch resolves its
 * `resource` from), `filter` and `sort` (`ObjectGantt.tsx` —
 * `$filter: schema.filter`, `$orderby: convertSortToQueryParams(schema.sort)`).
 *
 * `columns` and a row cap are NOT mapped, because neither has a read site: a
 * gantt projects the fields its `gantt` config names (start/end/title/progress/
 * dependencies/…) rather than a column list, and the `$top` its reload does
 * send is the platform ceiling — a named constant, ⛔ not authorable
 * (objectui#7210, ruling a′). Writing a view's field list or page size onto
 * either key would hand the block a value it ignores, which is the defect this
 * wiring removes, one layer deeper. ⚠️ This paragraph used to say the reload
 * "issues no `$top` at all"; that stopped being true at objectui#7210 and is
 * corrected here because objectui#8769 puts the same `$top` on one more path.
 *
 * Inline data still WINS: `getDataConfig` prefers `schema.data` /
 * `schema.staticData` over the object name, so a gantt authored with both a
 * binding and inline rows renders the inline rows. ⚠️ It no longer renders
 * them UNPROCESSED — objectui#8769 routes the inline provider through the same
 * adapter query as every other provider, so a `filter` / `sort` mapped here
 * narrows and orders inline rows exactly as it does fetched ones, and the row
 * ceiling applies to them too.
 */
const OBJECT_GANTT_DATA_SOURCE: ElementDataSourceMapping = {
  filter: true,
  sort: true,
};

// Register component
export const ObjectGanttRenderer: React.FC<{ schema: any }> = elementDataSourceBlock(({ schema }) => {
  // `useSchemaContext()` may hand back a NULL adapter: a host with nothing
  // bound spells absence either way, and the seam declares both
  // (`DataSource | null | undefined`, objectui#7912). The widget below
  // declares the single spelling `dataSource?: DataSource`, so collapse the
  // two absences into that one here rather than widening the widget.
  const { dataSource: contextDataSource } = useSchemaContext() || {};
  const dataSource = contextDataSource ?? undefined;
  // The spec's `PageComponentSchema.dataSource` binding (objectstack#7121). A
  // gantt authored with the binding and no flat `objectName` produced no data
  // config at all, so `resolveDataSource` had nothing to fetch through: an empty
  // chart, no request, no diagnostic.
  // objectui#12920 — the unresolvable-view panel's title reads the bundle.
  const { t } = useObjectTranslation();
  return (
    <ElementDataSourceGate
      schema={schema}
      mapping={OBJECT_GANTT_DATA_SOURCE}
      dataSource={dataSource}
      testId="object-gantt"
      errorTitle={t('element.gantt.sourceUnresolved', {
        defaultValue: 'This gantt chart’s data source could not be resolved',
      })}
    >
      {(bound) => <ObjectGantt schema={bound} dataSource={dataSource} />}
    </ElementDataSourceGate>
  );
});

/**
 * What a task click does, as measured through the real `SchemaRenderer`
 * (objectui#11168 slice 4), with and without a record navigator the host
 * publishes. This block differs from the tree, the map and the timeline in two
 * ways. `ObjectGantt` defaults an absent key to a drawer. It also hands
 * `useNavigationOverlay` its own `onNavigate`, so the hook's
 * host-navigator branch (objectui#11293) is never reached here: `page` and
 * `new_window` go to the address the gantt derives from the current location.
 */
const OBJECT_GANTT_NAVIGATION_DESCRIPTION =
  'What a task click opens — the `{ mode, size, openNewTab, preventNavigation }` block a list view declares. '
  + 'With the key ABSENT a click opens the task\'s record in a drawer, this renderer\'s own default. '
  + '`mode` is an overlay (`drawer`, `modal`, `split`, `popover`), `new_window`, `page` or `none`, and a block written without `mode` takes the spec\'s `page` default. '
  + '`drawer`, `modal` and `popover` open the task\'s record in that overlay, and `split` opens it beside the chart, which stays drawn; `none` opens nothing. '
  + '`page` opens the task\'s record page in the same tab and `new_window` opens it in a new tab. '
  + 'The gantt builds that address itself from the page it is on and does not use a record navigator the host publishes, so a host that publishes one changes nothing: '
  + 'on the object\'s own list or view route (`…/OBJECT/view/VIEW`) the address is the record page `…/OBJECT/record/ID`, while on any other page, such as a custom page, `/OBJECT/record/ID` is appended to the current address. '
  + 'The object is `data.object` when `data` is the object provider, else `objectName`; on inline rows that name neither there is no record to open, and every mode, the default drawer included, opens nothing. '
  + '`preventNavigation: true` opens nothing whatever the mode, `openNewTab: true` opens the record page in a new tab and outranks every mode except `none`, and `size` sets the overlay width.';

// `objectName` is NOT a required input (objectui#7470): `getDataConfig` reads
// `data`, then `staticData`, then `objectName`, and the `object-gantt` zod
// schema (`requireRecordSource`, `77cb489b4`) is where "one of the three" is
// enforced — or a `dataSource.object` binding, which the gate lands on
// `objectName` and the refinement counts since objectui#11117. The input list is a flat declaration with a boolean `required`, so
// it states the rule in the description rather than growing a one-of form.
//
// `data` and `staticData` are declared (objectui#10394): `ObjectGanttSchema`
// declares both, and without an input the html tier's `validateTree` reported
// a block authored on either as `unknown-prop`. Their arms are the schema's:
// `data` is `ViewDataSchema`, a `{ provider, … }` OBJECT — `ObjectGantt` calls
// the ladder on the `'view-data'` arm, so a bare array under `data` is not a
// record source (objectui#8348), and this renderer hands `ObjectGantt` the
// schema alone, so no node key reaches it as a prop — and `staticData` is an
// array of records. Each description names only what `ObjectGantt` was
// measured to do with the key. Pinned in
// `__tests__/recordSourceInputs-10394.test.ts`.
//
// `filter` and `sort` are declared (objectui#8220): `ObjectGantt` lowers both
// onto the one `find` its reload issues for every record source (`$filter` /
// `$orderby`), and `@objectstack/spec`'s `object-gantt` row declares both, so
// without an input the html tier's `validateTree` reported a working key as
// `unknown-prop`. `filter` is the RULE-ARRAY arm only — the spec refuses the
// MongoDB-style record form at this door, and `type: 'array'` makes the html
// tier refuse it too. Pinned in `__tests__/queryKeysDeclared-8220.test.tsx`.
//
// The eleven presentation, persistence and read-only keys after `sort` are
// declared by objectui#11168 slice 4. `@objectstack/spec` 17.5.0's
// `object-gantt` row declares each of them, and the repo-wide parity guard
// (`apps/console`'s `registry-inputs-spec-parity`) loads this package and
// judges the block in both directions. Under objectui#11111 decision 3 = B each
// key was measured through the real `SchemaRenderer`, `ObjectGantt` and
// `GanttView`, and every one is honoured, so every one is declared. Where the
// row's own describe is true of this renderer, the description starts with it
// word for word; what follows it is what the measurement added. `gantt`'s
// description used to list `percentageField`, a member nothing reads and the
// spec refuses by name, and now states the block as the row declares it.
// Pinned in `__tests__/objectGanttInputs-11168.test.tsx`.
ComponentRegistry.register('object-gantt', ObjectGanttRenderer, {
  namespace: 'plugin-gantt',
  label: 'Object Gantt',
  category: 'view',
  inputs: [
    { name: 'objectName', type: 'string', description: 'ObjectQL object name. The record source is one of `data`, `staticData` and `objectName`; the `object-gantt` schema refuses a block that declares none of them, unless the node\'s `dataSource.object` names the object, which then lands on this key.' },
    { name: 'gantt', type: 'object', description: 'Gantt-timeline configuration, the author face — the same block `ListViewSchema.gantt` declares, and the one the renderer validates this node against. Taken WHOLE when present: the flat top-level spelling beside it is ignored. The spec requires `startDateField`, `endDateField` and `titleField`, which name the record fields a task\'s bar starts at, ends at and is titled by; the other members (`progressField`, `colorField`, `dependenciesField`, `parentField`, `viewMode`, `exportFileName`, …) are optional.' },
    { name: 'data', type: 'object', description: 'A `{ provider, … }` data-source configuration, read FIRST on the record-source ladder: a gantt carrying one never reaches `staticData` and never queries `objectName`. `{ provider: \'value\', items }` charts those rows, `{ provider: \'object\', object }` queries that object and `{ provider: \'api\', read }` reads through that request. A bare array is not this key’s shape and is not a record source: the gantt falls through to `staticData`, then `objectName`, so inline rows belong under `staticData`.' },
    { name: 'staticData', type: 'array', description: 'Inline records, read SECOND on the record-source ladder: a `data` configuration wins and this key is then never reached, while `objectName` is read AFTER it, so a gantt carrying both charts these rows and never queries that object. `filter` and `sort` narrow and order these rows exactly as they do fetched ones.' },
    { name: 'filter', type: 'array', description: 'Base query filter in the rule-array form `[{ field, operator, value }, ...]`, narrowing the tasks the gantt charts — from every record source it reads: the object, an `api` request, or inline rows. Context tokens such as `{current_user_id}` are resolved first, then the filter is lowered to `$filter` on the query. The MongoDB-style record form is not this key’s shape.' },
    { name: 'sort', type: 'array', description: 'Task order in `[{ field, order }]` form, ordering the rows the gantt charts. Lowered to `$orderby` on the same query.' },
    { name: 'navigation', type: 'object', description: OBJECT_GANTT_NAVIGATION_DESCRIPTION },
    { name: 'label', type: ['string', 'object'], description: 'Gantt label — the second link of the exported PNG/PDF file-name chain, after `gantt.exportFileName` and before the bound object\'s own label. A string is used as written, and an inline locale map (`{ en, "zh-CN", … }`) gives the entry for the display locale. The chart draws it nowhere else.' },
    { name: 'skipWeekends', type: 'boolean', description: 'Measure duration and auto-schedule math in WORKING days, skipping Saturdays and Sundays. The day view also folds the Saturday and Sunday columns out of its axis.' },
    { name: 'holidays', type: 'array', of: 'string', description: 'Additional non-working dates for the working calendar, ISO `yyyy-mm-dd` strings; folded into a Set for the duration math. A non-empty list turns the working calendar on by itself, without `skipWeekends`, and the day view folds each listed date\'s column out of its axis.' },
    { name: 'persistLayout', type: 'boolean', description: 'Opt OUT of layout and filter-chip persistence — only an explicit `false` disables it; the storage key is `objectName:viewName`. The object half is `objectName`, else `data.object`, and `gantt` on inline rows that name neither. With `false` the toolbar has no save-layout button and nothing is stored.' },
    { name: 'viewName', type: 'string', description: 'Layout-persistence scope, the second half of the `objectName:viewName` storage key (renderer default `\'default\'`). Two gantts on the same object with different names keep separate saved layouts, and a gantt restores only the layout saved under its own name.' },
    { name: 'markers', type: 'array', description: 'Extra vertical reference lines drawn like the Today marker — each `{ date, label?, color? }`: `date` places the line (a date outside the drawn range draws none), `label` is drawn against it, `color` paints it. `color` is a CSS colour, the theme\'s primary colour when omitted.' },
    { name: 'criticalPath', type: 'boolean', description: 'Seed the critical-path highlight ON; the toolbar toggle stays available either way' },
    { name: 'showBaselines', type: 'boolean', description: 'Render the planned-vs-actual baseline bars — ON unless an explicit `false` disables it. A task draws one only when `gantt.baselineStartField` and `gantt.baselineEndField` give it both baseline dates.' },
    { name: 'readOnly', type: 'boolean', description: 'Disable every write path on this gantt and lock the record drawer. A task click still opens the record, read-only.' },
    { name: 'mobileReadOnly', type: 'boolean', description: 'Auto read-only on narrow viewports — ON unless an explicit `false` disables it. Narrow is under 640px: the chart\'s own width once it is measured, the viewport\'s until then. A narrow chart\'s own write paths are gated as under `readOnly`, read-only badge included, but the record drawer is locked by `readOnly` alone, so a task\'s record still opens writable. `false` keeps a narrow chart editable, and `readOnly: true` locks the chart and the drawer at any width.' },
  ],
});

/**
 * ⛔ The bare `gantt` node type key is RETIRED (objectui#8008, maintainer
 * ruling 2026-09-09, route 3). `object-gantt` is the one spelling this plugin
 * serves.
 *
 * ## What was here, and why it went
 *
 * `ComponentRegistry.register('gantt', ObjectGanttRenderer, { namespace:
 * 'view', ... })` — a second key on the SAME renderer, which stored both
 * `view:gantt` and the bare `gantt` fallback. The declared face admitted only
 * one of the two: `ObjectGanttSchema.type` is the literal `'object-gantt'`, so
 * an author who annotated their node could not write the key the registry
 * accepted (`TS2322`), while an author who left the literal bare got no
 * checking at all. Two published faces, opposite verdicts.
 *
 * ## Why unregistering is the whole retirement here — measured, not assumed
 *
 * ⚠️ `BaseSchemaCore` ends `.passthrough()` (and `BaseSchema` closed with
 * `[key: string]: any` until objectui#8347), so a dropped MEMBER KEY is KEPT,
 * not refused, on the zod face (the objectui#7664 failure). That hazard does not reach a TYPE NAME on this
 * surface, and the reason is structural rather than lucky: no schema face in
 * `@object-ui/types` ever declared `gantt` as a component node type — measured
 * whole-repo, zero declarations, against a firing control of two for
 * `object-gantt` (`objectql.ts` + its Zod mirror). There is no arm to convert
 * into a named refusal, so unregistering IS the retirement.
 *
 * ⇒ Registration-only retirement. Contrast the `kanban` sibling in the same
 * batch (objectui#8802), which DID have a declared arm and therefore got a
 * named refusal rather than a deletion.
 *
 * ## ⛔ Two layers, and only one of them moved
 *
 * The string `gantt` also names a STORED `NamedListView.type` — the value
 * `CreateViewDialog` writes and every tenant's database holds. That layer is
 * untouched: `packages/plugin-view/src/ObjectView.tsx`'s `switch (viewType)`
 * maps the stored `gantt` view type onto the node type it emits, and it already
 * emits `object-gantt`. ⇒ Every gantt view any user ever created through the
 * console already renders through the surviving spelling; this retirement moves
 * zero stored documents.
 *
 * Pinned in `src/__tests__/bare-gantt-node-key-retired-8008.test.ts`.
 */
