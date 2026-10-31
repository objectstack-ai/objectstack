---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a metadata write refused with `NOT_OVERRIDABLE`, `NOT_CREATABLE`, `INVALID_METADATA` or `DESTRUCTIVE_CHANGE` now leaves its `denied` row in `sys_metadata_audit`

Clause-②: no
Metadata-protocol: none

`sys_metadata_audit.code` has always documented `not_overridable`, `not_creatable`, `invalid_metadata` and `destructive_change` as `denied` values, and the save, publish, rollback and delete doors refuse with exactly those codes. No audit write stamped them, though: only the lock gate (`item_locked`) and the stale-version check (`metadata_conflict`) left a row. A reader of `GET /api/v1/meta/:type/:name/audit` concluded that a refused attempt never happened.

- **The row.** `outcome: 'denied'`, `code` the documented lower-case value, `operation` the door (`save`, `publish`, `rollback` or `delete`), `actor` and `source` as the door's allowed row records them, and `note` the sentence the caller was refused with. The type is filed under its canonical singular, as every other row is.
- **Where it is written.** Where the door hands the refusal back to its caller, so a refusal raised by any of the gates inside the door is covered, including one added later.
- **What still writes no row.** A refusal with any other code (`INVALID_REQUEST`, `RESOURCE_CONFLICT`, a driver fault, any 5xx) writes nothing, as before; the column's set of values stays closed. `item_locked` and `metadata_conflict` keep the rows their own gates write and are not written twice. A refusal one door hands back through another is recorded once. The batch package publish keeps its `batch_aborted` row.
- **No caller change.** The refusal the caller receives is unchanged: the same code, status and message. The audit write is best-effort, as it always was.
