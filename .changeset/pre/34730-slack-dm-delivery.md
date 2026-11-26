---
'@objectstack/service-messaging': minor
'@objectstack/connector-slack': patch
'@objectstack/plugin-approvals': patch
'@objectstack/spec': patch
'@objectstack/cli': patch
---

Clause-②: yes (widening)
Metadata-protocol: added

feat(messaging): Slack DM delivery — a `slack` channel, a per-person link store, approval requests by DM

An organization can now receive notifications in Slack, as direct messages to each person who connected their own Slack user (ADR-0013 addendum of 2026-11-19, step 2 of #34730).

- **The install.** An organization administrator (`setup.write` in their current organization) installs the organization's own Slack app with `PUT /api/v1/messaging/slack/account` `{ token }`. Slack proves the bot token (`auth.test`) before it is saved. The app's bot token needs the scopes `chat:write`, `im:write`, `users:read` and `users:read.email` (the methods called are `auth.test`, `users.lookupByEmail`, `conversations.open` and `chat.postMessage`); `auth.test` does not check scopes, so an app without `users:read.email` installs and every proposal then answers 502. The token is kept in `sys_channel_account.bot_token`, a `secret` field: encrypted at rest by the host's `ICryptoProvider`, masked on every read, never returned by any route, and read only by the server when it calls Slack. `GET` and `DELETE` on the same route read and remove the install.
- **A person's link.** `POST /api/v1/messaging/me/slack-link/proposal` proposes a link by the person's email (Slack `users.lookupByEmail`); it delivers nothing until the person confirms it with `POST /api/v1/messaging/me/slack-link/confirm`. A Slack link is proposed only for a verified email and names no one before it is confirmed. `GET` and `DELETE /api/v1/messaging/me/slack-link` read and remove it. An administrator lists links with `GET /api/v1/messaging/slack/links` and removes one with `DELETE /api/v1/messaging/slack/links/:id`; the person is told by inbox and e-mail (topic `messaging.slack_link_removed`) and may link again. A link goes when the person is deleted, banned, or leaves the organization. Links are `sys_channel_user_link` rows; every write names who acted, so the platform's write audit records each one.
- **The channel, only where connector-slack is composed.** `slack` is registered beside inbox, email, sms and push only on a composition where connector-slack's `slack` client service resolves at boot: `ConnectorSlackPlugin` now registers that service, which sends with a caller-held token. On such a composition, and only there, the `/automation` save doors accept `slack` on a `notify` node, and `GET /api/v1/messaging/preference-options` and `GET /api/v1/messaging/me/preferences` list `slack` as a channel. A `notify` node naming `slack` delivers only where connector-slack is composed, the organization installed Slack and the recipient confirmed a link. Without connector-slack, those doors answer as before: a `notify` node naming `slack` is refused 400, and neither preference door lists it. It sends `conversations.open` then `chat.postMessage` with the notification's title linked to its deep link, made absolute under `OS_AUTH_URL` / `OS_BASE_URL`. Preferences, digest and quiet hours apply as on every channel. A recipient with no confirmed link is skipped before any delivery row is written, so nothing is dead-lettered for them; a refused token stops delivery on that install until an administrator sets it again; a rate limit is retried.
- **Approval requests.** `approval.requested` also asks for `slack`, beside inbox and e-mail, only while the `slack` channel is registered and mounted (connector-slack composed).
- `MessagingChannel` gains an optional `reachableRecipients(ctx, { organizationId, recipients })`, consulted once per channel per emit after preferences. A channel without it reaches every recipient, as before.
- `PLATFORM_OBJECTS_BY_PACKAGE['service-messaging']` lists `sys_channel_account` and `sys_channel_user_link`, and the organization ownership inventory gives both a row.
