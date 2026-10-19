---
'@objectstack/platform-objects': minor
'@objectstack/spec': patch
---

`sys_organization` now declares a `rename_organization` action ("Rename Organization") at `record_header` and `list_item`, so an organization record page can rename the organization. It collects `name` (required) and `logo`, both pre-filled from the record, and no `slug`. It calls better-auth's `/api/v1/auth/organization/update` exactly as `update_organization` does (the record's id as `organizationId`, the fields under `data`), and it is gated on `multiOrgEnabled` like the other organization actions. Because the request carries no slug, the organization keeps its slug. It is declared before `change_slug`, so on the record header it takes the third inline slot and `change_slug` moves into the `⋯` overflow menu.

`update_organization` (name, slug and logo, list row only) and `change_slug` are unchanged.

`@objectstack/spec` books the new action in `PUBLIC_AUTH_FEATURES.multiOrgEnabled.gatedInputs`, beside `update_organization`.

Clause-②: yes
