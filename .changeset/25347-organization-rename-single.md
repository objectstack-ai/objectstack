---
'@objectstack/platform-objects': patch
---

fix(platform-objects): a single-organization deployment can rename its organization, and the organization record says which timezone wins

Clause-②: yes (widening)
Metadata-protocol: none

- **`sys_organization.rename_organization`** (name and logo, no slug) is gated on the organization capability (`features.organization`) instead of `features.multiOrgEnabled`, still for the grades `organization/update` admits (owner, admin). Under `single` it was hidden, and the generic edit form keeps `name` readonly, so the one organization could never be renamed from "Default Organization". A rename sends no slug, so the slug the default-organization bootstrap finds the row by is kept. `update_organization`, the slug door, stays multi-organization only.
- **`sys_organization.name`'s help** says it is changed with Rename Organization, and that the product name the console shows is set in Settings → Branding.
- **`sys_organization.timezone`'s help** no longer says date boundaries are computed in it: nothing on the platform reads the column. It now says the value is kept as the root default for business units, changes no date calculation today, and that formulas, reports and displayed dates use Settings → Localization → Default timezone.
