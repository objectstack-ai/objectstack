---
'@objectstack/plugin-audit': patch
---

feat(plugin-audit): an @mention reaches the mentioned person by e-mail as well as the inbox, one e-mail per person per 10-minute window

Clause-②: no
Metadata-protocol: none

Before, a `collab.mention` notification named no channel, so messaging delivered it to the in-app inbox alone. A person who was mentioned while away from the Console never heard of it.

- **The mention now also goes by e-mail, on by default.** The mention writer keeps its inbox notice unchanged (one per comment and person). It then sends a second `collab.mention` emit with `channels: ['email']`. Both go through `messaging.emit` (ADR-0030 single ingress). Delivery preferences filter the e-mail like any channel: a person's `sys_notification_preference` row `(collab.mention, email, enabled: false)` mutes the e-mail and keeps the inbox notice. Approvals and every other notification are unchanged.
- **One e-mail per person per 10-minute window.** The e-mail emit is deduplicated per organization, person and clock-aligned 10-minute window (`:00`, `:10`, …). The first mention of a person in a window sends the e-mail, and later mentions in that window go to the inbox only. A person gets at most one mention e-mail per window: at most two in any ten minutes when a burst crosses a window edge, and at most 144 a day. Hosted deployments cap platform-sent mail per day, and this is what keeps mentions inside that cap.
- **What the e-mail says.** The subject is the notification title ("Alice mentioned you"), in the reader's language. The body is the comment preview, then one line that opens the record the comment is on. That line ships in every locale the plugin-audit catalog carries. The templates are code-declared through `MessagingService.registerBuiltinTemplates`, so an organization's own `sys_notification_template` row for `(collab.mention, email)` overrides them. The link is the inbox notice's `/{object}/{id}`, made absolute by the auth service's `getConsoleUrl`. It carries no token. Without an auth service the link stays relative. A comment whose thread names no record sends no e-mail.
