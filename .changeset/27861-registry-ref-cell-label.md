---
'@object-ui/fields': patch
'@object-ui/plugin-detail': patch
---

fix(fields): a user's Permission Sets and Positions tabs show each set's and position's label, not its api name

Clause-②: no
Metadata-protocol: none

A text field declaring `widget: 'permission-ref'` or `widget: 'position-ref'` (`sys_user_permission_set.permission_set`, `sys_user_position.position`) now has a read face of its own in list and detail cells: it draws the registry label of the stored name (`Organization Admin` for `organization_admin_no_bypass`), with the name on the cell's `title`. The labels come from the catalog the edit picker already lists (`DataSource.listMetadataItems`, `GET /api/v1/meta/:type`), read once per data source and registry type for every cell. A name the catalog does not hold, or holds without a label, still draws as the name, as does every cell while the catalog loads, when it fails, or when no data source can list a registry. A record page's related list now hands a column's declared `widget` to the cell resolution, as the grid already did, so these columns reach the face there.
