---
'@objectstack/plugin-security': patch
---

Make `clone_permission_set` carry the system permissions, row-level security
and tab permissions it was silently dropping

The Clone action POSTs its `params` values to `/api/v1/data/sys_permission_set`,
so the params list *is* the payload. It named two of the six definition facets a
`sys_permission_set` row carries — `object_permissions` and `field_permissions`
— leaving `system_permissions`, `row_level_security` and `tab_permissions`
absent from the body. `permissionSetBodyFromRow()` then read each one through
`parseMaybeJson(undefined, …)` and filled the empty default, so cloning a set
that grants `setup.access`, or one carrying row-level security policies,
produced a clone with none of them: record created, success toast fired, and the
missing half discoverable only by diffing the two records.

The three now travel, in the same JSON-string shape the two listed columns
already used. Nothing about what the door ACCEPTS changed — `permissionSetBodyFromRow()`
already read all six columns; what changed is what the action SENDS.

This became urgent one commit ago. The save door now refuses an in-place edit of
a package-declared permission set **and its refusal message tells the admin to
clone**, which made this action the platform's own recommended remedy while it
was still dropping three facets — an admin following that instruction lost
grants quietly. The failure direction was fail-closed (fewer grants), which is
why it was quiet.

`admin_scope` is **deliberately not copied** (maintainer ruling 2026-08-24).
Putting an ADR-0090 D12 delegated-admin authority onto a brand-new
organization-owned set on the admin's behalf is a privilege decision, not a
field copy. The Clone dialog now says so in its description, so the omission
reads to the admin as a decision rather than as the same silent drop — grant a
scope deliberately on the new set if it needs one.

Pinned by `packaged-permission-set-lock.test.ts` pin 6, which assembles the
clone payload by READING the action's params list rather than restating it, and
asserts each facet by identity against a non-empty value — the empty default
(`[]` / `{}`) is exactly what a "present" assertion would have accepted. Its
control proves the exclusion is live: the base fixture carries a real
`admin_scope`, and the clone still has none.
