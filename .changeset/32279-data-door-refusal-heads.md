---
'@objectstack/spec': patch
'@objectstack/types': patch
---

fix(spec, types): retired-key, aggregation and filter-comparand refusals answer a one-line message on the data doors, with the full prescription as a hint

Clause-②: yes (widening)
Metadata-protocol: none

The data doors used to answer these refusals with the spec's whole author-facing prescription as the message, 300 to 1,300 characters, which a toast cannot show. Each one now also carries a hand-written head (one line, at most 160 characters, naming the refused key or shape and the fix):

- `POST /api/v1/data/:object/query` (`400 VALIDATION_FAILED`): `fields[].message` is the head, and the new optional `fields[].hint` (`FieldErrorSchema.hint`) is the prescription, for the retired `array_agg` / `string_agg` aggregation functions, `aggregations[].distinct`, the retired `joins` / `cursor` / `distinct` query keys and the refused `where` comparands (a scalar `$in` / `$nin`, an array in a single-value slot, a malformed or null / blank / `$field` `$between` bound, a null list member or ordering comparand, a non-boolean `$null` / `$exists` / `$empty`).
- `GET /api/v1/data/:object?filter=` (`400 INVALID_FILTER`): `error` is the head, led by the engine's `find('…'):` context when both fit in 160 characters, and `details.hint` is the text the door answered before.

Status, code and every accepted value are unchanged, and the same requests are refused. `os compile`, the save doors and `os migrate` print the prescription byte for byte as before; nothing is cut from it. A client that reads `fields[].message` gets the short line; read `hint` for the full rule and fix.
