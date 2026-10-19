---
'@objectstack/cli': patch
---

fix(cli): `os migrate apply --allow-destructive`'s organization-ownership refusal says what 18.0 supports for a v17 database, and names no step of the command 18.0 refuses

Clause-②: no

- **`os migrate apply --allow-destructive` on a v17-shaped database.** When the run would drop `organization_id` from a table the organization-ownership ceremony owns, and the ceremony has not verified on the database, the refusal now says that 18.0 supports fresh installs only and does not upgrade a v17 database: keep a v17 database on a 17.x release until the 18.x release that carries the upgrade path, whose ceremony drops these columns itself. The v18 boot refusal and `os migrate organization-ownership`'s own refusal say the same. Before, it told the operator to run `os migrate organization-ownership --out PLAN` and then `--apply --plan-file PLAN`, which 18.0 refuses on every database (`NOT_IMPLEMENTED`). The `--json` refusal's `detail` no longer names that command either: it reads "No run of the organization-ownership ceremony is recorded on this database.", or names the last unverified run with its date and blocking count.
- **`os migrate organization-ownership --help`** shows what the command answers in 18.0: exit `1` with `NOT_IMPLEMENTED`, nothing read or written, and the same refusal as JSON. Before, it showed six plan and apply examples that 18.0 refuses.
- **`os dev` on a v17-shaped development database.** When it does not upgrade the database in place (the ceremony's plan is refused, or the database is not a local SQLite file), it now ends with the same position: keep a v17 development database on a 17.x release until the 18.x release that carries the upgrade path, and upgrade it there. Before, it told the developer to run `os migrate organization-ownership --dev` and then the same command with `--apply`.

Nothing else changes. The refusals still hold back the whole run, and their message code (`refused_organization_ownership_unmigrated`), `tables`, `marker`, exit code `1` and every flag are as before.
