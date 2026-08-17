---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
"@objectstack/service-messaging": minor
---

feat(automation): flow `notify` nodes can reference an email template for localized delivery — `template` + `templateData` on `NotifyNodeConfig`, resolved by `(name, recipient locale)` at delivery time (#9205)

Ruled 「立项，走 emailTemplates 路线」: instead of widening the `flows`
translation surface (whose guidance excludes notification text, #7646), a
`notify` node now bridges to the existing localized email-template subsystem.

- **Spec** — `NotifyConfigSchema` gains `template` (a `sys_email_template`
  name, read raw like `topic`/`channels`) and `templateData` (render context
  for the template's `{{var}}` holes; values interpolate `{token}` templates
  per run) as the localizable alternative to inline `title`/`message`. Inline
  strings stay fully valid and byte-identical for existing flows — they are
  the non-localizable path, and the describes now say so. A node carrying BOTH
  paths, or `templateData` without `template`, or NEITHER path, is refused
  loudly with the fix in the message (the `objectNavTargetExclusivity`
  posture: unrepresentable over silent precedence).
- **service-automation** — the notify executor forwards the template
  reference and its interpolated render context in the emit payload (the
  outbox snapshots it onto each delivery row), and no longer demands an
  inline title when a template is referenced.
- **service-messaging** — the email channel routes a template-carrying
  delivery through `IEmailService.sendTemplate({ template, locale, data })`,
  resolving the recipient locale per delivery: `payload.locale` if the
  producer set one, else the deployment default
  (`II18nService.getDefaultLocale()`, the #8195 ruled source), else
  `sendTemplate`'s documented `en-US` ladder. Template-resolution failures
  (`TEMPLATE_NOT_FOUND` / `TEMPLATE_INACTIVE` / `MISSING_VARIABLES`, and an
  email service without `sendTemplate`) are graded `permanent` — dead
  immediately with the code on the delivery row, instead of burning the retry
  schedule on metadata that cannot fix itself.

The inbox channel keeps its existing rendering (notification title/body,
falling back to the topic on the template path): it has no locale-capable
rendering seam to the email-template subsystem today, and that gap is
documented in the PR rather than papered over with a duplicated resolver.
