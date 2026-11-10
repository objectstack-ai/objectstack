---
'@objectstack/plugin-email': patch
---

fix(plugin-email)!: a non-string `subject`, `text` or `html` is the caller's `VALIDATION_FAILED`, refused before the transport (#32108)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: SendEmailInput already declares subject, text and html as strings, and the send path now refuses at run time the values that type already excluded. The refusal is the existing VALIDATION_FAILED path the send door answers for a malformed recipient, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing in `normalizeMessage` (`@objectstack/plugin-email`), served by `IEmailService.send`, `sendInline` and the `POST /api/v1/email/send` door.

After the upgrade, a message whose `subject`, `text` or `html` is present but not a string (a number, an object, an array, a boolean) is refused with `VALIDATION_FAILED` naming the field, before any `sys_email` delivery row is written or the transport is called. Through the REST door that is `400 VALIDATION_FAILED`, the answer it already gives for a malformed recipient. Before, a non-string `text` or `html` answered `200` with `status: "failed"` and a Node stream error, and a non-string `subject` was coerced, so an object sent a mail reading `Subject: [object Object]` and a number sent its digits. The refusal is still recorded as a `failed` rejection row with `attempt_count: 0`, like every other pre-delivery refusal.

`undefined` and `null` are absence, not a wrong type, and behave as before: no subject is still "subject is required", and a `null` or absent `text` beside a string `html` (or the reverse) still sends.

To keep sending, pass these three fields as strings, for example `String(n)` for a numeric subject. First-party producers (`sendTemplate`, the messaging email channel and the settings mail test) already send strings.
