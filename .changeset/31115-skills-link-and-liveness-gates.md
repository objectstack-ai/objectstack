---
'@objectstack/skills': patch
---

docs(skills): the operations reference's `os generate <kind>` row names every kind the CLI scaffolds

Clause-②: no
Metadata-protocol: none

`skills/objectstack-platform/references/operations.md`: the `os generate <kind>` row listed four kinds in prose ("an object / view / flow / skill"); it now lists all ten `GENERATORS` keys (`object` `view` `action` `flow` `dashboard` `app` `skill` `picklist` `permission` `dataset`). The liveness gate now holds that row exhaustive against `GENERATORS` minus `RETIRED_GENERATORS`, so a new generator without a row, or a retired one (`agent`, `schema`) listed again, reds. Two restating clauses in the same file's port table ("so several example apps run side-by-side", "It never silently drifts") were deleted to pay the token ratchet for the longer row.
