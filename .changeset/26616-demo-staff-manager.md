---
'@objectstack/spec': minor
'@objectstack/plugin-auth': minor
---

feat(spec,plugin-auth): a `demoStaff` entry names its line manager, and the development boot writes it

Clause-②: yes (widening)
Metadata-protocol: added

A `demoStaff` entry declares one optional key, `manager`: the `email` of another entry of the same `demoStaff` list, compared without regard to case. It is named by address because the address identifies an account everywhere the platform provisions one; a display name is a label a person can edit. Before, the entry was strict and refused the key, so a fresh demo's `manager` approval rung reached nobody until someone ran Setup → Users → Set Manager by hand.

`defineStack` (and so `os validate`) refuses, with `STACK_CROSS_REFERENCE_INVALID` 422, a `manager` that is the address of no entry, an entry that names itself, and managers that form a loop. A manager written as a display name is refused at the entry's path, saying it takes an address. `reportsTo`, `managerEmail`, `managerId` (and so `manager_id`) and `supervisor` are pointed to `manager`.

On an `os dev` boot, `@objectstack/plugin-auth` links each declared manager in a second pass, once every entry has its account and still before the application seed runs. Each link goes through the same checks as `POST /api/v1/auth/admin/set-user-manager`. A link is written only when the account has no manager, so a manager someone set by hand is left as it is on every later boot; a manager cleared by hand reads as no manager and is written again. A link that cannot be written (the manager's own entry was not provisioned, or the set-manager checks refuse it) is reported on the boot log under the subordinate's address. `DemoStaffOutcome` gains `managersLinked` and `managersKept`.
