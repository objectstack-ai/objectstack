---
"@objectstack/platform-objects": patch
"@objectstack/plugin-security": patch
"@objectstack/driver-sql": patch
---

fix(platform-objects,plugin-security,driver-sql): `sys_user_preference` and `sys_capability` uniqueness is per organization (#8323)

Both objects declared their uniqueness as a table-level index with bare
`unique: true`. At the DECLARED-index level that is the positional spelling of
`'global'` — the listed columns verbatim — so on a tenant-scoped object it
materialized an **installation-wide** unique index. (Field-level `unique: true`
means the opposite, per-organization, and has since #3696; `packages/lint` names
that divergence "the #4986 trap" and warns on it via
`unique/unscoped-declared-index`.) Measured on a deployment running
`OS_TENANCY_POSTURE=isolated`:

- **A user in two organizations could never persist a preference key they had
  already used in the first one.** `sys_user_preference`'s `(user_id, key)` was
  installation-wide, so the second organization's write was refused by a row the
  caller cannot read — and `data-objectstack`'s `userState.save()` swallows the
  failure by design, so "recent items" and similar preferences silently stopped
  persisting in a user's second workspace, with no error anywhere.
- **`sys_capability.name` refusals were an existence oracle across tenants.** An
  organization could POST a name and read `409` vs `201` to learn whether some
  other organization — or the platform seed — already held it, while its own
  `GET` on that name returned zero rows.

Both declarations now say `unique: 'organization'` (ADR-0120 D1), materializing
`(COALESCE(organization_id,'__global__'), …)`. Platform-seeded rows carry no
organization and the key part is NULL-safe (ADR-0120 D3), so they stay unique
among themselves and `bootstrapSystemCapabilities`' upsert-by-name is unaffected.
Same-organization duplicates are still refused — the constraint is scoped, not
removed.

The bare `unique: true` spelling itself is **unchanged**; whether it should be
reinterpreted is #5082 (v18), and the publish-time authoring advisory is #8379.

**Migration (`@objectstack/driver-sql`).** Respelling a declared index changes
its generated name, which on a deployed database read as two unrelated findings:
the composite missing (`create_index`, safe) and the old global index orphaned
(`drop_index`, **destructive**). An operator applying only the safe half would
have kept the global index — i.e. kept the defect — while the plan read as
applied. The declared-index respelling now routes through the same
`replace_unique_index` retirement the field-level `unique` migration has used
since #3728: one finding, categorised `safe`, CREATE before DROP, and the legacy
index dropped only once the replacement is confirmed present. Any two rows
colliding on `(organization, …fields)` already collided on `(…fields)`, so the
replacement can neither fail on existing data nor lose any.

Operators upgrading a deployed database should run `os migrate plan` / `os
migrate apply` — no `--allow-destructive` is required. Until the retirement is
applied the old index keeps enforcing, so the constraint is never unenforced at
any point in the migration.
