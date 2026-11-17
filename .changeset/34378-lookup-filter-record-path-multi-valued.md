---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

feat(lint)!: a `lookupFilters` `{ $record: "path" }` path through or to a multi-valued field is refused

Clause-②: no (narrowing) — a `lookupFilters[].value` `{ $record }` path on a lookup, master_detail or user field whose first segment is a multi-valued field of the object owning that field (a plain path to it, or a hop through it), or whose leaf behind a single-valued hop is a multi-valued field, linted clean and published; it is now refused at error as `object-field-ref-unknown` by `os lint`, `os validate`, `os build` and the runtime publish door, and reported (never refused) on the package publish receipt's object probe.
Metadata-protocol: narrowed
Skills-docs: follow-up #34201 — no doc or skill teaches `{ $record }` yet, so there is no teaching to correct here; the multi-valued clause rides the describes this change edits.

<!-- adr-0087: registered lookup-filter-record-path-multi-valued-refused -->

**BREAKING** only for a `{ $record }` path that reads a list. A `{ $record }` comparand stands for ONE value of the record being edited and pairs only with `eq`, `ne`, `gt`, `lt`, `gte` or `lte`, but the path check judged only that each segment names a field, so `{ $record: "accounts.cb_market" }` through a `multiple: true` lookup, or `{ $record: "tags" }`, linted clean. A hop through a multi-valued lookup reaches no single row, so the entry was left out without a word; a plain path to a multi-valued field put a list where one value goes. `object-field-ref-unknown` now refuses the path at the multi-valued field and names it. Multi-valued means `isMultiValueField`: a field flagged `multiple: true`, or a `multiselect`, `checkboxes` or `tags` field. A registry-injected column and a leaf on an object outside the stack are not judged. Measured first-party exposure: zero — no example app, platform object, skill or docs sample writes a `$record` path.

**FROM → TO.** FROM `{ $record: "accounts.cb_market" }` (a hop through a `multiple: true` lookup), `{ $record: "tags" }` or `{ $record: "account.markets" }` (a multi-valued leaf) TO a path that ends at, and hops through, single-valued fields only.

**Fix:** copy the value you mean onto a single-valued field of the record being edited (or of the record one single-valued hop away) and reference that. The semantic entry `lookup-filter-record-path-multi-valued-refused` carries the same notice into the upgrade guide and `os migrate meta`. `os explain object-field-ref-unknown` lists the position.
