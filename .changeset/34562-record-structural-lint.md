---
'@objectstack/lint': minor
'@objectstack/spec': patch
---

fix(lint): a lookup filter's `$record` path to a structured field is refused where it is written

Clause-②: no (narrowing)
Metadata-protocol: narrowed

A lookup field's `lookupFilters[].value.$record` reads one value from the record being edited and compares it under a scalar operator. A path whose first segment, or whose leaf behind one relationship hop, is a structured field — a member of `STRUCTURED_JSON_TYPES` in `@objectstack/spec/data`: `json`, `composite`, `repeater`, `record`, `location`, `address`, `vector` — holds an object, not one value. Read from code, the picker compares that object as one value under a scalar operator, so the filter does not do what it reads as, and `os lint` said nothing. Rule `object-field-ref-unknown` now refuses such a path, at the same two positions and with the same hint as a path to a multi-valued field: point `$record` at a single-valued field. A hop through a structured field was already refused as "not a relationship" and still is, once.

To fix a refused path, copy the value you mean onto a single-valued field and reference that field instead.

The ADR-0087 ledger gains the semantic entry `lookup-filter-record-path-structured-refused` in `@objectstack/spec`, beside the multi-valued one.

<!-- adr-0087: registered lookup-filter-record-path-structured-refused -->
