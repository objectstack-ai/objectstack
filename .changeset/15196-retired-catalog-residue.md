---
'@objectstack/plugin-security': patch
---

fix(plugin-security): the `sys_user_position.position` refusal names the security catalog type it judged against, and reads no retired catalog table

A `sys_user_position` write naming no position in the security catalog is still refused `400 VALIDATION_FAILED` with one `reference_not_found` entry at `position`. That entry's `constraint.target` now reads `position`, the security catalog type the value is judged against, instead of `sys_position`, a catalog table that is no longer registered. The sibling `sys_user_permission_set.permission_set` refusal already answers `target: 'permission'`. A client that read `constraint.target` should expect `position`.

The refusal no longer looks a refused value up as a `sys_position` record id to suggest that row's name. That lookup could not succeed on a current deployment, so it never suggested a name. Every refused value now gets the same remedy: write the machine name of an existing position, or declare the position first.

Also removed: the unused internal `per-organization-catalog.ts` module, which nothing imported. Nothing else changes.

Clause-②: no
