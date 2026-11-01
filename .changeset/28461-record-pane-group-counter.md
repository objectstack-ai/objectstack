---
'@object-ui/plugin-grid': patch
'@object-ui/plugin-kanban': patch
'@object-ui/plugin-list': patch
'@object-ui/app-shell': patch
---

feat(console): on a grouped list or a kanban board, the record pane's counter and ↓ ↑ step within the opened record's group or lane, and the counter's tooltip names it

Clause-②: yes (widening)
Metadata-protocol: none

A record opened from a grouped list (a contact list grouped by account) or from a board drew no 「3 / 21」 counter and no ↓ ↑ in its pane, so stepping to the next record meant closing the pane and clicking the next row. Now:

- **The pane steps within the group.** The counter counts the rows of the opened record's group (a board: its lane), ↓ ↑ step through them in the order the list draws them, and the last row of a group has no ↓. The counter's tooltip names the group — 「Acme Corporation 中第 1 条，共 3 条」 — where an ungrouped list's names the view. A nested group is named by its path of headings. The record page opened from the row's ↗ steps the same way.
- **Shown rows only.** A collapsed group or lane draws no rows and is not stepped through; a server-grouped group steps through the page of it on screen.
- **An ungrouped list is unchanged**: its counter and tooltip are as before.

Host channels, never authoring keys: `ObjectGrid` and `ObjectKanban` gain an optional `onRowGroupsChange` prop that reports the open groups (lanes) with their headings and rows (`ObjectGridRowGroup`, `KanbanLaneRows`), and `ListView`'s `onRowsChange` gains an optional second argument, `groups` (`ListViewRowGroup`), on a grouped grid and a board.
