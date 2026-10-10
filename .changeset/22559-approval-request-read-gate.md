---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): the generic data door serves `sys_approval_request` rows by the approvals door's visibility

Clause-②: no

A read of `sys_approval_request` through the generic data door (`find`, `findOne`, `count` and `aggregate`, so the REST data routes, the export route, the MCP data tool and every other engine read) now returns only the requests the approvals door (`/api/v1/approvals/*`) serves the same caller:

- the requests the caller submitted, is a current approver of, or has acted on;
- every request, for an administrator holding the approval override;
- read-only, on an object named in `recordReaderVisibleObjects`, the requests of a record the caller can read, on a read that names that record (`object_name` and `record_id`, or the request's id).

Before this, a deployment that granted read on the object served every request of the organization on that door, including the payload snapshots of records the caller cannot open.

- **One rule for both doors.** The gate asks the approvals service for its own visibility (the same rule `listRequests` and `getRequest` apply), through an in-package handle: the published `ApprovalService` type is unchanged. It is not the activity stream's parent-record gate, which admits every reader of the record: the record-reader tier stays off unless the deployment names the object.
- **Absence, not refusal.** A request the caller may not see answers a by-id read exactly as a missing one does, `404 RECORD_NOT_FOUND`. A list's `total` and a grouped count are narrowed like its rows. A failed visibility answer denies the read and logs a warning.
- **Unchanged.** The approvals door, an administrator's view (Setup → Approvals → Requests), and the approval engine's own reads. A deployment that grants no read on the object still answers `403`.
- The record-reader tier no longer anchors on `sys_approval_request` itself, even when `recordReaderVisibleObjects` names it.
