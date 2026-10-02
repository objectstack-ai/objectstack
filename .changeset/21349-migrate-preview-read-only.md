---
'@objectstack/cli': patch
---

`os migrate meta --stored` and `os migrate audit-metadata-bodies` without `--apply` no longer write to the database they preview. Both now boot the stack the way `os migrate plan` does: schema DDL is held back, the app's inline seed loader does not run, and a SQLite file that does not exist is not created.

Clause-②: no

**What was wrong.** Both previews booted the full data stack before reading, and that boot ran schema sync and the app's seed loader. The seed loader upserts every seeded row, so a preview bumped `updated_at`, stamped `organization_id` on seeded rows that had none, put an operator's edit to a seeded row back to the seed's value, and re-evaluated relative-date seed values. On a database that was behind the app's schema, the boot also added the missing columns and created the missing tables. The 17.6.0 upgrade checklist runs both previews before their `--apply` runs, so the safety step changed the data.

**What changes for an operator.** A preview leaves the schema and every row byte-identical, and its report is the same as before. `--apply` boots and writes exactly as before. One edge changes: a preview pointed at a database that lacks the table it reads (a SQLite file that does not exist, an unbooted database, or the wrong `--database-url`) now fails and exits 1 instead of creating the table and reporting nothing to examine. Point `--database-url` at the deployment's database, or boot the deployment once first.
