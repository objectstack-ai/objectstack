---
'@objectstack/spec': patch
---

fix(spec): `os lint` no longer tells authors to remove a declared webhook's `label` or `description`

Clause-②: no (a liveness-ledger re-grade: no schema, accept set, served body or error code moves; only the advisory `liveness-dead-property` warning on these two keys stops)

The shipped liveness ledger (`liveness/webhook.json`) graded a declared webhook's `label` and `description` `dead` once the boot seeder that copied them into a `sys_webhook` row retired, and the advisory lint warned "Remove it" on every webhook that authored them. They are read: the Studio metadata list and quick-find show both keys, read off `GET /api/v1/meta/webhook`. Both rows are now `live`, so a declared webhook may keep its `label` and `description` and no warning is printed for them. Nothing else changes: the dispatcher still delivers on the same props as before.
