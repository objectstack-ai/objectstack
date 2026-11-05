---
'@object-ui/plugin-dashboard': patch
---

feat(plugin-dashboard): a dataset-bound KPI tile opens the records behind its number

Clause-②: no
Metadata-protocol: none

A dashboard metric tile bound to a dataset now opens the same drill drawer its charts and tables already open, by click or by Enter/Space. The list is the widget's filter (the dashboard's filters included) AND the answer's date window AND the measure's `drillScopes` entry, which carries the dataset's own filter and the measure's own filter, so the records listed are the records the number counts. A tile whose measure has no `drillScopes` entry (a derived measure, or a scope that names a relationship path) offers no click, as does a tile whose filter the list cannot express; its markup is unchanged. Nothing to author: the click follows from the dataset answer.
