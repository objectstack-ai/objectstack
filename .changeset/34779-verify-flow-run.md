---
'@objectstack/verify': patch
'@objectstack/cli': patch
---

feat(verify): run a flow locally and report its node trace before it is submitted

Clause-②: yes (widening: a new `os verify --flow` option, and new `@objectstack/verify` exports)
Metadata-protocol: none

`os verify --flow <name>` runs one flow once on a fresh in-memory boot of the app and reports what the engine did: each node's status as the run's log records it, the first failure with its code and the node named, and every write the run made.

- The run starts the way production starts it. A record-change flow is fired by its own trigger: the run writes the record `--flow-record '{"field":"value"}'` names as the dev admin (inserted for a create or write leg; seeded and saved unchanged for an update leg; seeded and deleted for a delete leg). A flow its own trigger starts is started with no caller, with the context that trigger builds: an API-triggered flow gets `--flow-input '{...}'` as its record and its params (the request body); a time-relative flow gets the `--flow-record` row, seeded first, as its record (the acting organization a sweep can set is not reproduced); a schedule or another `runAs: 'system'` flow gets `--flow-input` as its params. Any other flow goes through the trigger route as the dev admin, with `--flow-input` as its params.
- A node whose type no installed plugin runs is named, whether the run reached it or not. A flow whose trigger never binds is reported with the trigger and the engine's reason, and is not run. A schedule or time-relative trigger left unarmed by the deployment's scheduled-work switch (the default) is not a defect: it is reported as not armed and the flow is still run.
- The run writes to the in-memory database the boot creates and nowhere else: a write to an object bound to any other datasource is refused before that datasource's driver is called, and the node that made it fails naming the object and the datasource. Four outbound node types are not executed: `http`, `connector_action` (with every connector a plugin contributes behind it), `notify` and `script`; a plugin's own node type that calls out under another name is not stood in and runs for real. A run that ends at one of them stops there and the report names it (`outbound_not_run`), in a child flow too; every node before it ran for real. A stop a `try_catch` catches is listed in `outboundStops`, and a later node that fails is still the first failure.
- A failed run, a missing executor, an unbound trigger, a record-change or time-relative flow given no record, and a write refused outside the ephemeral stack each fail `os verify`. A run its start condition skipped, one that paused at a screen, wait or approval, and one stopped at an outbound node are reported and do not.
- `--json` carries the report as `flowRun`.

New exports from `@objectstack/verify`: `runFlowProof`, `formatFlowRunReport`, and the `FlowRunRequest`, `FlowRunVerdict`, `FlowRunStart`, `FlowRunStep`, `FlowRunWrite`, `FlowRunFailureKind`, `FlowRunFailure`, `FlowRunTrigger` and `FlowRunReport` types. Nothing that ran before changes.
