---
'@objectstack/plugin-approvals': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

Deleting a record whose approval is still pending now ends the flow run that
was waiting on it. The run is cancelled in the same step that voids the
approval request, with the reason that the record it is about was deleted:
neither the `approve` nor the `reject` branch runs. Before, the run stayed
paused forever, looking exactly like a run still waiting for a decision.

- When the approval sits inside one or more `subflow` nodes on the same
  record, every run up that chain is cancelled too, deepest first. No subflow
  parent is resumed (that would read as the subflow having completed).
- When the run is one item of a batch (`map`), the batch is woken and goes on
  to its next item, recording the deleted one as cancelled — the same as a
  withdrawal during a revision window.
- The delete is never refused or failed for this. A run that cannot be
  cancelled stays paused and is named in the warning, as before.
- Runs left paused by deletes made before this release are not cleaned up.
  To find them, look for approval requests with status `cancelled` and cancel
  reason `record_deleted`: each names its flow run, which an administrator
  cancels by hand.

`ApprovalService.cancelForDeletedRecord` answers a new `cancelledRuns` list;
`suspendedRuns` now lists only the runs that could not be cancelled.
