---
"@objectstack/service-analytics": patch
---

fix(analytics): scope the dimension-label lookup to the referenced object's RLS (#3602)

When a dataset groups by a `lookup`/`master_detail` dimension, analytics resolves
the grouped FK ids to the related record's display name via a per-record read
(`group by id`) dressed as an aggregate. That read carried **no read scope**, so
it revealed related-record display names whenever the referenced object's RLS is
stricter than the base object whose rows carry the id — a user could see a name
the referenced object's own RLS would hide. (Same-object and looser-referenced
cases were already safe because the ids come from the post-#3597 scoped
aggregate; this closes the stricter-referenced case.)

The label lookup now applies the **referenced object's own** read scope — bound
to the request via the same `getReadScope` provider the aggregate path uses,
composed with `$and` (never key-merge) so it can't be displaced by the id
predicate. Fail-closed: if that object's scope can't be resolved, the dimension's
labels are skipped (the raw id renders) rather than fetched unscoped. No behaviour
change when no read-scope provider is configured.

Internal `DimensionLabelDeps.fetchRecordLabels` gains an optional `scope` argument
and `resolveDimensionLabels` an optional `resolveScope` resolver; both are
service-analytics-internal (no spec/contract change).
