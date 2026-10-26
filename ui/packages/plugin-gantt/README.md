# @object-ui/plugin-gantt

Gantt chart plugin for Object UI - Visualize project timelines and task dependencies.

## Features

- **Gantt Charts** - Interactive Gantt chart visualization
- **Full CRUD on the timeline** - Create via toolbar quick-create dialog, edit
  inline or via drag, delete via row kebab → confirmation dialog, view detail
  via click → navigation overlay
- **Drag-and-drop rescheduling** - Drag a bar to move it; drag either edge to resize
  start/end (snaps to whole days, persists via `dataSource.update`)
- **Task Dependencies** - Link tasks with dependencies
- **Timeline View** - Visualize project schedules
- **Task Management** - Create, edit, and track tasks
- **Responsive** - Scrollable timeline for large projects
- **Customizable** - Tailwind CSS styling support

### Create / Edit / Delete / View

When used through `ObjectGantt` (the wiring the framework uses for the
`gantt` stored view type) the full CRUD lifecycle is wired automatically:

- **Create** — click the toolbar "+ New Task" button. A small dialog opens
  pre-filled with start/end (today → +7 days). On submit the component calls
  `dataSource.create(objectName, { [titleField], [startDateField],
  [endDateField], …required fields })` and optimistically inserts the new
  record into the chart.
- **Edit** — drag the bar (move), drag an edge (resize), or hover the row
  and pick **Edit inline** from the kebab menu to rename / change dates
  inline. All paths funnel through `dataSource.update`.
- **Delete** — hover a row, open the kebab menu, choose **Delete**. A
  shadcn `<AlertDialog>` asks for confirmation; on confirm `dataSource.delete`
  removes the record (optimistic local removal, reverts on failure).
- **View / Edit / Delete in a side drawer** — click anywhere on a row
  (or pick **View details** in the kebab) to open a right-side drawer
  containing the standard `<DetailView>` from `@object-ui/plugin-detail`.
  The drawer ships the same record-header chrome used everywhere else
  (badges, summary chips, **Edit** + **Inline edit** buttons, and a
  **…** more-actions menu with **Delete**). Edits via inline-edit save
  through `dataSource.update` and merge into the local timeline state;
  delete confirms via the platform standard dialog and removes the row
  on success. Fields are auto-derived from the record (object schema is
  fetched by `DetailView` itself when `dataSource.getObjectSchema` is
  available).

  Override it with `navigation` in the `properties` bag — the spec's
  `NavigationConfig`, `{ mode, size, openNewTab, preventNavigation }`. What a
  task click does with each member, measured through the real `SchemaRenderer`
  (objectui#11168 slice 4):

  - **absent** — the drawer above, this renderer's own default;
  - `drawer`, `modal`, `popover` — the task's record in that overlay; `split` —
    the record beside the chart, which stays drawn;
  - `page`, and a block written without `mode` (the spec's `page` default) —
    the record page in the same tab; `new_window` — the same page in a new tab;
  - `none` — nothing; `preventNavigation: true` — nothing, whatever the mode;
    `openNewTab: true` — the record page in a new tab, outranking every mode
    except `none`; `size` — the overlay width.

  ```json
  { "type": "object-gantt", "properties": { "objectName": "project_task", "gantt": { "startDateField": "start_date", "endDateField": "end_date", "titleField": "name" }, "navigation": { "mode": "page" } } }
  ```

  The record-page address is the gantt's own. It derives it from the page it
  is on and does not use a record navigator the host publishes
  (objectui#11293), so mounting one changes nothing. On the object's own list
  or view route (`…/project_task/view/all`) the address is the record page
  `…/project_task/record/ID`; on any other page, such as a custom page, the
  gantt appends `/project_task/record/ID` to the current address. The object is
  `data.object` when `data` is the object provider, else `objectName`; on
  inline rows that name neither, no mode opens anything, the default drawer
  included.

  *Which* detail layout opens is not authorable here: assign a `record` page
  to the object and let `isDefault` pick the one that opens. Page assignment
  is what resolves a detail layout; this block only decides **how** that
  detail is surfaced. `navigation`'s schema refuses any key it does not
  declare: an undeclared key rejects the whole config, so the `mode` beside it
  never takes effect either. `@objectstack/spec`'s `NavigationConfigSchema`
  owns the member list.


### Drag-and-drop rescheduling

When the renderer is used through `ObjectGantt` (the standard wiring used by
the framework's `gantt` stored view type) drag is enabled automatically: each bar
shows a grab cursor; the body drags the entire task, and the two thin edge
zones (≈6px) resize start or end. Pointer motion snaps to whole days using
the current column width. A move shifts the start and the end by the same
number of calendar days and keeps each one's time of day, so across a
daylight-saving change a day task keeps its length in days and a 10:00 start
stays at 10:00; dragging a summary moves every task beneath it the same way.
With shift bands configured (`timeSegments`), a day-view drag moves by bands
instead and keeps the bar's elapsed length. On release `ObjectGantt` issues an
optimistic local patch and a `dataSource.update(objectName, recordId, { [startDateField]: …,
[endDateField]: … })`. If the request fails the local state is reverted.

When you embed the lower-level `<GanttView>` directly, pass `onTaskUpdate`
to opt in:

```tsx
import { GanttView } from '@object-ui/plugin-gantt';
import type { GanttTask } from '@object-ui/plugin-gantt';

// `tasks` is whatever you loaded; `save` stands in for your own write path.
declare const tasks: GanttTask[];
declare const save: (id: GanttTask['id'], changes: { start: Date; end: Date }) => void;

const editableChart = <GanttView
  tasks={tasks}
  onTaskUpdate={(task, { start, end }) => {
    // `changes` is a Partial<Pick<GanttTask, 'title' | 'start' | 'end' | 'progress'>>:
    // only the keys the edit actually touched are present. A bar drag/resize
    // sends start + end, but the progress grip sends just { progress } — so
    // guard, or a progress drag writes both dates back as undefined.
    if (!start || !end) return;
    save(task.id, { start, end });
  }}
/>;
```

## Installation

```bash
pnpm add @object-ui/plugin-gantt
```

## Usage

### Automatic Registration (Side-Effect Import)

```typescript
// In your app entry point (e.g., App.tsx or main.tsx)
import '@object-ui/plugin-gantt';

// Now you can use gantt types in your schemas.
// The gantt is RECORD-DRIVEN: it names a data source and the fields to read.
// It does not take a task array — see "Schema API" below. Its props go in the
// node's `properties` bag, and its field mapping in the bag's `gantt` block.
const schema = {
  type: 'object-gantt',
  properties: {
    objectName: 'project_tasks',
    gantt: {
      titleField: 'name',
      startDateField: 'start_date',
      endDateField: 'end_date',
      progressField: 'completion_percentage'
    }
  }
};
```

### What the side-effect import registers

Registration is *only* a side effect of importing the package — the single
`import '@object-ui/plugin-gantt'` above is the whole of it. There is no
components map to iterate over: importing the entry point runs the
`ComponentRegistry.register(...)` calls at the bottom of `src/index.tsx`, which
claim these schema types:

| Schema `type` | Namespaced key | Renderer |
| --- | --- | --- |
| `object-gantt` | `plugin-gantt:object-gantt` | `ObjectGanttRenderer` |

Both spellings of the surviving key resolve — `register` stores the namespaced key
*and* a bare-`type` fallback. It declares four inputs: `objectName`, the `gantt`
configuration object, and the two other record sources, `data` and `staticData`.
`objectName` is not a required input: the record source is one of `data`,
`staticData` and `objectName` (read in that order), and the `object-gantt` schema
refuses a block that declares none of them, unless the node's `dataSource.object`
names the object, which the registration then lands on `objectName`. `data` is a
`{ provider, … }` data-source configuration, never a bare array; inline rows go
under `staticData`.

> **The bare `gantt` key is retired** (objectui#8008, ruled 2026-09-09). This
> table used to carry a second row, `gantt` / `view:gantt`, on the same renderer.
> The registry accepted both spellings while the published declaration admitted
> only one — `ObjectGanttSchema.type` is the literal `'object-gantt'` — so an
> author who annotated their node could not write the key the registry took.
> `object-gantt` is now the one spelling.
>
> ⚠️ The **stored view type** `"gantt"` — what a saved `listViews[].type` holds —
> is a **different layer and is unchanged**. `ObjectView` maps a stored `gantt`
> view onto the `object-gantt` node type, so no saved view moves.

`ObjectGanttRenderer` is a thin wrapper: it pulls `dataSource` off the renderer
context and hands the schema to `ObjectGantt`.

### Public exports

The package exports components, helpers and their types — not a registry map:

```typescript
import {
  ObjectGantt, // ObjectQL-integrated gantt: loads records, writes back edits
  ObjectGanttRenderer, // the registered renderer for `object-gantt`
  GanttView, // the standalone timeline component
  QuickFilterBar, // the toolbar's quick-filter dropdowns
  ResourceWorkload, // resource × period workload grid
  normalizeDependencies, // raw dependency-field value -> GanttDependency[]
  normalizeTaskType, // raw type-field value -> GanttTaskType
  normalizeShiftSegments, // raw timeSegments config -> NormShiftSegments
  parseHHMM,
  shiftDayStart,
  bandAt,
  computeWorkload,
} from '@object-ui/plugin-gantt';

import type {
  ObjectGanttProps,
  GanttViewProps,
  GanttTask,
  GanttTaskType,
  GanttViewMode,
  GanttDependency,
  GanttDependencyObject,
  GanttLinkType,
  GanttMarker,
  QuickFilterDef,
  QuickFilterBarProps,
  QuickFilterField,
  QuickFilterOption,
  QuickFilterLabels,
  ShiftSegmentsConfig,
  ShiftBandConfig,
  NormShiftSegments,
  NormShiftBand,
  ResourceWorkloadProps,
  WorkloadColumn,
  WorkloadOptions,
  ResourceCell,
  ResourceLoad,
} from '@object-ui/plugin-gantt';
```

To serve the gantt under a registry key of your own, register the exported
renderer under that key:

```typescript
import { ComponentRegistry } from '@object-ui/core';
import { ObjectGanttRenderer } from '@object-ui/plugin-gantt';

ComponentRegistry.register('my-gantt', ObjectGanttRenderer, {
  namespace: 'my-app',
});
```

## Schema API

### Gantt Chart

The gantt node is **record-driven**: it names *where records come from* and
*which fields* carry the schedule. It does not carry a task array — the task
objects further down this page are the component's runtime shape, produced by
`ObjectGantt` from each record.

An authored node takes its props in its `properties` bag, whose members are
`@objectstack/spec`'s `ComponentPropsMap['object-gantt']` row, and its field
mapping in the bag's `gantt` block. `objectui validate` judges the bag against
that row and refuses a prop written flat on the node by name, naming where it
goes (`Did you mean objectName → properties.objectName?`, or
`startDateField → properties.gantt.startDateField`), as the spec's own page
component does (objectui#10859). `SchemaRenderer` hoists the bag onto the node
before `ObjectGantt` runs, so the reads below are the same for both: the
renderer sees the hoisted node.

`ObjectGantt` decides what to render from exactly two reads
(`src/ObjectGantt.tsx`):

**1. Where the records come from — `getDataConfig`.** The first of these three
that is present wins; if none is present there is no data config at all and the
chart renders empty:

```typescript
const recordSource = {
  type: 'object-gantt',
  properties: {
    // Pick ONE of the three:
    objectName: 'project_tasks',                          // load through the host DataSource
    // data: { provider: 'value', items: [ /* records */ ] },  // inline records
    // staticData: [ /* records */ ],                          // shorthand for the above
  },
  // …or name the object in the node's `dataSource` binding instead of `objectName`:
  // dataSource: { object: 'project_tasks' },
};
```

`data` is the spec's `ViewData` union. This chart reads two of its arms:
`{ provider: 'object', object }` and `{ provider: 'value', items }`.
`{ provider: 'schema', schemaId }` is accepted by the spec and is not a source
this chart reads: measured, a gantt carrying it queries `objectName` instead.
The view-level `{ provider: 'api', read, write }` arm is retired in the spec
(objectstack#23082) and nothing here reads it either: a gantt still carrying
one is answered the same way, and its `read` / `write` URLs are never
requested. A metadata-declared API call is the page element's `dataSource`
binding.

**The provider does not change which query keys apply.** An authored `filter`
and `sort` narrow and order the rows on **every** provider, inline ones
included, and the platform row ceiling (2,000 drawn rows, with a footnote
naming both numbers) applies to all of them — inline rows cost the browser what
fetched rows cost. Inline rows go through the same in-memory adapter the other
providers go through, so `filter` is evaluated with the same matcher and the
ceiling is applied to the **filtered** set, never to the raw one. Before
objectui#8769 the inline provider skipped that query and drew every authored
row with an authored `filter` silently dropped.

The same holds for the full-text pair: `search` is sent as `$search`, and
`searchableFields` as `$searchFields` alongside it (never without a term). A
list view's toolbar Search box writes both onto the gantt node it composes — the
chart runs its own query, so the node is the only way the term reaches it. They
are not authored keys: the spec's row does not declare them, so `objectui
validate` refuses them in the bag.

**2. How the fields map — `getGanttConfig`.** Two spellings, checked in order.
The **`gantt` block wins whenever it is present**, and it is taken WHOLE — the
flat top-level keys are not merged into it. The flat spelling is read only when
there is no `gantt` block, and then only when `startDateField` and
`endDateField` are both present. A node carrying both spellings renders the
block's values and gets a dev-mode warning naming the ignored top-level keys.
**Author the `gantt` block**: the flat spelling is the runtime handoff
`ObjectView` and `ListView` write onto the node they compose, and an authored
node cannot carry it — `objectui validate` refuses each flat key and names
`properties.gantt.KEY`, and the spec's row refuses it inside the bag too.

Precedence follows the maintainer ruling on objectui#5018 (2026-08-17), which
settled the identical two-faces shape for `plugin-map`; objectui#6469 inherited
it here. Before that flip the flat branch returned first, so an authored `gantt`
block was discarded silently.

```typescript
const fieldMapping = {
  type: 'object-gantt',
  properties: {
    objectName: 'project_tasks',
    gantt: {
      startDateField: 'start_date',
      endDateField: 'end_date',
      titleField: 'name',
      progressField: 'completion_percentage',
      dependenciesField: 'dependent_task_ids',
      colorField: 'bar_color',
      parentField: 'parent_task',
      typeField: 'task_kind',
      viewMode: 'week',               // 'day'|'week'|'month'|'quarter'|'year'
    },
  },
};
```

`viewMode` is real authoring surface (a member of the spec's `GanttConfigSchema`,
so of the `gantt` block) and is honoured by **both** renderer branches — the
timeline and the resource-workload grid. It reaches the renderer through
`getGanttConfig`, so it only takes effect alongside a taken gantt config.
Omitting it is meaningful — a persisted layout then seeds the granularity before
the renderer's `'day'` fallback.

#### Keys this page used to teach that the renderer never reads

Earlier revisions of this README showed a task-array schema. Those keys have no
read site anywhere in `src/` — a schema built from them renders an **empty
chart with no diagnostic**, because `type: 'object-gantt'` *is* a registered type, so
the node mounts and simply finds nothing to draw:

| Key shown before | Status | Use instead |
| --- | --- | --- |
| `tasks` | never read off the schema | `objectName` / `data` / `staticData` |
| `object` | never read | `objectName` |
| `nameField` | never read | `titleField` |
| `startField` | never read | `startDateField` |
| `endField` | never read | `endDateField` |
| `fields: { name, start, end, … }` | never read | the `gantt` block |
| `onTaskClick`, `onTaskUpdate` | never read *off the schema* | React props on `<ObjectGantt>` / `<GanttView>` — functions do not belong in serializable metadata |
| `className` | never read off the schema | a React prop on `<ObjectGantt>` |

The keys the renderer reads beside `gantt` — `readOnly`, `mobileReadOnly`,
`markers`, `navigation`, `skipWeekends`, `holidays`, `criticalPath`,
`showBaselines`, `persistLayout` / `viewName` and `label` — are all optional,
all declared by the spec's `object-gantt` row, and all published by the
registration since objectui#11168 slice 4. Each is described in the table
below.

#### Full field-mapping reference (`GanttConfig` members)

`titleField` / `startDateField` / `endDateField` are required; everything below
is optional. Set them INSIDE the `gantt` block — beside a `gantt` block a
top-level copy is ignored (with a dev-mode warning naming the losing keys), and
on an authored node `objectui validate` refuses it.

| Key (under `gantt`) | Effect |
| --- | --- |
| `parentField` | Builds the summary tree: parents roll up their children's span and weighted progress. |
| `typeField` | Distinguishes `task` / `summary` (aliases `project`, `phase`) / `milestone` / `group` (alias `folder`). A `group` row renders as a **pure tree header with no timeline bar** — expandable like a summary but never scheduled, for grouping-only levels that have no dates of their own. `summary` still renders a bar-carrying rollup bracket. |
| `lockField` | Marks a row **view-only** when the field is truthy: no bar drag/resize, no progress drag, no dependency connector dot, and inline-edit plus context-menu edit/delete are hidden. Clicking still works (open drawer / jump). Independent of `readOnly`, so one level of a tree can be frozen while its siblings stay editable. |
| `defaultCollapsedDepth` | Auto-collapse every tree node at or below this 0-indexed depth that has children, on first render. Roots are depth 0; the user can still expand any of them, this only seeds the initial state. In a 4-level tree, `2` starts with every level-2 node (and its children) folded. Omit to start fully expanded. |
| `dependenciesField` | Draws the dependency arrows. Accepts CSV, an id array, or `[{ id, type: 'fs'\|'ss'\|'ff'\|'sf' }]`. Setting it also makes links **editable** unless `readOnly`: drag a bar's connector dot to create an FS link, right-click a link to switch its type or remove it, right-click a bar to add a predecessor or successor. Every change is written back to the field, which is auto-promoted to the `[{ id, type }]` form the moment a non-FS link is stored. |
| `tooltipFields` | The hover detail. Each entry is a field name or `{ field, label }`, formatted by field type. |
| `baselineStartField` / `baselineEndField` | Draw a thin planned-vs-actual baseline strip under each bar. |
| `groupByField` | Swimlane the rows by any field — a select/lookup label or a raw value; empty values fall into an "ungrouped" bucket. |
| `colorField` | Field whose value picks the bar colour. |
| `resourceView: true` | Render the **resource / workload view** instead of the task grid: one row per resource with a per-column load histogram. Requires `assigneeField` to bucket tasks. |
| `assigneeField` / `effortField` / `capacity` | Resource bucketing (required for `resourceView`), per-task workload weight (default `1`), and the per-resource capacity ceiling (default `1`). Any column whose summed load exceeds `capacity` is painted as over-allocated. |
| `quickFilters: [{ field, label?, options? }]` | Render a quick-filter bar above the grid — one multi-select dropdown per entry, narrowing the visible bars by that field (AND across dimensions). Option lists resolve in priority order: explicit `options` → the object schema's `select`/`enum` options (the full domain) → a `lookup` / `master_detail`'s referenced records (pulled in full through the data source, so values with **no** tasks still appear) → distinct values from the loaded data. Lookup values match on the embedded record id. Selecting every option of a dimension collapses to "no constraint". |
| `autoZoomToFilter` | When a quick filter narrows the set, re-derive the timeline range from the **remaining** tasks so the axis zooms to the filtered span (default `true`). Set `false` to pin the axis to the full task span, so bars keep their absolute position while filtering. |
| `viewMode` | Initial granularity, `'day'` (default) / `'week'` / `'month'` / `'quarter'` / `'year'`; the toolbar switches it live. `year` widens the axis to one column per year with a decade band above. |

With links present, dragging a bar into a position that violates a dependency
raises a reschedule confirmation: accepting runs a topological forward pass
(link-type aware; summaries stay fixed rollups) over the affected tasks,
declining keeps the manual placement. This is on by default whenever
`dependenciesField` is set, and suppressed under `readOnly`.

#### Node-level display and behaviour options

True siblings of `gantt` in the `properties` bag, not `GanttConfig` members.

| Key (in `properties`, beside `gantt`) | Effect |
| --- | --- |
| `criticalPath: true` | Start with the critical-path (zero-slack chain) highlight on; the toolbar toggle stays available. |
| `showBaselines: false` | Hide the baseline strips even when baseline fields are mapped (default `true`). |
| `skipWeekends: true` | Working-calendar math: auto-schedule and critical path count working days only, and reschedules snap off Sat/Sun. In **day mode** this also folds weekend columns out of the timeline — Friday sits against Monday and a one-column drag advances one working day. Coarser scales stay linear. |
| `holidays: ["yyyy-mm-dd", …]` | Extra non-working days for the working calendar, combined with or instead of `skipWeekends`. In day mode these columns fold out of the axis too. |
| `markers: [{ date, label?, color? }]` | Extra vertical marker lines, like the Today line. `label` is drawn against the line and `color` paints it (the theme's primary colour when omitted); a date outside the chart's range draws no line. |
| `persistLayout: false` | Disable layout persistence. By default the toolbar's save-layout button snapshots the current granularity, zoom and task-list collapse state, plus the quick-filter chips, to `localStorage` (key `gantt-layout:OBJECT:VIEW`) and restores it on the next load. `OBJECT` is `objectName`, else `data.object`, and `gantt` on inline rows that name neither. With `false` there is no save-layout button and nothing is stored. |
| `viewName: "board"` | The `VIEW` half of that key (default `default`). Two gantts on the same object with different names keep separate layouts, and each restores only its own. |
| `readOnly: true` | **Disable every edit path** — no bar drag/resize/progress, no inline edit, no delete, no dependency-link drag, no reorder, no auto-schedule, and the Undo/Redo buttons are hidden. A read-only badge shows in the toolbar and the right-click menu drops to view-only (or is suppressed when nothing is actionable). Task click and granularity switching still work. Use it for dashboards and shared read-only views. |
| `mobileReadOnly: false` | When the chart is narrow (under 640 px of its own measured width, or of the viewport until that is measured) it auto-enters read-only, giving touch users a clean scrollable thumbnail — the chart's write paths are gated as under `readOnly`, applied only while narrow. The record drawer is not: it locks under `readOnly` alone, so a task's record still opens writable on a narrow chart. Enabled by default; `false` keeps a narrow chart editable, and `readOnly: true` locks the chart and the drawer at any width. |
| `label` | Names the exported PNG/PDF file: the link after `gantt.exportFileName` and before the object's own label, then `objectName`. A string, or an inline locale map (`{ "en": …, "zh-CN": … }`) resolved to the display locale. The chart draws it nowhere else. |
| `navigation` | What a task click opens — see **Create / Edit / Delete / View** above. |

The toolbar also carries **navigation** (jump-to-today / this-week / this-month
buttons that scroll the timeline to the start of that period) and **export**
(PNG, plus a dependency-free single-page PDF of the whole chart), always
available regardless of `readOnly`. Each task-list row carries a **locate** icon
by its End cell that smooth-scrolls the timeline to centre that row's bar and
pulses it — useful in deep or long trees.

#### A maximal node, for reference

```json
{
  "type": "object-gantt",
  "properties": {
    "objectName": "project_task",
    "gantt": {
      "titleField": "name",
      "startDateField": "start_date",
      "endDateField": "end_date",
      "progressField": "progress",
      "parentField": "parent_id",
      "dependenciesField": "depends_on",
      "typeField": "item_type",
      "lockField": "is_locked",
      "defaultCollapsedDepth": 2,
      "colorField": "status",
      "baselineStartField": "planned_start",
      "baselineEndField": "planned_end",
      "tooltipFields": [{ "field": "owner", "label": "Owner" }, "status", "effort"],
      "groupByField": "owner",
      "assigneeField": "owner",
      "effortField": "effort",
      "quickFilters": [
        { "field": "status", "label": "Status" },
        { "field": "project", "label": "Project" },
        { "field": "priority", "label": "Priority", "options": ["high", "medium", "low"] }
      ],
      "autoZoomToFilter": true
    },
    "criticalPath": true,
    "skipWeekends": true,
    "holidays": ["2026-01-01", "2026-12-25"],
    "readOnly": false
  },
  "bind": "project_task"
}
```

### Task Structure

`GanttTask` is the **component's runtime** task — what `<GanttView>` renders and
what `ObjectGantt` produces from each record. Dates are real `Date` objects and
the label field is `title` (`src/GanttView.tsx`):

<!-- readme-exports: partial GanttTask — deliberate excerpt: `fields` and `hasOwnDates` are populated by ObjectGantt itself, as the paragraph below the block says -->
```typescript
import type { GanttDependency, GanttTaskType } from '@object-ui/plugin-gantt';

interface GanttTask {
  id: string | number;
  title: string;
  start: Date;
  end: Date;
  progress: number;                  // 0-100
  dependencies?: GanttDependency[];  // predecessor id, optionally with a link type
  parent?: string | number | null;   // builds the hierarchy; unknown ids render as roots
  type?: GanttTaskType;              // 'task' | 'summary' | 'milestone' | 'group'
  color?: string;                    // bar fill — any CSS color, e.g. '#3b82f6'
  borderColor?: string;              // alert outline, fill untouched
  locked?: boolean;                  // view-only row (still clickable)
  baselineStart?: Date;              // planned-vs-actual reference bar
  baselineEnd?: Date;
  data?: any;                        // the source record behind the row
}
```

A few more optional fields (`fields` for tooltip rows, `hasOwnDates`) are
populated by `ObjectGantt` itself — see `GanttTask` in `src/GanttView.tsx` for
the full declaration.

## Examples

### Basic Gantt Chart

Inline records, no backend — `data.items` carries the records and the `*Field`
keys of the `gantt` block say which of their fields the chart reads. Note that
the record field names are yours; only the `*Field` keys are fixed vocabulary.

```typescript
const schema = {
  type: 'object-gantt',
  properties: {
    gantt: {
      viewMode: 'week',
      startDateField: 'start',
      endDateField: 'end',
      titleField: 'name',
      progressField: 'progress',
      dependenciesField: 'dependencies',
      colorField: 'color',
    },
    data: {
      provider: 'value',
      items: [
        {
          id: '1',
          name: 'Project Planning',
          start: '2024-01-01',
          end: '2024-01-07',
          progress: 100,
          // bar fill goes straight into an inline `backgroundColor` —
          // it must be a CSS color, NOT a Tailwind class
          color: '#3b82f6'
        },
        {
          id: '2',
          name: 'Design Phase',
          start: '2024-01-08',
          end: '2024-01-21',
          progress: 75,
          dependencies: ['1'],
          color: '#a855f7'
        },
        {
          id: '3',
          name: 'Development',
          start: '2024-01-22',
          end: '2024-02-15',
          progress: 30,
          dependencies: ['2'],
          color: '#22c55e'
        },
        {
          id: '4',
          name: 'Testing',
          start: '2024-02-16',
          end: '2024-02-28',
          progress: 0,
          dependencies: ['3'],
          color: '#f97316'
        }
      ]
    }
  }
};
```

### Interactive Gantt

Callbacks are **not** schema keys — the schema is serializable metadata, and a
function cannot survive it. Through the registered `gantt` / `object-gantt`
types the whole CRUD lifecycle is already wired to the host `DataSource`
(create/edit/drag/delete/detail drawer), so there is usually nothing to pass.
When you render the component yourself, hand the callbacks in as React props.
A component mounted without `SchemaRenderer` receives the node as it reads it,
so its `schema` prop keeps its props on the node: nothing hoists a `properties`
bag there.

```tsx
import { ObjectGantt } from '@object-ui/plugin-gantt';
import type { DataSource } from '@object-ui/types';

// The adapter your host already talks to — see "Integration with Data
// Sources" below for where it comes from.
declare const dataSource: DataSource;

const interactiveChart = <ObjectGantt
  schema={{
    type: 'object-gantt',
    objectName: 'project_tasks',
    startDateField: 'start_date',
    endDateField: 'end_date',
    titleField: 'name',
  }}
  dataSource={dataSource}
  onTaskClick={(record) => console.log('Task clicked:', record)}
/>;
```

To turn editing off from the metadata instead, set `readOnly: true` — in the
`properties` bag of an authored node, or on the schema you mount — that one *is*
read.

### With ObjectQL Integration

```typescript
const schema = {
  type: 'object-gantt',
  properties: {
    objectName: 'project_tasks',
    gantt: {
      titleField: 'name',
      startDateField: 'start_date',
      endDateField: 'end_date',
      progressField: 'completion_percentage',
      dependenciesField: 'dependent_task_ids'
    }
  }
};
```

## View Modes

The Gantt chart renders one timeline column per unit of the active scale:

- **day** - one column per day (weekday + weekend shading)
- **week** - one column per week (starting Monday)
- **month** - one column per calendar month
- **quarter** - one column per quarter (Q1–Q4)
- **year** - one column per year (decade band above)

A two-row header shows the grouping above the units (months above days/weeks,
years above months/quarters). The toolbar's segmented control switches scales
interactively (`onViewChange` notifies you), and the zoom buttons step the
column width — falling through to the next coarser/finer scale at the bounds.
Drag snapping follows the active scale: bars snap to days in day view, weeks
in week view, and whole calendar months/quarters (duration preserved) in the
coarse views.

### The toolbar period label and its steppers

The label between the `‹` / `›` buttons names the period **currently on screen**,
not the extent of the data: it reads the date at the left edge of the viewport
and snaps it to the same tier the band header groups by — a month under day and
week view, a year under month and quarter view, a decade under year view, and
the shift-day under shift-segmented day view. So the label and the band header
directly beneath it always name the same period, and the label moves as the
chart is scrolled.

`‹` / `›` step the visible window by one of those periods (one month in day and
week view, one year in month and quarter view, a decade in year view), clamped
to the ends of the timeline. They step the *label's* tier rather than a single
column, so one click always changes what the label says.

Set the initial scale with `viewMode`, a member of the `gantt` block, beside
the field mapping:

```typescript
const schema = {
  type: 'object-gantt',
  properties: {
    objectName: 'project_tasks',
    gantt: {
      viewMode: 'month',
      startDateField: 'start_date',
      endDateField: 'end_date',
      titleField: 'name'
    }
  }
};
```

## Task Hierarchy, Summaries & Milestones

Give a task a `parent` (or configure `parentField` on the data-source schema)
to build a tree: child rows indent under their parent with expand/collapse
chevrons in the task list. Any task with children renders as a **summary**
bracket spanning its children's combined date range, with progress rolled up
as the duration-weighted average of its descendants — summaries are read-only,
their children drive them.

Zero-duration tasks (`end <= start`) — or tasks whose `type` is
`'milestone'` (via `typeField`: values like `milestone`, `summary`,
`project`, `group` are recognized) — render as diamond markers. Milestones
can be dragged to move but not resized; dependency arrows anchor at the
diamond center.

These are runtime `GanttTask` objects (what `<GanttView>` takes directly) —
dates are real `Date`s and the label field is `title`. Coming from records
instead, the same tree is configured with `parentField` / `typeField`.

```typescript
import type { GanttTask } from '@object-ui/plugin-gantt';

const tasks: GanttTask[] = [
  // summary (has children) — its span and progress are rolled up
  { id: 'phase1', title: 'Phase 1', start: new Date('2024-06-01'), end: new Date('2024-06-30'), progress: 0 },
  { id: 't1', title: 'Design', parent: 'phase1', start: new Date('2024-06-01'), end: new Date('2024-06-14'), progress: 80 },
  { id: 't2', title: 'Build', parent: 'phase1', start: new Date('2024-06-15'), end: new Date('2024-06-30'), progress: 20 },
  { id: 'launch', title: 'Launch', type: 'milestone', start: new Date('2024-07-01'), end: new Date('2024-07-01'), progress: 0 },
];
```

## Interactions

Beyond drag-to-reschedule, the timeline supports:

- **Progress drag** — hover a bar and drag the round grip at the progress
  boundary; the fill follows live and `onTaskUpdate(task, { progress })`
  commits on release (snapped to whole percent, clamped 0–100).
- **Hover tooltip** — bars, milestones and summaries show a tooltip with
  title, date range, duration and progress.
- **Context menu** — right-click a bar or list row for View details / Edit
  inline / Delete (items appear only when the matching callback is wired).
- **Keyboard navigation** — the chart body is focusable: ↑/↓ move the row
  selection, Enter opens the task, Delete deletes it, ←/→ collapse/expand
  summary rows. Rows carry `treeitem` roles with `aria-level`/`aria-selected`.
- **Drag-to-create dependency** — drag the connector dot on a bar's right
  edge onto another bar; a dashed rubber band previews the link and
  `onDependencyCreate(source, target, 'fs')` fires on drop. Through
  `ObjectGantt` the new predecessor is appended to the record's
  `dependenciesField`, preserving the field's original shape (CSV or array).
- **Row drag-to-reorder** — pass `onTaskReorder(task, before)` to enable
  HTML5 drag reordering in the task list (sibling-scoped; persistence is up
  to the host, e.g. via a sort field).

## Scale & Performance

Rows and timeline columns are **virtualized**: only what is in (or near) the
viewport renders, so the chart stays responsive with thousands of tasks and
multi-year day-scale ranges. No configuration needed — windowing follows the
scroll position automatically, and dependency arrows keep their absolute
positions while scrolling.

Two more chrome features ship with it:

- **Fullscreen** — the expand button in the toolbar puts the whole chart into
  native fullscreen (and back).
- **Custom markers** — vertical reference lines beyond the Today marker:

```tsx
import { GanttView } from '@object-ui/plugin-gantt';
import type { GanttTask } from '@object-ui/plugin-gantt';

declare const tasks: GanttTask[];

const chartWithMarkers = <GanttView
  tasks={tasks}
  markers={[
    { date: '2026-07-01', label: 'Code freeze', color: '#ef4444' },
    { date: '2026-07-15', label: 'Release' }, // defaults to the primary theme color
  ]}
/>;
```

Through the schema, pass the same array as `markers` in the gantt node's
`properties` bag.

## Task Dependencies

Link tasks to show dependencies:

```typescript
import type { GanttTask } from '@object-ui/plugin-gantt';

const tasks: GanttTask[] = [
  {
    id: 'task-1',
    title: 'Foundation',
    start: new Date('2024-01-01'),
    end: new Date('2024-01-10'),
    progress: 100
  },
  {
    id: 'task-2',
    title: 'Building',
    start: new Date('2024-01-11'),
    end: new Date('2024-01-25'),
    progress: 50,
    dependencies: ['task-1']  // Depends on task-1
  },
  {
    id: 'task-3',
    title: 'Finishing',
    start: new Date('2024-01-26'),
    end: new Date('2024-02-05'),
    progress: 0,
    dependencies: ['task-2']  // Depends on task-2
  }
];
```

Through a data source the same links come from `dependenciesField` on the
schema, and the tree/label fields from `parentField` / `titleField`.

Dependencies render as arrows from the predecessor bar to the dependent bar.
Arrows follow bars live while dragging, and hovering a bar highlights its links.

### Link Types

Each dependency entry is either a predecessor id (`'task-1'`) or an object with
an explicit link type:

```typescript
dependencies: [
  { id: 'task-1', type: 'fs' },  // finish-to-start (default)
  { id: 'task-2', type: 'ss' },  // start-to-start
  { id: 'task-3', type: 'ff' },  // finish-to-finish
  { id: 'task-4', type: 'sf' },  // start-to-finish
]
```

When records come from a data source (`dependenciesField`), the field value may
be a CSV string (`"task1, task2"`), an array of ids, or an array of objects —
`task`/`target`/`_id` are accepted as id aliases, and long-form type names like
`"finish_to_start"` / `"end-to-end"` map onto `fs`/`ss`/`ff`/`sf`.

## Integration with Data Sources

The adapter is **not** a schema key — it reaches the renderer through the
renderer context (or as an explicit `dataSource` prop), while the schema names
the object and the fields. Mounted directly as below, `ObjectGantt` takes the
node as it reads it, typed `ObjectGanttSchema`, with its props on the node;
through `SchemaRenderer` the same props go in the authored node's `properties`
bag:

```tsx
import { createObjectStackAdapter } from '@object-ui/data-objectstack';
import { ObjectGantt } from '@object-ui/plugin-gantt';
import type { ObjectGanttSchema } from '@object-ui/types';

const dataSource = createObjectStackAdapter({
  baseUrl: 'https://api.example.com',
  token: 'your-auth-token'
});

const schema: ObjectGanttSchema = {
  type: 'object-gantt',
  objectName: 'tasks',
  titleField: 'task_name',
  startDateField: 'start_date',
  endDateField: 'end_date',
  progressField: 'progress_percent'
};

const ganttWithAdapter = <ObjectGantt schema={schema} dataSource={dataSource} />;
```

⚠️ A `dataSource` key **on the schema node** is a different thing with the same
name: it is the spec's `PageComponentSchema.dataSource` *binding* —
`{ object, view?, filter?, sort?, limit? }`, a declarative reference resolved
against the host — **not** an adapter instance. The renderer guards against the
confusion explicitly, so putting a live adapter there does not wire anything up.

## TypeScript Support

Two different vocabularies, two different packages — don't mix them up.

**The component's runtime types** come from this package. Use them when you
render `<GanttView>` (or `ObjectGantt`) yourself in React:

```typescript
import type { GanttTask, GanttViewProps } from '@object-ui/plugin-gantt';

const task: GanttTask = {
  id: '1',
  title: 'My Task',
  start: new Date('2024-01-01'),
  end: new Date('2024-01-10'),
  progress: 50,
  dependencies: [],
};

const props: GanttViewProps = {
  tasks: [task],
  viewMode: 'week',
};
```

**The authored (JSON metadata) node** is `{ type: 'object-gantt', properties }`,
and the members of `properties` are `@objectstack/spec`'s
`ComponentPropsMap['object-gantt']` row (its `ObjectGanttProps`). It is
**record-driven**: it names an object and the fields to read, it does not carry
a task array. There is no `GanttSchema`. `ObjectGanttSchema` in `@object-ui/types`
— which this package imports and does not re-export — types the node as
`ObjectGantt` reads it: after `SchemaRenderer` hoists the bag, or as you mount it
yourself.

```typescript
import type { ObjectGanttBlockNode } from '@object-ui/types';

const gantt: ObjectGanttBlockNode = {
  type: 'object-gantt',
  properties: {
    objectName: 'project_tasks',
    gantt: {
      titleField: 'name',
      startDateField: 'start_date',
      endDateField: 'end_date',
      progressField: 'completion_percentage',
      dependenciesField: 'dependent_task_ids',
    },
  },
};
```

`dependenciesField` (plural) is the spec's spelling and the one to author. The
singular `dependencyField` is a `@deprecated` legacy alias: `ObjectGantt` still
reads it (`dependenciesField || dependencyField`) on a node built in code, but an
authored node cannot carry it — `objectui validate` refuses it and names
`properties.gantt.dependenciesField`.

For a list view served under the `gantt` view type, the same configuration is a
`gantt` block on `ListViewSchema` (typed by `GanttConfig`, also from
`@object-ui/types`) rather than top-level keys — `ObjectGantt` reads either
spelling.

## Links

- 📚 [Documentation](https://www.objectui.org/docs/plugins/plugin-gantt)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/plugin-gantt)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
