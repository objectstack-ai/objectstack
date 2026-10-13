---
'@objectstack/core': minor
'@objectstack/plugin-security': minor
'@objectstack/plugin-auth': minor
---

feat(core)!: the authorization resolver reads which permission set a user grant holds from the grant's name, `sys_user_permission_set.permission_set` (ADR-0131 D4)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export, type or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is runtime resolution and two write doors: a stored grant that names no permission set, or names one only another organization holds, stops conferring through the resolver; a write naming a grant after another organization's set is refused; and the break-glass guard judges one more column. The remedy is data (a grant re-pointed at a set of its own organization), never a rewrite of anyone's code or metadata, and the one-time backfill that names existing grants already ships. The other categories are closed on facts: every package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no TypeScript declaration moves (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

**What the resolver reads now.** `resolveUserAuthzGrants` (and every surface built on it: `resolveAuthzContext`, `hasPlatformAdminStanding`, the explain engine, `runAs: 'user'` automation) finds a user grant's permission set by the grant's `permission_set` name. The set row is the grant's own organization's row of that name, or else the organization-less row of that name. `permission_set_id` is no longer read for this. Deactivation is still read from the set row. Sets a principal holds through a position are still reached through the position binding's id.

- **Platform standing.** An unscoped grant is read against the organization-less `admin_full_access` row only. An organization's copy of `admin_full_access` gives that organization's grants its capabilities, never platform standing.
- **Nobody's resolved permissions change** where a grant's name and id agree. The platform's grant writers store both, and the one-time backfill names grants stored before the name column existed. Goldens for the platform administrator, an organization administrator, a member and an agent are unchanged in `single`, `group` and `isolated`.

**What stops conferring.**

- **A grant that names nothing.** This is a grant the backfill has not named yet, or one it could not name: its id names no set row, its id names another organization's set row, or the name is not in the security catalog. Such a grant now confers nothing through the resolver. The backfill runs at `kernel:bootstrapped`, before any server opens its socket, so on the first boot after upgrading no request is answered before the grants it can name are named. The grants it cannot name are listed in its boot report.
- **A grant whose id names another organization's set.** Before this change, such a grant conferred that set. It now confers nothing.
- **Remedy.** Read the backfill's boot report, which lists each grant by row id. Re-point each listed grant at a permission set of its own organization, or at an organization-less one, with an update of `permission_set_id`. The platform stamps the name, and the grant confers again.

**What the grant name hook refuses now** (`@objectstack/plugin-security`). The name is taken only from a set row of the grant's own organization, or from an organization-less one. A tenant-less system writer can read every organization's sets, and it could name an organization-less grant after another organization's set. Now such a grant is stored without a name. A write that supplies that name is refused, from a system writer too, with the hook's usual `400 VALIDATION_FAILED` and `invalid_value` at `permission_set`. An update that re-points a grant at such a set, or moves a grant to an organization its set does not belong to, clears the name.

**What the last-administrator guard judges now** (`@objectstack/plugin-auth`). `organization_id` on `sys_permission_set` is a standing column. Moving the organization-less `admin_full_access` row into an organization takes away every grant-anchored platform administrator, as deleting it does, so the guard refuses it when it would leave none. An organization's copy of `admin_full_access` no longer counts as the set being in effect.

**Nothing to migrate** in code or metadata.
