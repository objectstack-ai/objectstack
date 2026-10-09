---
"@objectstack/plugin-approvals": patch
---

fix(plugin-approvals): `sys_approval_request` declares its per-caller `viewer` block under `attachedOnRead`, so the shared validator accepts the object's own action predicates (#22211, #22387)

`sys_approval_request` ships eight action `visible` predicates that read `record.viewer.can_act`, `record.viewer.can_override` or `record.viewer.is_submitter`. `viewer` is the block the approvals service attaches to every request it serves through `listRequests` and `getRequest`, computed from the caller. The object never declared it, so `os build` / `os validate` refused all eight with ``unknown field `viewer` on `sys_approval_request` ``, and the object save door's authoring gate refused a save of the shipped body the same way.

The object now declares `attachedOnRead: { viewer: { can_act: 'boolean', can_override: 'boolean', is_submitter: 'boolean' } }`. The eight predicates pass the build and the save door's gate. A misspelt leaf (`record.viewer.can_actt`) is still refused, and the refusal names the three declared leaves.

Unchanged: who sees which decision button. `viewer` is computed as before and served on the same two reads only; the generic data door, a record-change flow's `record` and a flow action's subject row do not carry it. The served object definition gains the `attachedOnRead` key. The exported `SysApprovalRequest` type resolves to the same type.
