---
"@objectstack/core": minor
"@objectstack/objectql": minor
"@objectstack/service-analytics": minor
"@objectstack/service-automation": patch
"@objectstack/spec": patch
---

feat(filters): evaluate `{filter-token}` placeholders server-side (#3582)

Filter values travel as JSON, so a time- or user-scoped slice writes a
placeholder instead of code:

```ts
filter: { close_date: { $gte: '{current_year_start}' }, owner: '{current_user_id}' }
```

The vocabulary has been in `@objectstack/spec` for a while (`date-macros.zod.ts`,
`context-tokens.zod.ts`) and `objectstack build` rejects tokens outside it
(#3574). What was missing is the half that *substitutes a value*: **nothing on
the server ever did**. A placeholder reached the driver as the literal string
`'{current_year_start}'`, compared as text, and matched nothing.

That failure is invisible — an empty widget looks exactly like a metric that is
legitimately zero — so apps worked around it by computing dates at module load,
which freezes "this year" into the built artifact and quietly goes stale.

**New: `resolveFilterTokens()` in `@objectstack/core`**, wired into the two
server-side seams every filter passes through:

- **ObjectQL read path** — `find` / `findOne` / `count` / `aggregate`, so REST
  queries, related lists, saved-view filters and flow `find_records` all resolve.
  It runs before the middleware chain, so only author-supplied filters are
  inspected; RLS/sharing filters are injected downstream from concrete values.
- **Analytics dataset executor** — a dataset's intrinsic `filter`, a widget's
  `runtimeFilter`, measure-scoped filters, and time-dimension `dateRange`s.
  This path needs its own call: `NativeSQLStrategy` compiles raw SQL and binds
  comparands directly, so a dashboard widget never passes through `engine.find()`.

Behavioural notes:

- Date tokens resolve to ISO strings (`YYYY-MM-DD`, or a full timestamp for
  `{now}` / `{N_hours_ago}` / `{N_minutes_ago}`). Turning that into a column's
  on-disk form stays the driver's job (`SqlDriver.temporalFilterValue`), so
  there is still exactly one source of truth for the storage convention.
- Calendar boundaries follow `ExecutionContext.timezone`; one instant is pinned
  per filter tree, so a `>= {current_month_start}` / `< {next_month_start}` pair
  can never straddle a boundary.
- `{current_org_id}` reads `ExecutionContext.tenantId`; `{current_user_id}` reads
  `userId`. A request carrying neither now **throws** instead of resolving to
  `null` — a null comparand degrades to `IS NULL` on most drivers and would hand
  back the rows the filter was written to exclude.
- An unrecognised placeholder **throws**, carrying the near-miss fix
  (`{current_user}` → `{current_user_id}`, `{this_quarter_start}` →
  `{current_quarter_start}`). This matches what `objectstack build` already
  enforces. Consequence, previously implicit and now load-bearing: a filter value
  that is *entirely* `{...}` is always read as a placeholder, so a literal value
  of that shape is not expressible — rename the value.

Also in this change: `notify` no longer sends the six-character string
`"undefined"` as an audience member. `to: ['{record.owner.manager}']` walks
`.manager` on a scalar foreign-key id, resolves to nothing, and `String(undefined)`
turned that into a phantom recipient — the emit "succeeded", addressed nobody,
and said nothing. Unresolved recipients are now dropped, and a node with no
recipient left fails naming the offending template and pointing at the start
node's `config.expand` (#3475), which does hydrate the relation.
