---
'@object-ui/plugin-dashboard': patch
---

fix(plugin-dashboard): a `compareTo` KPI tile shows its number when the reader picks All time, instead of the executor's "compareTo needs a dated window to shift" error

Clause-②: no
Metadata-protocol: none

- **Before.** A dataset-bound widget with `compareTo` always sent `compareTo` to the dataset executor, but lowered a `timeDimensions` window only when its resolved filter held a closed `{ $gte, $lte }` date pair. Picking **All time** on the dashboard's date-range filter removes that pair, so the executor refused the query and the tile showed a 400 error where its number belonged. The same tile without `compareTo` showed its number.
- **Now.** When the resolved filter carries no date condition at all on the compared field (on any field when `compareTo.dimension` is omitted), the widget asks for no comparison: the query is the one a widget without `compareTo` sends, and the tile shows its number with no comparison badge.
- **Unchanged: an author-written window that is not closed stays an error.** A one-bound window (`{ $gte: '{current_year_start}' }`, a YTD tile), an exclusive bound or a single day is still sent with `compareTo`, and the executor still refuses it and names the fix. The executor and the spec define a comparison only against a two-bound window. Two dated fields with no `compareTo.dimension` stay the executor's ambiguity error.
