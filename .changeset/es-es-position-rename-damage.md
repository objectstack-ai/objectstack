---
"@objectstack/plugin-security": patch
"@objectstack/plugin-sharing": patch
---

Repair the ADR-0090 `sys_role` → `sys_position` rename in the es-ES object
translation bundles, and guard it mechanically.

The rename half-landed in Spanish: an unreviewed substring find-replace produced
two non-words (`Puestoes` as the plural of `Puesto`, and `contpuesto` where the
replace ate the unrelated word `control`), while nine further leaves in
`plugin-security` and three in `plugin-sharing` were missed entirely and still
named the pre-rename concept. In `plugin-sharing` the same picklist key rendered
two different ways in one file — `position` was `Puesto` on the sharing rule and
`posición` on the record share, and `unit_and_subordinates` read `Rol y
subordinados` (naming the removed role concept) against `Unidad de negocio y
subordinados` on its sibling.

Spanish-facing admins saw `Puestoes` as the object's plural label in navigation
and list views, and two different words for one recipient kind across two Setup
screens.

Two regression guards now cover the classes involved: a malformed-compound and
stale-term check on the renamed security objects, and a self-consistency check
asserting that a picklist option key shared by several sharing objects renders
identically within a locale. Neither needs a reader of the locale to review it.
