---
'@objectstack/objectql': patch
---

Clause-②: no

A validation rule that reads `previous` now answers an insert with its own message. On insert the
rule's CEL scope binds `previous` to `null` (there is no prior row), so the guard
`previous == null` decides the insert — the binding a flow's start condition already gets on its
create leg. Before, `previous` was unbound on insert: any reference to it, the guard included,
faulted `Unknown variable: previous`, and a violating insert was refused as `unevaluable` with that
fault instead of the rule's message. The platform's own `validity_window_order` on
`sys_user_permission_set` is the measured case: an inverted grant window now answers
`400 VALIDATION_FAILED` with "Valid Until must be later than Valid From …", not a CEL fault.

The binding is the same for every predicate a write evaluates — a `script` / `cross_field`
condition, a `conditional`'s `when`, a field's `requiredWhen` and an option's `visibleWhen` —
and the validate-only preview judges an insert the same way. No shipped rule's verdict changes:
every rule this repository ships that reads `previous` refused and admitted the same inserts
before and after; only the refusal's reason moved. An update whose prior row is not in hand keeps
`previous` unbound and still fails closed, so `previous == null` never reads an update as an
insert. A rule that reads a column off `previous` with no guard (`previous.stage`) still has no
value on insert and still refuses it; the refusal now names that read and the guard to add —
`previous == null || …` to judge an insert, `previous != null && …` to skip one.
