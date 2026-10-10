---
'@objectstack/cli': minor
---

feat(cli): `os migrate organization-ownership` — the read-only plan of the v18 organization-ownership ceremony (ADR-0131 D10, ceremony item 1)

Clause-②: yes (widening)

A new command beside the `os migrate` family. It reads the database and writes a plan file the operator keeps; it never changes a row or a column, and it has no writing mode yet.

- **Per table:** the object's fate from the ADR-0131 D10 inventory (column drop, mirror deletion, attribution through a parent anchor, or report) with its citation, the row counts that fate touches, the rows whose owner cannot be derived (listed by id, with the reason), and whether the table will receive the `NOT NULL` constraint.
- **Ruled populations are counted by name:** the organization-scoped `sys_metadata` rows that the ceremony promotes, with their conflict list; the customized email templates; and the global settings rung that moves to `sys_platform_setting`.
- **Refuses, naming the table:** a table it cannot enumerate. That covers an unsupported driver, a read that fails, a column the fate needs that the table lacks, a platform table the inventory gives no fate, a name it cannot quote, and a database with no `sys_organization`. ⛔ It never reports such a table as empty. An inventoried object with no table on the database is listed as `absent`.
- **Under the `single` posture,** a NULL row that no anchor derives is attributed to the Default Organization (slug `default`). Under a walled posture it is reported.

```bash
os migrate organization-ownership                       # writes organization-ownership-plan-TIMESTAMP.json
os migrate organization-ownership --out plan.json --json
```

The plan file is never overwritten. Nothing about bare `os migrate` (the schema-drift plan) or any other subcommand changes.
