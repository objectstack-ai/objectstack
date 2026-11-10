---
'@objectstack/spec': minor
'@objectstack/types': patch
---

fix(spec, types): retired-key, aggregation and filter-comparand refusals answer a one-line message on the data doors, with the full prescription as a hint

Clause-②: yes (widening)
Metadata-protocol: added

The data doors used to answer these refusals with the spec's whole author-facing prescription as the message, 300 to 1,300 characters, which a toast cannot show. Each one now also carries a hand-written head (one line, at most 160 characters, naming the refused key or shape and the fix), on every door that answers `fields[]` through `zodIssuesToFields` and on the thrown-filter exits:

- `POST /api/v1/data/:object/query` (`400 VALIDATION_FAILED`), and likewise every other `fields[]` door (the batch and bulk routes, the record-page route, the analytics selection door, whose top-level `message` is composed from `fields[].message`, the runtime dispatcher's data and analytics domains, the dataset tools, and the `sys_personal_view` save hook in `plugin-auth`): `fields[].message` is the head, and the new optional `fields[].hint` (`FieldErrorSchema.hint`) is the prescription, for the retired `array_agg` / `string_agg` aggregation functions, `aggregations[].distinct`, the retired `joins` / `cursor` / `distinct` query keys and the refused `where` comparands (a scalar `$in` / `$nin`, an array in a single-value slot, a malformed or null / blank / `$field` `$between` bound, a null list member or ordering comparand, a non-boolean `$null` / `$exists` / `$empty`).
- `GET /api/v1/data/:object?filter=` (`400 INVALID_FILTER`): `error` is the head, led by the engine's `find('…'):` context when both fit in 160 characters, and `details.hint` is the text the door answered before.

Status, code and every accepted value are unchanged, and the same requests are refused. `os compile`, `os migrate` and the metadata save doors (`zodIssuesToMetadataIssues`) print the prescription byte for byte as before. The personal-view save (`sys_personal_view`) answers through `fields[]`, so it now answers the head in `fields[].message` and the prescription in `fields[].hint`. Nothing is cut from any prescription. A client that reads `fields[].message` gets the short line; read `hint` for the full rule and fix.
