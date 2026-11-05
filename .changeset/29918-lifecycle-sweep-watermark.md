---
'@objectstack/objectql': patch
'@objectstack/platform-objects': patch
'@objectstack/cli': patch
---

Clause-②: no
Metadata-protocol: none

The lifecycle sweep remembers when it last completed, so a kernel that reboots onto an existing datastore no longer re-sweeps within a minute of every boot.

`LifecycleService` now keeps a watermark in a new engine-owned, tenant-less object, `sys_lifecycle_state` (declared and registered by `@objectstack/platform-objects`, one row per datastore, id `lifecycle`). At the initial delay the scheduler reads that one row: when the last completed sweep is younger than the sweep interval, the first sweep waits for the interval and the read is the only statement issued. An older or missing watermark, a kernel without the object, or a read that fails (logged at `warn`) sweeps at the initial delay as before. Every sweep that completes with no policy error and a finished reference audit advances the row; a failed or partial sweep leaves it alone. A datastore the process created from empty still defers its first sweep one interval, and now seeds the row. A direct `sweep()` call still always sweeps.

The row is internal state, not a setting: no settings key, no environment variable, no audit row per sweep and no data API (`apiEnabled: false`). `OS_LIFECYCLE_DISABLED=1` still arms nothing. `os migrate organization-ownership` inventories the new table as deployment-level state with no organization column.
