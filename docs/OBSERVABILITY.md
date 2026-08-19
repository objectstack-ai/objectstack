# Observability

> `@objectstack/runtime` ships pluggable observability primitives so production deployments can wire Prometheus / OpenTelemetry / Sentry without the framework taking a hard dependency on any of them.
>
> **See also:** [Production HTTP Hardening](./HARDENING.md) — security headers, rate limiting, CSRF, JWT/session lifecycle.

## TL;DR

`createDispatcherPlugin` automatically instruments every route it mounts with:

- **Request id** propagation: honors incoming `X-Request-Id` (or mints `req_<uuid>`); echoes on the response.
- **`http_request_errors_total{method,route}`** counter (incremented on thrown errors).
- **Error reporting** for 5xx (handler-thrown or via `errorResponseBase` side channel).

**`http_requests_total{method,route,status}`** (1 per request) and
**`http_request_duration_ms{method,route}`** are emitted at the **transport**,
through the `IHttpServer.afterResponse` observation seam — so they cover
*every* inbound request on the server (auth, REST data API, raw-app mounts,
requests a middleware refused with 429), not only the routes the dispatcher
registers. That is what keeps the two derived signals below consistent with
each other: a 5xx-rate panel and a p95-latency panel drawn over the same
traffic.

> **⚠️ `http_request_duration_ms` measures the REQUEST, not the handler.** It
> used to be emitted by the dispatcher's per-route wrapper and timed
> `await handler(req, res)`; it is now the transport's `elapsedMs` — from the
> transport first seeing the request to the response existing, so the
> middleware chain and body parse are included. Samples can only move UP.
> Compare p95 across that boundary deliberately. The `route` label is always the registered **pattern**
(`/api/v1/data/:id`), never the concrete path; requests no route matched are
labelled `unmatched`. Exactly one counter is armed per server (first wiring
wins), so handing one registry to both the transport plugin and the dispatcher
never double-counts.

> **A transport that does not implement the `afterResponse` seam reports no
> HTTP metrics.** On such a transport `http_requests_total` stays flat while
> traffic flows: zero there means "not instrumented", never "no traffic". Ask
> with `typeof server.afterResponse === 'function'` before reading absence as
> coverage. (The dispatcher degrades on those transports by counting its own
> routes, which is all it can see.) The shipped Hono adapter and the
> `@objectstack/http-conformance` node adapter both implement the seam.

Defaults are no-op (zero overhead). Inject real adapters via the `observability` config:

```ts
import { createDispatcherPlugin } from '@objectstack/runtime';

createDispatcherPlugin({
  observability: {
    metrics: myPromMetrics,             // implements MetricsRegistry
    errorReporter: mySentryReporter,    // implements ErrorReporter
    generateRequestId: () => crypto.randomUUID(),  // optional
    requestIdHeader: 'X-Request-Id',    // optional
  },
});
```

## MetricsRegistry contract

```ts
interface MetricsRegistry {
  counter(name: string, labels?: Record<string, string>, value?: number): void;
  histogram(name: string, value: number, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
}
```

Naming follows Prometheus conventions (snake_case, unit suffix). All methods are
fire-and-forget; implementations **must not throw** on the hot path.

### Canonical metric names

```ts
import { RUNTIME_METRICS } from '@objectstack/runtime';

RUNTIME_METRICS.httpRequestsTotal       // 'http_requests_total'
RUNTIME_METRICS.httpRequestDurationMs   // 'http_request_duration_ms'
RUNTIME_METRICS.httpRequestErrorsTotal  // 'http_request_errors_total'
```

### Prometheus adapter (prom-client)

```ts
import { register, Counter, Histogram } from 'prom-client';
import type { MetricsRegistry } from '@objectstack/runtime';

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();

export const promMetrics: MetricsRegistry = {
  counter(name, labels = {}, value = 1) {
    let c = counters.get(name);
    if (!c) {
      c = new Counter({ name, help: name, labelNames: Object.keys(labels) });
      counters.set(name, c);
    }
    c.inc(labels, value);
  },
  histogram(name, value, labels = {}) {
    let h = histograms.get(name);
    if (!h) {
      h = new Histogram({
        name,
        help: name,
        labelNames: Object.keys(labels),
        buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
      });
      histograms.set(name, h);
    }
    h.observe(labels, value);
  },
  gauge(name, value, labels = {}) { /* analogous */ },
};

// Expose /metrics
fastify.get('/metrics', async (_req, reply) => {
  reply.type(register.contentType);
  return register.metrics();
});
```

> ⚠️ **Cardinality.** Never label by raw URL path (use the matched route
> template) or by user/org id. Both will blow up your TSDB.

### OpenTelemetry adapter

```ts
import { metrics } from '@opentelemetry/api';
import type { MetricsRegistry } from '@objectstack/runtime';

const meter = metrics.getMeter('objectstack-runtime');
const counters = new Map();
const histograms = new Map();

export const otelMetrics: MetricsRegistry = {
  counter(name, labels = {}, value = 1) {
    let c = counters.get(name);
    if (!c) {
      c = meter.createCounter(name);
      counters.set(name, c);
    }
    c.add(value, labels);
  },
  histogram(name, value, labels = {}) {
    let h = histograms.get(name);
    if (!h) {
      h = meter.createHistogram(name);
      histograms.set(name, h);
    }
    h.record(value, labels);
  },
  gauge(name, value, labels = {}) {
    // OTel gauges are async — typically you'd register an observable.
    // For point-in-time values, push to a metric you own outside this adapter.
  },
};
```

## ErrorReporter contract

```ts
interface ErrorReporter {
  captureException(error: unknown, context?: Record<string, unknown>): void;
}
```

The runtime calls this **only for 5xx responses**. 4xx are intentionally
excluded — client errors flood APM with noise and obscure real bugs. Track
them via the metrics counter (`http_requests_total{status="4xx"}`) instead.

Context passed by the dispatcher: `{ requestId, method, route }`. Reporters
are responsible for redacting sensitive fields from any additional context the
host wires in.

### Sentry adapter

```ts
import * as Sentry from '@sentry/node';
import type { ErrorReporter } from '@objectstack/runtime';

Sentry.init({ dsn: process.env.SENTRY_DSN });

export const sentryReporter: ErrorReporter = {
  captureException(err, ctx = {}) {
    Sentry.withScope(scope => {
      if (ctx.requestId) scope.setTag('request_id', String(ctx.requestId));
      if (ctx.method)    scope.setTag('method', String(ctx.method));
      if (ctx.route)     scope.setTag('route', String(ctx.route));
      Sentry.captureException(err);
    });
  },
};
```

### Datadog APM adapter

```ts
import tracer from 'dd-trace';
import type { ErrorReporter } from '@objectstack/runtime';

export const ddReporter: ErrorReporter = {
  captureException(err, ctx = {}) {
    const span = tracer.scope().active();
    if (span) {
      span.setTag('error', err);
      for (const [k, v] of Object.entries(ctx)) span.setTag(k, v);
    }
  },
};
```

## Request id correlation

Every response gets `X-Request-Id` (configurable header name). Handlers can
read it via `req.requestId`. Plug it into your structured logger:

```ts
const handler = async (req, res) => {
  const log = logger.child({ requestId: req.requestId });
  log.info('processing', { userId: req.user?.id });
  // ...
};
```

The incoming header is validated against `^[A-Za-z0-9._:-]+$` and length
≤ 200; malformed ids are silently replaced with a freshly-minted one. This
prevents log/header injection (`X-Request-Id: \r\nSet-Cookie: ...`).

## W3C Trace Context

The `parseTraceparent` helper is exported for hosts that want to wire the
incoming `traceparent` header into their OTel SDK:

```ts
import { parseTraceparent } from '@objectstack/runtime';

const tc = parseTraceparent(req.headers.traceparent);
if (tc) {
  // tc = { traceId, spanId, sampled }
  // Use with your OTel context — out of scope for the runtime itself.
}
```

We deliberately stop short of bundling OTel context propagation in the
runtime: the OTel API surface is large and host-specific (Node vs. edge vs.
browser), so we publish the parsing primitive and leave SDK wiring to the
host.

## Server-Timing (perf-tuning mode)

Per-request server-side timing can be surfaced to clients via the W3C
[`Server-Timing`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server-Timing)
response header. The browser DevTools **Network → Timing** panel renders these
phases inline, which makes it trivial to see where wall-clock time went on a
slow request without attaching a profiler.

```
Server-Timing: parse;dur=0.4;desc="Body parse", auth;dur=42;desc="Identity/session", db;dur=210;desc="6 queries", hooks;dur=18;desc="3 hooks", serialize;dur=7;desc="Response serialize", handler;dur=280;desc="Route handler", total;dur=355;desc="Total server time"
```

Reading it: the request spent 42ms resolving identity, 210ms across **6** SQL
queries (the count is the number to watch — six sequential round-trips is the
usual culprit behind an inexplicably slow list), 18ms in **3** business hooks,
and 7ms serializing the response. `db` and `hooks` are aggregates — one member
carrying the summed duration and the event count, not one member per query.

The header discloses internal phase durations, which is helpful for profiling
but also lets a caller fingerprint the backend, so disclosure is **gated**.
There are two ways to turn it on:

**Global** — every response carries the header. Flip this in staging, or
briefly on a production environment under active investigation:

```ts
new HonoServerPlugin({ serverTiming: true });
```

…or, for the default `os serve` server (which constructs the plugin for you),
via the environment (`OS_PERF_TIMING=1` and the older `OS_SERVER_TIMING=true`
are equivalent):

```bash
OS_PERF_TIMING=1 os serve
```

**Per-request** — available by default (unless hard-disabled below), with **no
redeploy**: the caller sends the request header

```
X-OS-Debug-Timing: 1
```

and the `Server-Timing` header comes back **only** when the request resolves an
**admin/service identity** (a platform/tenant admin, a service token, or an
internal system call). An ordinary user who sends the header gets nothing back —
they can never pull timings, so this is safe to leave available on a live
environment. This is the path to reach for when diagnosing "why is *this* request
slow?" against a running environment.

For a per-query breakdown, an admin sends `json` instead:

```
X-OS-Debug-Timing: json
```

which adds an **admin-only** `X-OS-Debug-Timing-Detail` response header — compact
JSON listing the slowest SQL statements (by shape), the single slowest, and the
query count:

```json
{"db":{"count":6,"totalMs":210.3,"slowest":{"sql":"select * from widgets where id = ?","dur":88.1},"queries":[{"sql":"select * from widgets where id = ?","dur":88.1}, …]}}
```

The statements are **parametrized** — knex's `?` placeholders, never the
bindings — so the query *shape* (the useful part for spotting N round-trips) is
exposed while literal row values never leave the server. The detail is
**admin-only even under global mode**: an ordinary caller who sends `json` still
gets the basic `Server-Timing` header (if global mode is on) but never the
`X-OS-Debug-Timing-Detail` payload. The list is capped and the labels sanitized
to header-safe ASCII.

To hard-disable both paths (no middleware registered at all), set
`serverTiming: false` explicitly.

When timing is emitted, every response carries `total` (the whole request,
measured by an outer middleware) plus the sub-phases the request path records
out of the box:

| Member | Recorded by | Meaning |
|:---|:---|:---|
| `total` | Hono server middleware | Whole request, wall-clock. |
| `parse` | HTTP adapter | Request-body parsing. |
| `handler` | HTTP adapter | Route-handler execution. |
| `serialize` | HTTP adapter | Response JSON encoding. |
| `auth` | Dispatcher | Identity / session resolution — the prime suspect for unexplained data-API overhead. |
| `db` | SQL driver | Total SQL time across the request; `desc` is the **query count** (folded from knex's per-query events, attributed to the originating request via `AsyncLocalStorage` so it is correct under concurrency). The basic header carries no SQL text; individual **parametrized** statements appear only in the admin-only `X-OS-Debug-Timing: json` detail payload. |
| `hooks` | ObjectQL engine | Total business-hook execution time; `desc` is the hook count. |

Each phase is recorded through a request-scoped collector that is a no-op when
the mode is off, so every one of them costs nothing on the normal path. The
`db` / `hooks` aggregates fold high-frequency events into a single member via
`countServerTiming` (below) rather than emitting one member per event.

### Recording your own phases

Timing is collected through a request-scoped `AsyncLocalStorage` collector, so
any code on the request's async call chain can add a phase without threading a
request object through every layer. The free functions are cheap no-ops when
the feature is off, so they are safe to leave in place permanently:

```ts
import { measureServerTiming } from '@objectstack/observability';

const rows = await measureServerTiming('db', () => engine.find(query), 'Primary query');
// → adds `db;dur=<ms>;desc="Primary query"` to the response when perf-tuning is on.
```

`startServerTiming(name)` (returns an `end()` callback) and
`recordServerTiming(name, dur)` are also available for manual instrumentation.
For a phase that fires many times per request (per query, per hook), use
`countServerTiming(name, dur, unit)` — it folds every call into one aggregate
member `name;dur=<sum>;desc="<count> <unit>"` instead of flooding the header:

```ts
import { countServerTiming } from '@objectstack/observability';

// each call adds to the running total + count for `db`
countServerTiming('db', queryMs, 'queries'); // → db;dur=<sum>;desc="<n> queries"
```

## Go-live checklist

- [ ] `metrics` adapter configured and `/metrics` (Prometheus) or OTel
      exporter wired.
- [ ] Verified `http_requests_total{status="2xx"}` increments under load.
- [ ] Verified `http_requests_total{status="5xx"}` increments when an
      endpoint deliberately throws.
- [ ] Verified `http_request_duration_ms` histogram has non-empty buckets.
- [ ] `errorReporter` adapter configured and at least one synthetic 5xx
      reaches your APM dashboard.
- [ ] Verified 4xx does **not** flood the APM.
- [ ] Log records include `requestId` field; cross-checked one against the
      response `X-Request-Id` header.
- [ ] Alerts wired: error rate, p95 latency per route.
- [ ] (Optional) `Server-Timing` verified in DevTools with global mode
      (`serverTiming: true` / `OS_PERF_TIMING=1`) on, confirmed **absent** for a
      normal request, confirmed the per-request `X-OS-Debug-Timing: 1` header
      returns timing **only** to an admin/service caller, and confirmed
      `X-OS-Debug-Timing: json` returns the `X-OS-Debug-Timing-Detail` payload
      **only** to an admin (never to an ordinary caller, even under global mode).
