---
"@objectstack/spec": patch
"@objectstack/plugin-approvals": patch
---

fix(approvals): return decision attachments as file descriptors, not "[object Object]" (#3504)

The `sys_approval_action.attachments` file field stores rich descriptors
(`{ id, name, url, mimeType, size }`), not bare fileId strings — a fileId passed
to the decision is resolved to a full descriptor on write. But `rowFromAction`
mapped the column with `.map(String)`, collapsing each descriptor object to the
literal string `"[object Object]"`. Every `listActions` consumer (the approval
inbox timeline) then received garbage: the attachment chip had no filename and
its id was `"[object Object]"`, so opening it 404'd.

- `ApprovalActionRow.attachments` is now `ApprovalActionAttachment[]` — the
  descriptor carries `id` + display `name` + a download `url`, so a consumer can
  label and open an attachment without needing read access to the system
  `sys_file` object (which regular approvers do not have). A bare-string fileId
  still normalizes to `{ id }` for safety.
- The decision *input* (`ApprovalDecisionInput.attachments`) is unchanged — it
  still takes fileId strings. Only the read shape changed.
