---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/platform-objects': minor
'@objectstack/cli': minor
'@objectstack/plugin-audit': minor
---

Clause-②: yes (widening) — `PLATFORM_OBJECTS_BY_PACKAGE['platform-objects']` (and so `PLATFORM_PROVIDED_OBJECT_NAMES` / `isPlatformProvidedObjectName`) lists one more real platform object, `sys_lifecycle_state`. Its readers resolve references against the roster and none refuses an author declaration, so a stack that references the object now resolves it instead of drawing the unknown-platform-name advisory; nothing that was accepted is refused.
Metadata-protocol: added
Skills-docs: none — `skills/**` and `content/docs/**` enumerate no platform object roster and teach nothing about the lifecycle sweep's schedule; the object is internal clock state with no data API, so there is nothing for an author to write against it.

The lifecycle sweep remembers when it last completed, so a kernel that reboots onto an existing datastore no longer re-sweeps within a minute of every boot.

`LifecycleService` now keeps a watermark in a new engine-owned, tenant-less object, `sys_lifecycle_state` (declared and registered by `@objectstack/platform-objects`, one row per datastore, id `lifecycle`). At the initial delay the scheduler reads that one row: when the last completed sweep is younger than the sweep interval, the first sweep waits for the interval and the read is the only statement issued. An older or missing watermark, a kernel without the object, or a read that fails (logged at `warn`) sweeps at the initial delay as before. Every sweep that completes with no policy error and a finished reference audit advances the row; a failed or partial sweep leaves it alone. A datastore the process created from empty still defers its first sweep one interval, and now seeds the row. A direct `sweep()` call still always sweeps.

The row is internal state, not a setting: no settings key, no environment variable, no audit row per sweep and no data API (`apiEnabled: false`). `@objectstack/plugin-audit` leaves `sys_lifecycle_state` out of `sys_audit_log` and `sys_activity`, so a sweep writes no ledger row for its own clock. `OS_LIFECYCLE_DISABLED=1` still arms nothing. `os migrate organization-ownership` inventories the new table as deployment-level state with no organization column.
