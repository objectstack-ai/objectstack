---
'@objectstack/driver-memory': patch
'@objectstack/driver-mongodb': patch
---

Stop a field operator whose lowering reuses another operator's key from silently clobbering it.

Both document-shaped drivers translated a field constraint by writing every lowered key into one object literal. Several authorable operators do not lower to a key of their own name — `$null` writes `$eq`/`$ne`, `$between` writes `$gte` plus `$lte`/`$lt`, `$lte` on a bare calendar day writes `$lt`, and MongoDB's `$contains`/`$startsWith`/`$endsWith`/`$icontains` all write `$regex` — so two constraints on one field landed on one key and the second assignment won. One constraint disappeared with no error and no trace in the emitted query, and which one disappeared was decided by the author's key order. On a row-level-security read scope, a dropped constraint is a widened one.

A lowered write whose key is free now merges inline as before; a write whose key is already taken becomes its own `$and` branch, where both constraints survive. Which write keeps the inline slot is decided by the spec's declared operator order rather than by the author's key order, so one predicate emits the same query however it is spelled. `driver-memory`'s analytics (cube) face carried a wider form of the same defect — its `$match` was keyed by field path, so a second predicate on a member replaced the first entirely, for every operator pair — and is promoted the same way.

Filters with no contested key are unchanged.
