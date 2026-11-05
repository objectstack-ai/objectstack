---
'@objectstack/plugin-approvals': patch
'@objectstack/service-messaging': patch
---

feat(approvals,messaging): approval requests, reminders and outcomes also go by e-mail, linking to the request page; messaging gains a code-declared notification template tier

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/plugin-approvals`: `approval.requested`, `approval.reminder`, `approval.approved` and `approval.rejected` request the `inbox` and `email` channels** in one emit. Before, every approval notice named no channel, so messaging delivered it to the in-app inbox alone and nobody who does not watch the Console bell heard of it. Every other `approval.*` topic stays inbox-only, and delivery preferences filter the e-mail as they filter any channel. The inbox is unchanged. On a deployment with no mail transport the e-mail is whatever the `email` channel answers there.
- **The approval e-mail** is the notice's own title as its subject and its body (in the recipient's language, as the inbox renders it) followed by one line that opens the request, in `en`, `zh-CN`, `ja-JP` and `es-ES`. The link is a new payload member, `approvalUrl`: the request page (`/system/approvals?request=ID`) under the deployment's public origin. `actionUrl` stays relative, as the Console routes on it. It opens the request for a signed-in reader and decides nothing; no ADR-0043 action link or token is in any payload.
- **`publicBaseUrl` now resolves when the option is unset**: `OS_AUTH_URL` (legacy `BETTER_AUTH_URL`), then `OS_BASE_URL`, never a guessed `localhost`. With none of them set, or a value that is not an absolute `http(s)` URL, links stay relative and the plugin warns once at start, naming the variable to set. The same origin also prefixes ADR-0043's `actionLinkUrl`, as its option always documented. To give approval e-mails a working link, set `OS_BASE_URL` (or `OS_AUTH_URL`) to the deployment's address.
- **`@objectstack/service-messaging`: `MessagingService.registerBuiltinTemplates(templates)`** (and the `BuiltinNotificationTemplate` type) declares `(topic, channel, locale)` notification templates in code. The channels' template store reads them at every rung of its locale ladder after the recipient organization's own `sys_notification_template` row: the rung's row, else the rung's built-in, else the next rung, else the generic title and body. Nothing is written to the database (ADR-0131 §1.4), so an organization that authors a row overrides the built-in with nothing to migrate. A malformed template, or a `(topic, channel, locale)` already declared, is refused with a `TypeError`, and nothing from that call is kept.
