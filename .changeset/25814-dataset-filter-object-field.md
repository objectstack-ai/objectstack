---
'@objectstack/service-analytics': patch
---

fix(analytics): a dataset filter key that names an object field filters that field, even when a dimension shares its name

Clause-②: no
Metadata-protocol: none

A dashboard global filter's `field` resolves against the dataset's object, not against its dimensions, and so do a widget's own `filter`, the dataset's `filter` and a measure's `filter`. The runtime read the key the other way round when the names collided. With a dimension `{ name: 'department', field: 'department.name' }`, picking a department in the filter bar sent `runtimeFilter: { department: UNIT_ID }`, and the query compared `department.name` to that id. Every widget on the board read 0, while the draft preview of the same dataset showed the right rows.

`queryDataset` now filters such a key on the object's own `department` column, on the native SQL and the ObjectQL paths alike. The field-read admission judges that column too. When the same key is selected as a dimension, the rows are still grouped by `department.name`. Nothing else moves:

- A key that is not a field of the object keeps resolving through the dimension of that name, as before (`department_name: 'Legal'`).
- A dimension whose `field` is its own name (`{ name: 'stage', field: 'stage' }`) already filtered the same column.
- `/analytics/query` on a registered dataset's cube still reads `where` as the cube's member names.
- A host that cannot list the object's fields (no `getObjectFieldNames`) keeps the old resolution. The shipped `AnalyticsServicePlugin` wires it.

What to do: nothing. A dashboard that worked around this by renaming the dimension keeps working.
