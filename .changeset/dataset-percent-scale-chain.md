---
"@objectstack/spec": minor
"@objectstack/service-analytics": minor
---

fix(spec,service-analytics): a percentage measure carries its SCALE, so a ratio of 1 is 100% (objectui#3136)

A `%` format string says how to PRINT a number, not what scale that number is
on — and the two readings collide at exactly `1`, which is both "100%" (a 0–1
ratio at full compliance) and "1%" (a single percentage point). With nothing on
the wire to tell them apart, renderers guessed from the value's magnitude and
resolved the collision the wrong way: an SLA / pass-rate dashboard reporting
`sla_rate = 1` displayed **"1.0%"** — "everything met the SLA" read as "1% met
the SLA" — on both the KPI card and the dataset table.

The scale was never actually unknowable; it just never left the server. A
measure declaring `derived: { op: 'ratio' }` is a 0–1 fraction *by definition*,
and a measure aggregating a `percent` field has whatever scale that field
stores. Both facts sit in metadata the enrichment pass already reads for the
ADR-0053 currency chain — which walks back to the source field, checks
`type === 'currency'`, and rides the resolved code onto the result column.
Percentages got no such treatment. They do now, through the same seam.

**`percentScaleOf(field)` (`@objectstack/spec/data`)** is the one place the
question is answered. A `percent` field stores a FRACTION unless it declares
`max > 1` (e.g. `min: 0, max: 100`), which marks whole-percent storage — the
same rule the percent edit widget already writes by, so a value round-trips.
Non-`percent` fields get no opinion: a plain `number` an author formatted with
a `%` keeps meaning exactly what their format string says.

**`AnalyticsResult.fields[].percentScale`** carries the answer: `'fraction'`
(`1` ⇒ "100%") or `'whole'` (`1` ⇒ "1%"), absent when the column is not a
percentage. `queryDataset` sets it from the measure's `derived.op === 'ratio'`
first, then the source field's scale. `currency` — emitted since ADR-0053 but
only ever written through a cast — is now declared on the same interface.

The config seam `measureCurrency` is renamed **`sourceFieldMeta`** and returns
`max` alongside `type`/`defaultCurrency`. The old name had already outgrown
itself: the date-bucketing path reads `type` through it to tell a `date`
dimension from a `datetime` one, and the percent chain is its third consumer.

Renderers that receive `percentScale` must scale by it rather than inferring
from the value; one that does not receive it (an older server) keeps whatever
fallback it has, so this is additive on the wire.

**Same widget family, second fix: an empty filtered group is a measured zero.**
A measure-scoped filter can exclude every row of a group the grid still lists,
and the database reports that by omitting the group from the supplementary
result — after the merge, indistinguishable from "not measured". For a COUNT or
a SUM it *is* measured: the answer is 0. `emptyGroupValueFor(aggregate)`
(`spec/data/aggregation-policy`) states which aggregates have an identity over
the empty set, and `queryDataset` fills it in once all supplementary merges are
done (a later measure's merge can append rows no earlier query saw). So
"0 of 12 paid" now reports `0` instead of blank, and a ratio built on it
computes to `0` instead of going null — the difference between a dashboard
saying "0% met the SLA" and saying nothing at all. `avg`/`min`/`max` keep their
null: there is nothing to average over an empty group, and flattening that to
zero would invent a measurement.
