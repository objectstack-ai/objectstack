---
'@objectstack/objectql': patch
'@objectstack/driver-sql': patch
---

fix(objectql,driver-sql): a boolean field given `'true'` / `'false'` stores the boolean, and a stored text `'false'` reads as false

Clause-②: no
Metadata-protocol: none

The record validator's boolean arm admits `true` / `false`, `0` / `1`, `'0'` / `'1'` and `'true'` / `'false'`, but the engine wrote the reading as sent. On SQLite the text `'true'` was stored beside rows holding `1`: a filter on `won = true` missed the row, and a `requiredWhen: record.won == true` read the string and admitted a write it refuses for `true`. The console's inline grid sends exactly these strings, so a line ticked in the grid could not be found by an equality filter.

The engine's write normalisation (`normalizeNumericStringValues`, on insert, update and validate, for every REST, batch and import door) now writes the boolean the arm judged: `'true'`, `'1'` and `1` as `true`; `'false'`, `'0'` and `0` as `false`. The accepted set is unchanged: any other value (`'yes'`, `'TRUE'`, `2`) is refused with `invalid_boolean`, as before.

driver-sql read every stored boolean as `Boolean(value)`, so a row stored as the text `'false'` read as `true`. Such a row now reads `'false'` / `'0'` as `false` and `'true'` / `'1'` as `true`. An equality filter on a row already stored as text still compares the text, so `won = false` matches that row only after it is saved again.
