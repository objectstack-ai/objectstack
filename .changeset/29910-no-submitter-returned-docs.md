---
'@objectstack/spec': patch
---

docs(approvals): say how a request with no submitter leaves the `returned` state

Clause-②: no
Metadata-protocol: none

- **`@objectstack/spec`: comment text only.** The `IApprovalService` docblocks on `recall`, `sendBack` and `resubmit` now state the path for a request with no submitter (its run's trigger resolved no user): nobody can recall it once it is `returned`, a system-context `resubmit` is its way out, and the next round opens `pending` with no submitter, where the system or the override actor may recall it. The `resubmit` docblock now names the system context it already admits. No key, type, schema or behaviour changes.
