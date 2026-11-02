---
'@object-ui/core': patch
---

fix(core): the view projection harvest reads the CEL optional-field spelling `record.?x` / `data.?x`

Clause-②: no
Metadata-protocol: none

A list view adds to its `$select` the fields its predicates read (row and bulk action `visible` / `disabled`, the object's actions, the CRUD `visibleWhen` / `disabledWhen` overrides and conditional formatting), so a gate on a field no column shows still finds that field on the row. The harvester only knew `record.x` and `data.x`. A predicate written with the CEL optional selector, `record.?status.orValue('')`, left `status` out of the projection, so on a row that did not show `status` the selector always answered "absent" and the action behaved as if the field were empty.

`collectPredicateFieldRefs` now reads `record.?x` and `data.?x` as the field `x`, beside the plain spelling. Nothing else changes: a harvested name is still projected only when the object declares it (or it is a platform column) and the principal may read it. A selector that names no field (`record.?` alone, `record.?.x`) and the JavaScript spelling `record?.x` still contribute nothing.
