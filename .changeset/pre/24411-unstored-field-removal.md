---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol): removing a field that stores nothing is not a destructive change

Clause-②: yes (widening) (the save door newly accepts, without `force`, a removal it refused; owes the seat's `TIER_DEFAULT` review of record before the queue)

- **What changed.** The object save's safety diff (`PUT /api/v1/meta/object/:name`, and every other door that reaches `saveMetaItem`'s destructive gate) now judges each finding by whether the field is stored, using the spec's storage predicate `isVirtualSearchField` (`SEARCH_VIRTUAL_TYPES`) on the field's own declaration — the predicate the sortability projection already reads. A `formula` field is computed on read and has no column (ADR-0079 addendum, item 9), so:
  - removing a `formula` field saves `200` without `?force=true` (it answered `409 DESTRUCTIVE_CHANGE` with "existing data in this column will become inaccessible");
  - retyping a `formula` field into a stored kind saves without `force`: the new column starts empty, and no stored value is lost.
- **Not changed.** Removing a stored field, including an engine-computed but stored one (`autonumber`, `summary`), still answers `409 DESTRUCTIVE_CHANGE` with the same `field_removed` finding and message. Retyping a stored field into a `formula` still answers `409` with `field_type_change`. The `force` mechanism, the messages and the error codes are unchanged.
- **Who notices.** An author or an agent that removes a formula field no longer needs `force=true` for it, so `force=true` stays reserved for a real loss of stored data.
