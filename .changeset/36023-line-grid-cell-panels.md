---
'@object-ui/fields': patch
---

feat(fields): the line-item grid's select and date cells open their panel under the cell, and Esc in a cell takes back only that cell

Clause-②: no
Metadata-protocol: none

In a form's line-item grid (`GridField`, the master-detail lines):

- A **select** cell shows its option label; a click, Enter, Space or a typed letter opens a searchable option list under the cell (the letter becomes the search), and a pick writes the value. Esc closes the list and writes nothing.
- A **date** or **date-time** cell keeps the browser's own control, typed into as before, and opens a calendar under the cell when the cell is entered, with Today, Tomorrow, Next week and Clear. A day picked on a date-time keeps its time of day.
- A **text** cell whose text is longer than the column floats right over its neighbours while it has the focus.
- **Esc** in a cell puts the line back as it was when the cell was entered, and no longer reaches a dialog the form is open in, so the dialog and its other lines stay.
- A stored day that does not exist is named at the top of the calendar and in the cell's tooltip instead of a line under the cell, so the row keeps its height.

Enter still moves to the next line (and adds one on the last line). Nothing a metadata author writes changes.
