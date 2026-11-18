---
'@objectstack/verify': patch
'@objectstack/cli': patch
---

feat(verify): run a flow locally and report its node trace before it is submitted

Clause-②: yes (widening: a new `os verify --flow` option, and new `@objectstack/verify` exports)
Metadata-protocol: none

`os verify --flow <name>` runs one flow once on a fresh in-memory boot of the app and reports what the engine did: each node's status as the run's log records it, the first failure with its code and the node named, and every write the run made.

- The run starts the way production starts it. A record-change flow is fired by its own trigger: the run writes the record `--flow-record '{"field":"value"}'` names as the dev admin (inserted for a create or write leg; seeded and saved unchanged for an update leg; seeded and deleted for a delete leg). A schedule, an API-triggered flow or a flow declared `runAs: 'system'` is started with no caller, as its trigger starts it. Any other flow goes through the trigger route as the dev admin, with `--flow-input '{...}'` as its params.
- A node whose type no installed plugin runs is named, whether the run reached it or not. A flow whose trigger never binds is reported with the trigger and the engine's reason, and is not run.
- The run writes to the in-memory database the boot creates and nowhere else: a write to an object bound to any other datasource is refused before that datasource's driver is called, and the node that made it fails naming the object and the datasource. Nodes that call out (`http`, `connector_action`, `notify`, `script`) are not confined and run for real.
- A failed run, a missing executor, an unbound trigger, a record-change flow given no record, and a write refused outside the ephemeral stack each fail `os verify`. A run its start condition skipped, or one that paused at a screen, wait or approval, is reported and does not.
- `--json` carries the report as `flowRun`.

New exports from `@objectstack/verify`: `runFlowProof`, `formatFlowRunReport`, and the `FlowRunRequest`, `FlowRunVerdict`, `FlowRunStart`, `FlowRunStep`, `FlowRunWrite`, `FlowRunFailureKind`, `FlowRunFailure`, `FlowRunTrigger` and `FlowRunReport` types. Nothing that ran before changes.
