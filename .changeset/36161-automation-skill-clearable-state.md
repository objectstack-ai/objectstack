---
'@objectstack/skills': patch
---

docs(skills): `objectstack-automation` teaches that clearing a state-machine field is a transition to `''`, and how to make a state clearable

Clause-②: no
Metadata-protocol: none

The state-machine notes in `references/state-machines-and-approvals.md` gain one entry: an update that sets the state field to `null` or `''` is judged from the stored state as a transition to `''`. A state meant to be clearable lists `''` in its targets, e.g. `paused: ['open', '']`; from any other state the machine lists, the clear is refused with `invalid_transition`, and the refusal's `constraint` carries `to: ''` beside `from`. A stored state that is not a key of `transitions` stays unguarded, as before.

This is the behaviour `@objectstack/objectql` already ships; the skill only teaches it.

Paid for by deletion in the same file, with the token ceiling unchanged (5936): the wording of the section's intro and of six neighbouring notes was shortened, each keeping its fact — one rule per field, `initialStates` gating insert, guards and reactions living outside the machine, the introspection route, the unguarded unlisted `from` state, and the `record.<field>` scope of sibling predicates.

Ride-along, same theme: in the `objectstack-data` eval `objects-fields-relationships.json`, the `employee` lifecycle case's expected answer declared a `state_machine` with `transitions` only, which publish refuses for a machine that runs on insert (`state-machine-no-initial-states`). It now declares `initialStates: ['draft']` with the reason, and the case's `must_contain` requires `initialStates`.
