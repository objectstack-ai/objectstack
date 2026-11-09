---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a grant naming no permission set is refused in one line an administrator can act on, and a set's label typed in place of its name is answered with that set's name (#30117)

Clause-②: no
Metadata-protocol: none

A `sys_user_permission_set` write naming no permission set (Setup's grant form, Create User's optional permission set, any non-system grant) used to answer with a paragraph about the column's contract, the security catalog and record ids. It now answers with one line:

- a value that is a set's label (trimmed, any case): `'Repair Technician' is the label of the permission set named 'asset_repair_technician': choose it from the list, or enter 'asset_repair_technician'.`
- a label more than one set carries: the sets are listed, and none is picked;
- anything else: `There is no permission set named 'xyz': choose one from the list.`

The refusal itself is unchanged: `400 VALIDATION_FAILED`, one `reference_not_found` entry at `permission_set`, nothing stored. A label is still never accepted as a name. The catalog is listed only on a refusal, agent ceiling sets are never suggested, and a listing that fails leaves the plain sentence and is reported at `warn`.
