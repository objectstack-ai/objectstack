---
'@objectstack/skills': patch
---

docs(skills): the `objectstack-data` security rule states a grant's uniqueness as the declared `unique: 'organization'` index holds it, in place of the retired `permission_set_id` column (#23615)

Clause-②: no

`skills/objectstack-data/rules/security.md`'s grant paragraph closed with "`permission_set_id` is a legacy column: do not write it." The grant object `sys_user_permission_set` no longer declares that column, so a write naming it is refused `400 INVALID_FIELD` as an undeclared field, and the sentence taught an AI author a key the declared shape does not have. The sentence is replaced by the rule the declared shape holds: one grant per user, set and organization, enforced by the join object's `unique: 'organization'` index on (`user_id`, `permission_set`, `organization_id`). The by-name reference — `permission_set` takes the set's `name` — and its refusals are unchanged. No behaviour changes; nothing an author writes changes.
