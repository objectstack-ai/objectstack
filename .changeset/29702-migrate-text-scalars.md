---
'@objectstack/cli': patch
---

feat(cli): `os migrate text-scalars` rewrites numbers and booleans still stored raw on text fields to their string, and lists the SQLite `"N.0"` text it cannot decide

Clause-②: no
Metadata-protocol: none

Since #29241 the write door stores a number or boolean written to a text-family field (the spec's `BOUNDED_STRING_FIELD_TYPES`: `text`, `textarea`, `email`, `url`, `phone`, `password`, `markdown`, `html`, `richtext`, `code`, `signature`, `qrcode`) as its string. Rows written before keep the old form: the raw `42` / `true` on driver-memory with persistence, the TEXT `"42.0"` / `"1.0"` / `"0.0"` on SQLite. A filter on `"42"` misses them, a read hands back the old form, and a unique field admits a new `"42"` beside an old `42` or `"42.0"`. This new command is the one-time data step, a sibling of `os migrate option-codes`, not part of `os migrate value-shapes`, which rewrites nothing.

- **Raw numbers and booleans are rewritten** to `String(value)`, the string the door stores for the same input.
- **SQLite `"N.0"` text is reported per object and field, never rewritten.** A text field declares no values, so `"42.0"` may be the old number or text a client typed.
- **Dry run by default.** `--apply` rewrites each affected row through the engine; a row the door refuses (a unique collision, a format the field no longer admits) is a per-row failure and the walk goes on. `--object` narrows the walk and refuses a name the deployment does not declare. `--apply` refuses a SQLite file another process holds unless `--force`.
- **No flag.** Nothing is gated on it. A re-run that reports nothing to rewrite is the verification.
