---
'@objectstack/spec': patch
'@objectstack/plugin-security': patch
'@objectstack/objectql': patch
---

fix(plugin-security, objectql, spec): the owner, queue and field-write 403s tell the user what was refused, and a forged `created_by` on create is reported instead of dropped silently

Clause-②: yes (widening)
Metadata-protocol: none

The owner-anchor, queue and field-write refusals now carry a `userMessage`, the end user's sentence in their own locale, beside a `code`, status and `message` that do not change. The console shows `userMessage` in place of its generic "no permission" toast, so a user who tries to give a record to someone else, create one for someone else, clear its owner, move it to another queue, or edit a field they may not edit now reads which of these was refused. The sentences come from the operation-message catalog (`errors.record_owner_change_denied`, `errors.record_owner_assign_denied`, `errors.record_owner_remove_denied`, `errors.record_queue_change_denied`, `errors.field_edit_denied`, `errors.field_edit_denied_opaque`, in en, zh-CN, ja-JP and es-ES), so a deployment can override them with a `translation` item. None names a grant or an API name. The field-write sentence names the refused fields by label only when every one of them has a label and the caller can read it; otherwise it names no field. The object-level refusal is unchanged and carries no `userMessage`.

A create that sends an audit column (`created_by`, `created_at`, `updated_by`, `updated_at`) which the audit binder then stamps over now reports it under `droppedFields` with reason `readonly`, as an update already does. The measured case is `created_by`: a forged value was stored as the caller's id with no report, while a forged `organization_id` in the same request was reported. Any other read-only key an app hook writes stays the hook's write and is not reported. A value equal to the stamp adds no row. Nothing stored changes, and `strictReadonlyWrites` still stores the stamp rather than refusing.
