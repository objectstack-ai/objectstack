# @objectstack/observability

Vendor-neutral observability primitives for the ObjectStack framework.

```ts
import {
  type MetricsRegistry,
  type Logger,
  NoopMetricsRegistry,
  ConsoleMetricsRegistry,
  OtlpHttpMetricsRegistry,
  JsonLogger,
  SEMCONV,
} from '@objectstack/observability';
```

## What lives here

Three contracts plus matching exporters:

| Contract           | Implementations                                                            |
| ------------------ | -------------------------------------------------------------------------- |
| `MetricsRegistry`  | `Noop`, `InMemory`, `Console`, `OtlpHttp`                                  |
| `ErrorReporter`    | `Noop`, `InMemory`, `Console`                                              |
| `Logger`           | `Noop`, `Console`, `Json`                                                  |

Plus `SEMCONV` — canonical Prometheus-style metric names emitted by the
framework runtime and services.

## Wiring

Pick one registry per deployment.

Self-hosted (any K8s with an OpenTelemetry Collector):

```ts
const metrics = new OtlpHttpMetricsRegistry({
  endpoint: 'http://otel-collector:4318',
  resource: { 'service.name': 'objectos', 'deployment.environment': 'prod' },
});
```

Cloudflare Workers are handled in `apps/cloud` — see that repo's exporter
(`new AnalyticsEngineRegistry(env.AE)`).

Local dev:

```ts
const metrics = new ConsoleMetricsRegistry();
```

Tests:

```ts
const metrics = new InMemoryMetricsRegistry();
expect(metrics.totalCounter('http_requests_total', { status: '500' })).toBe(0);
```

The runtime, service-storage, service-cache, and service-package
accept a `MetricsRegistry` and emit the standard names from `SEMCONV`.
Hosts swap implementations at deployment time without touching
business code.

## Design rules

1. **Never throw.** Every metric / log / report call site must survive
   a broken sink.
2. **Low cardinality.** Use `route` (pattern), not the raw URL; use
   `shard`, not the tenant id.
3. **OTLP buffer is flush-on-demand**, not interval-driven. Long-running
   hosts call `flush()` on a schedule; Workers call it inside
   `ctx.waitUntil` at the end of a request.
4. **No vendor SDKs.** This package depends only on `@objectstack/spec`.
   Vendor-specific exporters (Sentry, Cloudflare AE, Datadog) live in
   the deployment repos that need them.

See `docs/design/observability.md` (TBD) for the full architecture and
the deployment-side wiring contracts.
