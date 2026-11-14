---
'@objectstack/spec': minor
'@objectstack/service-automation': patch
---

feat(spec): a flow run's step log declares the `warnings` and `droppedFields` it already carried

Clause-②: yes (widening) — `ExecutionStepLogSchema` (`@objectstack/spec/automation`) gains two optional members, `warnings` (strings) and `droppedFields` (an array of the data engine's own `DroppedFieldsEventSchema` event). Both reach every published schema that embeds a step log: `ExecutionLogSchema.steps`, and through it `GetRunResponseSchema` (`GET /api/v1/automation/:name/runs/:runId`) and `ListRunsResponseSchema` (the runs list). Nothing that parsed before is refused.
Metadata-protocol: added

The engine has written both members onto a step that ran (`warnings` for a write whose requested fields the data engine legally stripped, `droppedFields` for the structured events behind those warnings), and the run-history routes serve the step as persisted. The published step-log schema named neither, so a reader that parsed a run through it stripped both and could not tell a step that partially did not land from a clean one. `droppedFields` reuses the data engine's event, so there is no second reason vocabulary.

`@objectstack/service-automation`: the engine now copies the two members onto a step only in that declared shape. From a host-registered executor's result, a `droppedFields` element that is not a well-typed drop event is skipped (the same filter the run's terminal `droppedFields` answer already applied), and so is a warning that is not a string; a member with nothing well-typed left is omitted. Before, any value with a truthy `length` was persisted and served as it came. The in-tree write nodes produce well-typed values, so their steps are unchanged.
