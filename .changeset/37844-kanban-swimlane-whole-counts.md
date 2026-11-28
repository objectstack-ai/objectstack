---
'@object-ui/plugin-kanban': patch
---

fix(kanban): a windowed swimlane board counts each whole swimlane, and each whole column when it queries itself

Clause-②: no
Metadata-protocol: none

A kanban drawn in swimlanes that holds only a window of its query (a page a list view hands it, or its own fetch that filled its `limit`) wrote each swimlane row's count from the cards it held, marked `+`, and a board that queried itself wrote its column counts the same way. Such a board now asks one grouped read on the lane field and the swimlane field together, each group's record count under the board's filter and search, and writes every swimlane row's whole count from it; a board that queries itself also writes every column's whole count from the same read. A board that holds every record of its query asks nothing more. A source with no grouped door, or a read that is refused or cut, keeps the counts marked `+`, as before. Nothing to migrate.
