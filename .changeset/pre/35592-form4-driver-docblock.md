---
'@objectstack/spec': patch
---

docs(spec): the `FilterCondition` nested-relation (form 4) docblock says per verb and driver how the form is served

Clause-②: no
Metadata-protocol: none

The form 4 paragraph of the `FilterCondition` docblock in `@objectstack/spec/data` said the nested-relation form is served "the same on every driver" by reading the related ids, and that a condition over the engine's cap is refused. It now says what the engine does: on a read verb (`find`, `findOne`, `count`, `aggregate`) a single-valued relation is one subquery inside the read's own statement where that is provably the same read; a multi-valued relation, `update`, `delete` and a read the subquery cannot prove read the related ids. On a driver that does not declare `DriverCapabilities.readableIdsLeaf` (MongoDB, OData) a single-valued condition on a read verb is refused up front with `INVALID_FILTER` / 400 (ADR-0139 D3, as amended). The cap sentence now applies only where ids are read. Text only: no schema, type or behaviour change; it now agrees with the Data Engine contract page.
