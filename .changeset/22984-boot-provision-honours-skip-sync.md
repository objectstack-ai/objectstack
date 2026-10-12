---
'@objectstack/plugin-audit': patch
'@objectstack/service-messaging': patch
'@objectstack/objectql': patch
---

Boot-time system-table provisioning honours `OS_SKIP_SCHEMA_SYNC` / `skipSchemaSync`

Clause-②: no

`OS_SKIP_SCHEMA_SYNC=1`, or `ObjectQLPlugin`'s `skipSchemaSync` option, declares that a deployment's DDL is managed out-of-band ("Use after running migrations manually"). The engine's boot honoured it, but `AuditPlugin` and `MessagingServicePlugin` still created their system tables at `kernel:ready`. A deployment that set the flag got tables created behind its back while its boot log said no DDL ran, and a database role without DDL rights got a DDL failure it never asked for.

- **What changes.** With the flag set, `AuditPlugin` (`sys_audit_log`, `sys_activity`, `sys_comment`, `sys_comment_reaction`) and `MessagingServicePlugin` (`sys_notification`, `sys_inbox_message`, `sys_notification_receipt`, `sys_notification_delivery`, `sys_notification_preference`, `sys_notification_subscription`, `sys_notification_template`, `sys_http_delivery`) issue no DDL and no existence probe at boot. Each logs one `info` line naming the objects it did not provision and the flag, and pointing at `os migrate apply`, which creates any that are missing (`os migrate plan` lists them as `create_table`). That path was measured to create all twelve tables, on one database, with the telemetry sibling database, and with the flag set in the migrate run's own environment.
- **Which value is read.** The one `ObjectQLPlugin` resolved: the option, else the environment variable. An explicit `skipSchemaSync: false` therefore still provisions under `OS_SKIP_SCHEMA_SYNC=1`. `ObjectQLPlugin` publishes that value on the engine instance it registers. It is a property of the instance, not a declared member, so no type or export changes.
- **What is unchanged.** With the flag unset, provisioning is exactly as before. `syncObjectSchema` is not gated, so on a flag deployment a runtime publish still gives a new object its table.
