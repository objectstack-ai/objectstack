---
'@objectstack/service-messaging': patch
---

feat(service-messaging): a keyed inbox notification reads in the reader's language, not the language it was delivered in

Clause-②: yes (widening)
Metadata-protocol: none

A notification whose text a producer keys (`EmitInput.keyedText`, as the approvals plugin does) is still rendered once at delivery, in the recipient's saved `sys_user.locale` or else the deployment default, and that text is still what `sys_inbox_message.title` / `body_md` store. A recipient with no saved locale in a Chinese console therefore read every such title in English ("Approval requested").

- **New read-only field `sys_inbox_message.keyed_text`.** The inbox channel now stores the catalog keys and params the title and body were rendered from, on both delivery paths (the inline fan-out and the durable outbox dispatcher). It holds keys and params only, never text rendered in another language. It is not written on the template path (a `notify` node's `template`), whose text is the template's, and it is never taken from a producer's free-form `payload`.
- **Read in the reader's language.** A middleware on `sys_inbox_message` re-renders `title` and `body_md` from those keys on any read that carries a request locale (the data API's `Accept-Language`, else the localization settings), through the same renderer delivery uses, so a zh-CN reader reads the Chinese sentence and an English reader the English one from the same row. A member the reader's locale has no entry for keeps its stored text.
- **Unchanged.** Rows written before this release carry no keys and read as stored (no backfill). A read with no locale, including the `/api/v1/notifications` list (it reads as the system), and a deployment with no `i18n` service serve the stored text. A producer that keys nothing writes exactly the row it wrote before.

`MessagingChannel` authors: the per-recipient `Notification` gains an optional `keyedText` member, the keys its `title` / `body` were rendered from. A channel that stores text may keep it; nothing else changes.
