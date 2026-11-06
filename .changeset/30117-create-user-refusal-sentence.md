---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): Create User's refusal of its permission set reads as two sentences: no user was created, then the grant's own reason (#30117)

Clause-②: no
Metadata-protocol: none

When the permission set named on `POST /api/v1/auth/admin/create-user` is refused, the answer still says first that no user was created, and now follows with the grant's reason as its own sentence, for example: `The permission set was not assigned, so no user was created. There is no permission set named 'xyz': choose one from the list.` Status, code, `fields` and the rollback (no user is created) are unchanged.
