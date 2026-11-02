---
'@objectstack/objectql': patch
---

fix(objectql)!: a select refuses a plain object or an array as its value, and as an element of a multi-value select's array

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata key, value or type moves, and no export or type changes: the record validator now refuses a write value whose shape is not the spec's stored shape for an option field (one option code, or an array of them). The narrowed face is a runtime answer to a data write, not anything an author wrote, so there is nothing for objectstack migrate meta to rewrite and no tombstone. Rows already stored are not rewritten or re-judged by this change, so no stored-row migration is prescribed either. -->

**BREAKING** for a data write that sends an object or an array where a select expects an option value. FROM: `{ stage: { a: 1 } }` or `{ stage: ["x"] }` on a single-value `select` / `radio` with no `options` answered `201` / `200` and stored the object or the array as sent (SQLite as its JSON text); so did `{ stage: ["a"] }` on a select whose options include `a`, and `{ labels: [{ a: 1 }] }` or `{ labels: [["a"]] }` on a `multiple: true` select, `multiselect`, `checkboxes` or `tags` field. TO: each is refused `400 VALIDATION_FAILED` with the field's `invalid_type` ("expected one option value, received an object", or "expected an array of option values, received an element that is an array"), on create, update by id, update by filter and the `validate()` dry run, and nothing is stored. The fix for a caller that hits it: send the option code itself (`{ stage: "x" }`), or an array of codes on a multi-value field (`{ labels: ["a"] }`); a value that really is structured data belongs in a `json` field.

One refusal changes its code: an object on a select whose declared `options` do not include it used to answer `invalid_option` and now answers `invalid_type`, because its shape is wrong before its membership is. Unchanged: strings and numbers on a single-value select, arrays of scalars on a multi-value one, option membership, a lone scalar wrapped on a multi-value field, `null`, and a filter-operator object (still refused with its own sentence). Rows already stored with an object or array value are not rewritten.
