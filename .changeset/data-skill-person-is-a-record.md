---
'@objectstack/skills': patch
---

docs(skills): the data skill teaches "the person is a record", a membership key with `valueField: 'id'`

Clause-②: no
Metadata-protocol: none

`objectstack-data`'s security rule now teaches the membership key whose `valueField` is `id`, the roster's own primary key: on an `employee` roster, `my_employee_ids: { userField: 'user', valueField: 'id' }` is the ids of the caller's own employee rows, and a `leave_request` policy reads `employee in current_user.my_employee_ids`. It grants nothing by itself, and a policy that tests it against a column not referencing the roster, or another object's `id`, is refused (`rls-predicate-membership-key-target`). The rule no longer says `valueField` can never be `id`; that was true before the platform change and is corrected here, including the earlier note in this release. A new eval case exercises it. The platform behaviour shipped in `@objectstack/spec`, `@objectstack/lint` and `@objectstack/plugin-security`; this release only teaches it.
