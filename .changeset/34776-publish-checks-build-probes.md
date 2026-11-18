---
'@objectstack/lint': minor
'@objectstack/metadata-protocol': minor
'@objectstack/service-automation': minor
'@objectstack/spec': minor
---

feat(lint): five publish-time checks for metadata that passes the schema and does nothing at run time, and four build probes over what landed

Clause-②: no (narrowing: four publish-time refusals of metadata the schema accepts today)
Metadata-protocol: narrowed
Skills-docs: follow-up #35245

<!-- adr-0087: registered publish-refuses-metadata-the-runtime-ignores -->

Five authoring rules join the registry the runtime publish gate and `objectstack validate` / `lint` / `compile` run. Each finding names its fix.

- `flow-node-type-no-executor` (error): a flow node whose `type` no executor in this deployment runs fails every run with `NO_EXECUTOR`. Judged only against the automation engine's SEALED node-type vocabulary, which the publish gate reads from the new `AutomationEngine.getSealedNodeTypeVocabulary()` (it answers `undefined` until `sealNodeTypeVocabulary()` ran at `kernel:bootstrapped`). The CLI does not know which plugins a deployment loads, so it judges nothing here.
- `flow-approval-decision-unrouted` (error): an `approval` node whose decision out-edges are not labelled exactly `approve` and `reject` runs every out-edge for a decision no label claims, so the approving and the rejecting branch both run.
- `flow-http-timeout-missing` (warning): an `http` node with no positive `config.timeoutMs` and no positive node-level `timeoutMs` waits on a slow upstream for as long as the connection stays open; the engine arms no default timer. A `durable: true` node, which does not wait on the endpoint, is not reported.
- `state-machine-no-initial-states` (error): an active `state_machine` validation without `initialStates` (or with an empty list) lets a record be created already in any state. Add `initialStates`.
- `action-no-object-binding` (error): a standalone action that declares `locations` but no `objectName` binds to no object, so its button never renders. Set `objectName`, or write `locations: []` for a headless action.

What was accepted before and is refused at publish now: a flow with an unrouted approval decision or a node type the deployment cannot run, a state machine without `initialStates`, a placed action with no object. The fix for each is in the finding.

Four post-publish build probes report, as warnings on the publish receipt, what the person will see: `widget_empty_result` (a dashboard card whose real query reads only zeros), `rollup_never_computed` (a roll-up blank on every parent that has children), `seed_reference_unresolved` (a landed sample record whose reference names no row in the publishing organization, so its page shows a reference to nothing) and `flow_connector_action_unresolved` (a `connector_action` step naming a connector or action this environment does not serve). Each carries its sentence for the person in every platform locale. `RunBuildProbesOptions` gains `automation` and `packageId`; the publish passes the automation engine's connector lookups and the publishing package.

New exports: `@objectstack/lint` adds `validateFlowNodeExecutors`, `validateInertObjectDeclarations`, `validateActionObjectBinding`, their finding types, and the rule ids `FLOW_NODE_TYPE_NO_EXECUTOR`, `FLOW_APPROVAL_DECISION_UNROUTED`, `FLOW_HTTP_TIMEOUT_MISSING`, `STATE_MACHINE_NO_INITIAL_STATES`, `ACTION_NO_OBJECT_BINDING`; `@objectstack/metadata-protocol` adds the `ProbeAutomation` type; `@objectstack/service-automation` adds `AutomationEngine.getSealedNodeTypeVocabulary()`. `@objectstack/spec` changes only descriptions: those of `RuntimeBuildIssueSchema`, and that of a state machine validation's `initialStates`.
