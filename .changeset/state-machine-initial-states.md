---
"@objectstack/spec": minor
"@objectstack/objectql": minor
---

feat(validation): `state_machine.initialStates` enforces the FSM entry point on INSERT (#3165)

A `state_machine` rule's `transitions` only governs UPDATE — on INSERT the rule
was a no-op, and a `select` field permits ANY declared option as the initial
value. So a record could be born mid-flow (created already `approved`), skipping
the whole state machine. This was the gap #3043's mitigation idea assumed didn't
exist (declared ≠ enforced, ADR-0049).

`state_machine` rules gain an optional `initialStates: string[]` — the states a
record may be CREATED in. When set, an insert whose (defaulted) state-field value
is outside the list is rejected server-side with `code: 'invalid_initial_state'`.
Omit it to keep the legacy behavior (no initial-state check on insert). A missing
/ empty value is left to required-validation; `transitions` (UPDATE) is
unaffected. Enforced at the same `evaluateValidationRules(..., 'insert')` seam the
engine already runs after field defaults.
