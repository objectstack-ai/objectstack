---
"@objectstack/service-messaging": minor
---

Synthesize the inbox `action_url` from the event `source` (ADR-0030 L5).

The Console bell reads `sys_inbox_message` (the L5 in-app materialization),
which carries only `action_url` — not the L2 `sys_notification` event's
`source_object`/`source_id`. Producers that pass a `source` but no explicit
`payload.url` (collaboration `@mention`, record assignment) therefore
materialized inbox rows with no navigable link, so the bell entry couldn't
deep-link to the originating record.

`emit()` now synthesizes an app-relative `/{object}/{id}` link from `source`
when no explicit `payload.url`/`payload.actionUrl` is supplied — in both the
inline fan-out and the durable-outbox enqueue paths (`actionUrlFor()`).
Precedence: explicit url → source-derived link → `undefined`. Keeps the L5
materialization self-sufficient for navigation (the objectui bell consumes
`action_url`).

Tests: 3 new `messaging-service.test.ts` cases (source→link, explicit-url
precedence, neither→undefined); all 95 service-messaging tests green.
