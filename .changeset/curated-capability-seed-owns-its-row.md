---
'@objectstack/plugin-security': minor
---

**The curated capability seeder reconciles the row the platform owns — never an organization's (#8470).**

`bootstrapSystemCapabilities` upserted each curated capability with
`find('sys_capability', { where: { name }, limit: 1 })` under a system context,
i.e. across organizations. Since #8461 made `sys_capability.name` unique per
ORGANIZATION rather than installation-wide (ADR-0120 D1, closing the
cross-tenant existence oracle #8323 reports), that lookup can have **two**
candidates: the platform's own row in the NULL-organization bucket, and one an
admin authored inside their organization — a supported action (ADR-0066 D1: the
platform DEFINES, admins EXTEND in Setup).

Two harms followed, the second worse:

1. an organization's authored `label`/`description` were overwritten with the
   platform's copy at every boot; and
2. when the organization's row was the one selected **before** the platform's
   row existed, the seeder took the update branch and the curated definition was
   **never inserted, in any bucket, installation-wide**.

**Ordering was not the missing property.** #4363's pagination tie-breaker
already appends `ORDER BY id` to any paged read of a driver-managed table, and
`limit: 1` counts as paged on both the SQL and MongoDB drivers — so the lookup
was already deterministic, deterministic on `id`, which says nothing about who
owns the row. Worse, being stable made it permanent: an installation that picked
the wrong row picked it again on every subsequent boot instead of self-healing.

**The curated lookup is now scoped to `managed_by: 'platform'` AND
`organization_id: null`** — the two facts that jointly define the platform's own
row, and which together make the result set a provable singleton (the post-#8461
unique key is `(COALESCE(organization_id, …), name)`, so the platform bucket
admits at most one row per name). The DERIVED half is unchanged: its own #5876
guard already refuses to touch a row it does not own.

The organization's row keeps its authored copy, and the platform's curated row
is seeded regardless of what any organization has authored.

**New `blockedCurated` field on the seeding result** (a widened return type —
breaking for anyone constructing `CapabilitySeedResult` by hand, hence `minor`
per the launch-window convention). It counts, and warns about, the one collision
the seeder now declines to resolve by overwriting: a curated name already held
in the platform bucket by a row the scoped lookup did not match. Previously that
case was "resolved" by clobbering the other author; now it is refused, and
refusing silently would be its own defect, since `tryInsert` swallows the
engine's unique-constraint refusal. The warning states the provenance it
actually **read** off the blocking row rather than asserting who authored it —
the seeder observes "no platform-owned row matched, and the insert was refused",
which is not the same fact as "this row belongs to someone else".

Reachable and ordinary, not hypothetical: `organization_id` auto-stamping lives
in the enterprise `@objectstack/organizations` runtime, which is also what
activates every walled posture — so on a deployment without it (`single`
posture, no stamper) every Setup-authored capability row lands in the
NULL-organization bucket.

No authorization behaviour changes. Grants (`systemPermissions`) and
requirements (`requiredPermissions`) resolve capabilities **by name**, and no
runtime code path reads a `sys_capability` row to decide access — so a
never-seeded curated row was a registry/Setup-listing defect, not a privilege
one. No migration: an already-overwritten organization row is not restored, but
it stops being overwritten, and a missing curated row is seeded on the next
boot.
