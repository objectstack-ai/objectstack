---
"@objectstack/types": minor
"@objectstack/service-analytics": minor
"@objectstack/runtime": minor
"@objectstack/rest": patch
---

fix(analytics,runtime,types): gate cube auto-inference on object existence; stop the dispatcher boundary returning raw SQL (#3867)

Two independent defects on the `/analytics` surface, found while verifying #3770
against a real server. On an authenticated CRM dev server, before this change:

```
POST /api/v1/analytics/query {"cube":"sqlite_master","measures":["count"],"dimensions":["type"]}
→ 200 {"rows":[{"type":"index","count":262},{"type":"table","count":71},{"type":"view","count":1}],
       "sql":"SELECT type AS \"type\", COUNT(*) AS \"count\" FROM \"sqlite_master\" GROUP BY type"}
```

That is SQLite's internal schema table — never a registered object — read
successfully through the analytics endpoint. Not merely "the name reaches the
driver and errors": **any table the connection can see was readable.**

**① The cube name reached the driver as a table name.** `AnalyticsService.ensureCube`
auto-infers a minimal Cube when none is registered, with `cube.sql = <the queried
name>`. That is the intended "metric over an object" path — an `object-metric` KPI
widget queries `crm_account` with no authored Cube — but it accepted *any* string,
so the endpoint could aggregate over an arbitrary physical table. The
analytics-side twin of the data-path gap #3770 closed, and it was not covered by
that fix: #3770 gated the protocol's `analyticsQuery`, which is the *degraded
fallback*; a deployment with `@objectstack/service-analytics` installed runs the
real engine instead (`ctx.replaceService`).

Inference is now gated on the same schema registry the data path consults, via a
new optional `AnalyticsServiceConfig.isRegisteredObject` that `plugin.ts` wires
from the `data` engine's `getObject`. Three-way rule: a registered Cube runs
untouched (its `sql` is whatever it declares); an unregistered name that IS an
object still auto-infers exactly as before; neither → `CUBE_NOT_FOUND` / 404
raised before any SQL exists, naming both ways to make the request valid. With no
probe configured the gate stands down and warns once — the same tiering #3770
took for a missing registry. `generateSql` (`/analytics/sql`) is gated too.

**② The dispatcher boundary returned `err.message` verbatim.** `errorResponseBase`
is the single error exit for *every* route the dispatcher plugin mounts —
`/analytics`, `/packages`, `/i18n`, `/storage`, `/automation`, `/auth`,
`/notifications`, `/mcp`. `@objectstack/rest` has guarded its data routes against
driver dumps forever (`mapDataError`); this boundary guarded nothing, so any
driver error on any of those routes shipped its SQL to the client. Unlike ①, this
half is unconditional — it does not depend on the cube being invalid.

The leak heuristic moved out of `rest-server.ts` into `@objectstack/types` as
`looksLikeInternalErrorLeak` (both packages already depend on it) and is now
applied at both boundaries — one predicate, one place to widen when a new
dialect's phrasing shows up. `mapDataError`'s behaviour is unchanged. At the
dispatcher it applies **only to 5xx**: a 4xx message is a deliberate
business/validation answer and must reach the caller intact. Sanitising costs no
diagnostics — the untouched error still reaches `errorReporter` through the
existing `__obsRecordedError` side-channel.

**Also fixed in the same function:** `errorResponseBase` read only
`err.statusCode`, while domain errors across this codebase carry `status` (and
`HttpDispatcher.errorFromThrown` already reads `status` first). Every deliberate
4xx thrown through a dispatcher route — including #3770's `OBJECT_NOT_FOUND` on
the analytics fallback path — was rendered as a **500**. It now reads `status`
then `statusCode`.

**Behaviour change.** `/analytics/query` and `/analytics/sql` return 404
`CUBE_NOT_FOUND` for a cube that is neither registered nor a registered object;
previously the name was passed to the driver. Dashboards and KPI widgets pointed
at real objects or authored cubes are unaffected. A 5xx on a dispatcher route
whose message looks like a driver dump now reads `Internal server error` — check
server logs or your error reporter for the original.
