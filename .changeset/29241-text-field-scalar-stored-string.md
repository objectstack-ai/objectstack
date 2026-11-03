---
'@objectstack/objectql': patch
---

fix(objectql)!: a number or a boolean written to a text-family field is stored as the string the validator judged

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata key, value or type moves, and no export or type changes: the write door now stores the string the record validator already judged a number or boolean by. The narrowed face is a runtime answer on a unique text-family field (a second write that the stored value now collides with), not anything an author wrote, so there is nothing for objectstack migrate meta to rewrite and no tombstone. Rows already stored are not rewritten by this change, so no stored-row migration is prescribed either. -->

**BREAKING** for one case only, a `unique` text-family field. FROM: `{ code: 42 }` and then `{ code: "42" }` (or `true` and then `"true"`) both answered `201` and stored two rows, on driver-memory and on SQLite. TO: both writes store `"42"`, so the second one is refused `409 UNIQUE_VIOLATION`. The fix for a caller that hits it: the two writes are the same value; send the string once, or update the existing row. In the other direction, SQLite used to refuse `true` after `1` (and `false` after `0`) because both were stored as `"1.0"` (`"0.0"`); both now land as two different strings (`"true"` and `"1"`). driver-memory admitted both before and still does.

The record validator's string arm (`text`, `textarea`, `email`, `url`, `phone`, `password`, `markdown`, `html`, `richtext`, `code`, `signature`, `qrcode`) judges a number or a boolean by its string reading: `42` is bounded and format-checked as `"42"`, `true` as `"true"`. The write used to carry the raw scalar to the driver, so the stored value depended on the driver: driver-memory stored and read back the number `42` and the boolean `true`, and SQLite stored the TEXT `"42.0"` for `42` and `"1.0"` for `true` (a `maxLength: 2` field admitted `42` and then held four characters). The write door now writes the judged string into the payload, beside the numeric-string rewrite on number fields, on insert, insertMany, update by id, update by predicate and the `validate()` dry run.

What you will see: a text-family column now stores and reads back `"42"` where driver-memory stored `42`, and `"42"` / `"true"` where SQLite stored `"42.0"` / `"1.0"`. A single write is answered as before: the same payloads are admitted and refused. What moves is the unique answer above, and hooks, formulas and filters now see the string. A filter that compares a text-family field to the number `42` (or to a boolean) no longer matches a row written as `42`, because that row is now stored as `"42"`: filter with the string. The fix on the filter side is tracked separately. Rows already stored are not rewritten, so an old SQLite `"42.0"` row, or a raw `42` in a driver-memory store with `persistence` enabled, does not collide with a new `"42"`. Unchanged: strings, `null`, missing keys, objects and arrays (refused), `json` and the structured types, and number and boolean fields.
