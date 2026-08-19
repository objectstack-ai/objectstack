---
"@objectstack/observability": patch
"@objectstack/plugin-hono-server": patch
"@objectstack/runtime": patch
---

fix(observability): emit `http_request_duration_ms` from the transport seam, so
p95 latency sees every inbound surface instead of dispatcher routes only
(#9834)

#9835 moved `http_requests_total` to the `IHttpServer.afterResponse` seam and
stopped there, which left the two derived signals the operator guidance names
inconsistent with each other: 5xx rate covered auth's `getRawApp()` mount and
the REST data API, while p95 latency still saw only the routes the dispatcher's
own `Proxy` wrapped. A missing latency panel is at least loud; the worse
reading is the p95 that IS drawn, computed from dispatcher routes only and
presented as the server's.

- `@objectstack/observability`: new `armHttpRequestDurationHistogram(server,
  metrics)`, the duration family's counterpart to `armHttpRequestCounter` —
  same `afterResponse` seam, its own `Symbol.for` first-wins latch, so a host
  that armed one family can still arm the other. `ArmHttpMetricResult` is the
  family-neutral spelling of the result union; `ArmHttpRequestCounterResult`
  stays as an alias.
- `@objectstack/plugin-hono-server`: `installHttpMetricsSeam` arms both
  families, so the transport owns every transport-observable HTTP metric in the
  shipped composition rather than splitting ownership across layers.
- `@objectstack/runtime`: the dispatcher offers its registry to the histogram
  seam as well, and `instrumentRouteHandler` gains
  `emitHttpRequestDurationMs` (default `true`) — passed `false` exactly when
  the transport implements the seam, which is what keeps the dispatcher's own
  routes at ONE observation instead of reintroducing the #9833 double count one
  family over.

**⚠️ The observation window changes with the emitter.** The per-route wrapper
timed `await handler(req, res)` — handler latency. The transport times from
first seeing the request to the response existing, so the middleware chain and
body parse are now included and samples can only move UP. This is the number a
latency panel should show (the request's latency, not one layer's share of it),
but it is a visible shift in an existing series: compare p95 across the upgrade
boundary deliberately. Documented in `docs/OBSERVABILITY.md` and the
production-readiness guide.

`http_request_errors_total` is deliberately NOT moved. The observation carries
no throw signal — only `{method, routePattern, status, elapsedMs}` — so a
transport-side emitter would have to key off a status class, which counts a
different population than "the handler threw". That is a semantics decision,
recorded on #9834 rather than guessed at here; the counter stays ungated on
every transport and keeps its documented meaning.
