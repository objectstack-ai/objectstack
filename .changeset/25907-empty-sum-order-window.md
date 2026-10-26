---
'@objectstack/service-analytics': patch
---

fix(service-analytics): an all-NULL `sum` group sorts and pages as the `0` it answers, the same on SQLite and PostgreSQL

Clause-②: no
Metadata-protocol: none

- **Before.** The native-SQL strategy folded a NULL `sum` (a group whose aggregand is NULL in every row, or a measure-scoped `sum` with no admitted row) to `0` in JavaScript, after the statement had already ordered and paged on the NULL. SQLite sorts NULL lowest and PostgreSQL highest, so `order { total: 'asc' }, limit 2` answered `0` before `-3` on SQLite and cut the `0` group from the page on PostgreSQL. The ObjectQL face answered `-3`, `0`.
- **Now.** The identity `emptyGroupValueFor` declares is in the statement, `COALESCE(SUM(…), 0)`, so `ORDER BY`, `LIMIT` and `OFFSET` read the value the group answers, on every dialect. The echoed `sql` and `/analytics/sql` show it. `count` is not wrapped: SQL `COUNT` already answers `0` over nothing.
- **NULL placement is stated.** `avg`, `min` and `max` keep NULL over nothing, and a dimension can hold NULL. On SQLite and PostgreSQL every `ORDER BY` key now carries `NULLS LAST`, in both directions: the ordering the ObjectQL face and the dataset door's post-pass already apply. A host whose dialect is MySQL or unnamed keeps the driver's placement, because no one spelling parses on all of them.
- **The ObjectQL face's echo states it too.** That face already orders NULL last (`applyOrdering`); its echoed `sql` and `/analytics/sql` now render the same `ORDER BY` as the native face, `NULLS LAST` included, so the printed statement runs to the order the face answered.
