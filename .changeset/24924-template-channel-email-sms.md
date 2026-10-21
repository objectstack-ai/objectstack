---
'@objectstack/service-messaging': patch
---

fix(service-messaging): the `sys_notification_template` copy now says that only the email and SMS channels use a template row, and that the in-app inbox never does

A notification template row is read by exactly two channels: the email channel (when the notification names no email template) and the SMS channel, which also renders the phone OTP and invitation texts. The in-app inbox reads no row on any path. `channel` is free text, so a row saved for `inbox`, `push` or any other value was stored and then rendered nowhere, with nothing to say so.

This entry first added a `channel_renders_template` warning for such a write; in the same release #24983's refusal superseded it, so a write naming another channel is refused rather than warned about, as that entry describes. The object's description, its empty state and the `channel` / `subject` help now say which channels use a row and that the inbox never does.

Clause-②: no — this entry now describes copy only (the object's description, its empty state and the field help); the narrowing of what a write may send is #24983's, declared in its own entry.

- **Unchanged.** Nothing this entry describes changes which writes are accepted. `email` and `sms` rows, how every channel renders, and the column and its width are unchanged.
- **What to do.** For in-app content, write an email template and name it in the notify step's `template`; the inbox and email both render it. A row for another channel was never sent, so delete it if you no longer want it listed.
