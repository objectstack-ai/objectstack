---
"@objectstack/lint": patch
---

The runtime publish gate no longer charges a write with a stored sibling's finding that only shows when the written item is present. Re-saving a master object with only its label changed answered `422 INVALID_METADATA` for a stored detail the author never touched: a detail's `lookupColumns` entry naming no field of the master, or a detail's `readonlyWhen` read through `parent`.

Clause-②: no

- On an update into a context collection (`object`, `permission`, `book`, `dataset`) the gate also judges the stored universe: the live collections with the written item's stored self in place. A finding located on another entry that the stored universe already holds is not this write's.
- A finding located on the written item itself is judged as before, even when the stored row carries the same finding. Re-saving a row is writing it.
- A write that newly breaks a sibling is still refused, for example removing the master field a detail's `lookupColumns` names.
- A create is judged as before.
- On a permission write the same change drops a stored detail's `security-master-detail-ungranted` advisory from a label-only re-save of the tenant's only permission set.
- A finding whose path names no entry the gate can locate keeps the previous verdict.
- ⛔ Nothing you author changes, and no export or signature changes.
