---
"@objectstack/service-messaging": patch
"@objectstack/plugin-audit": patch
---

fix(service-messaging,plugin-audit): the service that writes `sys_notification` is the one that declares it (#4154)

`MessagingService.emit()` writes `sys_notification` on every call — it is the
pipeline's single ingress (ADR-0030 L2). But the object was contributed to the
manifest by **`AuditPlugin`**, parked there with a comment saying it would stay
"until that [ADR-0030] migration lands". The migration landed; the parking did
not move.

That left a real deployment hole, because `AuditPlugin` is an **optional** pair
in the CLI's plugin table. Install messaging without audit and nothing registers
the object, so the engine has no schema to issue DDL from and every `notify()`
fails with `no such table: sys_notification`. AuditPlugin never wrote the row
itself — it deliberately routes through this service's `emit()` ingress
(`getMessaging()` in `audit-writers.ts`), and its own exclusion list already
annotates the object as "messaging-owned (ADR-0030)".

The contribution now lives with the writer, matching how every other
service-owned platform object is handled in this repo — `service-job` imports
`SysJob`/`SysJobRun`, `service-queue` imports `SysJobQueue`, `rest` imports
`SysImportJob`. Ownership of the *definition* is unchanged: the object stays in
`@objectstack/platform-objects` and in `PLATFORM_OBJECTS_BY_PACKAGE`, because
owning a definition and contributing it to a running kernel are different
things. It is also added to the service's `provisionSystemTables`, so the table
is created with the rest of the pipeline it heads rather than lazily on the
first write.

Found while migrating `notifications.hono.integration.test.ts` to in-memory
SQLite in #4065: that suite had to register the object itself to boot, which was
the deployment bug in miniature. The workaround is deleted in this change — the
suite now boots messaging alone and passes, which is the proof the product
declares what it writes.
