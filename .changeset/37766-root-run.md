---
'@objectstack/service-automation': patch
'@objectstack/plugin-approvals': patch
---

feat(automation): every run of a tree is handed its root run and the run that carries its record, and each approval request records both in columns of its own

Clause-②: yes (widening)
Metadata-protocol: none

ADR-0162 Execution item 7, "The root run". A `subflow` body or a `map` item knew only its immediate parent (`$parentRunId`), so nothing could tell which runs, and which requests, belong to one whole approval.

- **`@objectstack/service-automation`.** The engine stamps every run's context with its root run, `$rootRun`: `{ runId, flowName, object, startedAt }`, the run the tree was started on, its flow's key, the object it was started on (its context's `object`, with or without a record; `null` when it names none, never a `map` item's own object) and when it started. A run with no parent is its own root, also on each retry attempt; a child carries its parent's over, at any depth, and the stamp rides every suspension. Beside it, `$recordRun`: `{ runId, object, recordId }`, the highest run from this one up over which the record does not change, which is the root run or a `map` item run whose item is a record (a `subflow` child, and an item that is not a record, inherit their parent's). New: `AutomationEngine.rootRunOf(context)` and `recordRunOf(context)`, which answer them, and the `RootRun` and `RecordRun` types. A run parked before this release carries neither and gets both when it is resumed, derived in one walk of its links to its parents, before the suspension is consumed: a parent the store cannot read refuses that resume with `STORE_UNAVAILABLE` (nothing consumed, retry verbatim), and a parent that is no longer parked stamps the run `null` on both, said once at `warn`, while the run goes on; a child such a run starts inherits the `null`, and a `null` stamp is not walked again.
- **`@objectstack/plugin-approvals`.** The approval node hands both to `openNodeRequest` (new optional `rootRun` and `recordRun` inputs, types `ApprovalRootRun` and `ApprovalRecordRun`), and each request records `root_run_id`, `root_run_started_at` and `record_run_id` as it opens, three new read-only columns on `sys_approval_request` (in its free-text search set beside `flow_run_id`) with indexes on `(root_run_id, object_name, record_id)` and `(record_run_id)`. A run the engine could not place (the derivation above could not read its tree whole), and any run on an automation service without `rootRunOf`, opens its approval step as before, with the three columns empty. `ApprovalRootRun` and `ApprovalRecordRun` are exported from the plugin's index.

Nothing to migrate. The columns are added by schema sync; requests opened before this release keep them empty.
