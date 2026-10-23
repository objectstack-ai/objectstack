---
'@objectstack/core': patch
'@objectstack/plugin-auth': patch
'@objectstack/plugin-security': patch
'@objectstack/cli': patch
---

fix(core,plugin-auth)!: the last-admin guard judges a `sys_organization` insert that moves the Default Organization, and one definition of the Default Organization is exported from core

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. The narrowing is one more organization write the last-administrator guard refuses at runtime. -->

**BREAKING** for a `single`-posture deployment whose only organization is not slugged `default` and whose last administrator holds nothing but the Default Organization's `admin_full_access` grant.

- **`registerLastAdminGuard` (`@objectstack/plugin-auth`) now judges a `sys_organization` insert.** Under `single` the Default Organization is the one slugged `default`, else the only one, and its `admin_full_access` grant is what makes the platform administrator one (ADR-0131 D5). Adding an organization can move it with no grant touched: a second organization beside a sole one with another slug leaves none, and a new one slugged `default` takes its place.
  - FROM: the insert was admitted. The administrator lost platform standing in silence, and the guard then admitted a ban or delete of that same administrator, because it no longer counted anyone.
  - TO: the insert is refused (`PERMISSION_DENIED`, 403, on `sys_organization`) when it would leave nobody who can sign in and administer. An organization owner or admin, an `OS_PLATFORM_OWNER_EMAIL` administrator, or a Default Organization slugged `default` (which a new organization cannot move) admits it, as on the update and delete halves. Under a wall no grant anchors, so the insert is admitted and costs no reads.
- **One definition of the Default Organization (`@objectstack/core`).** New exports: `findDefaultOrganization(read)` (the rule, over a read the caller supplies), `DEFAULT_ORGANIZATION_SLUG`, and `readDefaultOrganizationId(ql)` (the resolver's own read, which fails loud on an unreachable store). plugin-auth's boot invariant, default-organization bootstrap, tenancy service and last-admin guard, plugin-security's `resolveDefaultOrganizationId`, and the ownership ceremony's plan now name the organization through it. Each keeps its own read policy: whether a failed read throws or reads as none, the guard's simulation of a pending write, and the ceremony's raw SQL. Two edge answers align with the resolver's. A `default`-slugged row with a blank id now falls through to the only-organization reading in the ceremony's plan. A numeric id is now read as its string in plugin-security's reader.

**What an operator does.** Before you create a second organization on a `single` deployment whose only organization has another slug, either give that organization the slug `default` (while it is the only one, that changes nothing else), or make sure another account can administer: an organization owner or admin, or an address in `OS_PLATFORM_OWNER_EMAIL`.
