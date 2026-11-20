---
'@objectstack/spec': patch
'@objectstack/objectql': patch
'@objectstack/service-analytics': patch
'@objectstack/plugin-security': patch
'@objectstack/driver-odata': patch
---

feat: analytics compiles the `SharedRecordIds` fixed-read leaf, the access explainer resolves it at the record, and OData refuses it (ADR-0155, step 5 of 6)

Clause-②: yes
Metadata-protocol: none

No visible change on its own: nothing on main writes a `SharedRecordIds` leaf yet. The sharing plugin starts writing it at ADR-0155's last step.

- **Analytics, the native SQL path** (`@objectstack/service-analytics`). A read scope carrying `{ id: { $in: SharedRecordIds.read(object, user) } }` compiles to one subquery in the list's own position, `id IN (SELECT "record_id" FROM "sys_record_share" WHERE "object_name" = ? AND "recipient_type" = ? AND "recipient_id" = ? AND "record_id" IS NOT NULL AND "record_id" <> '')`, with every value bound and no tenant scope on the subquery (ADR-0155 ① ruled A). The native strategy takes such a scope only when the host answers `AnalyticsServiceConfig.fixedReadLeafClassOf` with `null` for each leaf (outside both classes ADR-0155 D4 recognises: the object on another datasource than `sys_record_share`, or a middleware or `beforeFind` / `afterFind` hook registered for `sys_record_share` by name) and the dialect is SQLite, PostgreSQL, MySQL or SQL Server. Otherwise it declines, and the ObjectQL engine path answers. A host that wires no answer keeps today's behaviour: the native path declines every scope that carries the leaf. `AnalyticsServicePlugin` wires no answer in this release (#35946), so on every host today the native path declines a scope carrying the leaf and the engine path answers.
- **Analytics, the ObjectQL path.** The read-scope merges (`withReadScope`, the related-object scope, the label read) admit a placed read-form leaf and hand it to the engine by reference. The dry-run SQL echo prints the subquery. A leaf in any other position, under `$nin`, on another object or in its write form is refused, `INTERNAL_ERROR` / 500, logged at `error` once per service logger.
- **Analytics, the query's `where`.** A leaf reaches analytics only in the read scope. A leaf anywhere in a query's `where`, in either spelling, is now refused before either strategy runs, with `INTERNAL_ERROR` / 500. The message names the leaf and its table, not the recipient. Before this release `{ id: { $in: leaf } }` there answered `INVALID_FILTER` / 400, with a message that printed the recipient. A bare `{ id: leaf }`, or an array-form `=`, was read as a relation condition on `id`. No request can spell the leaf, so only in-process code could reach this.
- **The access explainer** (`@objectstack/plugin-security`). `ISecurityService.explain` resolves each leaf in the sharing read filter at the record it judges, with one read of `sys_record_share` under the leaf's own predicate, keyed by the record ids (one read for a whole batch). The sharing layer's `rowFilter` then has the two shapes it has today: `{ id: { $in: [recordId] } }` in the share arm for a caller with a grant on the record, and the share arm left out for a caller without one. The published `rowFilter` never carries the leaf. A leaf it cannot resolve is refused, `INTERNAL_ERROR` / 500, logged at `error` once.
- **OData** (`@objectstack/driver-odata`). `find` and `count` refuse a `where` carrying the leaf before any request is sent, `INTERNAL_ERROR` / 500. An OData `$filter` has no form of the subquery, and the driver declares no `fixedReadLeaves`. Before this release a direct `find` left the leaf's predicate out of the `$filter` it sent. The engine already refused the leaf before calling this driver.
- **The array form** (`@objectstack/spec`). `parseFilterAST` now refuses a leaf in an array-form `in` / `nin` with `INTERNAL_ERROR` / 500, where it answered `INVALID_FILTER` / 400. The new message names the leaf and its table, not the recipient. An unbranded copy that crossed JSON is still `INVALID_FILTER` / 400.
- **New exports** (`@objectstack/objectql`). `fixedReadLeafClassOfEngine(engine, leaf)` answers which ADR-0155 D4 class, if any, keeps the engine from handing a leaf to a driver. `driverEvaluatesFixedReadLeaf` answers whether a driver declares the leaf. Neither reads or writes anything.
