---
'@object-ui/components': patch
'@object-ui/plugin-grid': patch
'@object-ui/fields': patch
'@object-ui/i18n': patch
---

feat(ui): in a list cell, a picker opens under the cell, Backspace clears, a refused value stays, and Enter stays on the cell

Clause-②: yes (widening)
Metadata-protocol: none

`GridCellFacts` (the select-first grid's per-cell host facts, `@object-ui/components`) gains three optional keys: `editor` (`'below'` draws the cell's editor as a panel under the cell, which keeps showing its value; absent or `'cover'`, the editor stays a layer over the cell), `clearRefusal` (why Backspace or Delete leave the cell as it is) and `validate` (why a committed value is refused). A host that sets none of them gets the editor placement and commits it had, with Backspace now clearing (below).

In every grid `ObjectGrid` draws with the select-first model (the list page):

- **Pickers open under the cell.** Single and multi select, status, tags, date, date-time, time, colour, lookup and user cells open their list, calendar or palette as a panel under the cell; the cell keeps its value as drawn (a coloured badge stays coloured) and the row height does not change. On a date the typeable box is the top of the panel and the calendar shows beneath it. Typed input, long text and an address still edit in place.
- **Backspace or Delete clears the selected cell and saves at once.** A required field keeps its value and says it is required (a required rating too, for Backspace, Delete and the 0 key); a read-only cell says why, as before; a checkbox cell is left alone.
- **A value that fails the field's rules is not saved.** The rules are the record form's (required, length, range, email and URL shape), and text a number box cannot read is refused too. The editor stays open with what was typed and says why under it (a number box that already says it cannot read its text is not told twice); correct it and commit again, or press Escape to discard. A click elsewhere does nothing while a refused value is open; a refused value whose cell scrolls out of sight is discarded.
- **A person's face no longer makes its row taller.** A user cell drew a 32 px face, which made its list row 41 px tall against 33 px for a row of text; the face is now 24 px and the row stays 33 px, at rest and while the cell is edited.
- **The selected cell's frame stays under the frozen columns** when the cell scrolls beneath them, and a cell deselected with Escape is left with no focus ring.
- **Enter saves and keeps the same cell selected**, with the focus back on it. It used to save and move the selection one row down. Tab and Shift+Tab still save and move right and left.

`@object-ui/i18n` adds `table.cellNotNumber` and `table.cellInvalid` in every locale.

Forms, dialogs and the record page keep their current controls.
