---
"@objectstack/objectql": minor
---

fix(objectql)!: `having` on `engine.aggregate` resolves `{placeholder}` tokens through the resolver `where` uses, so an unknown one is refused `FILTER_TOKEN_UNKNOWN` / 400 instead of keeping no group with a 200; and the per-aggregation `filter`'s temporal and text-operator refusals name `aggregations[i].filter` instead of `where` (#20334)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) this change adds no transition to migrate. A refused `having` comparand is a `{placeholder}` the resolver cannot resolve: a token outside the vocabulary, which `having` compared as its own literal text, or a context token the request carries no value for. Neither was ever an accepted spelling with a meaning to preserve, and there is no spelling it can be mechanically rewritten to: which token or which literal the author meant is an authoring decision, and the refusal lists the resolvable tokens. `having` is a request-only key that no metadata type stores, so there is no stored document for `objectstack migrate meta` to rewrite. The tables below record the answer each input had and has; they prescribe no rewrite. -->

**BREAKING**: this narrows what `having` accepts on `engine.aggregate`, and on the REST aggregate query (`POST /data/:object/query`) that forwards it there. A `{placeholder}` in `having` is now resolved by the same resolver, with the same refusals, as one in `where`, once per query, before any driver is asked for a row, on both the native `driver.aggregate()` path and the in-memory fallback. It ships as `minor` under the launch-window convention for accept-set narrowings.

Measured before and after through `engine.aggregate` and `POST /data/:object/query`, on InMemoryDriver, SqlDriver on SQLite and SqlDriver on PostgreSQL 16, on both `having` paths, four groups whose `max(placed_on)` falls between 2026-01-02 and 2026-03-01:

| `having` | before | now | the same token in `where` |
|:--|:--|:--|:--|
| an unknown token: `{ last_placed: { $gte: '{not_a_token}' } }`, or a near miss such as `'{TODAY}'`, on any column, under `$and` / `$or` / `$not` or as an `$in` member | 200, keeps no group | `FILTER_TOKEN_UNKNOWN` / 400, no read | the same refusal, in the same words |
| `'{current_user_id}'` with no user on the request, `'{current_org_id}'` with no active organization, `'{record_id}'` always | 200, keeps no group | `FILTER_TOKEN_UNRESOLVED` / 400, no read (a REST request with no user is answered 401 before it reaches the engine, as before) | the same refusal |
| a known token: `{ last_placed: { $gt: '{current_year_start}' } }` on `max(placed_on)` | compared as its own text, which sorts after every digit: keeps no group | compares as `'2026-01-01'`: keeps all four | resolved |
| any known token, as a comparand, an `$in` member or a `$between` endpoint, under `$and` / `$or` / `$not` | compared as its own text (on a date or datetime column, `$gt` / `$gte` kept no group and `$lt` / `$lte` every group) | the groups the resolved value keeps, the same as that value written out | resolved |
| `{ customer_id: '{current_user_id}' }` on a groupBy key, as user `c2` | keeps no group | keeps `c2` | resolved |

Tokens resolve the way they do in `where`: a date macro to a `YYYY-MM-DD` day (a sub-day macro to an ISO instant) in the request's timezone, `{current_user_id}` and `{current_org_id}` from the request. A string that only contains braces (`'a{b}c'`) is not a placeholder and compares as written, as in `where`. The `having` doors run first, as `where`'s do: a clause an earlier `having` door refuses (an unknown key, an unknown operator, a comparand its temporal column cannot read) keeps that refusal and its words.

**The per-aggregation `filter`'s refusals name their position.** A comparand a declared temporal field cannot read, and a text operator aimed at a field that never holds a string, in `aggregations[1].filter` said `at where.placed_on.$gt` / `at where.amount.$contains`, a `where` the author did not write. They now say `at aggregations[1].filter.placed_on.$gt` / `at aggregations[1].filter.amount.$contains`, as that filter's list-shape and comparand-type refusals already did. The code (`INVALID_FILTER`), the status (400) and every other word are unchanged at the engine. Over REST, the message keeps its existing 500-character bound: a `date` field's refusal of a string such as `'not-a-date'`, which fitted within it, now loses the end of its remedy (`"{current_month_s…` at the shortest path), and the refusals that already exceeded the bound still do.

**Who is affected.** `having` is a request-only key (`QuerySchema.having`, `EngineAggregateOptions.having`), and no metadata type stores it. The five `having` clauses in this repository's docs and published skills compare a numeric aggregation alias with a number, and none carries a placeholder; no runtime code or example app in this repository composes a `having`. Callers of `engine.aggregate` and of the REST aggregate query in a deployment were NOT measured.

**Fix.** For an unknown token, write one the resolver knows (the refusal lists them: `{today}`, `{current_quarter_start}`, `{30_days_ago}`, `{current_user_id}`, …) or the literal value. For `{current_user_id}` / `{current_org_id}`, send the request with a user or an active organization.

**Unchanged**, measured identical before and after on the three drivers, both paths and both doors: every `where` answer, placeholders and refusals included; every `having` that carries no placeholder, its refusals in their words; every per-aggregation `filter` answer other than the two refusals' paths above, placeholders included.
