---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: under `single`, no slug change makes another organization the Default Organization — re-slugging to `default` captured the platform-admin anchor

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. What narrows is a runtime write: a `sys_organization` slug changed to `default` under `single`. -->

**BREAKING** for a `single` deployment that holds several organizations, none slugged `default`, and re-slugs one of them to `default`. Under `single` the Default Organization is the organization slugged `default`, else the only one, and its `admin_full_access` grant confers platform administrator standing (ADR-0131 D5). A re-slug to `default` therefore made that organization the Default Organization, and every holder of a grant it owned a platform administrator: an organization owner could do it through better-auth's `POST /auth/organization/update`, and a seed or a plugin through an engine update.

- **FROM:** a slug changed to `default` on any organization was admitted, as long as the last-administrator guard found an administrator left standing. **TO:** under `single` it is admitted only on the organization that is already the Default Organization (the sole organization taking the slug the boot gives it). Any other organization is refused `403 PERMISSION_DENIED` by the last-administrator guard's `sys_organization` `beforeUpdate` hook, for every engine write, `isSystem` included, so better-auth's `organization/update` answers it too. A read the guard cannot complete refuses as well.
- **Removed, with no in-place replacement: moving the Default Organization.** FROM: with several organizations, an operator could move `default` from one to another in two writes (the current one re-slugged away, then another re-slugged to `default`). TO: the second write is refused, because it is exactly the capture above, whoever makes it. An atomic swap was never possible (the slug is unique).
- **Stranding.** Re-slugging the Default Organization AWAY while other organizations exist is still admitted when an administrator stays standing (the last-administrator guard's update half, unchanged). After it, no organization names the Default Organization, so no organization can take `default`, the previous holder included, until the store holds one organization again or declares a wall. Do not re-slug a Default Organization away on a `single` deployment that holds several organizations.
- **Unchanged:** a slug changed to any other value; every slug change under a walled posture (`isolated`, `group`), where no grant anchors and a slug is just a slug; the data API, whose user-context PATCH and update-mode import were already refused a `slug` by the ADR-0092 identity write guard.

**What an operator does.** Keep another slug. To move the anchor, move the grant rather than the slug: an `admin_full_access` grant re-owned by the Default Organization anchors, and a grant owned elsewhere does not. To name a Default Organization on a `single` deployment that holds several organizations, hold one organization (merge the others into it; the sole organization is the Default Organization and may then take the slug `default`), or declare a walled posture (`OS_TENANCY_POSTURE=group` or `isolated`), as the tenancy organization census already prescribes.
