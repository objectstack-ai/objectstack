---
'@objectstack/spec': minor
'@object-ui/plugin-kanban': minor
'@object-ui/plugin-list': minor
'@object-ui/app-shell': minor
'@object-ui/i18n': minor
'@object-ui/plugin-view': minor
'@objectstack/lint': minor
---

feat(kanban): the board's own 视图设置, a lane header 「+」 and 「⋯」, and a lane statistic and card toggles on `KanbanConfig`

Clause-②: yes (widening)
Metadata-protocol: added

`KanbanConfigSchema` gains three optional keys, none with a default; a view that declares none of them renders as before:

- `summary` — a lane statistic drawn at the foot of each lane (`KanbanLaneSummary`): `{ type: 'count' }`, or `{ type: 'sum', field }` of a number field over the cards the lane has loaded, not every record of the lane; `{ type: 'none' }` shows nothing. It takes precedence over `summarizeField`. A sum over a lane holding more cards than were loaded says so (「仅已加载的卡片」). The whole-lane sum, and average, minimum and maximum, wait for a server lane read (#36520).
- `showFieldLabels` — absent means `true`: a card names each field beside its value; `false` draws the values alone.
- `hideEmptyFields` — absent means `true`: a card leaves out an empty field; `false` keeps its line.

On a board, the view settings show the lane field, which lanes show and in what order, the card fields (order, hide, add), the two card toggles and the lane-foot statistic, in place of the table's columns, group, row height and row colour. Each change applies at once and is held as the list's draft until Save. Each lane header gets 「+」 (a new record with the lane prefilled; an empty lane also gets a 「+ New」 row) and 「⋯」 (collapse, kept in this browser; hide). Hiding a lane moves its cards into 「未分类」, as `kanban.lanes` (#28211) always has, and the menu and the lanes list say so. The lane field picker offers select and radio fields; collapse is kept per reader, object and view. The Console now relays the view's `kanban.lanes`, which it used to drop, and both producers of the board node (`ListView` and `ObjectView#generateViewSchema`) relay the three new keys. `ObjectKanban` takes the host's `laneMenu` request (`KanbanLaneMenuRequest`). `@objectstack/lint` walks `kanban.summary.field` and refuses a `sum` over a field that is no number, a yes / no field included (`list-view-summary-field-type-refused`). Saving a board whose view declares no `kanban` block stores the lane field the board draws with the changed keys.
