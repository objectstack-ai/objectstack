---
'@object-ui/fields': patch
---

fix(fields): a `user` field's person object is always `sys_user` — the user cell and the person picker no longer read an authored `reference`

Clause-②: no
Metadata-protocol: none

A `user` field's target is a constant of its type: `@objectstack/spec` refuses a `user` field whose `reference` names any object but `sys_user`, and `referenceTargetOf` resolves every `user` field to `sys_user` whatever the field carries. The console now agrees with it in two places:

- **`UserCellRenderer`** (read-only cell): the field-level read gate on the person's name and avatar is keyed by `sys_user`. A stored object saved before the spec refused a foreign `reference` (for example `reference: 'crm_member'`) used to gate the cell by that object's policy; it is now gated by the `sys_user` policy, the object the runtime expands the field into.
- **`UserField`** (person picker): the picker targets `sys_user` even when the field carries a foreign `reference`, so it offers users, matching what the runtime stores and resolves.

What to do: nothing for a spec-valid `user` field (no `reference`, or `reference: 'sys_user'`). A field that links to another object is a `lookup`.
