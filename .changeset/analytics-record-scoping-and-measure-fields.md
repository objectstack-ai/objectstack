---
"@objectstack/plugin-security": minor
"@objectstack/service-analytics": minor
---

fix(security,analytics): scope /analytics/query to the caller's readable records, and refuse a measure over a missing field (#4467, #4437)

Two defects on the analytics query path, both found by the v17 verification run
(#3909 / #4482), both reproduced against a live showcase server before the fix
and re-verified with the same requests after.

## #4467 — `/analytics/query` applied no record-level scoping

`ISecurityService.getReadFilter` documents itself as "the same filter the engine
middleware AND-s into every find", and exists precisely for paths that bypass
that middleware — its own doc comment names the analytics raw-SQL path. But the
chain it mirrors is TWO sibling middlewares: plugin-security's RLS injection and
plugin-sharing's owner/share visibility filter (`buildSharingMiddleware` AND-s
`buildReadFilter` into `ast.where` for `find`/`findOne`/`count`/`aggregate`).
Only the RLS half was ever computed here, and analytics has no other source of
scope, so the OWD/share predicate simply never existed on that path.

Live repro: `showcase_private_note` is `sharingModel: 'private'`; an admin owns
5 notes, a member holds read shares on exactly 2 and no `viewAllRecords`.
`GET /data/showcase_private_note` correctly returned 2 for the member, while
`POST /analytics/query {measures:['count']}` returned 5 — and adding
`dimensions:['title']` returned all five titles, i.e. the VALUES of a column
that caller may not read, not merely a bad count. Any authenticated caller who
could reach `/analytics` could enumerate the field values of every row of any
object exposed as a cube, regardless of OWD, sharing rules, or RLS.

`getReadFilter` now resolves plugin-sharing's `buildReadFilter` through the
late-bound `sharing` service and AND-composes it with the RLS filter — the same
composition the two middlewares reach by both writing into `ast.where`. It also
computes the ADR-0057 D1 `__readScope` depth that the security middleware
normally stashes on the context for plugin-sharing to widen its owner-match
with, using the same `getEffectiveScope` call the middleware makes: no
middleware runs on this path, and without it a caller granted `unit`/`org` read
depth would be silently narrowed to `own`. The sharing predicate is resolved for
every non-system caller AHEAD of the RLS stand-down branches, because those are
the RLS middleware's own early exits and none of them is a reason to drop a
sibling middleware's predicate; a sharing-resolution failure denies outright
rather than falling through to half a scope.

**Why `minor` rather than `patch`.** This is an observable behaviour change on a
public read surface, in the narrowing direction: analytics results that a
principal could previously read they now cannot. Counts drop, `dimensions`
groupings lose rows, and any dashboard, report, or export built on
`/analytics/query` over an owner-private object will show smaller numbers for
non-superuser principals — correctly, but visibly. Deployments that had (however
unknowingly) come to depend on the unscoped totals will see them change on
upgrade, so this warrants more than a patch-level note even though it is a
security fix. No API signature changed: `ISecurityService.getReadFilter`'s
declaration is untouched — the implementation merely started honouring the
contract it already documented.

## #4437 — a measure naming a missing field 500'd with SQLITE_ERROR

`inferMeasure('ghost_sum')` maps a suffix convention onto a field name and has
no way to know the field exists, so it built `SUM(ghost)`, the driver threw
`no such column`, and the caller got
`500 {"code":"SQLITE_ERROR","message":"Internal server error"}` — a driver error
class as the `error.code` for what is a plain typo, which ADR-0112 forbids. A
dotted spelling took the same path (`measures:['total.sum']` prefix-strips to
`sum` → `SUM(sum)` → 500). The DATA route has refused the identical mistake with
a `400 INVALID_FIELD` naming the field since #4315/#4254.

`AnalyticsService.ensureCube` now validates each measure's resolved source field
against the backing object's field names before any SQL is built, and rejects
with the same envelope the data route produces (`400 INVALID_FIELD` carrying
`field`, `object`, `param`, `measure`) so one mistake has one shape across
`/data` and `/analytics`. The new `getObjectFieldNames` config hook reads the
same schema registry `isRegisteredObject` already consults and the data path's
own gate reads, so "which fields exist" has a single answer across both routes.

The gate is tiered exactly like the #3867 cube-inference gate, deliberately
narrow: it applies only when the cube's `sql` is a bare object name (an authored
cube whose `sql` is a real SQL expression has no field list to check against),
only when the probe answers (no data engine, or an external datasource whose
columns are not mirrored locally, stands down), and only to measures whose
source is a bare column — `count(*)` has no source field, and a dotted
cross-object reference resolves through a join this layer cannot see, so both
pass through untouched. `id`/`created_at`/`updated_at` are admitted
unconditionally, matching the data path's `resolveQueryFields`: a gate stricter
than the engine it guards would reject queries that used to work. Validation
runs before the cube is registered, so a rejected query leaves no trace in the
registry — otherwise a retry would find a "registered" cube carrying the bogus
measure and sail straight into SQL.

This half is `minor` for the same envelope reason: a request that used to return
500 now returns 400 with a different `code`, which is a visible contract change
for any caller branching on the response.
