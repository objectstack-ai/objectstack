---
'@objectstack/plugin-approvals': patch
---

Approval notifications reach their recipient with their text (#21847). The approvals service put each notification's text in `payload.message`. The messaging service builds the delivered notification from `payload.title` and `payload.body`, the fields its `EmitInput` documents, and no channel reads `message`. So `GET /api/v1/notifications` served every approval notification as a title over an empty `body`, and the inbox row's `body_md` was empty too. The lost texts were comments, request-info questions, send-back notes, reassignments, reminders, escalations, SLA breaches and out-of-office substitutions. Every one of them now travels in `payload.body`.

Clause-②: no

- The texts are unchanged. Only the field they travel in moved. Who is notified, and when, is unchanged.
- Approval notifications no longer carry `payload.message`. Nothing in the platform or the console read it. A tenant-authored `sys_notification_template` for an `approval.*` topic that wrote `{{ message }}` should write `{{ body }}`.
- The service's notify helper now declares its payload: `title`, `body`, `actionUrl`, and a reminder's `actions`. A call site that spells the text any other way no longer compiles.
- `@objectstack/service-messaging` is unchanged. There is one field, as documented, and no alias for the old one.
