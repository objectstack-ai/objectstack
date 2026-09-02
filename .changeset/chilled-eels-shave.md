---
'@objectstack/objectql': patch
---

A `state_machine` rule's refusal now carries `constraint` and `value` alongside an **author-written** `message`, not only alongside the built-in one (#14311).

`checkStateMachine` emitted the full field-error envelope — `field`, `code`, `message`, `label`, `constraint`, `value` — when the rule left its message empty, but dropped `constraint` and `value` the moment the rule declared one. Since `ValidationRuleSchema` **requires** `message` on every rule, the machine-readable half was in practice reachable only by declaring `message: ''`: every normally-authored state machine refused writes with no way for a client to learn *which* states are legal.

A create form that wants to offer exactly the declared `initialStates`, or a detail page that wants to grey out illegal transitions, had to parse the author's prose or keep a second copy of the state machine.

Now both paths emit the same envelope:

- insert — `constraint: { allowed: 'planned' }`, `value: 'active'`, `code: 'invalid_initial_state'`
- update — `constraint: { from: 'draft', to: 'approved' }`, `code: 'invalid_transition'`

The author still owns the wording; only the facts beside it are restored. Nothing about which writes are refused changes, and `constraint` / `value` are already declared on `FieldValidationError` (mirroring `FieldErrorSchema`), so no consumer contract widens — REST ships the same `400 VALIDATION_FAILED` envelope with the fields it always declared.
