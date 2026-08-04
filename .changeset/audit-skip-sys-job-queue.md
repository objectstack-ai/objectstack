---
"@objectstack/plugin-audit": patch
---

fix(plugin-audit): stop mirroring `sys_job_queue` traffic into the audit ledger (#5193)

`SKIP_OBJECTS` in `audit-writers.ts` excludes operational telemetry / plumbing
from `sys_audit_log` and `sys_activity` — ADR-0057 decision 5, *"stop the
amplifier"*. Its group (2) already listed `sys_job`, `sys_job_run` and
`sys_automation_run`; `sys_job_queue` — the highest-volume table of that same
family — was the one sibling missing, so every durable queue message was
mirrored into both sinks.

The audit hooks register for **all** objects (`afterInsert` / `afterUpdate` /
`afterDelete`) and there is no "writes made under a system context are not
audited" exemption, so `DbQueueAdapter`'s own writes were recorded like user
edits. One message costs at least three of them — the publish insert, the lease
`pending → running` update and the terminal `→ completed` update, plus one retry
update per failure and the reaper's periodic DELETE of completed rows — each
producing an `sys_audit_log` **and** an `sys_activity` row. Since queue-backed
email delivery landed, that ran on every single mail. Each `beforeUpdate` also
paid an extra `findOne` snapshot of the row it was about to change.

`sys_job_queue` is engine-owned plumbing (`managedBy: 'engine-owned'`,
`enable.apiMethods: ['get', 'list']`, `lifecycle.class: 'transient'`) that no
user can write, so those rows carried no compliance value — only noise and write
amplification. Nothing else changes: the exemption is one name in one list, and
ordinary business objects are audited exactly as before.

Operators who charted queue throughput off `sys_activity` should read
`sys_job_queue` directly instead — it is the system of record for queue state,
and unlike the audit sinks it is exposed for reading (`get` / `list`).
