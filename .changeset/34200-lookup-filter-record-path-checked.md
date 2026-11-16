---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

feat(lint)!: a `lookupFilters` `{ $record: "path" }` path must name a field of the record being edited, or one hop from it

Clause-②: no (narrowing) — a `lookupFilters[].value` `{ $record }` path on a lookup, master_detail or user field that names no field of the object owning that field, hops through a field that is not a relationship, names a leaf the referenced object lacks, or takes a second hop, parsed clean and published; it is now refused at error as `object-field-ref-unknown` by `os lint`, `os validate`, `os build` and the runtime publish door.
Metadata-protocol: narrowed
Skills-docs: follow-up #34201 — no doc or skill teaches `{ $record }` yet (the picker that resolves it has not landed; both describes carry `[PLANNED — not enforced]`), so there is no teaching to correct; the existing follow-up for `{ $record }` docs moves with the picker change.

<!-- adr-0087: registered lookup-filter-record-path-unknown-refused -->

**BREAKING** only for a `{ $record }` path that already names nothing the record being edited carries. The `{ $record }` shape landed with its spelling judged (snake_case names, at most one dot) but not what it names, so `{ $record: "acount.cb_market" }` parsed and was stored. `object-field-ref-unknown` now resolves it against the object that owns the picker field: the first segment is a field of that object; with a second segment the first is a relationship field and the second a field of the object it references. A hop to an object outside the stack is not judged. Measured first-party exposure: zero — no example app, platform object, skill or docs sample writes a `$record` path.

**Fix:** correct the misspelt segment. `{ $record }` reads the record being edited; a column of the candidate row is written `{ $field: "column" }`. The semantic entry `lookup-filter-record-path-unknown-refused` carries the same notice into the upgrade guide and `os migrate meta`. `os explain object-field-ref-unknown` lists the position.
