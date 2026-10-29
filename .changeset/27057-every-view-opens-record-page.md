---
'@object-ui/plugin-calendar': patch
'@object-ui/plugin-gantt': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-detail': patch
---

fix(ui): a calendar event and a gantt bar open the same record page a grid row opens in the console

Clause-②: no
Metadata-protocol: none

In the console a calendar event or a gantt bar opened a second, smaller rendering of the record (the quick-look `RecordDetailPanel`), while a grid row or a kanban card of the same object opened the record page in the drawer, with the drawer stack and ⤢ to the full page. Now every view opens the record page:

- **Calendar and gantt.** A host's `onRowClick` takes the click, as it already did on the kanban, the grid, the gallery, the map, the timeline and the tree. Before, both views let their own drawer outrank the host's handler, and the gantt's registration never forwarded one. The console's handler opens the record in the drawer, or on its page where the view or the object declares `page`. Before, a calendar view that declared `page` opened the quick-look drawer instead.
- **The renderers' own drawer is the fallback.** A calendar or gantt that nobody hands a click (a standalone block, a list with no host handler, a host outside the console) still opens its own drawer, as before. `ListView` passes the two views its click router only when its own host routes record clicks, so a hostless list keeps that drawer instead of a click that opens nothing.
- **Gantt registration.** `ObjectGanttRenderer` forwards a function-typed `onRowClick` and nothing else. An authored non-function value is dropped, and host `data` stays dropped.
- **`RecordDetailPanel`** is unchanged apart from its docblock, which names it as the fallback and its later removal.
