---
'@objectstack/service-messaging': patch
---

fix(service-messaging): a `sys_notification_template` saved for a channel other than `email` or `sms` is now warned about, because no channel ever sends it

A notification template row is read by exactly two channels: the email channel (when the notification names no email template) and the SMS channel, which also renders the phone OTP and invitation texts. The in-app inbox reads no row on any path. `channel` is free text, so a row saved for `inbox`, `push` or any other value was stored and then rendered nowhere, with nothing to say so.

The object now carries a `channel_renders_template` rule at `severity: 'warning'`. A write naming another channel is still accepted and stored, and it now reports the warning. A single-record create, clone or update answers it in the write answer's `warnings` (`rule`, `severity`, `field: 'channel'`, `code`, `message`), and the server logs it once per write. Bulk updates and imports log it. The message points in-app content to an email template (`email_template`) named in a notify step's `template`. The object's description, its empty state and the `channel` / `subject` help now say which channels use a row and that the inbox never does.

Clause-②: no — nothing a write could send before is refused now; a save naming another channel gains one advisory in the write answer's existing `warnings`.

- **Unchanged.** Every write that was accepted is still accepted, and stored rows are not read, rewritten or flagged by anything but a write that names their channel. `email` and `sms` rows, how every channel renders, and the column and its width are unchanged.
- **What to do.** For in-app content, write an email template and name it in the notify step's `template`; the inbox and email both render it. A row for another channel was never sent, so delete it if you no longer want it listed.
