---
"@objectstack/plugin-security": patch
"@objectstack/spec": patch
---

fix(plugin-security,spec): `sys_position.name` uniqueness is per organization (#8468)

`sys_position` declared its uniqueness as a table-level index with bare
`unique: true`. At the DECLARED-index level that is the positional spelling of
`'global'` — the listed columns verbatim — so on a tenant-scoped object it
materialized an **installation-wide** unique index. (Field-level `unique: true`
means the opposite, per-organization, and has since #3696; `packages/lint` names
that divergence "the #4986 trap" and warns on it via
`unique/unscoped-declared-index`.) This is the third instance of the class
ruled on 2026-08-13, after `sys_user_preference` and `sys_capability` (#8461).

Measured live on a real engine before the fix — two organizations, same name,
`OS_TENANCY_POSTURE=isolated`:

```
CREATE UNIQUE INDEX uniq_sys_position_name on sys_position (name)

org_jia POST name=sales_manager  → 201
org_yi  POST the SAME name       → 409 UNIQUE_VIOLATION
org_yi  POST an unused name      → 201
org_yi  GET  that name           → total 0
```

Two consequences. **An organization could not name a position that any other
organization had already used** — `sales_manager` taken installation-wide meant
a permanent, unexplained 409 on a perfectly ordinary name. And because the
refusal is per-value on a row the caller cannot read, it was a **cross-tenant
existence oracle**: an admin could enumerate other organizations' position
vocabulary by reading 409-vs-201.

The declaration now says `unique: 'organization'` (ADR-0120 D1), materializing
`(COALESCE(organization_id,'__global__'), name)`. Platform-seeded rows
(`bootstrapBuiltinRoles` — `platform_admin`, `org_*`, and the ADR-0090 D9
audience anchors) carry no organization and the key part is NULL-safe (ADR-0120
D3), so they stay unique among themselves and the bootstrap upsert-by-name is
unaffected. Same-organization duplicates are still refused — the constraint is
scoped, not removed.

Positions are deliberately flat (ADR-0090 D3, finalizing ADR-0057 D5), so the
"a hierarchy implies a shared namespace" argument does not arise here: there is
no `parent_id` on this object.

**Published text.** The field's spec `describe()` said "Unique position name",
and `content/docs/references/identity/position.mdx` is generated from it, so the
docs asserted installation-uniqueness as though it had been intended. The
`describe()` now reads "Position name, unique per organization" and the
reference page is regenerated from it; the object's own field description and
the `clone_position` dialog's help text are corrected to match.

**Migration.** No new machinery: the `replace_unique_index` retirement that
#8461 generalized to declared indexes covers this object unchanged. Respelling a
declared index changes its generated name, which on a deployed database would
otherwise read as two unrelated findings — the composite missing (safe) and the
old global index orphaned (**destructive**) — letting an operator who applies
only the safe half keep the defect while the plan reads as applied. Instead it
plans as ONE `replace_unique_index` entry categorised `safe`, CREATE before
DROP, with the legacy index dropped only once the replacement is confirmed
present.

Operators upgrading a deployed database should run `os migrate plan` / `os
migrate apply` — no `--allow-destructive` required. Note that **deploying the
new code is not by itself the fix**: `initObjects` is additive, so until the
retirement is applied the old installation-wide index keeps enforcing (and the
constraint is never unenforced at any point in the migration).
