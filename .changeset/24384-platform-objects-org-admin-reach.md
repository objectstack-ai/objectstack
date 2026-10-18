---
'@objectstack/platform-objects': minor
---

`sys_organization`'s organisation-admin actions are now offered only to the membership grades whose requests the door accepts. Before, they were gated on `multiOrgEnabled` alone, so a plain member saw them, and better-auth refused every click with 403:

- `update_organization` ("Edit Organization", list row) and `rename_organization` ("Rename Organization", record header and list row) declare `requiresMembershipReach: 'update_organization'`: owner and admin.
- `delete_organization` ("Delete Organization", list row) declares `requiresMembershipReach: 'delete_organization'`: the owner alone.

The `multiOrgEnabled` gate stays as the last term of each predicate. `invite_user` is unchanged, and `set_active_organization`, `leave_organization` and `create_organization` stay open to every grade.

`sys_organization` no longer declares `change_slug`. Its target, `/api/v1/cloud/organizations/{id}/change-slug`, is served only by the cloud orchestrator, so on every other multi-organization composition the record header offered "Change Slug" and the click answered `404 ENDPOINT_NOT_FOUND`. In this composition the slug door is `update_organization` (better-auth's `organization/update`, list row).

**Migration, for a host that serves `change-slug`:** declare the action next to the route, as a top-level action with `objectName: 'sys_organization'`, so it is attached to the object and the record page's `page:header` can name it. Copy the action as it was before this release: `name: 'change_slug'`, `type: 'api'`, `method: 'POST'`, `locations: ['record_header']`, `target: '/api/v1/cloud/organizations/{id}/change-slug'`, `requiresFeature: 'multiOrgEnabled'`, its confirm question on `description`, and one `slug` param (`required`, `defaultFromRow`). Ship its translations with it, because the platform's bundles no longer carry `sys_organization._actions.change_slug`.

Clause-②: yes (widening)
