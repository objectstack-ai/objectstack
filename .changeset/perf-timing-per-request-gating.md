---
"@objectstack/observability": minor
"@objectstack/plugin-hono-server": minor
"@objectstack/runtime": minor
---

feat(observability): admin-gated per-request `Server-Timing` via `X-OS-Debug-Timing` (#2408)

Perf-tuning mode was previously global-only (`serverTiming` option /
`OS_SERVER_TIMING`), which discloses internal phase durations — a mild
backend-fingerprinting surface — to every caller. This adds the per-request
gating path from the design so an operator can pull a single request's
`Server-Timing` breakdown on a live environment without turning the header on
for everyone.

- **observability**: a request-scoped disclosure gate (`runWithPerfDisclosure`,
  `allowPerfDisclosure`, `isPerfDisclosureAllowed`, `PerfDisclosureGate`) kept
  separate from the pure `PerfTiming` collector and pinned to its own
  `Symbol.for` store so the middleware and dispatcher share it across module
  copies.
- **plugin-hono-server**: the Server-Timing middleware is registered by default
  (unless `serverTiming: false`). It runs the collector when timing is global
  **or** the request sends `X-OS-Debug-Timing: 1`, and emits the header only
  when the gate is open. `OS_PERF_TIMING=1` now also enables global mode.
- **runtime**: after resolving the execution context, the dispatcher opens the
  gate for admin/service/system principals, so ordinary callers never receive
  the header even if they send the debug header.

Existing global-mode behavior is unchanged.
