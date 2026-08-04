---
"@objectstack/plugin-email": minor
"@objectstack/platform-objects": patch
---

plugin-email: large attachments (>256 KiB) now get durable queue delivery, with their content held out of the `sys_email` row

A message whose attachments exceeded the in-row budget was pushed back onto inline delivery — whole, but with none of the durability queue delivery exists to provide, which meant the platform was weakest about exactly the mail that matters most (a signed contract, an exported report). Its content now goes to the `file-storage` capability, the row records a `storageKey` plus the audit metadata, and the queue worker fetches the content back to rebuild the message.

- **Zero migration.** `attachments_json` declared `storageKey` from the start; this adds the producer and the reader. Attachments at or under `SYS_EMAIL_ATTACHMENT_LIMIT_BYTES` still go in the row exactly as before, and the boundary includes equality.
- **The row stays an audit log, not a blob store.** `filename` / `contentType` / `size` / `hash` stay on the row permanently; the content is a delivery artifact and is deleted a grace window (24h) after the row reaches a terminal state, at which point `storageKey` is replaced by `contentReclaimedAt`. Reclamation is a delayed `email.attachment.reclaim` queue job that carries the storage keys, so a row deleted in the meantime reclaims its content instead of orphaning it.
- **Nothing degrades silently.** No `file-storage` capability, or an upload that fails, keeps today's behaviour — inline delivery of the whole message — and says which of the two it was and how to fix it. On the way back, content that cannot be fetched (outage, missing object, no capability on the worker, truncated or substituted bytes) fails the row loudly; a message is never delivered without an attachment it declares.
