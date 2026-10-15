---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): the inbox's referenced-record titles (`payload_display`) are served only for a referenced record the caller may read

Clause-②: no

- **Referenced-record titles follow the reader's access to the referenced RECORD.** `listRequests` and `getRequest` now title a lookup in the payload snapshot only when the reading caller may read the record it points at, asked through the platform's one caller-scoped row-access answer (`resolveReadableParentIds`, the same one the comment, activity, attachment and mail gates ask), once per referenced object per read. So the referenced object's object-level read, its sharing and its row-level rules decide, as they already do for the data API's `$expand`. A referenced record the reader may not read gets no display value and the snapshot's stored id stands, as it already does for a deleted referenced record. A reader who may read the record gets the same title as before, still picked from the fields they may be served.
- **Nothing about the record under approval changes.** Its title (`record_title`), its label and its field-level-security-redacted snapshot are served to a routed approver exactly as before, whatever their access to that record.

A patch: a narrowing of served values only. Nothing is granted, and no schema, route, error code, translation key or export moves. With no security plugin composed, every caller-scoped read answers every record, so every title is served as before.
