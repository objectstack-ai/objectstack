---
'@objectstack/service-package': patch
'@objectstack/cli': patch
---

`os migrate plan` / `apply` cover `sys_packages`, and the boot honours `OS_SKIP_SCHEMA_SYNC` for it

Clause-②: no

`sys_packages`, the package registry's table, is created by `PackageServicePlugin.start()` with its own DDL, because it keys on `(id, version)` and a declared object cannot carry that key. So it was never on the managed migration path: `os migrate plan` did not list it and `os migrate apply` did not create it. A deployment that sets `OS_SKIP_SCHEMA_SYNC=1` ("Use after running migrations manually") still had it created at boot, and had no documented way to create it otherwise.

- **The migration path covers it.** `PackageServicePlugin.init()` declares the table as its `package.storage` kernel service: a read-only catalog probe (SQLite, PostgreSQL and MySQL each ask their own catalog) and the boot's own create statements. `os migrate plan` lists `sys_packages` as `create_table` when it is absent, and `os migrate apply` creates it, with the same statements the boot runs, so the table and its `idx_packages_latest` index come out exactly as a boot creates them. Whether the flag is set does not matter to either command. Where the table's presence cannot be read (a driver that names no SQL dialect), the run says it did not examine the table, and neither lists nor creates it.
- **Then the boot honours the flag.** With the flag set, `PackageServicePlugin` issues no DDL and no existence probe at boot, and logs one `info` line naming `sys_packages` and the flag, and pointing at `os migrate apply`. The `package` service is still registered. The value read is the one `ObjectQLPlugin` resolved (the `skipSchemaSync` option, else the environment variable), as `plugin-audit` and `service-messaging` read it. On a flag deployment, run `os migrate apply` before the first boot that needs the table.
- **What is unchanged.** With the flag unset, the boot creates the table exactly as before. An existing `sys_packages` table is not altered by either command; the plan lists nothing for it. No type or export changes.
