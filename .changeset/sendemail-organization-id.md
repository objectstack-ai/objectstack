---
'@objectstack/spec': minor
'@objectstack/plugin-email': minor
'@objectstack/service-messaging': minor
'@objectstack/plugin-auth': minor
---

Widen `SendEmailInput` / `SendTemplateInput` with an optional `organizationId`, threaded from producers that already hold an organization, so `plugin-email`'s writer stamps `sys_email.organization_id` at the source (#11741, Decision 2 of #11303).

- `@objectstack/spec`: `SendEmailInput.organizationId?` and `SendTemplateInput.organizationId?` — optional, pass-through only; absent stays legal (auth verification / password-reset mail carries none).
- `@objectstack/plugin-email`: `EmailService.send()` stamps the value verbatim onto the persisted `sys_email` row; `sendTemplate()` forwards it to `send()`. No in-adapter resolution or fabrication — the writer runs under a constant system context and only passes through what the input carries.
- `@objectstack/service-messaging`: the email channel threads `delivery.notification.organizationId` on both of its arms (plain `send` and the `sendTemplate` template path).
- `@objectstack/plugin-auth`: `sendInvitationEmail` threads the invitation's own `organizationId`; org-less auth mail (reset / verification / magic link / email-change notice) is unchanged.

Forward-stamping only: existing org-less `sys_email` rows are not backfilled.
