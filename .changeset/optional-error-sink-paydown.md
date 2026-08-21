---
"@objectstack/cloud-connection": patch
"@objectstack/metadata-protocol": patch
"@objectstack/plugin-approvals": patch
"@objectstack/plugin-audit": patch
"@objectstack/plugin-auth": patch
"@objectstack/plugin-email": patch
"@objectstack/plugin-reports": patch
"@objectstack/plugin-sharing": patch
"@objectstack/plugin-webhooks": patch
"@objectstack/service-knowledge": patch
---

**Contract tightening (types only, no runtime behaviour change):** twelve logger
sink types that declared an optional `error` now declare a **non-optional**
`warn`, so a durability report always has somewhere to land (#9754, #10556).

`error` stays optional on every one of them — hosts legitimately inject reduced
sinks, and requiring `error` was measured and rejected as #9754 option C. What
changes is that its *absence* now has a declared, guaranteed destination. Call
sites keep the `logger?.warn?.(…)` spelling as the backstop for hosts the type
cannot reach.

Who has to change: a caller that hands one of these sinks an object with **no
`warn` method**. Every construction site in this repo already supplies one, so
the in-tree cost was zero; an external embedder passing a reduced `{ info }` or
`{ error }` sink will now see a compile error, which is the point — that caller
was silently discarding the reports.

The sinks: `PluginContext['logger']` (cloud-connection), `IndexMigrationLogger`
(metadata-protocol), `MinimalLogger` (plugin-approvals lifecycle-hooks),
`AuthEventAuditLogger` and `ReadAuditLogger` (plugin-audit), `LoggerLike` and
`ReconcileMembershipDeps['logger']` (plugin-auth), `ReclaimLogger`
(plugin-email), `ReportServiceOptions['logger']` (plugin-reports),
`MinimalLogger` (plugin-sharing bulk-recompute), `OptionalLogger`
(plugin-webhooks) and `KnowledgeLogger` (service-knowledge).

Three forwarding seams were tightened with them, because `tsc` reported that
they would otherwise re-open the silence one module downstream of where it was
closed: `MinimalLogger` in plugin-sharing's `rule-hooks.ts` and
`record-share-cascade.ts`, and `AuthManagerConfig['logger']` in plugin-auth.
The last of those is the only externally visible one: `AuthManager`'s `logger`
option stays optional, but a logger that *is* supplied must now carry `warn`.
