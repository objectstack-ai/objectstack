---
"@objectstack/objectql": patch
---

`os migrate value-shapes` now prescribes the key rename on a legacy `{latitude, longitude}` location, instead of reporting the missing-pair type error.

A value-shape rejection was read positionally — `parse.error.issues[0]` — at both places the value-shape detail is produced: the write path's warn-first / strict branch, and the exported `valueShapeViolation` the scan imports. zod reports per-member issues before the object-level `unrecognized_keys` one, so on a value whose keys were **renamed** the actionable message sorts last and was discarded. A `location` stored as `{latitude, longitude}` — the exact legacy shape the scan's own header names as one it exists to find — reported `Invalid input: expected number, received undefined`, leaving an operator to derive a rename that edit distance cannot reach (`latitude` -> `lat`), while `LocationValueSchema` had built the prescription and thrown it away.

Both readers now prefer the undeclared-key issue when the rejection carries one, through a single shared helper — two readings of the same rejection drifting by one clause is how one path prescribes the rename and the other does not. The affected strings are the `os migrate value-shapes` finding `detail`, the warn-first `[value-shape]` log line, and the `invalid_value_shape` error's `detail` under strict enforcement.

⛔ No verdict moves. The same values are flagged, the same writes are rejected or admitted, and the deployment gate opens on exactly the same evidence — only the operator-facing text changes.

Scoped by measurement rather than by assumption: of the sixteen types these readers cover, only `location` and `address` are backed by a key-closed object schema, so only they can emit `unrecognized_keys` at all — for the other fourteen the preference cannot change a single character. Both classes it does reach curate the alias map that makes the undeclared key the more actionable half. The defect reaches `address` as well as `location`: every address member being optional rules out a *missing*-member type error, but not a *wrong-typed* declared one, which still sorts ahead of the undeclared-key issue.
