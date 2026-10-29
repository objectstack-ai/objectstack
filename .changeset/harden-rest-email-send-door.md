---
'@objectstack/rest': patch
'@objectstack/spec': patch
'@objectstack/plugin-email': patch
'@objectstack/client': patch
---

fix(rest)!: the REST email send door requires a send capability and bounds the sender, the custom headers, the organization and identity mail

Clause-②: yes (narrowing) — the REST send door refuses callers and bodies it admitted (the breaking half), and the published `IEmailService` contract gains an optional `getDefaultFrom()` (a widening, the same move as `isConfigured()` on the same interface). No spec key, export or config field is removed or renamed.
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` teaches `POST /api/v1/email/send`, `client.email.send` or `IEmailService` (a `git grep` of `skills/` for each names nothing), so no skill line changes. The runtime-services page, `content/docs/kernel/runtime-services/email-service.mdx` ("Over HTTP"), states the four bounds in this change.

<!-- adr-0087: not-required (no-migration-prescription) A runtime authorization narrowing at one REST door, not a metadata change. No spec key, export, option, config field, response field or stored shape is removed, renamed or re-shaped: SendEmailInput keeps every member, and a caller the bounds admit receives the same answer as before. There is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which HTTP callers and bodies the door serves. The other categories are closed on facts: the four packages publish (not unpublished); no ADR-0087 id covers this door and this diff adds none (not registered or already-registered); and IEmailService, the one published interface that moves, gains an optional member and is referenced in code across the workspace (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an accept-set narrowing of `POST /api/v1/email/send`), shipped as `patch` because no metadata protocol moves.

`POST /api/v1/email/send` (and its environment-scoped twin) now applies four bounds after the authentication floor and before anything is sent. Each refusal is `403 PERMISSION_DENIED` in the nested `{ error: { code, message } }` envelope, and the mail service is not called:

- **Capability.** The caller must hold `manage_platform_settings`, the capability that already governs the mail settings namespace, the `sys_identity_email` log and the two body columns of `sys_email`. An authenticated caller without it is refused. The check runs before the provider lookup, so a refused caller gets `403` whether or not mail is wired.
- **Attribution.** `sentBy` is always the authenticated caller. A body that names another user is refused. A body that names the caller, or names no one, is stamped with the caller.
- **Sender.** The envelope sender is the deployment's configured sender (the Mail settings' From address, or `defaultFrom`). A `from` naming any other address is refused. A `from` naming the configured address is accepted, and the configured value is sent in its place. `headers` is accepted only as the contract's `Record<string, string>`: a plain object whose every key is a header field name and whose every value is a single-line string. Any other shape is refused, and so are custom `From`, `Sender` and `Return-Path` headers.
- **Organization.** The message is recorded under the caller's active organization: the door sets `organizationId` from the caller's execution context, and the service stamps it onto `sys_email.organization_id`. A body naming another organization is refused, and so is a body naming one when the caller has no active organization. `identityMail` is refused (any value but `false`): identity mail is sent by the server itself. `replyTo` is unchanged; it is the caller's Reply-To address and makes no claim about the sender.

Server-internal sends (flows, notifications, auth mail) call `IEmailService.send` directly and are unchanged.

`IEmailService` gains an optional `getDefaultFrom()` that returns the configured sender, and plugin-email's `EmailService` implements it. A service that does not implement it still sends through the door, but a caller `from` is refused because the sender cannot be checked.

plugin-email's SMTP transport now hands nodemailer custom headers as an explicit list of name/value entries, one per key of the headers map, so every key is read as exactly one header name. A well-formed headers map puts the same headers on the wire as before.

What changes for you: an integration that sends through the REST door needs a credential holding `manage_platform_settings`, and should leave `from`, `sentBy`, `organizationId` and `identityMail` out of the body, since the door supplies each of them. Custom headers are sent as a plain object of string values.
