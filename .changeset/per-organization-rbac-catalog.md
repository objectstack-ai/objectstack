---
"@objectstack/plugin-security": minor
"@objectstack/plugin-sharing": minor
"@objectstack/core": patch
---

Materialize the RBAC catalog **per organization**, so a walled deployment can
administer positions, permission sets and sharing rules again (#10103).

On a walled deployment (`group` / `isolated`) every principal — an organization
owner and a platform admin alike — listed **zero** positions, permission sets
and sharing rules while the tables held rows. Nothing could be bound through
Setup, and a declared `hierarchy-security` could never be armed by an operator
however loudly an app declared it.

Every row in those three tables was organization-less. plugin-security's Layer 0
composes a strict `organization_id = :tenant` for a walled posture and the
middleware ANDs it into the read AST over the driver's
`(organization_id = :tenant OR organization_id IS NULL)`; the conjunction of the
two is the strict equality alone, so the driver's null arm was annihilated on
every authenticated read.

**The wall is not changed, at either layer.** The rows get an owner instead:

- `bootstrapDeclaredPositions`, `bootstrapBuiltinRoles`,
  `bootstrapDeclaredPermissions` (plugin-security) and
  `bootstrapDeclaredSharingRules` (plugin-sharing) upsert by
  `(name, organization_id)` and run **one pass per organization** under a walled
  posture — the framework built-ins (`platform_admin`, `org_*`, `everyone`,
  `guest`) included, matching `sys_user_position`, which is already
  per-organization, and matching both objects' own `unique: 'organization'` name
  index.
- Seeding also fires on **organization creation**, not only at `kernel:ready`, so
  a tenant created after startup does not administer an empty catalog until the
  next restart.
- `single` posture is **unchanged**: exactly one organization-less pass, which is
  the correct shape there.

An organization-less row is now invalid state under a walled posture. Nothing is
reaped — grants (`sys_user_position`, `sys_position_permission_set`,
`sys_user_permission_set`, `sys_record_share`) point at these rows by id, so
deleting them would revoke standing access with no signal at the moment of loss.
Instead a per-organization pass that meets pre-fix organization-less rows for
names it seeds **says so loudly**, naming the rows and the remedy, and still
creates that organization's own copies. The failure this closes is the silent
no-op: a tenant-threaded pass that sees the old row through the driver's
compatibility arm, reads the name as already represented, and creates nothing
while reporting success.

Two enforcement-plane reads are scoped in the same change, because the exposure
they carry only exists once per-organization copies exist:

- `resolveUserAuthzContext`'s position name-sweep (`@objectstack/core`) resolved
  `sys_position` by name across **every** organization, so the junction read
  behind it collected another organization's `everyone` binding — a cross-organization
  grant bleed, and an O(organizations) read on the per-request path. It is now
  threaded through the driver's tenant chokepoint, keeping per-request resolution
  O(the caller's own organization's catalog).
- plugin-security's permission-set `dbLoader` resolved sets by name unscoped,
  with a `limit` equal to the number of names — correct while one row existed per
  name, a truncation the moment copies exist. It is now scoped to the caller's
  organization and its bound widened.

Boot reconciliation is O(changed declarations): each pass reads what its
organization already has and writes only where a declaration actually differs, so
the common boot performs no writes at all. Steady state rides the
organization-creation hook.

Cross-links #10119 / PR #10422, whose criteria-sweep scoping makes per-organization
sharing rules cheaper than the unscoped sweep they replace.
