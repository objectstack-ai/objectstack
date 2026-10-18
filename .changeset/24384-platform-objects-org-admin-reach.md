---
'@objectstack/platform-objects': minor
---

`sys_organization`'s organisation-admin actions are now offered only to the membership grades whose requests the door accepts. Before, they were gated on `multiOrgEnabled` alone, so a plain member saw them, and better-auth refused every click with 403:

- `update_organization` ("Edit Organization", list row) and `rename_organization` ("Rename Organization", record header and list row) declare `requiresMembershipReach: 'update_organization'`: owner and admin.
- `delete_organization` ("Delete Organization", list row) declares `requiresMembershipReach: 'delete_organization'`: the owner alone.

The `multiOrgEnabled` gate stays as the last term of each predicate. `invite_user` is unchanged, and `set_active_organization`, `leave_organization`, `create_organization` and `change_slug` stay as they were.

Clause-②: yes (widening)
