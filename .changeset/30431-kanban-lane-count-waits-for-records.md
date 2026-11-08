---
'@object-ui/plugin-kanban': patch
---

Clause-②: no
Metadata-protocol: none

A kanban lane no longer reads `0` before its records have arrived. Every lane header that writes a count (the flat board's badge, the swimlane layout's column titles and lane rows) shows a small pending marker instead until the board's records settle, and the lane carries `aria-busy` meanwhile; the lane total waits the same way. Before this, a board opened right after publish under a list view showed the list's footer 「12 条记录」 over lanes reading 0 / 0 / 0 / 0 for as long as its lane queries were in flight. A lane that really holds nothing still reads `0` once its query answers. The signal is the one the board's "No cards" state already waits on (objectui#8827); no new string.
