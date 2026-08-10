---
"@objectstack/metadata-protocol": patch
"@objectstack/metadata-core": patch
---

fix(metadata): two same-name active SHARED views can no longer coexist — `sys_view_definition`'s active-row index gets a NULL-safe key (#6417)

#5839 / PR #6415 delivered "unique among ACTIVE rows" for `sys_view_definition`
as a runtime partial UNIQUE index, and deliberately changed only the index's
**row scope** — that is what made it strictly weaker than the index it replaced
and therefore incapable of failing on existing data. It also left the other
half of the same index broken, and pinned that gap honestly rather than closing
it.

SQL UNIQUE treats NULLs as mutually **distinct**. `owner` is NULL for SHARED
views and `organization_id` is NULL for environment-level ones, so
`(name, organization_id, owner)` constrained **personal views only**. Measured
on real SQLite over the driver's own DDL:

```text
two ACTIVE personal views, same (name, org, owner) : REJECTED
two ACTIVE shared views    (owner NULL)            : OK   ← unconstrained
two ACTIVE env-level views (organization_id NULL)  : OK   ← unconstrained
```

Two same-name shared views inside one tenant were therefore reachable, while
`name` is declared as the globally unique qualified view id (`object.viewKey`)
— so the view switcher, which aggregates and de-duplicates by `name`, and every
read path that locates a view by name, had no defined answer about which row
they got.

**What changes.** Per the maintainer ruling of 2026-08-08 this is now forbidden.
The same runtime migration materializes the key NULL-safe, folding each nullable
part's NULLs into one bucket that is unique among itself:

```sql
CREATE UNIQUE INDEX idx_sys_view_def_active ON sys_view_definition
  (name, COALESCE(organization_id, '__global__'), COALESCE(owner, ''))
  WHERE state = 'active'
```

Both spellings are copied from an existing in-repo precedent rather than
invented: `'__global__'` is ADR-0120 D3's reserved sentinel for the tenant
column (the driver's `GLOBAL_TENANT`), and `COALESCE(owner, '')` is
`ensureOverlayIndex`'s `COALESCE(package_id, '')` form for a non-tenant nullable
discriminator. Neither can collide with real data — an organization id may never
equal `'__global__'`, and an owner is a user id, never the empty string.
**Storage is untouched**: rows keep their NULLs, only the index folds them, so
`WHERE owner = ''` still matches nothing.

Unchanged: archived rows stay exempt (#5839's active-only scoping survives, on
shared views too), a shared view and a personal view may still share a name, and
so may two tenants' or two environments' rows.

**This is a tightening, so it can fail to build.** Unlike #5839, rows that
violate the new key exist in the wild today, precisely because nothing rejected
them. The migration probes before it replaces anything, and on a conflict takes
ADR-0120 D4's disposition: the previous index is left in place (the table is
never left unconstrained), the report names the key that is not enforced, ships
the exact `GROUP BY … HAVING COUNT(*) > 1` query that lists the offending rows,
points at `os migrate plan` — and the boot continues. Resolve the duplicate
active shared views, restart, and the tightening applies itself.

Dialects with no partial indexes (MySQL/MariaDB) keep the declared bare
composite, which is ADR-0120 D3's own degradation. That report is **raised from
`info` to `error`**: under #5839 alone the dialect lost slot recycling, a
functional degradation the next user hits immediately, but it now loses an
integrity guarantee the platform states it enforces while continuing to look
healthy — AGENTS.md's durability arm. The line names both gaps that stay open
there and the duplicate-listing query. The unclassifiable-failure arm is raised
with it, so the failure nobody can name is never reported more quietly than the
one that has a name.
