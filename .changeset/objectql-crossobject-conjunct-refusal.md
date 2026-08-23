---
"@objectstack/service-analytics": minor
---

**BREAKING**: `/analytics/query` now refuses a cross-object filter nested inside a
combinator on the ObjectQL path, instead of silently answering the wrong number
(#10759).

`ObjectQLStrategy` runs one cross-object envelope check, from two call sites.
`generateSql()` (the `/analytics/sql` preview) asked it about every member the
`where` touches, flattened out of the filter tree. `execute()` asked it about the
built engine filter — where an AND-ed leaf sits at the top level and is seen, but
anything structural (an `$or`, a `$not`, a nested `$and` that cannot merge) has
been folded into `filter.$and`, so the only key readable for it was the literal
`$and`, which is never a field name.

One query therefore got two answers, measured over one fixture in one run:

```
where: { $or: [{ 'account.region': 'West' }, { stage: 'won' }] }

before   /analytics/sql     400 INVALID_FIELD  cross-object filter "account.region"
         /analytics/query   200, rows
after    both               400 INVALID_FIELD  cross-object filter "account.region"
```

`engine.aggregate` cannot join. The half that returned rows was not answering the
cross-object query: the disjunct naming a column the base object does not have
can never match, so the query silently collapsed to its remaining branches and
reported a narrower figure as if it were the answer. Both call sites now derive
the member list from one shared view, so the invariant the strategy already
stated for itself — the preview accepts and rejects the same set the execution
door does — holds by construction rather than by two call sites agreeing.

Who is affected: a deployment whose driver reports `objectqlAggregate` but not
`nativeSql` (Mongo, the memory driver), running an analytics query that puts a
related object's field inside `$or` or `$not`. Such a query now returns
`400 INVALID_FIELD` naming the member. The refusal already existed and already
had these words; what changed is that the execution door reaches it too. Nothing
an author writes in metadata changes, no stored shape is affected, and queries
whose combinators name only base-object fields are untouched — that set is pinned
in `crossobject-conjunct-refusal.test.ts` alongside the new refusal, because a
fix that refused every combinator would have looked identical from the refusal
side alone.

The remedy for an affected query is the one the error message has always carried:
run it on a native-SQL driver, which can join, or drop the cross-object member
from the filter.

<!-- adr-0087: not-required (no-migration-prescription) A runtime query-shape refusal on /analytics/query, not a metadata surface: no authorable key, export or config field is removed or renamed, so `objectstack migrate meta` has nothing to rewrite and an upgrader has no stored shape to convert. The affected input is an ad-hoc request body, and the error itself names the member and the two ways out. -->
