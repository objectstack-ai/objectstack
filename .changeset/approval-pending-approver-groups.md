---
"@objectstack/spec": patch
"@objectstack/plugin-approvals": patch
---

feat(plugin-approvals): expose per-group membership of pending approvers (objectui#2807)

`per_group` (会签) requests now carry `pending_approver_groups` on the
enriched row — a map from each still-pending approver id to the group key(s)
it fills (e.g. `{ "u_devadmin": ["finance", "legal"] }`). A client can label
each "waiting on" chip with the group it represents instead of showing
duplicate, context-free names.

- Resolved in `attachDecisionProgress` from the same open-time
  `__approverGroups` snapshot the `decision_progress` groups already use, so
  the two never disagree.
- Only the **pending** slots are mapped (a resolved approver has left
  `pending_approvers`), and **synthetic** (unnamed, `#N`) group keys are
  dropped — a `· #0` sub-tag would be noise.
- Absent for non-`per_group` behaviors. Display-only; the engine's
  finalization tally stays authoritative.
- Added to the `ApprovalRequestRow` contract in `@objectstack/spec`.
