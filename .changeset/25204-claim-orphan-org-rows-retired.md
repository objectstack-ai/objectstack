---
'@objectstack/organizations': patch
---

fix(organizations)!: the first organization no longer adopts organization-less rows — `claimOrphanOrgRows` is retired

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @objectstack/organizations#claimOrphanOrgRows) The one author-reachable removal is a runtime export: the function `claimOrphanOrgRows` leaves `@objectstack/organizations`'s published entry. No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

**BREAKING** for a walled store (`group` or `isolated`) that holds application rows with no `organization_id` when its first organization is created, and for code that imports `claimOrphanOrgRows`. It ships as `patch`: no metadata an author writes changes.

- **The first organization adopts nothing.** When the per-org seed replay landed no row and the new organization was the store's first, `OrganizationsPlugin` used to write that organization's id onto every organization-less row of every application object (`claimed N orphan seed row(s) for first organization …`). Being created first names no owner, so this was an owner by guess, which ADR-0131 D9 and D10 forbid. Under a wall, the only posture that mounts this plugin, the organization-ownership ceremony reports such a row, leaves it NULL and holds it against certification; the claim then gave the same row to whichever organization existed. Those rows now stay NULL.
- **A first organization with no seed replay logs that it starts empty**, the line every later organization already logs. The organization count the claim needed is no longer read.
- **Unchanged:** the per-org seed replay, the organization stamp on insert, the Default Organization bootstrap, and `claimOrgSeedOwnership`, which hands an organization's seeded rows to its owner.

**What an operator does.** On a store this release creates or certifies there is no such row, so nothing. On a walled store an earlier release created that holds organization-less application rows, run `os migrate organization-ownership`: it attributes every row an anchor names, and lists each row it cannot attribute with its remedy instead of guessing an owner.

The retired export:

- FROM `claimOrphanOrgRows` TO no replacement; run `os migrate organization-ownership` for organization-less rows.
