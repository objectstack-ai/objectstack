---
"@objectstack/spec": minor
"@objectstack/rest": minor
---

Add a batch form to `security/explain` (#8326): `recordIds: string[]` (max 200, mutually exclusive with `recordId`) on the existing request shape answers the per-record `decision.record.visible` verdict map for one `(object, operation)` pair in one round trip. The response gains an optional `records` array where `records[i]` answers `recordIds[i]` (duplicates answered per position); a missing record fail-closes to `visible: false` with `decidedBy` omitted. Each id is evaluated through the singular pipeline, so the batch answer for a record is identical to the singular answer by construction. Singular and object-level requests and responses stay byte-compatible; a request carrying both spellings, an empty batch, or more than 200 ids is refused with `400 VALIDATION_FAILED`.
