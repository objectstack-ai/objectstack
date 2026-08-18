---
"@objectstack/spec": patch
---

`FieldSchema` docs now pin the ruled multi-value lookup empty representation (#9447, maintainer ruling 2026-08-18): an emptied multi-value lookup reads back as `[]`, never `null` — binding for every writer (cascade repair, form clears, API writes) — and `required` on a multi-value lookup means non-empty array, so an emptied required set fails validation loudly.
