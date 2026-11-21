---
'@object-ui/components': patch
'@object-ui/fields': patch
'@object-ui/plugin-grid': patch
---

fix(grid): in a list cell a single click only selects, and the email and phone cells draw no copy button

Clause-②: no
Metadata-protocol: none

On a grid with the select-first cell model (the console's list page), a plain click on a link a cell draws used to follow it: an email opened the mail program, a phone number the dialler, a URL a new tab, a lookup or user chip that record's page, and an image thumbnail its lightbox. The cell was not selected, so a reader who meant to select or edit the cell left the list instead. The email and phone cells also drew a copy button beside the value, easy to hit while selecting.

A plain click on any of these now selects the cell and opens nothing. (A lookup chip on a list whose host opens records in place, the console's list page, opens that record in the side drawer instead.) To open one: Ctrl/Cmd-click it (as before), press the open button the selected cell shows on hover (only on the selected cell, never on the row hover), or press Ctrl/Cmd+Enter on the selected cell. A cell of several chips opens the first one that way. A double-click on the link edits the cell, as on any other cell. The name link is the one exception and opens the record on a single click, as before. The copy buttons are not drawn inside such a grid; Ctrl/Cmd+C copies the selected cell.

Outside the select-first model nothing changes: the record page, related lists, phone cards, kanban cards and every grid whose host does not turn on `cellSelection` keep their links and copy buttons.

For renderer authors: a link (`a[href]`) inside a select-first cell is now treated as part of the cell's value. Mark the one link a single click must still follow with `data-opens-on-click`, a non-link control that opens what the value points at with `data-cell-opener`, and a copy control the grid should not draw with `data-cell-copy`.
