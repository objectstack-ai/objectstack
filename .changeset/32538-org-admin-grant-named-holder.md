---
'@objectstack/plugin-security': patch
---

fix(plugin-security): an organization administrator's grant that names a package is judged on that holder alone

Clause-②: yes (widening)
Metadata-protocol: none

The organization-boundary check of a direct grant (`sys_user_permission_set`) judged the holder the grant names in `permission_set_package`, and then the bare name as well, on the premise that the write seam re-stamps the column from the name. Since #32164 the seam keeps a package the writer names when it holds the name and refuses one that does not, so the bare name is never what such a grant stores. The second judgement is dropped: a grant that names a package is judged on that holder alone; a grant that names none is judged by its name, as before.

FROM → TO (one moved answer): an organization administrator granting a permission set two packages hold, naming the in-boundary holder, FROM refused 403 PERMISSION_DENIED ("held by 2 packages … names no package") TO admitted. Unchanged: naming a holder outside the boundary, naming no package (refused, naming both holders), naming a package that holds neither, every one-holder grant, and every removal. A second holder of a name is registrable only after the ADR-0150 narrowing, so no environment answers differently today.
