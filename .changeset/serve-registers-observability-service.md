---
"@objectstack/cli": patch
---

`objectstack serve` now registers `ObservabilityServicePlugin`, so the `observability:metrics` service actually resolves for every consumer that follows the canonical resolution chain.

`serve.ts` built one metrics registry from `OS_OBS_EXPORTER` and threaded it into a single consumer (the dispatcher). Nothing in the repo registered the service itself, so the cache and storage adapters walked the documented chain — explicit option, then `observability:metrics`, then a no-op — and held a `NoopMetricsRegistry` in every shipped deployment, however `OS_OBS_EXPORTER` was set.

The registry is now built once and registered as a service ahead of the transport, the dispatcher and the capability providers, because every consumer resolves the chain during its own `init()`. Measured on a booted showcase app with `OS_OBS_EXPORTER=console`: `storage_operations_total` and `storage_operation_duration_ms` now emit where they previously emitted nothing, and the cache adapter now holds the configured registry instead of the no-op. `http_requests_total` is unchanged — it was already armed transport-wide by the dispatcher through the `IHttpServer.afterResponse` seam, and the per-server latch keeps it at exactly one observer.

Deployments that leave `OS_OBS_EXPORTER` unset or set to `noop` are unaffected: nothing is registered, and the transport still installs no per-request middleware.
