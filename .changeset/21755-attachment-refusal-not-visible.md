---
'@objectstack/service-storage': patch
'@objectstack/plugin-audit': patch
---

A write refusal on an attachment or a comment no longer names a parent record the caller cannot read (#21755).

Clause-②: no

- **What changed.** The attachment gate (`sys_attachment`, `@objectstack/service-storage`) and the comment gate (`sys_comment`, `@objectstack/plugin-audit`) refuse an update or a delete by a caller who neither wrote the row nor can edit its parent record. That refusal names the parent record. A caller who cannot read the parent now gets the platform's not-visible refusal instead. This is the answer the row-level write check gives the principals it covers: `PERMISSION_DENIED` (403), with the same localized `record_access_denied` sentence. It names neither the parent nor the row's link to it, in the message or in the envelope.
- **What did not change.** A caller who can read the parent but may not edit it keeps the named refusal: `ATTACHMENT_DELETE_DENIED` for an attachment delete, and `RECORD_NOT_ACCESSIBLE` for an attachment update and for a comment update or delete. Who may update or delete is unchanged.
- **A comment whose thread names no record** is read by nobody, so a non-author's write on it now gets the not-visible refusal too, and the thread value is not echoed back.
- **Localization.** `installAttachmentAccessHooks` and `installCommentAccessHooks` accept an optional fourth argument: a lazily resolved i18n lookup. With it, the sentence honours a deployment's `errors.record_access_denied` override, as the row-level write check's sentence does. Without it, the built-in catalog still renders the caller's locale.
