---
"@objectstack/spec": patch
"@objectstack/plugin-approvals": patch
---

fix(approvals): return decision attachments as file values, not "[object Object]" (#3504)

`sys_approval_action.attachments` is a `Field.file`, so the column **stores an
opaque `sys_file` id** (ADR-0104 D3 — the stored form of every media field). The
ObjectQL read path resolves that id into its expanded
`{ id, name, size, mimeType, url }` form on the way out. But `rowFromAction`
mapped the column with `.map(String)`, collapsing each expanded value to the
literal string `"[object Object]"`. Every `listActions` consumer (the approval
inbox timeline) then received garbage: the attachment chip had no filename and
its id was `"[object Object]"`, so opening it 404'd.

- `ApprovalActionRow.attachments` is now `ApprovalActionAttachment[]` — the
  expanded file value plus its id, so a consumer can label and open an
  attachment without needing read access to the system `sys_file` object (which
  regular approvers do not have).
- Three read forms are accepted: the expanded value (the normal case), a bare id
  (nothing to expand it into — storage service absent, file not committed), and
  a legacy inline blob written before file-as-reference (`file_id` /
  `mime_type`), until the backfill converts it. The id test reuses the
  platform's `isFileIdToken`, so this and the engine's read resolver cannot
  disagree about what counts as an id.
- The decision *input* (`ApprovalDecisionInput.attachments`) is unchanged — it
  still takes fileId strings, which is also exactly what the column stores. Only
  the read shape changed.
