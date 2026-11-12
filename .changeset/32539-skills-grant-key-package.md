---
'@objectstack/skills': patch
---

docs(skills): the data skill teaches the permission-set grant's four-column key and when a grant names `permission_set_package`

Clause-②: no
Metadata-protocol: none

`objectstack-data` → `rules/security.md`, "Assigning a permission set to a user", still said one grant per user, set and organization is enforced by a `unique: 'organization'` index, and never named `permission_set_package`. The sentence now states what the platform enforces since a permission set became identified by its package and its name:

- the grant's unique key is `(user_id, permission_set, permission_set_package, organization_id)`;
- a guard index holds grants that name no package to one per user, set and organization, and `driver-memory` builds no such guard;
- a grant names `permission_set_package`, on insert, when two packages hold the set's name; without it that grant is refused `409 RESOURCE_CONFLICT`, and the message names each holder.

Nothing an author writes is accepted or refused differently: the text follows behaviour already shipped, and claims no more than that change declared (the guard is absent on `driver-memory`).

The file does not grow. The four new lines are paid for by deleting restatement in the same file, each fact kept where it already lives: the `enable.apiMethods` bullet (`objectstack-data` SKILL.md, the `apiMethods` row), the lead-in above the `current_user.*` table (the table's own header), a repeated `// in a permission set` comment, the `readonlyWhen` aside on the field-lock choice (`objectstack-data` SKILL.md, the `readonlyWhen` bullet), the `secret` paragraph's "Encrypted-at-rest values" label (the `secret` row of `rules/field-types.md`), and a phrase in the `requiredPermissions` paragraph that repeated its own bold label. The file moves from 15834 to 15828 bytes (3959 to 3957 tokens, ceiling 3959 unchanged) and from 328 to 327 lines.
