---
'@objectstack/rest': patch
'@objectstack/spec': patch
'@objectstack/plugin-email': patch
'@objectstack/client': patch
---

fix(rest): the REST email send door requires a send capability and bounds the sender address

Clause-②: no
Metadata-protocol: none

`POST /api/v1/email/send` (and its environment-scoped twin) now applies three bounds after the authentication floor and before anything is sent. Each refusal is `403 PERMISSION_DENIED` in the nested `{ error: { code, message } }` envelope, and the mail service is not called:

- **Capability.** The caller must hold `manage_platform_settings`, the capability that already governs the mail settings page and the `sys_email` log. An authenticated caller without it is refused. The check runs before the provider lookup, so a refused caller gets `403` whether or not mail is wired.
- **Attribution.** `sentBy` is always the authenticated caller. A body that names another user is refused. A body that names the caller, or names no one, is stamped with the caller.
- **Sender.** The envelope sender is the deployment's configured sender (Settings → Mail → From address, or `defaultFrom`). A `from` naming any other address is refused. A `from` naming the configured address is accepted, and the configured value is sent in its place. Custom `From`, `Sender` and `Return-Path` headers are refused.

Server-internal sends (flows, notifications, auth mail) call `IEmailService.send` directly and are unchanged.

`IEmailService` gains an optional `getDefaultFrom()` that returns the configured sender, and plugin-email's `EmailService` implements it. A service that does not implement it still sends through the door, but a caller `from` is refused because the sender cannot be checked.

Migration: an integration that sends through the REST door needs a credential holding `manage_platform_settings`. It should omit `from` (the configured sender is used) and omit `sentBy` (the caller is recorded).
