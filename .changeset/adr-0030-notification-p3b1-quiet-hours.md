---
"@objectstack/service-messaging": minor
---

ADR-0030 P3b-1 — quiet-hours. A notification that lands inside a recipient's
quiet-hours window is **deferred to the window's end** instead of disturbing
them; it then delivers normally.

- Implemented as a **deferred dispatch** on the P1 outbox — no parallel
  scheduler: `EnqueueDeliveryInput.notBefore` sets the delivery row's initial
  `nextAttemptAt`, and the existing dispatcher already skips pending rows whose
  `nextAttemptAt` is in the future. One delivery spine, reusing claim/retry/
  observability.
- `PreferenceResolver` reads `quiet_hours` (`{ tz, start, end }`, P2's field) off
  a channel-wildcard preference row (quiet hours are a per-person, channel-
  agnostic setting), computes the deferral with `quietHoursDeferral()` (HH:MM in
  the row's `tz`, default UTC; supports overnight windows that wrap midnight),
  and stamps `notBefore` on the target. `emit()` passes it through to the outbox.
- **critical** severity bypasses quiet hours (delivers immediately), like
  mandatory topics bypass muting. Honored on the durable outbox path; inline
  best-effort fan-out ignores it.

Tests: service-messaging **92 passing** — adds `quietHoursDeferral` unit cases
(same-day / overnight / outside / degenerate) and resolver cases (notBefore
stamped, critical bypass, JSON-string `quiet_hours`).

Follow-up: **P3b-2 — digest** (batch same-`(user, channel, window)` deliveries
into one) builds on this same deferral foundation, adding the window collapse.
