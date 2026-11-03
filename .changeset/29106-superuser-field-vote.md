---
'@objectstack/plugin-security': patch
'@objectstack/core': patch
---

fix(plugin-security): a permission set holding View All / Modify All on an object reads and edits every field of it, so an app's field mask no longer hides fields from platform admins

Clause-②: no
Metadata-protocol: none

An app permission set could not withhold a platform object's fields from its own members without withholding them from platform admins too. Field permissions merge most-permissively, but only sets that declare a field entry voted. `admin_full_access` grants every object through its `'*'` super-user bits and declares no field entries, so it cast no vote, and an app set's `readable: false` hid the field from any admin who also held the app set. Lists dropped the columns, sorting or filtering on them was refused 403, and Setup screens rendered them empty.

Now, per ADR-0066 D2 ⑧ as amended (ruling of record 6573563853), a set that holds the super-user bypass on an object votes on every field of that object in the field merge:

- **`viewAllRecords` votes `readable: true`.** It never grants an edit.
- **`modifyAllRecords` votes `readable: true` and `editable: true`.**
- **Who counts as holding it is the row-level answer.** It is the same rule `PermissionEvaluator.superuserBypassSets` applies: the set's own entry for the object if it has one, otherwise its `'*'` wildcard. The field merge and the row bypass now read it through one function, `holdsSuperuserBypass` (`@objectstack/core`).
- **Every reader agrees.** That covers list projection, record read, the sort and filter gate, the field-level write gate, `GET /auth/me/permissions` (`fields`) and `POST /security/explain`.
- **Union without deny is otherwise unchanged.** A caller who holds the app set and no super-user set on the object is still masked. A field's `requiredPermissions` capability gate still applies to everyone.

**What to check after upgrading.** A permission set that holds `viewAllRecords` or `modifyAllRecords` on an object and also declares `readable: false` (or `editable: false`) on that object's fields no longer hides those fields from its own holders. To keep a field from someone, grant them the object without View All / Modify All and withhold the field there.
