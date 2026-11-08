---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a refused grant holder the caller cannot read is answered as a holder that does not exist

Clause-②: no
Metadata-protocol: none

A non-system write to `sys_user_position` or `sys_user_permission_set` that names a `user_id` the caller's own `sys_user` read does not return is now answered by the engine's reference check, the way every other user reference that caller names is answered: `400 VALIDATION_FAILED` with the engine's `reference_not_found` entry at `user_id`, in the caller's locale. A holder the caller can read is judged on organization membership as before and keeps the membership refusal with its remedy. Which writes are refused is unchanged, and so are the status and the codes: only the field entry a holder the caller cannot read receives is the reference check's. Under the shipped organization administrator's `sys_user` read (its own row and its organization's members), a user outside the organization now receives that entry.
