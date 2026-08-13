---
'@objectstack/plugin-sharing': patch
---

Stop scoping federated (`external`) objects by the phantom `owner_id` anchor

The ObjectQL registry injects `owner_id` into every object that has not opted out,
federated ones included, while `Engine.syncObjectSchema` returns early for
`external != null` and issues no DDL — so on a federated object that column exists in
the registered schema and in no store. `SharingService.buildReadFilter` and
`buildWriteFilter` both decided by asking "does this object carry an `owner_id`
field?", were answered yes, and AND-composed `owner_id = <caller>` (or the ADR-0057
DEPTH-widened `$in`) onto a query whose backing table has no such column. On SQLite the
unresolvable identifier degrades to a string literal, so the predicate is
constant-false — 0 rows, no error, HTTP 200; Postgres and MySQL raise
`column "owner_id" does not exist`. Either way a federated object under the
secure-default `private` OWD was unreadable by any principal whose read scope was
narrower than `org`, and nothing reported why.

Both filters now apply a provenance test: an `owner_id` that is byte-identical to the
shipped `OWNER_FIELD_DEF` on an `external` object is the platform's injected anchor,
not a real owner column, so ownership scoping contributes nothing there. A federated
object that **declares** a real remote owner column keeps its scoping, and every local
object is untouched.
