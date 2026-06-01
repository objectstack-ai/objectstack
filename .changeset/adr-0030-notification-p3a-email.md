---
"@objectstack/service-messaging": minor
---

ADR-0030 P3a — email channel + notification templates. The same `emit()` now
reaches inbox **and** email per the user's preferences, rendered from a
template.

- **`email` channel** (`createEmailChannel`) — a thin `MessagingChannel` that
  delegates transport to the existing `email` service (ADR-0022: channel adds
  messaging semantics, the email sub-system stays the transport). It resolves the
  recipient user id → address (`sys_user.email`, or an email-shaped recipient
  verbatim), renders, and sends. Retry/backoff/dead-letter come free from the P1
  outbox dispatcher. Registered at `kernel:ready` only when an `email` service is
  present; absent ⇒ no channel (an explicit `channels:['email']` then reports
  "not registered" rather than silently no-opping). No-ops gracefully like the
  inbox channel when the capability isn't installed.
- **`sys_notification_template`** (topic × channel × locale) + a renderer:
  declarative `{{ payload.x }}` interpolation (no logic — auditable metadata),
  HTML/markdown/text bodies, locale fallback (`en-US` → `en` → default), and a
  **generic fallback to `payload.title`/`body`** when no template matches (so
  templates are purely additive). Contributed to the Setup → Configuration nav.
- Channels are now keyed per recipient (from P2), so a notification reaches each
  user on exactly the channels they accept, rendered by that channel's template.

Scope note (ADR-0022): **Slack stays a connector** (`connector-slack` already
ships the raw API path); a Slack *notification channel* needs per-user identity
mapping + OAuth and is enterprise-tier — deferred. push/webhook channels and the
digest / quiet-hours middleware (P3b) are follow-ups on the same seam.

Tests: service-messaging **85 passing** — adds `template-renderer.test.ts` and
`email-channel.test.ts` (address resolution, template vs fallback rendering,
no-service no-op, unresolved-address failure, transport-failure retry).
