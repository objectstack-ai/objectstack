---
'@objectstack/cli': minor
---

`os migrate meta --stored` and `os migrate audit-metadata-bodies` without `--apply` no longer write to the database they preview. Both now boot the stack the way `os migrate plan` does: schema DDL is held back, the app's inline seed loader does not run, and a SQLite file that does not exist is not created.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a CLI command's verdict on one edge, not a declaration: a preview of os migrate meta --stored or os migrate audit-metadata-bodies at a database that lacks the table it reads now exits 1 instead of creating the table and reporting nothing to examine. No authorable key, spelling, export or stored shape moves: every stack parses and loads exactly as before, the --apply runs boot and write exactly as before, and no stored row is read differently or rewritten. What an operator does about the refusal is point --database-url at the deployment's database or boot the deployment once, so there is no rewrite a ledger entry could carry. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a command's verdict, and this diff adds none (not registered / already-registered); and the change is CLI behaviour, not a TypeScript declaration (not runtime-interface-only / type-surface-only). -->

**BREAKING** — a preview of either command at a database that lacks the table it reads now exits 1, where it used to exit 0. It ships as `minor` under the launch-window convention for accept-set narrowings.

**What was wrong.** Both previews booted the full data stack before reading, and that boot ran schema sync and the app's seed loader. The seed loader upserts every seeded row, so a preview bumped `updated_at`, stamped `organization_id` on seeded rows that had none, put an operator's edit to a seeded row back to the seed's value, and re-evaluated relative-date seed values. On a database that was behind the app's schema, the boot also added the missing columns and created the missing tables. The 17.6.0 upgrade checklist runs both previews before their `--apply` runs, so the safety step changed the data.

**What changes for an operator.** A preview leaves the schema and every row byte-identical, and its report is the same as before. `--apply` boots and writes exactly as before. One edge changes: a preview pointed at a database that lacks the table it reads (a SQLite file that does not exist, an unbooted database, or the wrong `--database-url`) now fails and exits 1 instead of creating the table and reporting nothing to examine. Point `--database-url` at the deployment's database, or boot the deployment once first.
