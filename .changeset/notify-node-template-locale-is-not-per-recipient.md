---
'@objectstack/service-automation': patch
'@objectstack/service-messaging': patch
---

The `notify` node's Studio form and the messaging registration log now state the locale the delivery path actually resolves — one per notification, not one per recipient

`NotifyConfigSchema` was corrected in `packages/spec` to say that the `template`
path resolves `(name, locale)` with **one** locale for the whole notification.
The same retired promise survived outside the spec file, in the places an app
author is most likely to read it:

- `service-automation/src/builtin/notify-node.ts` — the `template` field's
  `configSchema` description, i.e. the text rendered in the **Studio form** the
  author fills in. It said the row is "resolved by (name, recipient locale) at
  delivery time and rendered per recipient".
- `content/docs/automation/email-templates.mdx` — the only site that stated the
  conclusion outright rather than merely licensing it: "so one node mails each
  person in their own language".
- `service-messaging/src/messaging-service-plugin.ts` — the channel-registration
  log line, which advertised "resolve sys_email_template per recipient locale".
- Two internal comments in `notify-node.ts` and one in its test, describing the
  payload the outbox snapshots as carrying a per-recipient-locale resolution.

None of that is what the delivery path does. `payload.locale` is interpolated
**once, before fan-out**, so it is a single value for the whole notification, and
its fallback is the deployment default (`II18nService.getDefaultLocale()`). The
platform has no per-user locale to read — `sys_user` carries no locale column,
and request-scoped locale does not exist at async delivery time — so recipients
whose personal languages differ all receive the same template row. A per-user
locale is deferred until measured pull (maintainer ruling, 2026-08-13) and layers
in as an override at that same seam when it lands; the corrected wording dates
the deferral so it reads as a decision with provenance rather than an oversight.

The gap was worth correcting because the wording licensed exactly one action —
convert `notify` nodes on the belief that non-English recipients get non-English
mail — and that action is a **net regression**: `TEMPLATE_*` failures classify
`permanent` and dead-letter, and the inbox channel starts requiring an email
service with `renderTemplate()` where inline text needed none.

Text only: no schema accepts or refuses anything it did not before, no delivery
behaviour moves, and no wire value changes. A new pin in `notify-node.test.ts`
asserts the form description names `payload.locale` and the deployment default
and refuses a bare "recipient locale", so a later edit cannot quietly restore the
promise.
