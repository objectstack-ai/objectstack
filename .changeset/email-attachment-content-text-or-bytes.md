---
'@objectstack/plugin-email': patch
---

fix(plugin-email)!: an email's text, html and attachment content reach the mail transport only as a string or as bytes

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: EmailAttachment already declares content as string or Buffer, and the send path now refuses at run time the values that type already excluded. The refusal is the existing VALIDATION_FAILED path the send door answers for a malformed recipient, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing in `normalizeMessage` (`@objectstack/plugin-email`), served by `IEmailService.send`, `sendInline` and the `POST /api/v1/email/send` door.

The rule: a message's text, html and every attachment's content reach the transport only as a string or as bytes, and the mail transport never reads a server file or fetches a URL on a message's behalf.

After the upgrade, `attachments`, when present and not `null`, must be an array of plain objects whose `content` is a `string` or a `Buffer`. Anything else is refused with `VALIDATION_FAILED` naming the attachment's position and the kind of value (never the value itself), before any `sys_email` delivery row is written or the transport is called: an object, a stream, a typed array other than a `Buffer`, an `ArrayBuffer`, a `null` or missing `content`, a non-array `attachments`, or a `null` element. Through the REST door that is `400 VALIDATION_FAILED`. The refusal is recorded as a `failed` rejection row with `attempt_count: 0`, like every other pre-delivery refusal. Before, such content was accepted and delivered inline.

Every SMTP transport the plugin builds (at boot, from saved mail settings, and for the settings mail test) now sets nodemailer's `disableFileAccess` and `disableUrlAccess` to `true`, on the transport and on every message it sends. They are applied after `transportOptions` and cannot be turned off there; `describe()` reports both.

Who moves: in-process callers passing a stream, a typed array or an object as an attachment's `content`. Pass a `Buffer` instead, for example `Buffer.from(bytes)` for a `Uint8Array`, or read the stream into a `Buffer` before sending. First-party producers send no attachments, or send strings and Buffers, and are unaffected.
