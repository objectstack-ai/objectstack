---
"@objectstack/lint": patch
"@objectstack/cli": patch
---

feat(lint): warn on seed values outside an object's declared state machine (#3433 follow-up)

#3433 exempts seed writes from the `state_machine` validation rule, so a seeded
status the FSM does not declare is no longer rejected at write time. A field-level
`select` still catches a value outside its `options`, but a `state_machine` on a
free-text field — or a value that is a valid option yet not a declared FSM state —
now sails through silently: the exemption is a deliberate but blind back door.

`validateSeedStateMachine` (a pure `(stack) => Finding[]` rule, run from
`os validate` / `os lint`, symmetric with the replay-safety rule from #3434)
re-adds that safety net at author time. It flags any seed record whose
`state_machine`-governed field carries a value outside the machine's declared
states — the union of `initialStates`, the transition-map keys, and the transition
targets. Advisory (`warning`): the exemption itself is legitimate, so the fix-it
points at either adding the state to the machine or correcting the typo, not a hard
build failure. New rule id: `seed-value-outside-state-machine`.
