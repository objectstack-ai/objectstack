---
'@objectstack/spec': patch
---

feat(spec): declare `SharedRecordIds`, the share-grant semi-join leaf, with its fixed inner read, the comparand door's `admitFixedReadLeaves` option and a conformance case-set (ADR-0155 step 1)

Clause-②: yes
Metadata-protocol: none

ADR-0155 replaces the list the sharing read scope binds today (`{ id: { $in: [granted ids] } }`, read from `sys_record_share` at most 5,000 grants per read, so a member past that count silently loses access) with an engine-internal leaf that a SQL driver compiles as a subquery in the same statement. This release declares the contract the later steps build on. Nothing writes the leaf yet, no caller admits it, and no read, write or boot behaves differently.

New in `@objectstack/spec/data`:

- **`SharedRecordIds`** — `SharedRecordIds.read(object, recipient)` (every access level) and `SharedRecordIds.write(object, recipient, accessLevels)` (the levels the producer supplies, for a predicate update) build a frozen value branded under `SHARED_RECORD_IDS_BRAND` (`Symbol.for('objectstack.filter.sharedRecordIds')`), non-enumerable like the `ReadableIds` brand. `isSharedRecordIds(value)` recognises it; a copy that crossed JSON, a structured clone or a spread arrives unbranded and is refused as a non-list comparand (`INVALID_FILTER` / 400), never dropped. It carries the object, the recipient user id and, on the write form, the levels: no organization and no reading context. No filter operator spells it, so no request or metadata author can write it.
- **The fixed inner read** — `SharedRecordIds.innerRead(leaf)` and the shared `fixedInnerReadOf(leaf)` describe what the leaf denotes as a `FixedInnerRead`: the table (`sys_record_share`), the projected column (`record_id`), the bound equality predicates (`object_name`, `recipient_type = 'user'`, `recipient_id`), the membership predicate on the write form (`access_level`), and `tenantScope: 'none'` (the subquery takes no tenant scope). Every evaluator compiles that description, plus the blank-id guard on the column, and none restates the predicate. `fixedReadLeafBrandOf` and `isFixedReadLeaf` recognise the leaf; ADR-0147's leaf will add its row to the same dispatch.
- **`ListComparandShapeOptions.admitFixedReadLeaves`** — one option naming the brands a caller of `assertListComparandShapes` admits as a `$in` comparand, beside `admitReadableIds`. No caller passes it in this release, so every door keeps refusing the leaf.
- **`FIXED_READ_LEAF_CASE_SETS` / `SHARED_RECORD_IDS_CASE_SET`** — the per-driver conformance cases (fixture tables, the rows each `where` must answer, which case needs the inner read to stay unwalled) and the engine seam's position, verb and recipient cases, as data for the driver and engine cards to run.

The `ISharingService.buildReadFilter` and `ISecurityService.getReadFilter` docs now say what holds once plugin-sharing writes the leaf: hand the scope to an engine read in process, under the context it was asked for, a context acting on that user's behalf, or a system context, and never serialise it or match it with a generic matcher. A host that registers a middleware or a `beforeFind` / `afterFind` hook for `sys_record_share` by name will be refused at boot from that switch on, until it removes the registration. A middleware or find hook registered for no object will not run on the share arm.
