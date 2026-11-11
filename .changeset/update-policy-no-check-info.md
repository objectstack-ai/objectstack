---
'@objectstack/lint': patch
---

feat(lint): note a caller-keyed update policy that declares no check, at info tier

Clause-②: yes (widening)
Metadata-protocol: none

New rule `security-update-policy-no-check`, severity `info`. It reports a row-level policy whose `operation` is `update` or `all`, whose `using` compares a column other than `created_by` with `current_user.id` (`owner_id == current_user.id`, an assignee), and which declares no `check`. The rule it states: a row-level policy with no `check` also admits new rows the ownership floor admits; declare `check` to bound what an update may write. Its fix line states the side effect: declaring `check` on any applicable policy takes the USING-only siblings and the floor out of the check, so a creator who is not the owner loses update unless a `check` admits them. `os explain security-update-policy-no-check` carries the composition (ADR-0058 D4).

The finding refuses nothing. It is `info` tier, and `--strict` promotes warnings, never an `info` finding, so neither `os lint --strict` nor `os validate --strict` fails on it. A policy keyed on `created_by` alone, a policy that declares a non-blank `check`, a `select`, `insert` or `delete` policy and a disabled policy are not reported. The rule id is exported from `@objectstack/lint` as `SECURITY_UPDATE_POLICY_NO_CHECK`.
