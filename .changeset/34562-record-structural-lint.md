---
'@objectstack/lint': minor
---

fix(lint): a lookup filter's `$record` path to a structured field is refused where it is written

Clause-②: no
Metadata-protocol: narrowed

A lookup field's `lookupFilters[].value.$record` reads one value from the record being edited and compares it under a scalar operator. A path whose first segment, or whose leaf behind one relationship hop, is a structured field — a member of `STRUCTURED_JSON_TYPES` in `@objectstack/spec/data`: `json`, `composite`, `repeater`, `record`, `location`, `address`, `vector` — holds an object, not one value, so the picker's filter never matched and `os lint` said nothing. Rule `object-field-ref-unknown` now refuses such a path, at the same two positions and with the same hint as a path to a multi-valued field: point `$record` at a single-valued field. A hop through a structured field was already refused as "not a relationship" and still is, once.

To fix a refused path, copy the value you mean onto a single-valued field and reference that field instead.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: `LookupFilterRecordReferenceSchema` parses exactly as before. The moved answer is one lint finding on a `$record` path that never filtered; the fix is the author's choice of a single-valued field, which no mechanical rewrite can make, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->
