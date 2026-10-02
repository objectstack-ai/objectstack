---
'@objectstack/cli': minor
'@objectstack/runtime': minor
---

The CLI's one-shot commands no longer write to the database as a side effect of booting. No `os migrate *`, `os meta resync`, `os secret orphans` or `os storage orphans` run loads the app's inline seed data, apply and delete modes included, and every mode that writes nothing now boots read-only.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a CLI command's verdict on one edge, not a declaration: a no-write mode of os migrate value-shapes, os migrate recorded-by, os migrate resume, os secret orphans or os storage orphans pointed at a database that lacks a table it reads now exits 1 instead of creating the table and reporting nothing. No authorable key, spelling, export or stored shape moves: every stack parses and loads exactly as before, the write modes write exactly what they wrote before minus the seed loader's rows, and no stored row is read differently or rewritten. What an operator does about the refusal is point --database-url at the deployment's database or boot the deployment once, so there is no rewrite a ledger entry could carry. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id covers a command's verdict, and this diff adds none (not registered / already-registered); and the change is CLI behaviour plus one new optional runtime config key, not a TypeScript declaration change to an existing surface (not runtime-interface-only / type-surface-only). -->

**BREAKING** — a no-write run of `os migrate value-shapes`, `os migrate recorded-by`, `os migrate resume`, `os secret orphans` or `os storage orphans` at a database that lacks a table it reads now exits 1, where it used to exit 0. It ships as `minor` under the launch-window convention for accept-set narrowings.

**What was wrong.** Eight commands booted the full data stack in a mode their documentation says writes nothing: `os migrate value-shapes` (scan), `summary-nulls`, `files-to-references` and `recorded-by` (dry run), `os migrate resume` (list), `os secret orphans` and `os storage orphans` (report), and `os meta resync` without `--yes`. That boot ran schema sync and the app's inline seed loader. The seed loader upserts every seeded row, so each run bumped `updated_at`, stamped `organization_id` on seeded rows that had none, and put an operator's edit to a seeded row back to the seed's value. On `examples/app-crm` that was all 28 seeded rows on every run. On a database behind the app's schema, the boot also added columns and created tables. The apply and delete modes ran the same seed loader alongside the write the operator confirmed.

**What changes for an operator.**

- Every mode that writes nothing boots the way `os migrate plan` does: the schema sync is held back, no seed rows are written, and a SQLite file that does not exist is not created. The database is left byte-identical, and the report is the same as before.
- No one-shot CLI boot loads the app's inline seed data. `--apply`, `--delete`, `os migrate resume --run` and `os meta resync --yes` write what they report and nothing else. Seeding stays with `os dev` and `os serve`.
- The deferred schema sync now covers every SQL datasource the boot connects, not only the default one. `os migrate plan` lists a second datasource's pending tables, and `os migrate apply` creates them after you confirm.
- One edge changes: a no-write run pointed at a database that lacks a table it reads (a SQLite file that does not exist, a database that was never booted, or the wrong `--database-url`) refuses and exits 1 instead of creating the table and reporting nothing. Point `--database-url` at the deployment's database, or boot the deployment once first. `os secret orphans --json` answers that refusal with `"error": "scan_failed"`.
- `os migrate value-shapes --json` prints one JSON document when the scan fails its gate. It used to print a second one, `{"error":"EEXIT: 1"}`.

**For embedders of `@objectstack/runtime`.** `createStandaloneStack` accepts `armLifecycleSweep` (default `true`). With `false`, the ADR-0057 lifecycle sweep (rotation, retention reaping, archiving and the dangling-reference audit that rides its clock) is never armed on that boot, and an explicit `sweep()` call on it returns an empty report. The CLI passes `false` on every one-shot boot.
