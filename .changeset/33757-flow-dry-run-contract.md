---
'@objectstack/spec': patch
---

feat(spec): `IAutomationService.dryRun`, a dry run of a flow definition that need not be published: once, unarmed, as a named user, against a supplied start, without changing live data (#33757)

Clause-②: yes (widening) — a new optional member on `IAutomationService` and new exported types. No existing member, type or code changes, and an implementation without the member still satisfies the contract.
Metadata-protocol: none

The contract half of #33661 (objectstack-ai/cloud#3309 item 5, option A, ruled by the account owner); #33661 implements it in `@objectstack/service-automation` and `@objectstack/runtime`. The method's doc block states the semantics the implementation owes:

- **Writes are simulated, never made.** `create_record`, `update_record` and `delete_record` report the write they would make (object, operation, target rows, values as computed); a create binds an opaque placeholder id that later reads by id see. No hook, trigger, other flow or audit row runs, since nothing is written.
- **Identity is the named user**, whose own grants the engine resolves, and the run is never elevated, a `runAs: 'system'` definition included. Admission is the by-name start rule (`flowStartRefusal`), judged on the supplied definition against the named user; a refusal answers `status: 'refused'` with `PERMISSION_DENIED`, before any node runs.
- **Approval nodes and waits stop the run** (every node type whose descriptor declares `supportsPause: true`), reported with who would be asked, what would resume it, the screen, or the flow it would start. Nothing is created or scheduled.
- **Side effects outside the data** (`notify`, `http`, `connector_action`, `script`, `save_notice`) are never sent, only reported with their computed payload.
- **Unarmed and unregistered**: never registered or listed, the trigger never armed, no run persisted, one pass with no retry. An invalid definition throws what `registerFlow` throws.

**In-process APIs.** `@objectstack/spec/contracts` exports `FlowDryRunOptions`, `FlowDryRunResult`, `FlowDryRunStatus`, `FlowDryRunRefusalCode`, `FlowDryRunStep` and the step types it unions over (`FlowDryRunStepBase`, `FlowDryRunRouteStep`, `FlowDryRunAssignmentStep`, `FlowDryRunDecisionStep`, `FlowDryRunReadStep`, `FlowDryRunWriteStep`, `FlowDryRunOutboundStep`, `FlowDryRunStopStep`). All additive.
