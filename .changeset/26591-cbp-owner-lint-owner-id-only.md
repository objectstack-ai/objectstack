---
'@objectstack/lint': patch
'@objectstack/spec': patch
---

fix(lint): `security-controlled-by-parent-owner-policy-without-opt-in` prescribes `ownerMayEdit` only for a policy keyed on `owner_id` (#26591)

Clause-②: no (lint advice is not a contract face; no accepted metadata shape moves)
Metadata-protocol: none

`sharing.controlledByParent.ownerMayEdit: true` admits one caller past a `controlled_by_parent` detail's master gate: the user in the stored row's `owner_id`, on a detail that carries that column. The lint arm used to prescribe the opt-in for any `update` / `all` policy of the form `FIELD == current_user.id`. So an app whose accountable person is its own user field (`owner == current_user.id`) declared the opt-in, lint went quiet, and that user was still refused with `403 requires edit access to its master record`.

- The opt-in is still prescribed, as before, for a policy keyed on `owner_id` on a detail that carries it and has not opted in, and the arm stays silent once it has.
- A policy keyed only on another user field is now flagged whether or not the detail opted in. The verdict says the opt-in admits only the stored `owner_id`. The hint never names the opt-in: it says to key the accountable person on `owner_id`, or drop the policy.
- On a detail with no `owner_id` (`ownership: 'business_unit' | 'org' | 'none'` and no `owner_id` field of its own), the opt-in names nobody. A policy keyed on `owner_id` there gets the same treatment, and the hint says to give the detail an `owner_id` column.
- The runtime gate is unchanged. The rule's `os explain` entry covers both cases. The `ownerMayEdit` evidence line in `@objectstack/spec`'s liveness ledger now describes the narrowed arm.
