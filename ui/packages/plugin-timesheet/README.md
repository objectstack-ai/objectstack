# @object-ui/plugin-timesheet

Timesheet view plugin for Object UI: an editable **row × weekday** entry grid.

A list view of `type: 'timesheet'` pivots detail records (time entries, daily
quantities) into rows × the seven days of one week. Each record lands in the row
its `rowFields` values name and the day its `dateField` falls on, and the cell
shows its `valueField`. Every cell is editable, and every edit is one call on the
record API.

It registers one component type via the `ComponentRegistry`:

- `object-timesheet` — composed by `@object-ui/plugin-list`'s `ListView` for a
  `timesheet` view. It is not a curated page block.

## Usage

Declare a list view whose `type` is `timesheet`, with its binding block;
`ListView` composes the node:

```ts
const binding = {
  timesheet: {
    rowFields: ['project', 'task'], // 1–3 fields; one row per distinct combination
    dateField: 'work_date',         // date or datetime
    valueField: 'hours',            // number, currency or percent
  },
};
```

The component can also be rendered directly:

```tsx
import { ObjectTimesheet } from '@object-ui/plugin-timesheet';
import type { DataSource } from '@object-ui/types';

declare const dataSource: DataSource;

<ObjectTimesheet
  schema={{
    type: 'object-timesheet',
    objectName: 'time_entry',
    timesheet: { rowFields: ['project'], dateField: 'work_date', valueField: 'hours' },
  }}
  dataSource={dataSource}
/>;
```

### Keys

| Key | Description |
| --- | --- |
| `objectName` | The object whose records the grid pivots. |
| `timesheet` | `{ rowFields, dateField, valueField }`. All three are required; without them the grid shows "Timesheet configuration required". |
| `filter` | Base filter, joined with the displayed week on `dateField`. |

## Behaviour

- **Writes.** Typing into an empty cell `create`s a record carrying the row field
  values, the day and the number. Changing a cell `update`s that record; clearing
  it `delete`s it. Hooks, validation and permissions judge each cell; a refusal
  stays on the cell with the server's message and the typed text, and Enter retries.
  Every write is announced with `notifyDataChanged`, which re-reads the week.
- **Multi-record cells** show their sum and are read-only.
- **Week.** Starts on the display locale's first day (`firstDayOfWeek`), with
  previous / this / next navigation. Row, day and week totals are always shown.
- **Add row** asks for the row field values (with each field's own edit widget)
  and adds an empty row; typing a day then creates its first record.
- **Query.** One `find` per week: the view filter AND `dateField` in the week,
  capped at the platform's non-grid row ceiling, with the row fields' relations
  expanded (field-level read access permitting).

## Strings

`timesheet.*` is a lazy locale namespace
(`@object-ui/i18n/namespaces/timesheet`), fetched when a timesheet mounts. The
grid renders nothing that reads one of its keys until the catalogue for the
page's language is resident.

## Exports

`ObjectTimesheet`, `ObjectTimesheetRenderer`, and the pure model:
`resolveTimesheetConfig`, `buildTimesheetRows`, `planCellWrite`, `startOfWeek`,
`weekDays`, with the types `TimesheetBinding`, `TimesheetGrid`, `TimesheetRow`,
`TimesheetCell` and `CellWrite`.
