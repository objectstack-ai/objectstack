---
"@objectstack/service-analytics": patch
---

fix(service-analytics): gate the `/analytics/query` SQL echo on debug, as the contract has always declared (#8286)

`POST /api/v1/analytics/query` returned the executed statement to the caller in
`data.sql` on every deployment, `NODE_ENV=production` included, with no debug
flag requested and none available to request. The contract had declared the
field debug-only since it was introduced — `AnalyticsResultResponseSchema`
(`spec/api/analytics.zod.ts`) types it `optional()` and describes it as
"Executed SQL (if debug enabled)" — but no implementation ever read a debug
switch. This restores declared = enforced. **The contract is unchanged; the
response now matches it.**

**What was disclosed.** More than table and column names. The echoed statement
carries the compiled read scope, so it describes the SHAPE of the tenant
isolation predicate: on the reported deployment it showed that `sys_user` is
walled by an enumerated `"sys_user"."id" IN ($2, $3, …)` member list rather than
by an `organization_id` comparison — that is, which column the wall is built on
and how — plus the bound-parameter arity, which counts the caller's own
organization's membership and hands a prober the exact query surface to work
against.

**No wall was breached.** This is information disclosure and nothing more. The
reporter ran the isolation probes on the same deployment and every one held:
cross-tenant read answered 404, cross-tenant update and delete answered 403 at
row-level security, a `filter`/`where` naming another organization came back
empty, a batch write by foreign id answered per-row `PERMISSION_DENIED`, and the
audit log and activity stream were partitioned cleanly. The wall works; it
simply should not have been describing itself to callers.

**The gate is one gate.** It lives at the response-assembly seam —
`AnalyticsService.query`, the single point every strategy's result leaves
through — not on any one strategy. `NativeSQLStrategy` returns the statement it
ran, `ObjectQLStrategy` renders a representative one, and the fallback delegate
passes through whatever the service it delegates to minted (the in-memory
analytics service always echoes); gating one of the three would have left the
others serving. `queryDataset` reaches the same seam through `DatasetExecutor`,
so dataset-backed dashboard and report responses inherit the verdict without a
second gate to keep in step.

**The switch, and its default.** New `debugSql` option on
`AnalyticsServicePlugin` (forwarded to `AnalyticsServiceConfig`). Unset means no
host choice, which resolves to `NODE_ENV === 'development'` — and only that: an
**unset** `NODE_ENV` counts as production and the echo stays off, matching how
`os start`, `os serve` and `os doctor` already read that absence. Of the two ways
to be wrong, disclosing on a production deployment whose operator forgot the
variable is the dangerous one.

It is deliberately a HOST switch with no request field behind it: a
caller-settable debug flag would let any tenant reopen the disclosure on demand,
which is the shape of the defect rather than a fix for it. It is also
deliberately separate from the plugin's existing `debug` option, which stays
server-side log verbosity only — raising log level on a live deployment must not
widen what travels to a tenant.

**Unaffected.** `POST /api/v1/analytics/sql` — the dedicated dry-run route that
exists to hand back a statement — is not gated and behaves exactly as before; it
is where an author debugging a widget should look. Rows, `fields`, `totals`,
drill-through metadata, error envelopes and every gate on the query path are
untouched, and no shipped consumer read the echo (the Studio console does not
render it).
