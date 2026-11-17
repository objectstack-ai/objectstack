---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@object-ui/plugin-timesheet': minor
'@object-ui/plugin-list': minor
'@object-ui/plugin-view': minor
'@object-ui/core': minor
'@object-ui/types': minor
'@object-ui/i18n': minor
'@object-ui/app-shell': minor
'@object-ui/cli': minor
'@object-ui/console': minor
---

feat(ui): timesheet list view, an editable row × weekday entry grid

Clause-②: yes (widening — new list view type `timesheet`, its `timesheet` block and the `VisualizationType` member; new locale keys)
Metadata-protocol: added

A list view can now be `type: 'timesheet'`. It pivots detail records into rows × the seven days of one week, and every cell is editable:

```ts
type: 'timesheet',
timesheet: {
  rowFields: ['project', 'task'], // 1–3 fields; one row per distinct combination
  dateField: 'work_date',         // date or datetime
  valueField: 'hours',            // number, currency or percent
}
```

- Typing into an empty cell creates a record carrying the row's field values, the day and the number. Changing a cell updates that record, and clearing it deletes the record. Each cell is one call on the record API, so hooks, validation rules and permissions judge it; a refusal stays on that cell with the server's message.
- A cell holding several records shows their sum and is read-only.
- The grid offers each write only to a caller who may make it (the affordance-to-grant map's `gridAddRow`, `listInlineEdit` with the value field's write permission, and `rowDelete`). A cell no granted write can change is read-only, and **Add row** needs the create grant. An interface page's list block relays the view's `timesheet` block.
- The week starts on the viewer's locale first day, with previous / this / next navigation. Row, day and week totals are always shown.
- **Add row** asks for the row field values first; typing a day then creates the record. The view's `filter` applies to the week's query.
- A `timesheet` view with an incomplete block shows "Timesheet configuration required", and `os validate` warns with `view/layout-without-binding`. `view/list-view-field-refs` checks the three field names.

The renderer is the new lazy package `@object-ui/plugin-timesheet` (`object-timesheet`), with its own lazy locale namespace `timesheet.*`. The view switcher, the create-view dialog and the Studio list-view type section offer the new type.
