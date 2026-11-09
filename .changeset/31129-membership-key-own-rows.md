---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/plugin-security': minor
---

feat(spec,lint,plugin-security): a membership key may yield the caller's own roster rows (`valueField: 'id'`)

Clause-②: yes (widening)
Metadata-protocol: added

A declared membership key (`ObjectSchema.membershipKeys`) may now name `id`, the roster object's own primary key, as its `valueField`. `current_user.KEY` is then the ids of the signed-in user's own rows of that object, "the records I am". This covers the apps where the person is a record: an HR `employee`, a service-desk `agent`, a portal `customer`.

```ts
// on the employee roster object
membershipKeys: {
  my_employee_ids: { userField: 'user', valueField: 'id' },
}
// in a permission set
rowLevelSecurity: [
  { name: 'own_leave', object: 'hr_leave_request', operation: 'select', using: 'employee in current_user.my_employee_ids' },
]
```

The key yields only rows whose `userField` is the caller, so it grants nothing by itself. What a policy grants with it is the author's choice, as for any other key.

- `os validate`, `os build`, `os lint` and the server's save gate no longer refuse `valueField: 'id'` with `membership-key-value-field-invalid`. They still refuse any other column that is not a `lookup`, `master_detail` or `user` reference. `id` is still no user reference as `userField`.
- `rls-predicate-membership-key-target` treats such a key as holding ids of the roster object itself. A policy may compare it with a column that references the roster, or with the roster's own `id`. A comparison with a column of another object, a non-reference column, or another object's `id` is refused as before.
- The security plugin's roster read projects `id` once for such a key. The set is de-duplicated, bounded by `MEMBERSHIP_KEY_MAX_VALUES` and fails closed over the bound, as before.
