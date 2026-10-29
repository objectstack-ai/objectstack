---
'@objectstack/objectql': patch
---

Clause-②: no
Metadata-protocol: none

Hardening (ADR-0100): the engine's credential-column guard now covers filter and sort keys, not only aggregates. A `password` or `secret` field was already refused as a group-by key or a min / max operand; it is now also refused, with the same `400 INVALID_FIELD` envelope, as a `where` / `filter` predicate (including a `{ "$field": … }` comparand, a per-aggregation `filter`, an `expand` entry's own `where` / `orderBy`, and a nested-relation condition on a related object's credential field) and as an `orderBy` key, on `find`, `findOne`, `count`, `aggregate` and predicate `update` / `delete`, before any driver is asked. A has-a-value check stays accepted: `{ "$null": … }`, `{ "$exists": … }`, `{ "$empty": … }`, or equality with `null`. The guard binds every caller except a system context, so the server's own credential lookups are unchanged. A search no longer scans a credential column, even one an object lists in `searchableFields`.

If a caller sorted or filtered on a `password` / `secret` field, it now receives `400 INVALID_FIELD`: sort or filter by another field, or use a has-a-value check.
