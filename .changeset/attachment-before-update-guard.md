---
"@objectstack/service-storage": patch
---

**Behaviour change (tightening):** updates of `sys_attachment` rows are now authorization-gated, where they previously ran with **no record-level check at all** (#10091).

`installAttachmentAccessHooks` gated insert (parent-edit access, `uploaded_by` server-stamped) and delete (uploader-or-parent-editor), but registered **no `beforeUpdate` hook** — so under the default member permission sets (wildcard CRUD, no row scoping) any member could rewrite any attachment row: re-point `parent_id` at a record they cannot read, or rewrite `uploaded_by` and then walk through the delete gate's uploader shortcut. The `sys_comment` kit — explicitly derived from this one — has gated update with the same rule since #4630; the source kit was missing the limb its derivative copied.

The new `beforeUpdate` gate narrows the accept set as follows; if a currently-working update starts failing, the caller lacked rights the other two verbs already required:

- **Row rule:** the caller must be the attachment's uploader OR hold edit on its parent record (`ISharingService.canEdit`; degrades to caller-scoped parent READ visibility when no sharing service is present). A multi-row update requires EVERY matched row to pass. Refusals are HTTP 403 with the **standard catalog code `RECORD_NOT_ACCESSIBLE`** (ADR-0112: generic permission conditions take the catalog — the same envelope the comment kit's update gate emits; the insert/delete gates keep their grandfathered `ATTACHMENT_*` codes).
- **Re-point rule:** an update that changes `parent_object`/`parent_id` must additionally satisfy the attach rule on the NEW parent (edit access, read visibility in degraded mode) — 403 `ATTACHMENT_PARENT_ACCESS` otherwise, and a re-point half that names no record (`null`/empty) is refused rather than left to validation.
- **Unscoped shape:** an unscoped `multi: true` update (no `where` at all) is refused outright via the `dispatchUnscopedMultiWrite` whole-operation dispatch (#9974), mirroring the delete verb's #4757 refusal. The explicit match-all `where: {}` is still accepted and authorized per row.

System-context operations and context-less programmatic calls on bare kernels bypass the gate exactly as the insert/delete gates do. `uploaded_by` is deliberately not re-stamped on update: the caller is already verified as uploader or parent editor before the write proceeds, so the rewrite-then-uploader-delete escalation is closed by the row rule itself.
