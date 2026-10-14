---
'@objectstack/service-mailbox': minor
---

Inbound mail stores its attachments: each attachment of an ingested message, and each message it forwards as an attachment as an `.eml` file, is stored through the `file-attachments` service as a file of the message's `sys_mail_message` row

Clause-②: no

- **What is stored, and where.** Every part of a stored message besides its text and HTML bodies (inline parts included, and each forwarded `message/rfc822` or `message/global` part as the `.eml` file it travels as) becomes one `sys_file` and one `sys_attachment` whose parent is the message's own `sys_mail_message` row, written by `IFileAttachmentService.attachFile` in the mailbox's organization after the row, and only for a message the call stored, so a re-delivered copy adds no attachment.
- **Without the storage capability.** A kernel that composes no `file-attachments` service (registered by `@objectstack/service-storage`) stores each message without its attachments, and says so once in the log.
- **Refused attachments.** A part the service refuses, such as one over the `max_upload_mb` upload size limit, is logged at `error` with its file name and the refusal, and the message and its other attachments are still stored.
- **For a host that constructs `MailIngestService` itself.** It takes the service as the optional `attachments` resolver (`MailboxServicePlugin` supplies it), and its `MailIngestLogger` now needs `error`, as `MailSyncLogger` already does.
