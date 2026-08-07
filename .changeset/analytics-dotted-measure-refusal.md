---
"@objectstack/service-analytics": patch
---

fix(service-analytics): refuse a dotted `measures` entry loudly instead of aggregating the base column (#5918)

**Observable behaviour change.** An analytics query whose `measures` entry
carries a dot that is not the cube-name qualifier — `owner.region_count_distinct`,
`total.sum` — now answers `400 INVALID_FIELD` naming the entry **as the request
spelled it**. Some of these queries used to succeed.

That is the point: succeeding is what was wrong with them. The auto-inference
path minted a measure by dropping the first segment of any dotted entry, so on
an object that happened to carry a same-named column the query ran

```
SELECT COUNT(DISTINCT region) AS "owner.region_count_distinct" FROM "crm_account"
```

— no JOIN, no error, a response column labelled with a relation attribute and a
number that came from the base table. The caller could not tell from the result
that it was wrong. Where the object had no same-named column it degraded to the
#4437 gate's `400 INVALID_FIELD`, which was honest about what reached SQL
(`aggregates field 'score'`) but named a string nobody had written; the caller
had sent `owner.score_sum`.

`measures` was the fourth and last mint site of the punctuation #5739 sorted
out on `dimensions` / `where` / `timeDimensions`. It is ruled the other way, and
deliberately so: `lookupMember`'s relation-traversal tier is dimension-only, so a
dotted measure has no correct traversal answer to converge on. A refusal is the
honest answer, and it costs nothing that was working. Maintainer ruling,
2026-08-07.

Both a genuine traversal intent (`owner.amount_sum`) and a plain typo
(`total.sum`) get this refusal. They are lexically indistinguishable on this
path, and separating them would need field metadata the ad-hoc path does not
have. A real relation-traversal measure (`SUM("owner"."amount")` + LEFT JOIN)
would be a capability with its own justification, not a side effect of a strip.

The refusal is applied at both places a Metric is minted from a request
spelling — the ad-hoc mint and the suffix-augmentation mint for a cube that is
already registered — because the ad-hoc path registers what it infers, so the
very same query reaches the second one from the second request onwards.

Unchanged: the `<cube>.` qualifier (`crm_account.region_count_distinct`) is
still stripped and still runs; bare measures (`region_count_distinct`, `count`,
`created_at_max`) are untouched; a cube's own declared measure is authored, not
minted, so a Cube whose measure names a related column in its `sql` still
compiles the JOIN — which is the supported way to aggregate across a
relationship; and dotted **dimensions** still traverse, per #5739.

**Migration.** Aggregate one of the object's own fields
(`<field>_sum` / `_avg` / `_min` / `_max` / `_count_distinct`), or declare a Cube
whose measure names the related column. The refusal message says both, and names
the entry you sent.
