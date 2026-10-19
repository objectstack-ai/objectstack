---
'@objectstack/cli': patch
---

fix(cli): `os migrate plan` no longer lists `sys_packages` among the tables "declared by no object in this plan" after `os migrate apply` has created it

Clause-②: no

`sys_packages` is the package registry's table. It is not an object: `PackageServicePlugin` creates it with its own DDL, and `os migrate apply` creates it from the registry's `package.storage` declaration. The plan's unmanaged-table sweep built its known set from the planned drivers' managed tables and the declared objects only, so on every applied deployment the plan reported the live registry table as if it were stranded.

- **Now:** the sweep also counts the tables the boot's composition declares outside the object set. It reads that name from the same `package.storage` declaration the plan creates the table from. It reads it on every boot, whether or not the table exists yet, the skip-schema-sync boot of a Turso remote primary included. On `examples/app-crm` after `os migrate apply --yes`, the plan lists only a genuinely stranded `sys_*` table.
- **Still reported:** a `sys_packages` table in the database of a deployment that composes no package registry. Nothing there declares it.
- **Refused in one more case:** a `package.storage` service whose shape this CLI does not read now fails `plan`, `apply` and `organization-ownership` on a skip-schema-sync boot too, with the error those commands already gave on every other boot: `@objectstack/cli` and `@objectstack/service-package` must come from the same release.
- **Unchanged:** the `--json` keys, the section's wording, and what `apply` creates.
