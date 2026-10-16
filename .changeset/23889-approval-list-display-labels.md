---
'@objectstack/plugin-approvals': minor
---

Clause-②: yes (widening)

feat(plugin-approvals): the approval lists show engine-written display labels, which are the step and flow labels, whom a pending request waits on, the record an action is about, and the slot it was taken as (#23889)

The Requests and Action History lists are generic list views. They show stored columns only, so admins used to read node ids (`manager_review`), `flow:` api names, slot addresses and raw user ids there. The approval engine now writes display columns beside the machine ones, and the list views show those columns. Nothing is removed or renamed. The machine columns (`process_name`, `current_step`, `pending_approvers`, `step_name`, `acted_as`) keep their values, and every query and decision still reads them.

**`sys_approval_request`**, written by `ApprovalService`:

- `process_label`: the flow's label, and `current_step_label`: the Approval node's label. Both are snapshots taken when the request opens, from the labels the flow engine already hands to `openNodeRequest`. Renaming the flow later does not rewrite them.
- `pending_approver_labels`: whom the request waits on, one label per pending slot, joined with `, `. A slot that names a person (a user id, or an email an account carries) gets that account's name. Any other slot (a `position:` or `team:` literal) shows its address. The column is rewritten whenever the slate is written (open, a partial tally, reassign, SLA reassign) and cleared with the slate on every terminal write.
- The list views: `process_label` replaces `process_name` in every view. `current_step_label` replaces `current_step` in `all_requests`, `my_pending` and `submitted_by_me`. `pending_approver_labels` is added to `all_requests` and `my_pending`.

**`sys_approval_action`**: each new row copies these columns from its request:

- `step_label`: the request's step label.
- `object_name` + `record_id`: the request's record pointer (`record_id` declares `referenceVia: 'object_name'`), so a list can name the record.
- `acted_as_label`: `acted_as` labelled the same way as the waiting-on column. It is null exactly when `acted_as` is null.
- The list views: `step_label` replaces `step_name` in `recent`, `all_actions` and `by_actor`. `recent` and `all_actions` add the record pointer and show `acted_as_label` in place of `acted_as`.

The inbox door's `process_label` / `step_label` now read the new columns first. They fall back to the config snapshot for rows opened earlier, so what they serve is unchanged.

**Read security.** Every new value is either a column of the request the row's readers can already read, or a name the approvals door already serves those readers for that request: `pending_approver_names`, and the timeline's names. The names come from the same resolver, under the same system read. The generic data door serves both objects only to the callers the approvals door would serve.

**Rows written before this release** carry null in the new columns. A pending request gets its waiting-on column at its next slate write. Its actions copy the step label from the request's config snapshot. Older action rows have no record pointer, but their record can still be reached through `request_id`. No backfill runs.
