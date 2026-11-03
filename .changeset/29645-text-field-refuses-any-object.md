---
'@objectstack/objectql': patch
---

fix(objectql)!: a string-typed field refuses a Date, a Map, a Set, a class instance or a typed array as its value, as it already refused a plain object or an array (#29645)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: what a metadata author writes is read exactly as before. Only a record write carrying an object of the wrong shape on a text-family field is refused, with the validator's existing invalid_type code and the existing ADR-0104 shape sentence, so there is nothing for objectstack migrate meta to rewrite and no tombstone. Rows already stored are not rewritten by this change, so no stored-row migration is prescribed either. -->

**BREAKING** accept-set narrowing at the record write door (`@objectstack/objectql`), on the engine's insert, insertMany, update by id, update by predicate and the `validate()` dry run. Those are the doors flows, hooks and server code write through; a JSON request body carries none of these values, so REST callers see no change.

- **Before.** The string arm refused a plain object or an array, but its object test was prototype-strict, so any other object passed on its string reading. On a `text`, `textarea`, `password`, `markdown`, `html`, `richtext`, `code`, `signature` or `qrcode` field, driver-memory stored the object itself and SQLite stored a `Date` as its epoch number in TEXT (`"1767312000000.0"`), a `Map` or a `Set` as `"{}"`, and a class instance or a typed array as its JSON text. On `email`, `url` and `phone` the same write was refused, but only because that string failed the format check (`invalid_email`, `invalid_url`, `invalid_phone`).
- **Now.** Every object is refused `invalid_type` with the sentence `FIELD has an invalid TYPE value: expected a string, received an object`, on all twelve types, before any bound or format is judged, so the three format types now answer `invalid_type` for an object instead of their format code. The driver is never written. A readonly field's value is judged the same way, as a shape check.
- **Unchanged.** A string. A number and a boolean, which keep their string reading and are stored as that string. `null` and a missing value. A plain object and an array (already refused). A filter-operator object keeps its own earlier refusal sentence. A `json` field and the structured-JSON types still hold any object.

**The remedy.** Write the string you mean: `value.toISOString()` for a `Date` on a text field (or declare the field `datetime`), `JSON.stringify(...)` when JSON text is really what the field should hold, or declare the field `json` when it holds structured data.
