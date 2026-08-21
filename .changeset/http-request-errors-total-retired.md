---
"@objectstack/observability": minor
"@objectstack/runtime": minor
"@objectstack/spec": minor
---

fix(observability): **BREAKING** — `http_request_errors_total` is retired (ADR-0049 enforce-or-remove, #9834)

**⛔ If you have a Grafana panel, an alert rule or a recording rule keyed on
`http_request_errors_total`, it will read a FLAT ZERO after this upgrade.** That
zero is the removal, not a healthy server, and it is the one way this change can
hurt you — nothing throws, nothing warns, the series simply stops receiving
samples. Rewrite the query before you deploy.

Maintainer ruling 2026-08-20: **RETIRE**. The name was declared in `SEMCONV` as
part of a stable namespace *"so hosts can wire alerts/dashboards against it"*,
but the only emitter was `@objectstack/runtime`'s `instrumentRouteHandler`,
applied only by the dispatcher's own route Proxy — so the series never saw
auth's `getRawApp()` mount, the REST data API via `RouteManager`, or any other
inbound surface. Its two siblings in the same HTTP family moved to the
`IHttpServer.afterResponse` transport seam (`http_requests_total`, #9650/#9835;
`http_request_duration_ms`, #9834/#10004) and this one could not follow:
`HttpResponseObservation` carries `{method, routePattern, status, elapsedMs}`
and **no throw signal of any kind**, so every transport-side shape would have
counted a *different* population rather than the same one more widely.

Migration (FROM → TO):

| Wrote | Write instead |
|---|---|
| `rate(http_request_errors_total[5m])` in a panel or alert | `rate(http_requests_total{status=~"5.."}[5m])` — emitted by the transport, so it covers every inbound surface instead of the dispatcher's routes only |
| `sum by (route) (http_request_errors_total)` | `sum by (route) (http_requests_total{status=~"5.."})` |
| `SEMCONV.httpRequestErrorsTotal` / `RUNTIME_METRICS.httpRequestErrorsTotal` in host code | Delete the read. Both members are gone; `tsc` reports the missing property at the read site. |

One-line fix: replace the metric name with `http_requests_total{status=~"5.."}`.

<!-- adr-0087: registered http-request-errors-total-retired -->

**The replacement is wider, not merely different.** The retired counter was
divergent from a 5xx rate in *both* directions, measured: the dispatcher answers
its own errors through `errorResponseBase`, which sets a status and does **not**
re-throw — so the counter **missed** those — while its `catch` incremented
unconditionally, so a **thrown 4xx WAS counted** as an error. And
`http_requests_total` already carries a `status` label, so a status-class error
counter was fully derivable from data the transport already publishes. Prove the
new query wider rather than merely non-empty: make an auth route or a REST
data-API route answer 5xx and confirm it moves, where the retired counter would
not have moved at all.

**If what you were actually alerting on was "a handler threw rather than
returning an error envelope"** — the one signal this counter uniquely carried —
that is the `errorReporter`, not a metric. Wire an `ErrorReporter` adapter
(Sentry / Datadog / your own); it still fires on every 5xx throw and is
untouched by this change.

What is NOT removed: `http_requests_total`, `http_request_duration_ms`,
request-id propagation, the 5xx error reporter, and the
`res.__obsRecordedError` side channel that carries a swallowed error to it. The
dispatcher still instruments every route it mounts; it just no longer publishes
a fourth series whose name promised more coverage than it had.
