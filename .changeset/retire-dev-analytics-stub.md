---
'@objectstack/plugin-dev': patch
'@objectstack/runtime': patch
---

Retire the dev-mode `analytics` stub, and make the dispatcher gate `/analytics` on `handlerReady` rather than on service presence (#4000).

Retiring the degraded analytics shim (#3891) made an empty `analytics` slot the honest signal: `/api/v1/analytics/*` 404s and discovery reports `unavailable`. `plugin-dev` refilled that slot with a stub, which re-created the retired shape in dev mode — the dispatcher gated on "is a service registered", so the stub was called like a real engine and its empty result came back as a 200.

- `plugin-dev` no longer registers an `analytics` dev stub; the slot stays empty (`NO_DEV_STUB_SERVICES`). Every other dev stub is unchanged.
- The `/analytics` domain, its route-mount gate, and discovery's `routes`/`features` now share one predicate (`isAnalyticsServiceServeable`): a service that self-declares `handlerReady: false` (ADR-0076 D12 — `__serviceInfo`, or plugin-dev's legacy `_dev: true`) is treated as an empty slot. A `degraded` implementation that genuinely serves requests keeps serving; `discovery.services.analytics` still reports a registered stub as `status: 'stub'`, which says more than `unavailable` would.

FROM → TO for dev setups that relied on the stub answering `POST /api/v1/analytics/query` with `{ rows: [], fields: [] }`: install the real engine — `@objectstack/service-analytics` runs an InMemory strategy and needs no database of its own. Nothing else changes; hosts that already install it (including `os serve`, where `analytics` is in `ALWAYS_ON_CAPABILITIES`) are unaffected.
