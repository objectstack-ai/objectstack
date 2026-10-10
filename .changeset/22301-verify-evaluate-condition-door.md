---
'@objectstack/verify': minor
---

feat(verify): the handle gains a door to the automation engine's condition evaluator

Clause-②: yes (widening)

An app's tests can evaluate a flow condition on the booted stack's own evaluator through the in-process handle, so a suite no longer calls the booted kernel's `automation` service by hand for a condition's truth table.

- **`stack.automation.evaluateCondition(condition, variables)`** calls the booted `automation` service's `evaluateCondition`, the method a flow's start gate, its edges and its `decision` branches are decided by. It resolves with the engine's boolean, unchanged. It is for a truth table over variable shapes no write produces.
- **`condition`** takes the shapes the engine takes, and is handed over as given: an envelope (`{ dialect: 'cel', source }`) or a string, which the engine reads as CEL unless it carries a `{var}` hole (the legacy template dialect). The engine's own flow sites hand the evaluator an envelope (a start node's string `condition` and a `decision` branch's `expression` are wrapped as `{ dialect: 'cel', source }`, and an edge's condition already is one), so pass the envelope to model any of them.
- **`variables`** is a plain object. Each own key becomes one entry of the `Map` the engine takes: `{ record, previous }` binds `record` and `previous`.
- **Refusals are not the handle's.** A condition the engine cannot evaluate rejects with the engine's own error, never `false`. On a stack with no automation service it rejects with the kernel's own `SERVICE_NOT_REGISTERED` error, whose `serviceName` is `'automation'` (`isServiceNotRegisteredError` from `@objectstack/core` answers `true`). Boot with `automation: true`, or have the app declare `requires: ['automation']`. No error code is added.
