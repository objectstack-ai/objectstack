---
'@objectstack/cli': patch
---

fix(cli): `os migrate organization-ownership` plans a v17 database that still holds the retired `sys_scim_provider` table, listing it as fate 4 instead of refusing it (ADR-0131 D10)

Clause-②: no

`sys_scim_provider` was retired from the platform before the ceremony's inventory was taken, so the inventory had no row for it. Its ADR-0087 entry (`scim-provider-object-retired`) leaves the table in place, untouched, by ruling, so every database that booted a release from before the retirement still holds it, `organization_id` column included. The plan refused such a database with `uninventoried-platform-table` (`sys_scim_provider carries organization_id but the ADR-0131 D10 inventory gives it no fate`), and so did `--apply`, so the ceremony could not run there at all and `os dev` / `os serve` stayed refused.

- **Now** the inventory lists `sys_scim_provider` with fate 4 (`report`), under a new census population, `retired-before-census`. The plan reports its rows and its NULL-organization rows by id. It never attributes them, not even to the Default Organization under `single`, and never deletes them.
- **NOT NULL:** the table is exempt, so the plan reports it as not receiving NOT NULL. The object is retired, no declaration anchors tenancy on the column, and a SCIM connection scoped to no organization was a legitimate row.
- The plan's `inventoryDigest` changes with the new row. A plan file written by an earlier CLI no longer matches, so `--apply --plan-file` refuses it with `plan-digest-mismatch`. Re-run `os migrate organization-ownership --out PLAN`, review it, and apply that.
