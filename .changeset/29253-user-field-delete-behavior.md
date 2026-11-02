---
'@objectstack/objectql': patch
---

fix(objectql): a `user` field's declared `deleteBehavior` takes effect when the user is deleted (#29253)

Clause-②: no
Metadata-protocol: none

A `user` field accepts `deleteBehavior`, but the referential delete walk only read `master_detail`, `lookup` and `tree` fields, so the value did nothing: deleting a user that a `restrict` user field held was not refused, a `cascade` user field did not delete the rows holding that user, and every holder kept the deleted user's id.

- **Now.** A `user` field that declares a `deleteBehavior` joins the walk and reads it as a `lookup` reads its own. `cascade` deletes the rows holding the deleted user. `set_null` clears the field; a `multiple: true` field loses only that member, and an emptied set is `[]`. `restrict` refuses the delete with `409 DELETE_RESTRICTED`, naming the holder's object. A `set_null` on a `required` user field is refused the same way, as on a required `lookup`. A field that names no `reference` still points at `sys_user`, because the type fixes the target.
- **Unchanged.** A `user` field that declares no `deleteBehavior` (the spec's parse adds none) stays out of the walk: deleting the user leaves the field as it was. `lookup`, `master_detail` and `tree` behave as before.
- **Which deletes.** Every user delete: better-auth deletes the user (admin remove-user, self delete-user) through the engine by id, and the generic data routes refuse a caller's own `sys_user` delete. A `restrict` refusal reaches the auth caller as `409 DELETE_RESTRICTED`, and the credential rows deleted before it are rolled back.

Nothing to do for a `user` field that declares no `deleteBehavior`. An app that declared one now gets the behaviour it declared.
