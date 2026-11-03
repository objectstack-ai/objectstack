---
'@objectstack/cli': patch
---

feat(cli): `os migrate option-codes` rewrites option values still stored as a number, a boolean or SQLite `"N.0"` text to the option code string

Clause-②: no
Metadata-protocol: none

Since #29562 the write door stores a number or boolean written to an option field (`select`, `radio`, `multiselect`, `checkboxes`, `tags`, a `multiple: true` select or radio) as the code string it was judged by. Rows written before keep the old form: the raw `3` / `true` on driver-memory with persistence, the TEXT `"3.0"` / `"1.0"` / `"0.0"` on SQLite, and raw elements in a multi-value array on both. A filter on `"3"` misses them, a read hands back the old form, and a unique field admits a new `"3"` beside an old `"3.0"`. This new command is the one-time data step, a sibling of `os migrate blank-single-values`, not part of `os migrate value-shapes`, which rewrites nothing.

- **Decidable values are rewritten.** A raw number or boolean becomes `String(value)` (on a field declaring codes, only when that string is one). A SQLite `"N.0"` becomes the declared code it reads as, when exactly one reading (`"3"`, or `"1"` / `"true"` for `"1.0"`, `"0"` / `"false"` for `"0.0"`) is declared.
- **The rest is reported, never rewritten.** A `"N.0"` on a field with no declared codes, an ambiguous `"1.0"` / `"0.0"`, a reading the field does not declare, and an unresolved picklist.
- **Dry run by default.** `--apply` rewrites each affected row through the engine; a unique collision is a per-row failure and the walk goes on. `--object` narrows the walk and refuses a name the deployment does not declare. `--apply` refuses a SQLite file another process holds unless `--force`.
- **No flag.** Nothing is gated on it. A re-run that reports nothing to rewrite is the verification.
