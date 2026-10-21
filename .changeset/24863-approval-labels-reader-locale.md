---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): the approvals inbox, the record's approval panel and the request page name the flow, the step and the record's object in the reader's language

Clause-②: no

- **What was wrong.** An approval request copies the flow's label and the Approval node's label when it opens (`process_label`, `current_step_label`), and the approvals door served that copy to every reader. A user whose locale is zh-CN, ja-JP or es-ES saw the authoring language, although the app's language pack carried `flows.<flow>.label` and `flows.<flow>.approvals.<node_id>.label` for those strings. The inbox row's `object_label` was the object's untranslated schema label.
- **Now.** `GET /api/v1/approvals/requests` (the inbox and the record's approval panel), `GET /api/v1/approvals/requests/:id` and the request a decision answers with serve `process_label`, `step_label` / `current_step_label` and `object_label` in the reader's locale (`Accept-Language`, else the `localization` settings). Each is read from the deployment's `i18n` service: `flows.<flow>.label`, `flows.<flow>.approvals.<node_id>.label` and `objects.<object>.label`. A bare `zh` reaches a `zh-CN` pack. The request get's step progress (`flow_steps`) names each step the same way.
- **Fallback.** A label the pack does not carry, a locale no pack holds, a read without a locale and a stack without an `i18n` service all get the label the request stored, exactly as before. An `en` reader of an app authored in English sees no change.
- **Unchanged.** The stored `process_label` and `current_step_label` columns keep the authored text they were written with: nothing is migrated or rewritten, and the generic data door, the list views and the one-tap action page still show the stored text. Who may read a request is unchanged. The `approval.requested` notification body is still English.
- **`ApprovalServiceOptions.i18nServiceSource`.** A new optional option: a lazy reader of the `i18n` service. `ApprovalsServicePlugin` wires it from the kernel's `i18n` service. A host that constructs `ApprovalService` by hand and leaves it out keeps the stored labels.
