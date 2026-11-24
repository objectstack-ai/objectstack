---
'@object-ui/plugin-grid': patch
'@object-ui/components': patch
'@object-ui/types': patch
'@object-ui/i18n': patch
---

feat(grid): a list cell's right-click menu copies, pastes and clears that cell

Clause-②: yes (widening) — an optional `cell` member (`copy`, `paste`, `clear`) on the context `data-table` hands a host's `renderRowContextMenu`; five new `table.*` language-pack keys in every locale `@object-ui/i18n` ships (`copyCell`, `pasteCell`, `clearCell`, `pasteNotValue`, `pasteUnavailable`); nothing is removed or renamed
Metadata-protocol: none

Right-clicking a cell in a list now offers what can be done to that cell, above the row's own items.

- The menu has two sections. Above a line: **Copy**, **Paste**, **Clear** and, where it was already offered, **Change history**. Below it: the row's items as before (Open, Open in new tab, the row's actions). A right-click off a data cell opens the row's section only.
- **Copy** copies the cell's value, as Ctrl/Cmd+C does.
- **Paste** writes the clipboard's text into the cell and saves it, through the same checks as typing into the cell: text that is not an email address in an email cell, a value over a field's length, an empty required field are refused and the cell says why. If the browser will not let the list read the clipboard, the cell says so and names Ctrl/Cmd+V. Paste is offered on text, numbers, dates and single-choice fields (an option by its value or label); on a record reference, a person, a multi-choice and other types it is unavailable.
- **Clear** empties the cell and saves it, as Backspace does; it is unavailable on a required field.
- On a read-only field, a calculated field, a grid that is not editable or a record the reader may not change, Paste and Clear are unavailable and Copy still works.
- A paste into the selected cell with Ctrl/Cmd+V now goes through the same checks: text the cell's editor would refuse is no longer sent to be saved, and text the column cannot read (letters in a number cell, a name in a lookup cell) says why instead of doing nothing.
