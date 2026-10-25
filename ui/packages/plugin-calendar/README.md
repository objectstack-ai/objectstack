# @object-ui/plugin-calendar

Calendar view plugins for Object UI - includes both ObjectQL-integrated and standalone calendar components.

## Features

- **Calendar View** - Monthly calendar with event display
- **Event Management** - Create, edit, and delete events
- **Drag-and-Drop Rescheduling** - Move events to a different day in
  month view, or drag vertically in week/day views to change start
  time. Drag top/bottom edges to resize start/end times. Changes are
  persisted via `dataSource.update()` automatically (override with the
  `onEventDrop` prop).
- **Click-to-Create** - Click any day cell (month view) or click-drag
  on the time grid (week/day views) to open a quick-create dialog
  pre-filled with the selected date/range. New records are persisted
  via `dataSource.create()` and inserted optimistically into the
  calendar. Required picklist fields auto-default to their first
  option.
- **ObjectQL Integration** - Connect to ObjectStack data sources
- **Standalone Mode** - Use with static data or custom backends
- **Locale week start** - Every week starts on the first day of the week
  of the calendar's locale (the `locale` prop, else the display locale):
  Sunday under `en-US`, Monday under `en-GB` or `zh-CN`. The month grid,
  its weekday heads, the week view's columns, the header's week range and
  the date popover all start on that day.
- **Responsive** - Mobile-friendly calendar layouts
- **Customizable** - Tailwind CSS styling support

## Drag-and-Drop

### Month view

| Gesture | Effect |
| --- | --- |
| Drag the event pill body to another day cell | Moves both `startDateField` and `endDateField` by the calendar days from the grabbed cell to the drop cell, each keeping its time of day: a 10:00 event stays at 10:00, even across a DST change. Grab cell → drop cell defines the days, so dragging from any day of a multi-day span works as expected. |
| Drag the right-edge handle of a multi-day pill | Moves only `endDateField` to the drop day, keeping its time of day; start is preserved. Refuses drops earlier than start. |

### Week / Day view (time grid)

The week and day views render a classic Google Calendar-style vertical
time grid with hour rows. Pointer-driven interactions:

| Gesture | Effect |
| --- | --- |
| Drag an event vertically | Shifts both `startDateField` and `endDateField` by the time delta (snapped to `slotMinutes`, default 30). |
| Drag the top edge of an event | Adjusts only `startDateField`; end is preserved. Refuses to drag past `end − slotMinutes`. |
| Drag the bottom edge of an event | Adjusts only `endDateField`; start is preserved. Refuses to drag past `start + slotMinutes`. |
| Click-drag on empty grid background | Opens the quick-create dialog with start/end pre-filled to the dragged time range. |

Pass `slotMinutes={15}` to change the snap granularity. Pass
`onTimeRangeSelect={(start, end) => …}` to handle drag-to-create
yourself instead of the default quick-create dialog.

When `ObjectCalendar` is bound to an object schema, the new dates are
persisted with `dataSource.update(objectName, id, patch)` automatically;
the local state is updated optimistically and rolled back if the
server call fails. To intercept (e.g. to confirm a status change) pass
`onEventDrop={(record, newStart, newEnd) => …}` — the default
persistence is skipped when you provide your own handler.

## Click-to-Create

Clicking an empty area of any day cell opens a small quick-create
dialog pre-filled with the clicked date. Type a title, press
<kbd>Enter</kbd> (or click **Create**), and the record is persisted
via `dataSource.create(objectName, payload)`. The payload includes:

- The configured `titleField` (defaults to `name`)
- `startDateField` and (if configured) `endDateField` set to the
  clicked day
- Auto-defaults for any other required fields the user hasn't supplied
  (first picklist option for `select`/`status`, `false` for booleans,
  `0` for numerics, or the field's `defaultValue`)

The new record is optimistically inserted into local state so it
appears immediately. To override (e.g. open your own create form), pass
`onDateClick={(day) => …}` — the default behaviour is skipped.

The dialog is offered only where that payload can succeed. If the object
has a required field outside the set above (a required lookup, a required
text field other than the title), the click — or a range drag in the
week/day grid — opens the host's full create form instead: the calendar
calls `onEdit` with a new record (no `id`) carrying the date values, e.g.
`onEdit({ due_date: '2026-10-20' })`, and the host pre-fills its create form
with them. The console does this already. Without an `onEdit`, the gesture
offers nothing on such an object. Required fields the server fills on insert
(`readonly`, `system`, `autonumber`) do not count.

## Reporting the visible days

A host that fetches the calendar's records for it, and hands them over as
`data`, can fetch only the days on screen. `ObjectCalendar` reports them
through `onVisibleRangeChange={({ start, end }) => …}`: once on mount, and
again whenever navigation or a view change moves them. `start` is local
midnight of the first day drawn and `end` local midnight of the day after the
last, so the range is half-open. In the month view it covers the whole
six-week grid, including the leading and trailing days of the neighbouring
months, under the locale's first day of the week; in the week view it is the
week, and in the day view the day. An unchanged range is not reported again.

`ListView` (`@object-ui/plugin-list`) uses it to fetch a calendar view's
visible days instead of one batch of the object (objectui#12081). Like the
other host callbacks, it is forwarded only when the value is a function.

## Installation

```bash
pnpm add @object-ui/plugin-calendar
```

## Usage

### Automatic Registration (Side-Effect Import)

```typescript
// In your app entry point (e.g., App.tsx or main.tsx)
import '@object-ui/plugin-calendar';

// Now you can use calendar types in your schemas
const schema = {
  type: 'calendar-view',
  data: [
    {
      id: '1',
      title: 'Team Meeting',
      start: '2024-01-15T10:00:00',
      end: '2024-01-15T11:00:00'
    }
  ]
};
```

### What the side-effect import registers

Registration is *only* a side effect of importing the package — the single
`import '@object-ui/plugin-calendar'` above is the whole of it. There is no
components map to iterate over: importing the entry point runs the
`ComponentRegistry.register(...)` calls in `src/index.tsx` and
`src/calendar-view-renderer.tsx`, which claim these schema types:

| Schema `type` | Namespaced key | Renderer |
| --- | --- | --- |
| `object-calendar` | `plugin-calendar:object-calendar` | `ObjectCalendarRenderer` |
| `calendar` | `view:calendar` | `ObjectCalendarRenderer` |
| `calendar-view` | `plugin-calendar:calendar-view` | internal wrapper around `CalendarView` (not exported) |

Both spellings work — the namespaced key and the bare `type` fallback.

### Public exports

The package exports components and their types, not a registry map:

```typescript
import {
  ObjectCalendar, // ObjectQL-integrated calendar component
  CalendarView, // standalone calendar component
  ObjectCalendarRenderer, // the registered renderer for `object-calendar` / `calendar`
} from '@object-ui/plugin-calendar';

import type {
  ObjectCalendarComponentProps,
  CalendarViewProps,
  CalendarViewEvent,
} from '@object-ui/plugin-calendar';
```

To serve the calendar under a registry key of your own, register the exported
renderer under that key:

```typescript
import { ComponentRegistry } from '@object-ui/core';
import { ObjectCalendarRenderer } from '@object-ui/plugin-calendar';

ComponentRegistry.register('my-calendar', ObjectCalendarRenderer);
```

## Schema API

### CalendarView

Display a calendar computed from the node's `data` records. This is the full
authored surface: `CalendarViewSchema` in `@object-ui/types` declares 15 keys of
its own. **13 of them are authorable**, converged on what the registered
`calendar-view` renderer actually reads (objectui#5667), and they are the ones
listed below. Two of them — `data` and `className` — refine common `BaseSchema`
keys; the rest of `BaseSchema` (`id`, `visible`, ...) applies as on any node.

**The other two are REFUSALS, not keys you can write.** `body` and `children`
are declared `never` (objectui#9256): a read-site sweep of every package that
registers a component measured that no renderer read consumes either content
channel for a `calendar-view` node — it renders events computed from `data`, not
child nodes — so authoring one is now refused at `tsc` and at validation instead
of silently rendering nothing. They are counted above because the interface
declares them; they are absent from the listing below because the listing is the
*authorable* surface.

```typescript
import type { CalendarViewSchema, CalendarViewMode, CalendarEvent } from '@object-ui/types';

type CalendarViewNode = {
  type: 'calendar-view';
  data?: any;                       // records rendered as events (array, or a binding expression)
  titleField?: string;              // default 'title'
  startDateField?: string;          // default 'start'
  endDateField?: string;            // default 'end'
  allDayField?: string;             // default 'allDay'
  colorField?: string;              // default 'color'
  view?: CalendarViewMode;          // 'month' | 'week' | 'day' (default 'month')
  currentDate?: string | Date;      // ISO string authored; Date from a React host
  allowCreate?: boolean;            // default false — shows the "New event" button
  className?: string;               // Tailwind classes for the container
  onEventClick?: (event: CalendarEvent) => void;   // HOST-ONLY (see below)
  onViewChange?: (view: CalendarViewMode) => void; // HOST-ONLY (see below)
};

// The listing above is held to the shipped type BY THE COMPILER, both
// directions, rather than by this paragraph: a key whose type here disagrees
// with what `CalendarViewSchema` declares is a compile error.
declare const authored: CalendarViewNode;
declare const shipped: CalendarViewSchema;
const forwards: CalendarViewSchema = authored;
const backwards: CalendarViewNode = shipped;
```

> **What those two assignments do and do not buy.** They check every key's
> **type**, in both directions. They do **not** check a key's **spelling**:
> both assign a declared variable, not a fresh object literal, and TypeScript
> runs its excess-property check only on a fresh literal. So a key renamed in
> the listing is an extra optional member on one side and simply absent on the
> other, and both assignments still compile. A fresh literal IS checked:
> `CalendarViewSchema` extends `BaseSchema`, which carries no index signature
> since objectui#8347, so
> `const node: CalendarViewSchema = { type: 'calendar-view', titleFieldd: 'name' }`
> is a compile error. Metadata that arrives as data is a question for the zod
> faces (the strict `StrictAnyComponentSchema` refuses an unknown key), not for
> TypeScript.

There is deliberately **no authorable `events` key**: the renderer computes its
events from `data` plus the field-name keys, and drops an authored `events`
(objectui#4433). Nine formerly declared keys — `events`, `defaultView`,
`defaultDate`, `date`, `views`, `editable`, `onEventCreate`, `onEventUpdate`,
`onDateChange` — were retired in objectui#5667 because nothing read them on the
authored-node path and no measured app authors them. `onDateClick` is **not**
on this schema — it is a `CalendarViewProps` component prop (see
[Drag-and-Drop](#drag-and-drop) and [Click-to-Create](#click-to-create)).

> **The handlers are host-only.** `onEventClick` and `onViewChange` are
> forwarded to the component only when the value really is a function, which
> authored JSON can never produce — supply them from a React host
> (`<SchemaRenderer ... onEventClick={fn} />`). Authored as JSON strings they
> are dropped, same as absent.

### Calendar Event Structure

Events are not authored directly — the renderer computes one event per record
in the node's `data` array, reading the fields the field-name keys point at:

```text
id:     record.id                 // falls back to record._id, then the array index
title:  record[titleField]        // default field 'title'
start:  record[startDateField]    // default field 'start' (ISO datetime string)
end:    record[endDateField]      // default field 'end' (optional)
allDay: record[allDayField]       // default field 'allDay'
color:  record[colorField]        // default field 'color'
data:   record                    // the whole record rides along
```

`@object-ui/types` still exports the `CalendarEvent` interface — it is the
declared payload type of the host-only `onEventClick` callback.

## Examples

### Basic Calendar

```typescript
const schema = {
  type: 'calendar-view',
  data: [
    {
      id: '1',
      title: 'Product Launch',
      start: '2024-02-15T09:00:00',
      end: '2024-02-15T17:00:00',
      color: 'bg-blue-500'
    },
    {
      id: '2',
      title: 'All-Hands Meeting',
      start: '2024-02-20T14:00:00',
      end: '2024-02-20T15:00:00',
      color: 'bg-green-500'
    }
  ]
};
```

The records above already use the default field names (`title`, `start`, `end`,
`color`), so no field-name keys are needed; on a `calendar-view` node, point
`titleField` / `startDateField` / `endDateField` / `allDayField` / `colorField`
at your own fields when they differ. They sit flat on this node because
`CalendarViewSchema` has no `calendar` block: here the flat keys are the only
spelling. An `object-calendar` takes the same five inside its `calendar` block
instead (next section).

### With ObjectQL Integration

Every key below is one `ObjectCalendarSchema` declares. The five field-name keys
go inside the `calendar` block: `getCalendarConfig` reads that block first and
returns it whole. A misspelt start-date key inside it is therefore not a partial
failure either: no record has a date to be placed by, so every one is counted
as unscheduled under the calendar instead of drawn.

`startDateField` is the only one of the five the calendar needs — `titleField`
is optional, and an event with no explicit title resolves one through the
ADR-0079 record display-name chain. A calendar authored with no `calendar`
block renders the "Calendar configuration required" refusal screen, which says
so and also names where the key belongs: the view's `calendar` block. That
matters on an **interface page**, whose `interfaceConfig` has no calendar slot
of its own — the only lever there is `sourceView`, pointed at a view that
declares the block (objectui#8170).

The same five keys written flat on the node are **not** a second way to author
this. That flat spelling is the runtime handoff — `ObjectView` and `ListView`
emit it on the node they build, and `getCalendarConfig` falls back to it only
when the node has no `calendar` block — so `ObjectCalendarSchema` declares it
because the renderer reads it. `@objectstack/spec` refuses it at authoring with
`unrecognized_keys` and names the `calendar` block in the same diagnostic (one
key per concept, its Prime Directive #12).

```typescript
import type { ObjectCalendarSchema } from '@object-ui/types';

// What this annotation buys, and what it does not - measured, objectui#7925.
// It type-checks the VALUES of the declared keys: `defaultView: 'agenda'` and
// `calendar: { titleField: 42 }` are both compile errors, and
// `check:doc-snippets` re-runs that check on every commit. Top-level key NAMES
// are checked too since objectui#8347 removed `BaseSchema`'s `[key: string]: any`,
// and since objectui#6152 so are the key names inside the `calendar` block: its
// type is the spec's strict `object-calendar` slot, so a misspelt key there, or
// a block without `startDateField`, is a compile error as well as a parse error.
const schema: ObjectCalendarSchema = {
  type: 'object-calendar',
  objectName: 'events',
  calendar: {
    titleField: 'name',
    startDateField: 'startDate',
    endDateField: 'endDate',
    allDayField: 'isAllDay',
    colorField: 'statusColor'
  },
  defaultView: 'month',
  navigation: { mode: 'modal' }   // what an event click opens - see below
};
```

`navigation` is what an event click opens — the spec's `NavigationConfig` by
reference, `ViewNavigationConfig` in `@object-ui/types`, the type
`ObjectGridSchema.navigation` uses: `mode` (`page`, `drawer`, `modal`, `split`,
`popover`, `new_window` or `none`) with `size`, `openNewTab` and
`preventNavigation`. With the key absent a click opens the record in a drawer.
An overlay mode keeps the click from a parent view's `onRowClick` /
`onEventClick`; any other mode hands it to them. `page` — and a block written
without `mode`, which takes the spec's `page` default — opens the record page
through the record navigator the host publishes on `RelatedRecordActionsContext`
(objectui#11293); the console publishes one on its custom pages, record pages and
list views. Under a host that publishes none, such as an embedded renderer,
there is no record page to open and the click opens nothing.

### Interactive Calendar

The handlers are host-only — a function can only come from a React host
building the node in code, never from authored JSON:

```typescript
import type { CalendarViewSchema } from '@object-ui/types';

// The annotation is what types the two handler parameters: `event` is
// `CalendarEvent` and `view` is `CalendarViewMode`, read off the shipped
// schema. Without it both are implicitly `any`.
const schema: CalendarViewSchema = {
  type: 'calendar-view',
  data: [],
  onEventClick: (event) => {
    console.log('Event clicked:', event.title);
    // Open event details modal
  },
  onViewChange: (view) => {
    console.log('View changed:', view);
    // React to the calendar switching between month/week/day
  }
};
```

Authored JSON reacts to clicks through the node's action channel instead
(`allowCreate: true` dispatches `{ type: 'create' }`; event clicks dispatch
`{ type: 'event-click' }`).

## ObjectQL Integration

When using with ObjectStack, the calendar can automatically fetch and display
events. The adapter is **not** a schema key: `ObjectCalendarRenderer` reads it
from the renderer context that `SchemaRendererProvider` supplies. The schema
names the object with `objectName` and its fields inside the same `calendar`
block as above - there is no `fields` container.

```typescript
import { createObjectStackAdapter } from '@object-ui/data-objectstack';
import type { ObjectCalendarSchema } from '@object-ui/types';

const dataSource = createObjectStackAdapter({
  baseUrl: 'https://api.example.com',
  token: 'your-auth-token'
});

// The annotation checks the values of the declared keys, not the key names -
// see the note on the first `object-calendar` block above.
const schema: ObjectCalendarSchema = {
  type: 'object-calendar',
  objectName: 'calendar_events',
  calendar: {
    titleField: 'title',
    startDateField: 'start_time',
    endDateField: 'end_time'
  },
  defaultView: 'month'
};
```

Pass the adapter to `SchemaRendererProvider` to wire the fetch up.

**The provider does not change which query keys apply** (objectui#9061, the port
of objectui#8769). An authored `filter` and `sort` narrow and order the records
on **every** provider, inline ones included — both `staticData` and
`data: { provider: 'value', items }` reach the same in-memory adapter the
`object` provider goes through, so `filter` is evaluated with the same matcher.
Before objectui#9061 the inline provider skipped that query and drew every
authored record with an authored `filter` silently dropped. The platform row
ceiling (2,000 drawn rows, with a footnote naming both numbers — objectui#7210,
ruling a′) applies to inline records too, and it is applied to the **filtered**
set, never to the raw one: a large inline array that a `filter` cuts below the
ceiling draws every matching record and shows no footnote.

⚠️ Two consequences of routing inline records through the adapter. They reach the
calendar as that adapter's own deep copy rather than as the authored array's
object identities, so code comparing a record handed to `onEventClick` against
the authored array with `===` needs `id` equality instead; and the copy is a JSON
round-trip, so inline records must be JSON-serializable.

## Customization

Style the calendar with Tailwind classes:

```typescript
import type { CalendarViewSchema } from '@object-ui/types';

const schema: CalendarViewSchema = {
  type: 'calendar-view',
  className: 'border rounded-lg shadow-lg',
  data: [] // your records
};
```

## TypeScript Support

The **authored** (JSON metadata) types live in `@object-ui/types`, not in this
package — this package imports them too, and does not re-export them:

```typescript
import type { CalendarViewSchema } from '@object-ui/types';

const schema: CalendarViewSchema = {
  type: 'calendar-view',
  data: [
    { id: '1', name: 'Meeting', begins: '2024-01-15T10:00:00', ends: '2024-01-15T11:00:00' }
  ],
  titleField: 'name',
  startDateField: 'begins',
  endDateField: 'ends',
  view: 'week',
  allowCreate: true
};
```

> **Two calendar event types — pick by which side you are on.**
> `@object-ui/types` exports **`CalendarEvent`**, the AUTHORING event
> (`id: string`, `start` / `end` accept ISO strings with `end` required, plus
> `description`) — since objectui#5667 it is no longer part of the authored
> surface (a `calendar-view` node carries `data` records, not events; see
> [Calendar Event Structure](#calendar-event-structure)), but it remains the
> declared payload type of the host-only `onEventClick` callback. This package
> exports **`CalendarViewEvent`** (`CalendarViewProps['events']`), the
> `CalendarView` **component's runtime** type: `id: string | number` and
> `start: Date` / `end?: Date`. They are not interchangeable — neither is
> assignable to the other.
>
> Both were spelled `CalendarEvent` until objectui#5044, where IDE auto-import
> chose between them at random and the wrong pick failed as a remote `TS2322`
> about `Date`. This package still exports `CalendarEvent` as a **`@deprecated`
> alias of `CalendarViewEvent`**, so existing importers keep compiling; write
> `CalendarViewEvent` in new code.

## Links

- 📚 [Documentation](https://www.objectui.org/docs/plugins/plugin-calendar)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/plugin-calendar)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
