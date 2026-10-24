---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the organization record says its name is not the product name, and that Localization's timezone is the one in effect

Clause-②: no
Metadata-protocol: none

- **`sys_organization.name`'s help** says it is the organization's own name, and that the product name the console shows is a different setting, set in Settings → Branding.
- **`sys_organization.timezone`'s help** no longer says date boundaries are computed in it: nothing on the platform reads the column. It now says the value is kept as the root default for business units, changes no date calculation today, and that formulas, reports and displayed dates use Settings → Localization → Default timezone.

Both in all four bundles. Nothing stored or served changes meaning.
