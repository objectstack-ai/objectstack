---
"@objectstack/spec": minor
---

Approvals display contract v2 — no raw identifiers reach a business reviewer. The inbox enrichment pass now resolves the three remaining id leaks: `payload_display` resolves lookup/master_detail foreign keys in the snapshot to the referenced record's display title (batched one query per object), `pending_approver_names` resolves user-id approvers via `sys_user` (id or email; `role:<r>` literals stay as-is), `object_label` rides the target object's schema label on the row, and `listActions` rows carry `actor_name` so the audit timeline never shows an id.
