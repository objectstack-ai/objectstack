---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): a request's `record_title` is served only from fields its reader may read, and the one-tap action pages name the record by its id

Clause-②: no

- **The inbox title follows the reader's field-level security.** `listRequests`, `getRequest` and every action's read-back row (which the request actions' success messages read) now pick `record_title` from the subject record as served to the reading caller: the same answer the payload snapshot is redacted by (readable, and not masked for that caller). A display field the reader may not read, or is served masked, gives no title, and the key is absent, the shape the redaction gives that field in the payload. A title-eligible field the reader may read still names the record, and a reader who may read the display field gets the same title as before. Deleted records fall back to the reader's redacted snapshot, as before. Nothing is granted: record access stays with object permissions, sharing and row-level rules.
- **The action-link pages name the record by its id.** The session-less confirm and result pages (ADR-0043) have no reader to narrow for, so their "Record" row shows the record id beside the object's label, as the approval notification names it, and never the title.

A patch: a narrowing of served values only. No schema, route, translation key, export or notification field moves. With no field-visibility source wired, every title is served as before.
