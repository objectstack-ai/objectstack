---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: the last-admin guard and the default-organization bootstrap count only the Default Organization's `admin_full_access` grant — an organization-less grant is no administrator

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. The rows this reads differently exist only on a database the ownership ceremony has not certified, or in a composition that registers no organization object. -->

**BREAKING** for a host that holds an `admin_full_access` grant row with no `organization_id` (`NULL`, absent or blank). Since the resolver stopped reading such a row as platform-admin standing (ADR-0131 D1/D5), the two plugin-auth readers that still counted it now read it the same way.

- **`registerLastAdminGuard` (the last-administrator guard).** FROM: an organization-less `admin_full_access` grant counted as a platform administrator under `single`, beside the Default Organization's. TO: only the Default Organization's grant counts, and only under `single`; with no nameable Default Organization (a composition that registers no organization object among them) no grant counts. The configured administrator list (`OS_PLATFORM_OWNER_EMAIL`, verified accounts) and organization owners and admins count as before.
  - The guard now **refuses** a write it used to permit: ending the standing of the last administrator the resolver recognises while an organization-less holder exists. Counting that holder let the deployment's only platform administrator be banned, deleted or downgraded.
  - It now **permits** a write it used to refuse: banning, deleting or revoking an organization-less holder who is nobody's administrator.
  - Under a walled posture, a switched-off or dangling organization-less grant is no longer "emptied environment" evidence, and the refusal no longer carries its walled remedy sentence (no grant is evidence there).
- **`ensureDefaultOrganization` (the bootstrap's grant anchor).** It reads only the Default Organization's `admin_full_access` grant, and no grant when no Default Organization is nameable. An organization-less grant holder is never bound as the Default Organization's owner. The configured owner is read first, as before.

**Who sees it.** No served composition: a fresh install, a certified 18.0.0 database and a ceremonied database hold no organization-less grant, and the engine derives or refuses one wherever the organization object is registered. What changes is a host that embeds the guard on an engine with no organization object (for example on driver-memory), or runs plugin-auth outside `os serve` on a database the ceremony has not certified.

**What an embedder does.** Anchor your administrators the way ADR-0131 D5 names: declare them in `OS_PLATFORM_OWNER_EMAIL` (their accounts verified), or give them an owner or admin `sys_member` row. Or register the organization object (`sys_organization`, which plugin-auth ships) and own the grant by the Default Organization. On a database 17.x or an 18.0 pre-release created, run `os migrate organization-ownership`, which attributes every organization-less grant to an organization.
