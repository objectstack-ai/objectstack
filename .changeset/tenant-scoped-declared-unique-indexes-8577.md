---
"@objectstack/plugin-security": patch
"@objectstack/service-messaging": patch
---

fix(plugin-security,service-messaging): two more tenant-scoped declared unique indexes become per-organization (#8577)

Two platform objects declared their uniqueness as a table-level index with bare
`unique: true`. At the DECLARED-index level that is the positional spelling of
`'global'` — the listed columns verbatim — so on a tenant-scoped object each
materialized an **installation-wide** unique index. (Field-level `unique: true`
means the opposite, per-organization, and has since #3696; `packages/lint` names
that divergence "the #4986 trap" and warns on it via
`unique/unscoped-declared-index`.) These are the fifth act of the class ruled on
2026-08-13, after `sys_user_preference` / `sys_capability` (#8461),
`sys_position` (#8556) and the five of #8554.

| object | package | was | now |
|---|---|---|---|
| `sys_notification_subscription` | `service-messaging` | `[topic, principal]` global | same, per organization |
| `sys_audience_binding_suggestion` | `plugin-security` | `[package_id, permission_set_name, anchor]` global | same, per organization |

Measured live on a real engine before the fix — two organizations, the same key,
`OS_TENANCY_POSTURE=isolated`, driving the real shipped declarations. Both
reproduced identically:

```
org_jia POST the key   → 201
org_yi  POST the SAME  → 409 UNIQUE_VIOLATION
org_yi  POST an unused → 201            ← the control that makes it an oracle
org_yi  GET  the key   → total 0        ← refused by a row it cannot see
```

`sys_notification_subscription` is the class's usual shape and the direct sibling
of `sys_notification_preference`: a user belonging to two organizations could not
subscribe to the same topic in both, and since `role:x` / `team:x` principal
names are themselves per-organization, the same string denoted different
subscribers while colliding on one installation-wide key.

`sys_audience_binding_suggestion` is **more serious, and it is not a naming
collision at all.** Its key is the owning package's id, the package's own
permission-set name and the anchor — the same triple for every tenant that
installs the same package — while the row is per-tenant by construction
(ADR-0090 D5/D9: raised when a package's `isDefault` set is observed, resolved
when a tenant admin confirms). So the second and every later organization to
install a package never got its suggestion row: its admins were never prompted to
bind the package's default permission set, its users never received that set, and
nothing reported it — the reconciler cannot distinguish the cross-tenant UNIQUE
violation from the benign concurrent-sync race its `catch` was written for. Both
halves are now pinned end to end: two organizations installing the same package
each end up with their own pending row, and re-running one organization's sync
still adds nothing.

### One caveat on `sys_audience_binding_suggestion`

This release makes a per-organization suggestion row **possible**; it is not yet
what the platform writes. The reconciler still reads and writes through a
tenant-less system context, so on a shared-runtime multi-organization
installation the surface continues to hold one organization-less row that every
tenant reads — measured, recorded as a test, and tracked in #8617, which remains
open. Single-organization installations are unaffected either way.

## ⚠️ Operators: a migration is REQUIRED, and deploying this release is not it

Respelling a declared index changes its generated **name**. On an existing
database `initObjects` is additive: it creates the new per-organization composite
at boot and **never drops the old global index**, which goes on enforcing. Until
the retirement is applied, a deployed installation that has taken this release
still refuses the second organization's row — that is asserted as a test, not
assumed.

Run the migration:

```
os migrate plan       # shows one `replace_unique_index` per object, categorised `safe`
os migrate apply      # no --allow-destructive needed
```

Each object plans as **one pure relaxation**, not as two findings. That matters:
if it read as "composite missing" (safe) plus "old global index orphaned"
(destructive, opt-in), an operator applying only the safe half would keep the
global index — keep the defect — while the plan read as applied. The #8461
`replace_unique_index` arm covers both unchanged (no driver change in this
release), applies CREATE-before-DROP so uniqueness is never unenforced in
between, drops the legacy index only once the replacement is confirmed present,
preserves every row, and converges to no drift.

Two details worth an operator's attention:

- **Both** replacement index names are **hash-suffixed**, because their natural
  names are 66 and 90 characters against a 60-character limit:
  `uniq_sys_notification_subscription_799a483c` and
  `uniq_sys_audience_binding_suggestion_a736dc5a`. On
  `sys_audience_binding_suggestion` the legacy name
  (`uniq_sys_audience_binding_suggestion_79a05fef`) is hash-suffixed too, so the
  two differ only in the hash. That is expected, not corruption.
- Rows with no `organization_id` (platform/seed rows) stay unique **among
  themselves**: the organization key part is NULL-safe
  (`COALESCE(organization_id, '__global__')`, ADR-0120 D3), so seeding by name
  keeps working and a tenant may hold its own row of the same key.

## Not breaking

A relaxation admits key pairs that were previously refused and refuses nothing
that previously succeeded, so no caller that worked before fails now. Every read
path for these two objects goes through the tenant-scoped data API, so no
consumer resolves one of these keys across organizations expecting at most one
row. Shipped as `patch` for that reason — the same call #8556 and #8554 made for
the same shape.

The one published uniqueness claim about either object — "one per package × set ×
anchor" on the permission-sets guide — now reads "one per organization × package
× set × anchor". Neither object's field text made a uniqueness claim, so no
translation bundle changed.
