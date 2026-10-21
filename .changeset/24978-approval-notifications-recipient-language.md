---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): approval notifications reach each recipient in their own language

Every approval notification now hands the messaging service its sentence as catalog keys beside the English literal (`EmitInput.keyedText`). The messaging service renders it at delivery in each recipient's `sys_user.locale`, else the deployment default. This plugin's translation bundle gains the sentences in en, zh-CN, ja-JP and es-ES, in its `messages` face (`messages.approvalRequestedTitle` and the rest).

- **Which notifications.** `approval.requested`, `approval.reminder`, `approval.sla_breached` (to the approvers and to the submitter), `approval.approved` and `approval.rejected`, the two out-of-office notices (`approval.ooo_substituted`, `approval.ooo_skipped`), `approval.escalated`, `approval.reassigned` and `approval.returned` (the send-back and the auto-rejection). For `approval.comment`, `approval.request_info` and a send-back that carries the approver's note, only the headline is keyed. The body is that person's own words, delivered as written.
- **The record is named as before:** the object's label and the record id (`Deal D_123`), never a title. The label is rendered from the app's `objects.<object>.label` when its language pack holds one, else the schema label.
- **The English is unchanged.** The payload's `title` and `body` are the `en` catalog entries, byte for byte the sentences each notification carried before. A messaging service that does not render keyed text delivers them as it always did.
- **Unchanged.** Who is notified, each notification's topic, payload fields, deep link, dedup key and organization, and every channel's delivery behaviour apart from the text.
