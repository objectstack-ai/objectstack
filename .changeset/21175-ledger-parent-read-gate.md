---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): a read of the compliance ledger returns only the rows about records the caller can read (#21175)

Clause-②: no

Every door onto `sys_audit_log` reads it through the engine, under the ledger's own object grant and tenant wall. The ledger has no owner column and names a different parent object on every row, so a reader whose permission sets grant the ledger read was served the rows about a record the data plane answers that reader `404` for: its create, update and delete rows, whose snapshots carry the record's field values (narrowed field by field since the previous release, but not by record).

`AuditPlugin` now mounts the activity stream's parent-record read gate on the ledger. On `find`, `findOne`, `count` and `aggregate` — the list, its `total`, the by-id read and both query shapes on the generic data doors — a row that names a record (`object_name`, `record_id`) is returned only when the caller's own engine read of that record finds it, so the parent object's sharing, RLS and object-level permissions decide. The gate's mechanism is now one module shared by the activity stream and the ledger; parent reads stay batched, one per parent object.

Row classes, stated:

- **A row about a record** is kept exactly when the caller can read that record. This includes the `login` and `logout` rows, which name the session.
- **A row about a record that no longer exists** is read by no caller, so it is excluded for every caller that is not system context, admins included: every `delete` row, every other row about a deleted record, and every `logout` row (sign-out deletes the session it names). The rows stay at rest, and system-context reads still return them.
- **A row about no record** — the run-level `import`, `config_change` and `platform_admin_standing_change` rows, and an auth event that carried no session id — has no record to judge and carries no record's field values, so it is served under the ledger's own grant exactly as before.
- **A record action (`create`, `read`, `update`, `delete`) that names no record**, a row naming an object the engine does not know, and a row naming the ledger itself are excluded.

The field-level redaction composes unchanged on the rows the gate keeps. On a read whose pre-scan reaches the gate's 2,000-row bound, the narrowing fails closed and logs a warning, as the activity stream's does: scope a broad read by `object_name` and `record_id`.
