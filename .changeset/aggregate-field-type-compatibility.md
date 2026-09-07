---
"@objectstack/spec": minor
---

feat(spec): declare the aggregate × field-type compatibility matrix a dataset measure is judged against — `AGGREGATE_FIELD_TYPE_COMPATIBILITY` and `isAggregateCompatibleWithFieldType` (#16353, spec half of #16099)

A dataset measure pairs an `aggregate` with a `field`, and nothing between author and driver correlated the two: `avg` over a `Field.datetime` compiled to `AVG(col)` and reached the backend, where one SQL family averages the column's storage form and another rejects the call — one metadata document, two answers. Which pairs are accepted is a contract, so it is now declared once in `@objectstack/spec/data`:

| Aggregate | Accepted field types |
|---|---|
| `count`, `count_distinct` | every `FieldType` |
| `sum` | `number`, `currency`, `rating`, `slider`, `progress`, `summary` — the numeric class EXCEPT `percent` (a rate does not add; `isIncoherentAggregate` already says so) |
| `avg` | the numeric class, `percent` included |
| `min`, `max` | the numeric class plus `date`, `datetime`, `time` — both return a value of the field's own type |
| every other pair | refused |

The ruling (director, decision batch #59, 2026-09-06) named its buckets by category; the table resolves them against the real `FieldType` membership through the `field-value.zod` semantic classes: "numeric" is `NUMERIC_VALUE_TYPES` (`integer` is a driver-internal column alias, not a `FieldType` — the integer-valued authorable members are `rating` / `slider` / `progress`); "temporal" is the three temporal classes, `time` included because its stored form is a dialect question exactly like `date` / `datetime` (native TIME on Postgres and MySQL, canonical `HH:MM:SS[.fff]` TEXT on SQLite), the canonical form orders chronologically on every dialect, and `AnalyticsResult.fields[].type` already describes `min` / `max` over it as temporal (#15768). `formula` is refused for arithmetic aggregates whatever its declared `returnType`: it is virtual in SQL storage, no column exists to aggregate.

Two refused rows override existing opinions and are recorded as such, not presented as agreement. **Booleans** are refused for `sum` / `avg` / `min` / `max` by the ruling's "every other pair: refused", while maintainer ruling #11152 already has every backend answer them as numbers (`sum(flag)=3`, `avg(flag)=0.5`, `min(flag)=0`, `max(flag)=1`, pinned in the spec's `AGGREGATION_CASES`; `driver-sql` casts the aggregand on Postgres to make it hold). That refusal is therefore not grounded in backend divergence; whether booleans belong in those rows is a collision between two rulings and is referred to the maintainer as its own decision — the row ships exactly as batch #59 stated it. **The string classes** are refused for `min` / `max` here, while `service-analytics` (#15768) already types `min` / `max` over them as a supported `'string'` result; the refusal is defensible (string order is collation-dependent) but it overrides that opinion.

**The narrowing, stated plainly.** Every pair outside the table — `avg` × `datetime`, `sum` × `boolean`, `min` × `text`, `sum` × `percent`, and so on — is an authoring shape `DatasetMeasureSchema` accepts today and will be REFUSED once the two consumer legs land: the compile-time refusal in the dataset compiler (#16099) and the authoring-time lint rule (its devx sub-card). A measure whose pair is refused is fixed by changing the aggregate to one the field's type supports (`min` / `max` for a temporal field; `avg` for a `percent`; `count` for anything), never by widening the table.

**Not breaking in this release, `minor` on purpose.** This changeset ships a table and a predicate that nothing yet enforces: `DatasetMeasureSchema` accepts byte-for-byte what it accepted before, no export is removed or narrowed, and no runtime path reads the table yet. It is an additive widening of the published surface — two new exports in `dist/*.d.ts` — which the maintainer ruling of 2026-09-04 (decision batch #35) puts at `minor`. The refusal itself arrives with the consumer legs, whose changesets carry the breaking declaration, its migration prescription and the ADR-0087 disposition; this one names the narrowing so an upgrading author can read the contract before it is executed.

`isIncoherentAggregate` is unchanged and stays the semantic opinion beside this table. The two diverge on exactly one pair: `count_distinct` × `percent` is flagged there and accepted here (the ruling reads `count_distinct` as "any type"). That divergence is pinned in the table's test and reported on #16353 rather than resolved silently.
