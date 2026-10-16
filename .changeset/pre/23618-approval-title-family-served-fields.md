---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): the inbox's referenced-record titles (`payload_display`) and the record-lock refusal's title are served only from fields the caller may read

Clause-②: no

- **Referenced-record titles follow the reader's field-level security on the referenced object.** `listRequests` and `getRequest` now pick each `payload_display` title from the referenced record as served to the reading caller: the same answer the payload snapshot and `record_title` are narrowed by (readable, and not masked for that caller), asked for the referenced object, once per object per read. A display field the reader may not read on the referenced object, or is served masked, gives that key no display value, so the snapshot's stored id stands, as it already does for a deleted referenced record. A title-eligible field the reader may read still names the record, and a reader who may read the display field gets the same title as before.
- **The `RECORD_LOCKED` refusal names the record only from what the writer may read.** The per-record refusal sentence takes its title from the record as served to the refused writer, asked with the writer's own execution context. When the writer may not read the display field, or is served it masked, the sentence names the object's label alone (`This Opportunity is locked …`), as it already does for a record with no title; it never names the id. A writer who may read the field is told the title as before. The code (`RECORD_LOCKED`) and status (409) are unchanged.

A patch: a narrowing of served values only. Nothing is granted, and no schema, route, error code, translation key or export moves. With no field-visibility source wired, every title is served as before.
