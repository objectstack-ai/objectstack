---
'@objectstack/spec': minor
'@object-ui/plugin-kanban': minor
'@object-ui/plugin-list': minor
'@object-ui/app-shell': minor
'@object-ui/i18n': minor
---

feat(kanban): the board's own 视图设置, a lane header 「+」 and 「⋯」, and a lane statistic and card toggles on `KanbanConfig`

Clause-②: yes (widening)
Metadata-protocol: added

`KanbanConfigSchema` gains three optional keys, none with a default; a view that declares none of them renders as before:

- `summary` — a `ColumnSummaryConfig` statistic drawn at the foot of each lane (`count`, or `sum` / `avg` / `min` / `max` of `field`). It takes precedence over `summarizeField`; `{ type: 'none' }` shows nothing.
- `showFieldLabels` — absent means `true`: a card names each field beside its value; `false` draws the values alone.
- `hideEmptyFields` — absent means `true`: a card leaves out an empty field; `false` keeps its line.

On a board, the view settings show the lane field, which lanes show and in what order, the card fields (order, hide, add), the two card toggles and the lane-foot statistic, in place of the table's columns, group, row height and row colour. Each change applies at once and is held as the list's draft until Save. Each lane header gets 「+」 (a new record with the lane prefilled; an empty lane also gets a 「+ New」 row) and 「⋯」 (collapse, kept in this browser; hide). The Console now relays the view's `kanban.lanes`, which it used to drop. `ObjectKanban` takes the host's `laneMenu` request (`KanbanLaneMenuRequest`).
