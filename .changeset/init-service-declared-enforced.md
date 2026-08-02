---
'@objectstack/metadata': patch
'@objectstack/rest': patch
'@objectstack/cli': patch
'@objectstack/service-analytics': patch
'@objectstack/service-datasource': patch
'@objectstack/service-job': patch
'@objectstack/service-knowledge': patch
'@objectstack/service-queue': patch
'@objectstack/service-settings': patch
'@objectstack/service-storage': patch
---

Init-time service consumption is now declared everywhere, and the declaration is enforced (#4471, ADR-0116). A new CI gate (`check:init-service-contract`) walks every plugin's `init()` call graph — including private helpers, the shape that shipped #4420 — and errors on any init-reachable `getService('X')` of a workspace-provided service that is not covered by `dependencies`, `optionalDependencies`, or `requiresServices`. Eleven previously undeclared init-time consumers (metadata, rest, cli serve plugins, and seven services) now declare `optionalDependencies` on their providers, so the kernel orders them deterministically instead of by registration luck; each still degrades on purpose when the provider is not composed. Plugin authors: a best-effort init-time `getService` must declare its provider in `optionalDependencies` (declared tolerance) — the checker never exempts it.
