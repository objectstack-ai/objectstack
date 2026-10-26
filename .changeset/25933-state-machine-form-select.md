---
'@object-ui/core': patch
'@object-ui/plugin-form': patch
'@object-ui/plugin-grid': patch
---

feat(ui): an edit form's `state_machine` select offers only the moves the server accepts

Clause-②: yes
Metadata-protocol: none

A record whose `status` is governed by an error-severity `state_machine` validation used to offer every option in the edit form, and the server refused the invalid ones only after submit, without naming the allowed next states. The form now offers the persisted value plus the states the machine declares as its next moves.

- **`@object-ui/core`:** new export `stateMachineNextValues(objectSchema, fieldName, currentValue)`. It returns the set of values a field may move to from its persisted value, or `null` for "don't constrain". It narrows only where the server refuses: rules with `severity: 'error'` (the default), `active` not `false`, and `events` covering `update` (the default covers it). A from-state the transition map does not declare stays unconstrained, and several applicable rules on one field intersect. It is a read of the declared transition map for choice controls, not a client-side rule engine.
- **`@object-ui/plugin-form`:** `gateFormFields` takes an optional `previousValues` (the persisted record) and narrows each single-value select governed by such a machine, on both the entry's own `options` and its `field.options`. Every layout passes its persisted record: the simple, modal, drawer, tabbed, split and wizard forms. The from-state is the stored row, never the live form value. A create form is unconstrained, and the current value always stays offered. Options outside the reachable set are left out rather than drawn disabled.
- **`@object-ui/plugin-grid`:** `stateMachineNextValues` is now re-exported from `@object-ui/core`. The grid's inline editor therefore stops narrowing on a `warning` / `info` machine, an inactive one, or one whose `events` leave out `update`. The server never refuses those moves, so the editor now offers every option for them.
