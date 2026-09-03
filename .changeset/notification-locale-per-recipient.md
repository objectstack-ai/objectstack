---
"@objectstack/service-messaging": minor
"@objectstack/spec": minor
"@objectstack/service-automation": patch
---

feat(service-messaging): notification locale is resolved per recipient — `sys_user.locale`, then the deployment default (#13881)

Maintainer ruling 2026-09-01, quoted verbatim and untranslated:

> **解析点移到 fan-out 后按收件人**:`payload.locale` 不再是 fan-out 前单值,插进 `email-channel.ts` L86-99 自留的 seam
> **解析链 = 收件人 `locale` → 部署默认**(`II18nService.getDefaultLocale()`),缺失恒回退,⛔ 任何路径不得死信

Before, the delivery path resolved ONE locale per notification: `payload.locale`
if the producer set one (interpolated once, before fan-out), else the deployment
default. Every recipient of a notify node got the same `sys_email_template` row,
whatever language they read — the hotcrm measurement that lifted the 2026-08-13
deferral.

Now the locale is resolved PER RECIPIENT, at delivery time, through ONE read
point (`recipient-locale.ts`, `resolveRecipientLocale`): the recipient's own
`sys_user.locale` — read off the same row the channel already fetches for the
address, so it costs no second query — else the deployment default, probed
lazily so live `localization` changes are honoured. The same chain serves the
email channel's two arms (`sendTemplate` and `sys_notification_template`), the
inbox channel's template path, and the SMS channel, so one notification cannot
arrive in two languages across channels.

**Never a dead letter from this seam.** A recipient value that is absent, empty,
whitespace, non-string, malformed, or the literal string `"undefined"` /
`"null"` (the exact shape hotcrm measured dead-lettering every user without a
preference row) falls back to the deployment default; nothing named anywhere
arrives at the downstream ladders as an absent key, which is their documented
`en-US` floor. A locale read that throws (a `userObject` override without the
column) is retried address-only and falls back — the delivery still goes out.

**Behaviour change for producers:** a `payload.locale` set by a producer is no
longer consulted. It was never a declared key of the notify node (only the
generic `payload` passthrough carried it) and no in-repo producer writes it;
the ruling retired it as the pre-fan-out single value. A node that relied on
it now sends each recipient their own language, else the deployment default —
which is the ruled behaviour, not a regression. Nothing to migrate: remove the
key, or leave it, it is inert either way.

`@objectstack/spec` ships the contract text: the `notify` node's `template`
description and its refusal messages now state the per-recipient chain and
name `payload.locale` as not consulted (`automation/io-node-config.zod.ts`),
mirrored on the runtime descriptor in `@objectstack/service-automation`.

Interaction with the `TEMPLATE_*` permanent-failure class is unchanged in
kind: `sendTemplate`'s ladder still ends at `en-US`, so a recipient locale can
dead-letter a delivery only where the deployment default would have too — a
bundle with neither the requested row nor an `en-US` row, which is off the
documented contract.
