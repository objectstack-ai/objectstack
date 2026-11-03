---
'@objectstack/objectql': patch
---

fix(objectql)!: a string-typed field refuses a plain object or an array as its value, instead of storing its JSON text (#29133)

Clause-②: no (narrowing) — a create, update or screen-flow resume that writes a plain object or an array into a `text`-family field (the twelve `BOUNDED_STRING_FIELD_TYPES`) is refused `invalid_type`, where it was admitted and stored as JSON text. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: what a metadata author writes is read exactly as before. Only a record write carrying a value of the wrong shape is refused, with the validator's existing invalid_type code and the existing ADR-0104 shape sentence, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the record write door (`@objectstack/objectql`), served by every door that runs the record validator: REST create and PATCH, the engine's insert / update / multi-update, a flow's record nodes, the screen-flow resume, and `os validate` / `os build` over seed records.

- **Before.** The string arm judged `String(value)` while the write carried `value`, so `{ "nested": true }` or `["a", "b"]` on a `text`, `textarea`, `email`, `url`, `phone`, `password`, `markdown`, `html`, `richtext`, `code`, `signature` or `qrcode` field passed every bound and the driver stored its JSON text (201 / 200).
- **Now.** Both shapes are refused `invalid_type` with the sentence `<Label> has an invalid <type> value: expected a string, received an object` (or `an array`), in all four locales. The driver is never written. A readonly field's value is judged the same way, as a shape check.
- **Unchanged.** A string, a number and a boolean (a number or boolean keeps its string reading), `null` and a missing value. A filter-operator object keeps its own earlier refusal sentence. A `json` field and the structured-JSON types still hold any object.

**The remedy.** Send the string you mean: `JSON.stringify(value)` on the client if JSON text is really what the field should hold, or declare the field `json` when it holds structured data.
