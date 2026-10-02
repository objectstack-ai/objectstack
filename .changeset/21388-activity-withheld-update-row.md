---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): an activity row recording an update whose every changed field the reader is withheld is no longer served to that reader, on any listing face

Clause-②: no

A `sys_activity` row's recorded change (`metadata.old` / `metadata.new`) is narrowed key by key for each reader, through the security service's served-fields answer. An update whose every changed field the reader is withheld still reached that reader as a row with an empty change, and its summary, actor and timestamp said that the record changed, and when. An org member holding object-level `sys_activity` read was served that row for each sign-in stamp on a colleague's identity record (`last_login_at`), and for each failed-sign-in counter bump, lockout, password-change stamp and MFA-required stamp.

Such a row is now withheld from that reader as a row:

- **What counts as one.** An update row (its stored change has both an `old` and a `new` side) whose stored change had at least one key, where the reader is served none of those keys. The keys are read from the STORED change, not the redacted one.
- **What is unaffected.** A create or a delete keeps its row. A row whose stored change is empty on both sides (an update that touched only `internal` fields) is unaffected. A mixed update keeps its row, with the served keys only. A reader served every field (an administrator) still reads every row with its change, within the pre-scan's bound. A system-context read is not narrowed.
- **Every face agrees.** The rule is a WHERE built from a system-context pre-scan on `find`, `findOne`, `count` and `aggregate`. So a list's `total`, its pages, a by-id read (`404`) and a grouped count agree with the rows served. A pre-scan that reaches its 2,000-row bound answers a broad read from the rows it judged, for every reader, administrators included, and logs a warning. The remedy is to scope the query by `object_name` and `record_id`.

No migration: no key, export or config changes. A reader the security service gives no answer for (no security plugin wired) is not narrowed, as before.
