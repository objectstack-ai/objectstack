---
'@objectstack/objectql': patch
---

fix(objectql): a number or a boolean written to a text-family field is stored as the string the validator judged

Clause-②: no
Metadata-protocol: none

The record validator's string arm (`text`, `textarea`, `email`, `url`, `phone`, `password`, `markdown`, `html`, `richtext`, `code`, `signature`, `qrcode`) judges a number or a boolean by its string reading: `42` is bounded and format-checked as `"42"`, `true` as `"true"`. The write used to carry the raw scalar to the driver, so the stored value depended on the driver: driver-memory stored and read back the number `42` and the boolean `true`, and SQLite stored the TEXT `"42.0"` for `42` and `"1.0"` for `true` (a `maxLength: 2` field admitted `42` and then held four characters). The write door now writes the judged string into the payload, beside the numeric-string rewrite on number fields, on insert, insertMany, update by id, update by predicate and the `validate()` dry run.

What you will see: a text-family column now stores and reads back `"42"` where driver-memory stored `42`, and `"42"` / `"true"` where SQLite stored `"42.0"` / `"1.0"`. Nothing is refused and nothing is newly admitted. Rows already stored are not rewritten. Unchanged: strings, `null`, missing keys, objects and arrays (refused), `json` and the structured types, and number and boolean fields.
