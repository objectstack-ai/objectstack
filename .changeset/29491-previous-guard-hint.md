---
'@objectstack/lint': patch
---

fix(lint): the null-guard message names the guard that holds on an insert for a `previous.` operand

Clause-②: no
Metadata-protocol: none

The publish-time null-guard gate (`os build`, `os validate`, `os lint` and the runtime publish gate) reports an ordering or arithmetic operator applied to a nullable declared field with no `!= null` test in front of it, and tells the author to add one. For a `previous.FIELD` operand that advice alone faults on an insert, where `previous` is itself `null` (on a validation rule, a hook condition and a record-triggered flow's create leg alike). The message for such an operand now ends: guard it with `previous != null && previous.FIELD != null`. The shared sentence before it is unchanged and still reads word for word as the runtime's. Which predicates are refused does not change. Nothing to migrate.
