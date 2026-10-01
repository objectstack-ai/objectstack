---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/service-analytics': minor
---

fix(service-analytics)!: the analytics native-SQL strategy declines an object an engine middleware is registered for, so the engine serves it and that object's read gates apply; the engine answers which objects carry one (`IObjectQLEngine.hasObjectMiddleware`) (#21080)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a correction of which analytics strategy serves a query that reads an object the data engine holds a per-object middleware for, decided at request time. No authorable key, spelling, value domain or stored metadata shape moves: every dataset, cube and dashboard parses as before, nothing stored is rewritten, and the only declaration change is ADDITIVE (one optional member on IObjectQLEngine, one public method on ObjectQL, one optional member on AnalyticsServiceConfig), so there is nothing for an author to convert and nothing for `objectstack migrate meta` to reach. The queries newly refused are refused at request time by the ObjectQL strategy's existing envelope, not by a schema. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers strategy routing and this diff adds none (not registered / already-registered); and the change is runtime behaviour plus additive declarations, not a removal from a published interface (not runtime-interface-only / type-surface-only). -->

**BREAKING**: this narrows what the analytics doors serve for one class of query. It ships as `minor` under the launch-window convention for narrowings.

**What changes.** On a SQL driver, `NativeSQLStrategy` compiled a query to SQL and ran it through the driver's raw-SQL seam, so no engine operation ran and no engine middleware did. It applied the security service's object admission and read filter and nothing else, so the read gates that live in the engine as per-object middlewares did not apply there: a caller admitted to such an object at object level read grouped results and counts over every row, rows about parent records that caller cannot read included. It now declines a query that reads (as its base object, a declared join, or through a relationship path) an object the data engine holds a middleware registered for. The ObjectQL strategy serves it through the engine with the caller's context, so the engine's middlewares run, and the analytics answer for that caller equals the data door's. On the stock composition the objects that move off the native path are `sys_comment`, `sys_activity` and `sys_attachment` (read gates), `sys_approval_request` (the snapshot redaction), and `sys_user_position` and `sys_permission_set` (write-side middlewares, which move as a side effect: a middleware does not declare its operation). No shipped dataset or dashboard reads any of them.

**What is newly refused.** A query on such an object that the ObjectQL strategy cannot serve is refused with that strategy's existing `400`, where the native strategy used to serve it: for example a dimension reached through a relationship path combined with a measure that cannot be recombined across it (`avg`, `count_distinct`). Correctness wins over the fast path for a gated object.

**It fails closed.** `AnalyticsServicePlugin` asks the data engine. An engine without `hasObjectMiddleware`, or no engine, cannot say, and the strategy declines then too: every query on such a host is served by the ObjectQL strategy, and the plugin says so once at `warn`. A host that constructs `AnalyticsService` with `executeRawSql` and without the new `hasObjectMiddleware` config member keeps the native path for every object and is told so once at construction.

**New, additive.** `IObjectQLEngine.hasObjectMiddleware?(objectName): boolean` (`@objectstack/spec`), `ObjectQL.hasObjectMiddleware(objectName)` (`@objectstack/objectql`): whether a `registerMiddleware(fn, { object })` names the object; a global registration (no `object`, or `'*'`) is keyed to none and is not counted. `AnalyticsServiceConfig.hasObjectMiddleware` (`@objectstack/service-analytics`), which the plugin fills from the data engine.

**Unchanged.** Objects no middleware names keep the native path. The middleware chain, `registerMiddleware` and every gate are unchanged.

**What to do after upgrading.** Nothing on the stock composition. A host whose `"data"` service is not ObjectQL should implement `hasObjectMiddleware` to keep the native path for ungated objects. A host that builds `AnalyticsService` itself with `executeRawSql` should pass `hasObjectMiddleware` from its engine.
