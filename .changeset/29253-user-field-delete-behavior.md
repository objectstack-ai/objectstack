---
'@objectstack/objectql': minor
---

fix(objectql)!: a `user` field's declared `deleteBehavior` takes effect when the user is deleted (#29253)

Clause-②: no (narrowing) — deleting a user that a `user` field declaring `restrict` (or `set_null` with `required: true`) holds is refused with `409 DELETE_RESTRICTED`, where it succeeded before; a declared `cascade` now deletes the rows holding the user, and a declared `set_null` now clears them. Nothing is widened.
Metadata-protocol: semantic

<!-- adr-0087: registered user-field-delete-behavior-enforced -->

**BREAKING** for an app that declares `deleteBehavior` on a `user` field: the declared value now takes effect when the user is deleted.

A `user` field accepts `deleteBehavior`, but the referential delete walk only read `master_detail`, `lookup` and `tree` fields, so the value did nothing: deleting a user that a `restrict` user field held was not refused, a `cascade` user field did not delete the rows holding that user, and every holder kept the deleted user's id.

- **Now.** A `user` field that declares a `deleteBehavior` joins the walk and reads it as a `lookup` reads its own. `cascade` deletes the rows holding the deleted user. `set_null` clears the field; a `multiple: true` field loses only that member, and an emptied set is `[]`. `restrict` refuses the delete with `409 DELETE_RESTRICTED`, naming the holder's object. A `set_null` on a `required` user field is refused the same way, as on a required `lookup`. A field that names no `reference` still points at `sys_user`, because the type fixes the target.
- **Unchanged.** A `user` field that declares no `deleteBehavior` (the spec's parse adds none) stays out of the walk: deleting the user leaves the field as it was. `lookup`, `master_detail` and `tree` behave as before.
- **Which deletes.** Every user delete: better-auth deletes the user (admin remove-user, self delete-user) through the engine by id, and the generic data routes refuse a caller's own `sys_user` delete. A `restrict` refusal reaches the auth caller as `409 DELETE_RESTRICTED`, and the credential rows deleted before it are rolled back.

- **Rows stored before #9784.** Until then the spec's parse wrote `deleteBehavior: 'set_null'` on every field type, `user` included, so an object stored in that era can carry a `set_null` on a `user` field that no author wrote. That value now takes effect: the field is cleared when the user is deleted, and on a `required` field the delete is refused. No conversion rewrites it, because whether the value was meant is the author's to say: the semantic migration entry `user-field-delete-behavior-enforced` lists it for `objectstack migrate meta` and the upgrade guide. Save the object again without the key, or with the value you want.

**The fix.** If you declared `deleteBehavior` on a `user` field only as documentation, remove it or change it to what you want enforced. Nothing to do for a `user` field that declares no `deleteBehavior`.
