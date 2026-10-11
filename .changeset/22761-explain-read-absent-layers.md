---
'@objectstack/plugin-security': patch
---

`security/explain` answers a by-id write of a row the caller cannot read with the whole answer it gives for an id no row carries, layers included.

Clause-②: no

- The update, delete and transfer doors already answer such a row `404 RECORD_NOT_FOUND`, as they answer a nonexistent id, and explain's record verdict already took the missing-record shape. Every row-scoped layer's `record` block, and the tenant layer's verdict, now come from the same path a nonexistent id takes, so no layer names a status the door does not give.
- Nothing you author changes. The doors and the record verdict answer exactly as before, and an explanation of a row the caller can read is unchanged.
