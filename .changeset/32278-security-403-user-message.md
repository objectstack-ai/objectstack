---
'@objectstack/spec': patch
'@objectstack/plugin-security': patch
'@objectstack/objectql': patch
---

fix(plugin-security, objectql, spec)!: the owner, queue and field-write 403s tell the user what was refused, and a forged audit column on create is reported, and refused under `strictReadonlyWrites`, instead of dropped silently

Clause-②: yes (narrowing + widening)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes. An in-process create passed `strictReadonlyWrites` that sends an audit column the stamp replaces is refused with the engine's existing `ERR_READONLY_FIELD_REJECTED`, which names the field to the caller; no stored metadata or payload shape changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING.** An in-process `insert` / `insertMany` called with `strictReadonlyWrites: true` that sends an audit column (`created_by`, `created_at`, `updated_by`, `updated_at`) whose value differs from the one the audit stamp stores is now refused with `ERR_READONLY_FIELD_REJECTED` (`drops` reason `readonly`), and nothing is written. Before, the write completed with the stamp in place of the caller's value and said nothing. The option's contract already says it refuses every drop `onFieldsDropped` reports, and this release starts reporting that value. Fix: leave the audit columns out of a strict create, or send the values the stamp would store; a historical import passes `context.preserveAudit` and keeps its values. HTTP callers and writes without the option are not refused.

The owner-anchor, queue and field-write refusals now carry a `userMessage`, the end user's sentence in their own locale, beside a `code`, status and `message` that do not change. The console shows `userMessage` in place of its generic "no permission" toast, so a user who tries to give a record to someone else, create one for someone else, clear its owner, move it to another queue, or edit a field they may not edit now reads which of these was refused. The sentences come from the operation-message catalog (`errors.record_owner_change_denied`, `errors.record_owner_assign_denied`, `errors.record_owner_remove_denied`, `errors.record_queue_change_denied`, `errors.field_edit_denied`, `errors.field_edit_denied_opaque`, in en, zh-CN, ja-JP and es-ES), so a deployment can override them with a `translation` item. None names a grant or an API name. The field-write sentence names the refused fields by label only when every one of them has a label and the caller can read it; otherwise it names no field. The object-level refusal is unchanged and carries no `userMessage`.

A create that sends an audit column which the audit stamp then replaces with a different value now reports it under `droppedFields` with reason `readonly`, as an update already does. The measured case is `created_by`: a forged value was stored as the caller's id with no report, while a forged `organization_id` in the same request was reported. Any other read-only key an app hook writes stays the hook's write and is not reported. A value equal to the stamp is neither reported nor refused. Without `strictReadonlyWrites` nothing stored changes.
