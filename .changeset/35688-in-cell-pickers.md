---
'@object-ui/fields': patch
'@object-ui/plugin-grid': patch
'@object-ui/components': patch
'@object-ui/i18n': patch
---

feat(fields): in a list grid's cell editor, select, multi-select, tags, date, time and colour open ready to pick

Clause-②: yes (widening)
Metadata-protocol: none

The widget contract `FieldWidgetComponentProps` gains two optional host keys, `inCell` (draw the face for a grid cell's editor) and `onCommit` (the user has finished: write the last `onChange` value and close). `FieldEditWidget` forwards both, and `ObjectGrid`'s cell editor passes them. A host that passes neither renders every widget exactly as before.

In the cell editor of every grid `ObjectGrid` draws:

- **Single select and status** show their option list at once, with a search box that filters as you type. The arrow keys move through the list, Enter or a click picks, and the pick is saved; the selection stays on the cell. With nothing picked, Enter commits as before and Escape cancels.
- **Multi-select** (and a select declared `multiple`) is the same list with check marks: each pick toggles, and the edit is saved when you move on.
- **Tags** list this record's tags with check marks; unchecking removes one, and text that matches no tag is added from the list's leading "Add" row (Enter).
- **Date and date-time** open their calendar at once while the typed value stays visible and editable in the text box. The calendar offers Today, Tomorrow, Next week (seven days from today) and Clear. On a date, picking a day or a quick pick saves and closes; on a date-time, a day keeps the calendar open for the time, as in forms.
- **Time** opens the browser's time picker when the editor opens.
- **Colour** shows the hex box first (Enter saves, Escape leaves) and a row of swatches plus the browser's colour picker; a swatch saves and closes.
- A value picked this way hands the keyboard focus back to the selected cell, and in a grid that edits on a single click, the click that picked it no longer opens the editor again.

`@object-ui/i18n` adds the strings these faces show in every locale: `fields.datePicker.nextWeek`, `fields.datePicker.clearPick`, `fields.options.search`, `fields.options.noMatches`, `fields.tags.add`, `fields.color.swatches`, `fields.color.custom`.

Forms, dialogs and the record page keep their current controls.
