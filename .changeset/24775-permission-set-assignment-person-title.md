---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a permission-set assignment is titled by the person's name, not the raw user id

Clause-②: no (no accept set moves: the value a declared formula computes on read changes; no key, column, write path or authorization answer moves)

- **Before.** `sys_user_permission_set`'s record title (`display_title`, the object's `nameField`) composed the stored user id, so Setup's list of a user's permission sets and the assignment's record page read like `ISu3jHPIrdgD45L1rrC2FuE7DIcsk2ap → crm_edit`.
- **Now.** The title names the person: the user's `name`, or their `email` where the name is blank, then the set, as in `Alice Liddell → crm_edit`. The name is read one hop through `user_id`, under the reader's own permissions (the ADR-0079 addendum on one-hop formula titles). A reader who may not read that user, and a grant whose user no longer exists, get no title (`null`), never the user's name or email; a renderer then falls to the object's `titleFormat`, `{user_id} → {permission_set}`. No column is stored, and the title is still neither sortable nor searchable.
- **Cost.** A read of `sys_user_permission_set` that computes its formulas (no field projection, or a projection naming `display_title`) now issues one batched `sys_user` read per page. The grant read every authenticated request makes is not one of them: it names the columns it decides on, so it computes no title, and the request's authorization prelude stays 8 reads in 4 round trips for a principal holding a direct grant.
