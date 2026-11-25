---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@object-ui/plugin-kanban': minor
'@object-ui/plugin-list': minor
'@object-ui/i18n': minor
---

feat(kanban): a lane's sum, average, minimum and maximum cover every record of the lane, computed in the query

Clause-②: yes
Metadata-protocol: semantic
Skills-docs: follow-up #36422 (skills/objectstack-ui/rules/list-views.md teaches the board lane summary, now including avg / min / max)

A stored `kanban.summary` of type `sum` now totals every record in the lane (computed in the query) instead of the loaded cards; where the board cannot ask the server, no figure is drawn.

A board's lane foot statistic, `kanban.summary`, now takes `{ type: 'avg' | 'min' | 'max', field }` beside `none`, `count` and `sum`, and every one of `sum`, `avg`, `min` and `max` covers all of the lane's records:

- **One grouped aggregate, no fetch-then-add.** The board asks ONE aggregate over its own query — its filter and its host's search, grouped by the lane field — through the data door a grouped list view's headers already ride (`DataSource.queryGroupHeaders`, `POST /data/:object/query`). A lane longer than its page (50 records) shows the whole lane's figure; the "loaded cards" label is gone. Records with no lane value, and records in a value that is no lane, are folded into the trailing "Uncategorized" lane. A lane with no record shows `0` for a sum and no figure for the other three; a lane that holds records but that the answer has no group for (the door can cut the group rows under a deployment's default page size) shows no figure rather than `0`. A whole answer needs the door to hand back that the rows were cut: follow-up #36870.
- **Under the reader's permissions.** The platform runs the aggregate with the reader's row filter, and refuses an aggregate over a field the reader may not read; the board asks nothing for such a field, and a refused read draws no figure.
- **No figure rather than a partial one.** A data source without `queryGroupHeaders`, or a filter the read cannot repeat, draws no `sum` / `avg` / `min` / `max` figure. Over cards a host hands to the board without their query (records handed in whole), a `sum` is still added up on the board and the other three draw nothing. The list view hands a board whose lanes it cannot know before the query (lanes over a lookup field) its fetched page together with that page's query, so that board's `sum`, `avg`, `min` and `max` cover every record of each lane too (#36871).
- **`@objectstack/lint`** judges `avg`, `min` and `max` the way it judges `sum` (`list-view-summary-field-type-refused`): the aggregate × field-type table's row for that function over the field's declaration, less the boolean class, which it now reads from the spec (`BOOLEAN_VALUE_TYPES`) instead of listing `boolean` and `toggle` itself. The list view's lane-statistic picker reads the same class, and now offers and names `avg` (Average), `min` (Minimum) and `max` (Maximum) over the number fields it offers for `sum`; the locale packs carry the three names and drop the retired loaded-cards label.

A stored `sum` keeps its key and its field; what it draws is now the whole lane's total where it drew a total over the loaded cards before, and no figure over a data source that cannot answer the lane read.
