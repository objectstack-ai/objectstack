---
'@object-ui/plugin-kanban': patch
'@object-ui/plugin-list': patch
'@objectstack/spec': patch
---

fix(kanban): a list view board whose lanes come from a lookup field shows each lane's whole sum, average, minimum and maximum, not one page's

Clause-②: yes (widening)
Metadata-protocol: none

A list view board whose lanes it cannot know before the query (lanes over a lookup field) is handed one page of records. Its lane statistic (`kanban.summary`) used to add up that page under the name of the lane's total, and drew no average, minimum or maximum at all although the view settings offer them.

- **`@object-ui/plugin-list`**: the list view now hands that board the query of its page too: the node's `filter` is the effective filter its own fetch sent, and a new host prop, `laneStatisticQuery`, carries its search term and fields and its refetch signal (Refresh, `refreshTrigger`, a declared write).
- **`@object-ui/plugin-kanban`**: a board handed its cards with `laneStatisticQuery` asks the lane read a board that queries its own cards asks: one grouped aggregate (`DataSource.queryGroupHeaders`) over every record of each lane. `sum`, `avg`, `min` and `max` are the whole lane's figures; a source without that door, a refused read or a cut answer draws no figure, never the page's. A board handed its cards without their query (records handed in whole) still adds up a `sum` over them and draws none of the other three.
- **`@objectstack/spec`**: the `KanbanConfig.summary` description drops the "known gap" sentence and says what such a board draws.
- **What widens:** `ObjectKanbanComponentProps` (exported by `@object-ui/plugin-kanban`) gains the optional `laneStatisticQuery?: KanbanLaneStatisticRequest`. Every existing caller is unchanged.

This supersedes the "known gap" line of #36857's note (follow-up #36871) for the list view board whose lanes come from a lookup field: that board's `sum`, `avg`, `min` and `max` now cover every record of each lane.
