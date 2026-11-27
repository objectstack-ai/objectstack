---
'@objectstack/spec': minor
'@objectstack/mcp': minor
'@objectstack/platform-objects': minor
'@object-ui/app-shell': minor
'@object-ui/plugin-gantt': minor
'@object-ui/plugin-list': minor
'@object-ui/plugin-timesheet': minor
'@object-ui/core': patch
---

feat(ui): the field hand lock (`uiReadonly` / `uiReadonlyWhen`) holds on the Gantt, the timesheet cell and the palette prefill

Clause-②: no
Metadata-protocol: semantic

A field a person may not edit by hand (`uiReadonly: true`, or `uiReadonlyWhen` true over the record) now stays locked on the console surfaces that still wrote it:

- **Gantt.** A bar's drag and edge resize, the progress handle, the title and dates edited in place, the auto-schedule and the conflict reschedule, undo and redo, and a drawn dependency link all read the one verdict of `@object-ui/core` (`fieldReadOnlyByHand`) over the stored record, with the shell's predicate scope. A write that would change a locked field is refused: nothing is sent, the bar goes back and a toast gives the read-only reason. A locked field the write only echoes back (an in-place title edit carries the dates and progress too) is dropped from the write, so the rest still saves. A field locked on every record also closes the gesture before it starts: a move closes when either date is locked, a resize only when both are (the locked edge is refused on the write), and the progress handle and the link tool close with their own field.
- **Timesheet.** A cell whose record's value field is locked by hand is drawn read-only, so it cannot be edited or cleared. A row, date or value field locked on every record closes the create, so the empty cells and **Add row** are not offered.
- **Command palette.** The create-as prefill skips a field that is `uiReadonly`, as it already skipped a `readonly` one; a create is judged by the static half only, as the create dialog judges it.
- **List view.** A kanban board whose block names no `groupByField` takes the object's lifecycle field as its lanes; the operands of that field's lock predicates are now read with the rows too, so a card drag is judged over the whole record.

A kanban drag on the swimlane layout writes only the lane (column) field, never the swimlane field; that is now pinned.

Not yet covered: the in-app assistant acting for a person. Its writes run in the AI service, which does not read the hand lock, and the field descriptions now say so. Every other console surface a person edits through honours the hand lock, and the `uiReadonly` / `uiReadonlyWhen` descriptions and the MCP `describe_object` guidance say that. Writes through the API, import, actions and flows are unchanged: only the server lock (`readonly` / `readonlyWhen`) binds them.
