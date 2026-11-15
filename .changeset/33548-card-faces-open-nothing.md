---
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-kanban': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(plugin-grid, plugin-list, plugin-kanban, app-shell): cards whose click opens nothing no longer look clickable, and a view authored `navigation: { mode: 'none' }` opens no record on a Cmd/Ctrl or middle click

Clause-②: yes (widening) — `ObjectGalleryProps` (published by `@object-ui/plugin-list`) and `ObjectKanbanComponentProps` (published by `@object-ui/plugin-kanban`) each gain one optional prop, `rowOpensRecord?: boolean`, the name `ObjectGridComponentProps` and `ListViewProps` already carry. Absent, every card renders as before. Nothing is removed or narrowed.
Metadata-protocol: none

**Cards that open nothing.** A list's rows open nothing when its view is authored `navigation: { mode: 'none' }`, or when its object's data API serves no single-record read (a list-only object). The grid already drew such rows plain on a desktop; its phone cards, the gallery's cards and the board's cards still drew a pointer and a hover lift, so a tap that did nothing looked like a broken page. `ListView` now hands its `rowOpensRecord` to the gallery and the board as well as the grid, and none of these faces draws a pointer or a hover lift for a card that opens nothing. A board card the reader may drag keeps its grab cursor. Card actions (the phone card's "⋮") stay, and the click still reaches the host.

**No new tab on an authored `none`.** On the Console's object list a Cmd/Ctrl-click or a middle click on a row of a view authored `navigation: { mode: 'none' }` opened the record in a new tab, though the view declares no navigation. It now opens nothing, like a plain click. This supersedes the sentence in the `33317-row-opens-nothing-plain` note that says such a click "still opens the record in a new tab, as before". Rows that open a drawer or a page still open a new tab on a Cmd/Ctrl or middle click.
