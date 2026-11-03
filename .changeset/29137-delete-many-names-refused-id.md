---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): `deleteMany` names the id entry it refuses

Clause-②: no
Metadata-protocol: none

A `deleteMany` whose `ids` is an array but holds an entry that is not a record id is still refused with `400 VALIDATION_FAILED`, and the answer now says which entry. Each offending entry gets a `fields[]` row `{ field: 'ids.N', code, message }`, the same shape the REST ingress already gives `[null]`: an empty string answers `required` (the entry is empty, and a record id is required for delete), and any other non-id (null, an operator object such as `{"$ne":null}`, a boolean) answers `invalid_type`. The sentence names the first offending entry. Before, every such request got the sentence "requires 'ids' to be an array of record ids" and an empty `fields[]`, which named the wrong problem.

A non-array `ids` keeps that sentence and names no entry. What is refused does not change: a whitespace-only id still reaches the row loop and reports `RECORD_NOT_FOUND` for its row.
