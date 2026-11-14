---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: a seed load for one organization resolves people through membership in that organization, says when a reference lookup was refused, and gives hooks on seeded rows the organization the rows are stamped with

Clause-②: yes (narrowing) — narrowed: under a walled tenancy posture (`isolated` or `group`), a hook's `ctx.api` read made while a seed load writes a row for an organization now reads that organization's rows, where it read every organization's rows. Widened: on a load for one organization (the per-organization replay, a reseed, an install into an organization), a reference to a person (`owner_id`, a `sys_user` lookup) resolves to a person who is a member of that organization, where it never resolved; a reference to `sys_organization` resolves to the load's own organization; a reference to an object its author declared global (`tenancy: { enabled: false }`, no `organization_id` column) resolves across organizations; and a hook on a seeded row now sees the organization the row is stamped with as `ctx.session.organizationId`, on those loads and on every load that stamps the install's sole organization (the boot under `single`, a publish, a hot reload). Nothing that resolved before stops resolving, and no load that succeeded is refused.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed, renamed or re-shaped and no stored row changes shape: what moves is which rows a hook reads through its own api while a seed load for one organization writes, so there is nothing for a migration to rewrite and no tombstone -->

**BREAKING** for an app hook that reads through `ctx.api` on a seeded row under a walled tenancy posture and relied on seeing other organizations' rows. A seed load for organization A now writes as organization A: the hook reads what the same hook reads when a person of organization A creates the row through the API. The fix: a hook that genuinely needs rows of every organization says so with `ctx.api.sudo()` and filters them itself, as it must on the API path already.

What changes, by load:

- **A reference to a person on an organization's own load.** `sys_user` carries no organization (identity lives above it), so the loader's reference lookup no longer filters it by `organization_id`, which the database refused. It finds the people the natural key names and keeps the first one holding a `sys_member` row in the load's organization. A person who exists but is not a member is never used: the reference stays empty and its error says the person is not a member of that organization.
- **Every other reference target** is judged from its registered schema: one with an `organization_id` column is looked up inside the load's organization, as before; `sys_organization` answers only for the load's own organization; an object declared global has no organization filter. A platform-managed table with no organization column keeps the old lookup, and its refusal is now reported.
- **A refused lookup** (an unknown column, an unregistered object, a driver fault) is no longer read as "no match". The load logs it once per target, field and code, keeps going, and the reference's error names the refusal's code instead of saying no such row exists. The load's outcome is unchanged: the reference was unresolved before and stays unresolved.
- **The write context.** Every seed write of a load carries `tenantId` set to the organization the load stamps its rows with (the one the caller pinned, or the install's sole organization). The shared `SEED_WRITE_EXECUTION_CONTEXT` is unchanged. A load with no organization, pinned or derived, writes with exactly the context it used before.
- **A load with no organization** (the single-tenant boot, a publish, a hot reload) resolves references across the whole database, as before.
