---
'@objectstack/service-messaging': minor
---

fix(service-messaging)!: `sys_notification_template.channel` accepts only `email` and `sms`, the two channels that read a notification template

A notification template row is read by exactly two channels: the email channel (when the notification names no email template) and the SMS channel, which also renders the phone OTP and invitation texts. The in-app inbox reads no row on any path. `channel` was free text, so a row saved for `inbox`, `push` or any other value was stored and then rendered nowhere, with nothing to say so. The object now refuses that save. Its `channel_renders_template` rule answers `400 VALIDATION_FAILED`, attributed to `channel`, and the message points in-app content to an email template (`email_template`) named in a notify step's `template`. The rule guards insert, by-id update and bulk update, and an import's kept option values do not admit another channel. The object's description, its empty state and the `channel` / `subject` help now say which channels use a row and that the inbox never does.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling or exported declaration is added, removed, renamed or re-shaped, and the object keeps every field, its column types and widths, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the set of values one platform object's data write door accepts for `channel`. Rows already stored with another channel are not read, rewritten or refused by anything but a save that names that channel, and they render nowhere, as before. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed as a declaration (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (the accept set of one platform object's write door narrows), shipped as `minor` under the launch-window convention for breaking changes.

- **Before.** A `sys_notification_template` save naming any `channel` up to 64 characters was accepted. A row for a channel other than `email` or `sms` was stored and never rendered.
- **Now.** A save naming a `channel` other than `email` or `sms` is refused: `400`, `code: 'VALIDATION_FAILED'`, one field error on `channel` (`invalid_format`) whose message names the email template. This holds for a new row, for moving a row to another channel, and for re-sending a stored row's other channel.
- **Unchanged.** `email` and `sms` rows, and how every channel renders. A row already stored with another channel is still read, listed, edited in any other column and deleted, and it still renders on no channel. The column and its width are unchanged.
- **What to do.** Nothing, for `email` and `sms` rows. For in-app content, write an email template and name it in the notify step's `template`; the inbox and email both render it. Delete a stored row for another channel if you no longer want it listed: no channel ever read it.
