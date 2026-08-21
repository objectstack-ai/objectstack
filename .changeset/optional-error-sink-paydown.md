---
"@objectstack/cloud-connection": minor
"@objectstack/metadata-protocol": minor
"@objectstack/plugin-approvals": minor
"@objectstack/plugin-audit": minor
"@objectstack/plugin-auth": minor
"@objectstack/plugin-email": minor
"@objectstack/plugin-reports": minor
"@objectstack/plugin-sharing": minor
"@objectstack/plugin-webhooks": minor
"@objectstack/service-knowledge": minor
---

**BREAKING** (compile-time only): twelve logger sink types that declared an
optional `error` now declare a **non-optional** `warn`, so a durability report
always has somewhere to land (#9754, #10556).

`minor`, not `major`: during the launch window this stack ships breaking changes
as `minor` — every publishable package versions in lockstep, so a `major` would
promote the whole release. `patch` would be wrong in the other direction, because
this *can* break a consumer's build.

`error` stays optional on every one of these types — hosts legitimately inject
reduced sinks, and requiring `error` was measured and rejected as #9754 option C.
What changes is that its *absence* now has a declared, guaranteed destination.
Call sites keep the `logger?.warn?.(…)` spelling as the backstop for hosts the
type cannot reach, so **no runtime behaviour changes**: nothing that printed
before stops printing, and nothing silent starts printing.

### Who has to change, and what to do

Only a caller that hands one of these sinks an object with **no `warn` method** —
for example `{ info }` or `{ error }` alone. Add a `warn` member; there is no
rename, no removal, and no stored value or metadata key to rewrite. Every
construction site inside this repo already supplied one, so the in-repo cost was
zero; the compile error is reserved for the callers that were silently discarding
these reports.

The affected types, by package:

- `@objectstack/cloud-connection` — the internal `PluginContext['logger']`
- `@objectstack/metadata-protocol` — `IndexMigrationLogger`
- `@objectstack/plugin-approvals` — the internal `MinimalLogger` of `lifecycle-hooks`
- `@objectstack/plugin-audit` — `AuthEventAuditLogger`, `ReadAuditLogger`
- `@objectstack/plugin-auth` — `ReconcileMembershipDeps['logger']`, the internal
  `LoggerLike` of `member-role-canonical`, and `AuthManagerOptions['logger']`
- `@objectstack/plugin-email` — `ReclaimLogger`, via `ReclaimAttachmentContentOptions`
- `@objectstack/plugin-reports` — `ReportServiceOptions['logger']`
- `@objectstack/plugin-sharing` — the internal `MinimalLogger` of `bulk-recompute`,
  `rule-hooks` and `record-share-cascade`
- `@objectstack/plugin-webhooks` — `OptionalLogger`, via `AutoEnqueuerOptions`
- `@objectstack/service-knowledge` — `KnowledgeLogger`

`AuthManagerOptions['logger']` is the one most likely to be reached from outside:
`AuthManager` is public surface, its `logger` option stays optional, and a logger
that *is* supplied must now carry `warn`. The only non-test construction site in
this repo passes the kernel `Logger`, whose `warn` is already required.

`ReportService` and `AutoEnqueuer` additionally stopped defaulting their logger
field to `{}`. The field is now honestly optional rather than holding an empty
object that declared it could report and discarded everything. Behaviour is
unchanged in both directions.

<!-- adr-0087: not-required (runtime-interface-only packages/plugins/plugin-auth/src/auth-manager.ts#AuthManagerOptions, packages/plugins/plugin-auth/src/reconcile-membership.ts#ReconcileMembershipDeps, packages/metadata-protocol/src/migrations/partial-index-probe.ts#IndexMigrationLogger, packages/plugins/plugin-audit/src/auth-event-audit.ts#AuthEventAuditLogger, packages/plugins/plugin-audit/src/read-audit.ts#ReadAuditLogger, packages/plugins/plugin-reports/src/report-service.ts#ReportServiceOptions, packages/services/service-knowledge/src/knowledge-service.ts#KnowledgeLogger) every tightened type is a plain TypeScript logger interface -- no Zod projection, no metadata surface, and none is referenced by one -- so `objectstack migrate meta` has nothing to rewrite. Nothing is removed or renamed and no stored value moves; the only consumer action is adding a `warn` member at a construction site the compiler names. -->
