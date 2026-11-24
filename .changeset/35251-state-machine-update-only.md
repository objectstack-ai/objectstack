---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

fix(lint): `state-machine-no-initial-states` judges only state machines that run on insert

Clause-②: yes (widening)
Metadata-protocol: added

The publish-time rule `state-machine-no-initial-states` now refuses an active `state_machine` validation with no (or an empty) `initialStates` only when the machine runs on insert: its `events` include `insert`, or are left to the default `['insert', 'update']`. The engine runs a rule only on the write contexts its `events` name, so a machine declared `events: ['update']` (or `events: []`) never runs on create and never reads `initialStates`. Such a machine is accepted at publish and by `os validate` again, with no `initialStates`; adding one to satisfy the rule produced metadata the runtime ignores. A machine that runs on insert without `initialStates` is still refused, with the same fix.

`@objectstack/spec` changes only the description of a state machine validation's `initialStates`, which now says the rule judges a machine that runs on insert.
