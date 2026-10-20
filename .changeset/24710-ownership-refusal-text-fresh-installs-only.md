---
'@objectstack/metadata-core': patch
'@objectstack/metadata-protocol': patch
---

fix(metadata-core, metadata-protocol): two refusals say what 18.0 supports for a v17 database, not `os migrate organization-ownership`, which 18.0 refuses on every database

Clause-②: no (text only: no refusal code, outcome, accept set or served shape moves)

In 18.0, `os migrate organization-ownership` refuses plan and apply on every database (`NOT_IMPLEMENTED`): 18.0 supports fresh installs only. Two refusals still told the operator to run it, so following them led to a second refusal.

- **`LEGACY_ORGANIZATION_ROWS_UNREADABLE`** (`LegacyOrganizationRowsUnreadable`, `@objectstack/metadata-core`). It used to close with "Run `os migrate organization-ownership` on this database first." This read runs on every SQL database, a fresh 18.0 one included, and several of its refusals are the driver's (a dialect it cannot name, no raw-SQL seam, a column list that is not a list or comes back empty). For those, the command was never the remedy. The message now closes: "A fresh 18.0 install holds no legacy organization rows: there, the cause is the one named above, and the fix is in the SQL driver or the caller that met it. A database that does hold them is a v17 one. 18.0 supports fresh installs only and does not upgrade a v17 database: keep a v17 database on a 17.x release until the 18.x release that carries the upgrade path."
- **The seed refusal for a natural key held by a row with no organization** (`SeedLoaderService`, `@objectstack/metadata-protocol`). It used to close with "Attribute the unowned rows first (`os migrate organization-ownership`, then the same command with --apply), then re-run this seed". Even before 18.0, that bare `--apply` was refused, since the command requires `--plan-file`. The message now closes: "A row with no organization predates organization stamping, so it is a v17 database's. 18.0 supports fresh installs only and does not upgrade a v17 database: keep a v17 database on a 17.x release until the 18.x release that carries the upgrade path."
- **Unchanged:** both refusal codes, "Nothing was listed or written.", the seed refusal's opening sentences (what was refused and why), its `errored` count, and the dropped record.
