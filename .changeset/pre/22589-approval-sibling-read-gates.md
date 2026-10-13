---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): the generic data door serves `sys_approval_action` and `sys_approval_approver` rows by their request's visibility

Clause-②: no

A read of a request's two child tables through the generic data door (`find`, `findOne`, `count` and `aggregate`, so the REST data routes, the export route, the MCP data tool and every other engine read) now returns only the rows whose request the approvals door (`/api/v1/approvals/*`) serves the same caller:

- `sys_approval_action`, the decision log (actor, decision, comment text);
- `sys_approval_approver`, the pending-approver index.

Before this, a deployment that granted read on either object served every row of the organization on that door, including the decision log and comment text of requests the caller does not take part in.

- **One rule for both doors, and for all three tables.** The gates ask the approvals service the same question the `sys_approval_request` gate asks, keyed by the row's `request_id`: the request's submitter, its current approvers and those who acted on it see its rows; an administrator holding the approval override sees every row; and, read-only, on an object named in `recordReaderVisibleObjects`, a reader of the record sees its request's rows on a read that names the request (`request_id`) or the row (its id). The published `ApprovalService` type is unchanged.
- **The record page's Timeline keeps its readers.** A request's Timeline (a list of `sys_approval_action` keyed on `request_id`) serves the rows `listActions` serves the same caller; a row read by id is served exactly when a decision attachment on it would be (`authorizeFileRead`, which now shares the gate's read of the row's request).
- **Absence, not refusal.** A row the caller may not see answers a by-id read exactly as a missing one does, `404 RECORD_NOT_FOUND`. A list's `total` and a grouped count are narrowed like its rows. A failed visibility answer denies the read and logs a warning.
- **Unchanged.** The approvals door, an administrator's view, and the approval engine's own reads. A deployment that grants no read on either object still answers `403`.
- The record-reader tier no longer anchors on a row of either table, even when `recordReaderVisibleObjects` names it, as it already never anchored on `sys_approval_request`.
