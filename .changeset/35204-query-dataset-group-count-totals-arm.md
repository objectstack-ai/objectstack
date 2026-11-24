---
'@objectstack/service-analytics': patch
---

fix(service-analytics): `query_dataset` never pairs an empty answer with a group count

Clause-②: no
Metadata-protocol: none

A selection with `totals` runs its totals reads after the primary grid is counted. When one of those reads met a missing source, the service served the empty answer (`rowCount: 0`), but the group count of the primary grid was already written, so `query_dataset` answered `totalGroups` for a grid it never served. The count now reaches the caller only once the whole call has answered; an answer served empty because a read failed carries no `totalGroups`.

The `dataset-group-count.ts` header also states where the whole-grid proof stops: at the strategy's own read seam (`ctx.executeRawSql`, `ctx.executeAggregate`). A host-supplied bridge or an out-of-repo driver that silently truncates an unwindowed read would be counted as whole.

No key, member or export changes.
