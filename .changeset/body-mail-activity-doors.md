---
'@objectstack/spec': minor
'@objectstack/core': patch
'@objectstack/objectql': patch
'@objectstack/runtime': patch
'@objectstack/cli': patch
'@objectstack/rest': patch
'@objectstack/plugin-email': patch
'@objectstack/plugin-audit': patch
'@objectstack/plugin-security': patch
'@object-ui/app-shell': patch
---

feat(runtime): a script body sends mail and adds a timeline entry through platform doors that stamp who sent it

Clause-②: yes (widening)
Metadata-protocol: added

**BREAKING** (`@objectstack/plugin-email`): a `queued` row an app inserts into the mail log (`sys_email`, `sys_identity_email`) is sent from the configured sender, with no `From`, `Sender` or `Return-Path` header of its own, whatever sender the row names; a deployment with no configured sender refuses such a row. Migration: FROM inserting a mail-log row that names its own sender TO `ctx.email.send({ to, subject, text })` in a body that declares `email.send`, which sends from the configured sender with the calling user named in its display name. A row inserted with no sender of its own is delivered as before.

<!-- adr-0087: not-required (no-migration-prescription) no key, export or field is removed and no stored body changes shape; the change is which sender delivers a row an app inserted, and moving that app to the mail door is a code change no conversion can make for it -->

- **`@objectstack/spec`:** two new body capabilities, `email.send` and `activity.append`, and their inputs `BodyMailSendInputSchema` and `BodyActivityAppendInputSchema` (`@objectstack/spec/data`). The sender, the sending user, the organization, the actor and the origin are stamped by the platform and are not inputs: a key outside either shape is refused. Every string either input takes has an upper bound, and the limits that read across fields (`BODY_MAIL_RECIPIENT_LIMIT`, `BODY_MAIL_ADDRESS_LIST_LIMIT`, `BODY_MAIL_ADDRESS_LIMIT`, `BODY_ACTIVITY_METADATA_LIMIT`) are stated in each schema's description. `SYS_ACTIVITY_PLATFORM_TYPES` names the timeline types only the platform records. `SendEmailInput.requireLogRow` (`@objectstack/spec/contracts`) asks the mail service to send a message only if its log records it.
- **`@objectstack/runtime`:** an action or a job body that declares the capability calls `ctx.email.send({ to, subject, text })`, and a hook, action or job body `ctx.activity.append({ object, recordId, type, summary })`. A message is sent from the configured sender, as the calling user, under the caller's organization; a timeline entry is written with the calling user as its actor and the package and body as its origin. A record the call points at must be one the caller can read, in the caller's own scope: for a hook, the user of the write that fired it, never the system. A message names at most 50 recipients, each recipient list and `replyTo` fits the mail log as recorded, a message is sent only if the mail log records it, and an organization's mail is held to `OS_EMAIL_APP_SEND_HOURLY_LIMIT` messages an hour (default 200) before the door refuses another. A message cannot be taken back, so a hook body cannot send mail (`403 PERMISSION_DENIED`); an action or a job body sends it, and is refused with `409 RESOURCE_CONFLICT` while it runs inside a transaction. A timeline entry commits or rolls back with the write that runs the body. A door call inside the body's own `ctx.api.transaction` is refused with `409 RESOURCE_CONFLICT`. An entry's origin names the package that holds the body. A body with no calling user (a job) sends and writes with no user recorded.
- **`@objectstack/cli`:** the build infers both capabilities from a handler's calls, under a renamed or destructured context too. `ExtractedBody.capabilities` on `@objectstack/cli/hook-body` may now hold `'email.send'` and `'activity.append'`.
- **`@objectstack/objectql`:** `seedHookUserGrants` and `seedHookUnreadMembership`, the second step of a `runAs: 'user'` derivation and its fail-safe, are exported beside `deriveHookApi`. `openTransactionKind` answers whether a write runs inside a transaction that a write beside it joins (`'joined'`), one it cannot reach (`'separate'`), or none.
- **`@objectstack/core`:** the bounds a caller-sent message is held to (the sending user, the organization, the configured sender) are one function, `boundCallerMail`, shared by the REST mail door and the body door.
- **`@objectstack/rest`:** the REST mail door reads its bounds from `boundCallerMail`; its answers are unchanged.
- **`@objectstack/plugin-email`:** a mail-log row the mail service did not write is delivered from the configured sender, with no sender header of its own (see BREAKING above). `send()` honours `requireLogRow`: when the row cannot be written, it refuses with `503 SERVICE_UNAVAILABLE` and delivers nothing.
- **`@objectstack/plugin-audit`:** the activity feed owns the door's writer, `appendAppActivity` on the `audit` service. An app's entry may not use a platform-only type or a platform metadata key, and may not be about an object the feed does not show or an append-only object. `sys_activity` gains a read-only `origin` column, empty on an entry not written through the activity door.
- **`@objectstack/plugin-security`:** inserting into an append-only object from app automation that runs as system is deprecated, and says so once per kind and object, naming the two doors.
- **`@object-ui/app-shell`:** the script capability picker lists both capabilities with their calls.
