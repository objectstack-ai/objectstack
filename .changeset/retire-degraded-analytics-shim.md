---
"@objectstack/metadata-protocol": major
"@objectstack/objectql": major
---

fix(metadata-protocol,objectql)!: retire the degraded analytics shim — the `analytics` slot stays empty without service-analytics (#3891, #3878)

The protocol assembly (`assembleMetadataProtocol`, used by both
`MetadataProtocolPlugin` and `ObjectQLPlugin`'s built-in mode) used to register
a lightweight `analytics` fallback so `POST /api/v1/analytics/query` kept
answering on installs without `@objectstack/service-analytics`. That fallback
is **removed**, and with it the facade methods that existed only to serve it:
`ObjectStackProtocolImplementation.analyticsQuery` / `getAnalyticsMeta` (the
class no longer implements `AnalyticsProtocol`).

Why removal instead of repair (#3891):

- **It dropped the caller's ExecutionContext at the door.** The dispatcher
  passes `context.executionContext` (#2852), but the shim's `query` was
  unary — aggregation reached `engine.aggregate` with no context, the security
  middleware's empty-principal branch waved it through, and **no RLS or tenant
  predicate was injected**. An authenticated caller got a 200 with rows RLS
  would hide.
- **It ignored the contract filter.** `AnalyticsQuery`'s canonical filter field
  is `where`; the shim read only a non-contract `filters` key, so a
  spec-conformant filtered request silently returned a full-table aggregate.
- **Every security gate had to be built twice** (#3770 on the shim vs
  #3867/#3875 on the real engine) — the "duplicates logic only, harmless"
  assessment in ADR-0076 D10 did not survive contact with reality.

`getDiscovery()` stops hardcoding analytics as an always-on kernel service —
the entry is now computed from the service registry like every other optional
service (`enabled: false, status: 'unavailable'` and **no advertised route**
when absent), which also removes the pre-#2462 discovery lie the shim was
originally invented to make true.

**Migration.** Deployments that relied on the fallback (programmatic
`createStandaloneStack()` / `createObjectQLKernel()` embeds, hosts whose bundle
doesn't require `analytics`): install `@objectstack/service-analytics` and
mount `AnalyticsServicePlugin` — the real, context-aware engine. Without it,
`/api/v1/analytics/*` now answers **404 ROUTE_NOT_FOUND** (previously: 200 with
unscoped, unfiltered aggregates) and discovery reports
`analytics: { enabled: false, status: 'unavailable' }`. Callers of
`protocol.analyticsQuery(...)` / `protocol.getAnalyticsMeta(...)` must use the
`analytics` service (`kernel.getService('analytics')`) instead. `os serve`
default/full presets and managed environments already force the real engine and
are unaffected.
