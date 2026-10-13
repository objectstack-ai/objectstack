---
'@objectstack/objectql': patch
---

fix(objectql): the lifecycle reaper and archiver no longer partition an object with no tenant column by organization

A tenant-scope `lifecycle.retention_overrides` entry gives one organization its own retention window, and the reaper and the archiver apply it by partitioning the object's rows on `organization_id`: one pass for that organization's rows, then a global pass for everyone else's. On an object that has no `organization_id` column — one declaring `systemFields: { tenant: false }`, such as the deployment-level platform tables (`sys_job`, `sys_job_run`, `sys_job_queue`, `sys_flow_dispatch`, `sys_migration`, `sys_migration_journal`, `sys_presence`), or any other object the registry injects no tenant column into and whose author declares none — both passes named a column the table does not have. The SQL driver refused them (`INVALID_FILTER`), the sweep reported the object in its errors, and the table's retention stopped.

Such an object now has no tenant partition, the answer a federated object already got: the sweep runs its one global pass at the global window. No row of it belongs to an organization, so a tenant override naming it has nothing to select, and it is not applied. An object that has the column keeps its per-tenant windows unchanged.
