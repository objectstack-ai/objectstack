---
'@objectstack/platform-objects': patch
---

feat(platform-objects): a single-organization deployment can rename its organization

Clause-②: yes
Metadata-protocol: none

- **`sys_organization`'s Rename Organization** (name and logo, never the slug) is now gated on the organization capability instead of `multiOrgEnabled`. Under the `single` posture it was the one organization's only possible name door, and it was hidden: the generic edit keeps `name` readonly and every other organization action is multi-organization only. It is still offered only to the organization's owners and admins, and better-auth's `organization/update` still decides at the door.
- **Edit Organization** (which also sends the slug), Create, Delete, Switch and Leave stay multi-organization only. Under `multi` nothing changes.
- **`sys_organization.name`'s help** now says the name is changed with Rename Organization, in all four bundles.

Ruling 6384629949 on #25347.
