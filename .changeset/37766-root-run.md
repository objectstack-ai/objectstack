---
'@objectstack/service-automation': patch
'@objectstack/plugin-approvals': patch
---

feat(automation): every run of a tree is handed its root run, and each approval request records it in columns of its own

Clause-②: yes (widening)
Metadata-protocol: none

ADR-0162 Execution item 7, "The root run". A `subflow` body or a `map` item knew only its immediate parent (`$parentRunId`), so nothing could tell which runs, and which requests, belong to one whole approval.

- **`@objectstack/service-automation`.** The engine stamps every run's context with its root run, `$rootRun`: `{ runId, flowName, object, startedAt }`, the run the tree was started on, its flow's key, the object of its record (`null` for a record-less start, never a `map` item's own object) and when it started. A run with no parent is its own root, also on each retry attempt; a child carries its parent's over, at any depth, and the stamp rides every suspension. New: `AutomationEngine.rootRunOf(context)`, which answers it, and the `RootRun` type. A run parked before this release carries none and gets one when it is resumed, derived from its links to its parents, before the suspension is consumed: a parent the store cannot read refuses that resume with `STORE_UNAVAILABLE` (nothing consumed, retry verbatim), and a parent that is no longer parked leaves the run with no root run, said once at `warn`, while the run goes on.
- **`@objectstack/plugin-approvals`.** The approval node hands the root run to `openNodeRequest` (new optional `rootRun` input, type `ApprovalRootRun`), and each request records `root_run_id` and `root_run_started_at` as it opens, two new read-only columns on `sys_approval_request` with an index on `(root_run_id, object_name, record_id)`. On an engine that hands root runs but has none for the run (the derivation above could not read the run's tree whole), the approval step does not open: the node fails the run with a message that says the approval cannot be placed. An automation service without `rootRunOf` leaves the columns empty, as before.

Nothing to migrate. The columns are added by schema sync; requests opened before this release keep both empty.
