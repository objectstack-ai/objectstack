---
"@objectstack/spec": minor
"@objectstack/plugin-email": minor
"@objectstack/service-messaging": minor
---

feat(messaging): `IEmailService` gains a render-only `renderTemplate({ template, locale, data, timezone }) → { subject, html, text }`, and the inbox channel consumes it — localized `sys_email_template` content now reaches `sys_inbox_message` (#9225)

A template-path notify node with `channels: ['inbox', 'email']` delivered a
localized email and an inbox row whose title was the topic and whose body was
empty: the locale ladder + `{{var}}` renderer (ADR-0053 format filters
included) lived inside plugin-email's `sendTemplate`, unreachable without
sending mail (maintainer-ruled seam, 2026-08-17, on #9225).

- `IEmailService.renderTemplate` (new contract method, `packages/spec`)
  resolves a `sys_email_template` bundle by `(name, locale)` with the same
  documented en-US ladder as `sendTemplate`, validates required variables, and
  returns the rendered `{ subject, html, text }` — strictly render-only: no
  transport call, no queueing, no `sys_email` row. Implemented ONCE in
  plugin-email by extracting the resolver `sendTemplate` already used;
  `sendTemplate` now delivers what the shared resolver renders, byte for byte.
- The messaging inbox channel consumes it the way the email channel consumes
  `sendTemplate`: a delivery whose payload carries a notify `template`
  reference renders `subject` into the row's `title` and `text` into
  `body_md`, per recipient, at delivery time. A registered email service
  without the method — or no email service at all — fails the delivery LOUDLY
  (`TEMPLATE_UNSUPPORTED`, graded permanent) instead of silently degrading to
  topic-as-title; renderer failure codes (`TEMPLATE_NOT_FOUND` /
  `TEMPLATE_INACTIVE` / `MISSING_VARIABLES`) land on the delivery row and are
  graded permanent, mirroring the email channel.

The result shape follows what `sys_email_template` rows carry
(`subject`/`body_html`/`body_text?`): `html` is the rendered `body_html`,
`text` is the rendered `body_text` or, when the row declares none, derived
from the rendered HTML.
