---
'@objectstack/cli': patch
---

fix: `os migrate apply --allow-destructive` no longer says the organization-ownership ceremony verified on a database that was created from empty

Clause-②: no
Metadata-protocol: none

On a database an 18.x release created from empty, the ceremony's `sys_migration` row is the birth marker the boot guard writes (`details.birth`): it records that no ceremony was owed, not that one ran. When such a database dropped an `organization_id` column, the success line still read "the organization-ownership ceremony verified (TIME)", with TIME being the database's creation. The line now says which row let the drop through: for a birth marker, that the database was created from empty (its creation time and the platform version that created it) and the ceremony is not needed for it; for a ceremony run, the same sentence as before. The line is read from the marker the gate already reads, with no second database read. `--json` output, exit codes and which drops are allowed are unchanged.
