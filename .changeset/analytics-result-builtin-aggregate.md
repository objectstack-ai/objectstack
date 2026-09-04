---
"@objectstack/spec": minor
"@objectstack/service-analytics": minor
---

feat(spec,analytics): `AnalyticsResult.fields[].builtinAggregate` — a closed discriminator for a measure column whose display name is the server's built-in default (#14492)

**What a consumer sees.** `queryDataset()` (and `POST /api/v1/analytics/dataset/query`,
which relays the result verbatim) now carries an optional
`fields[].builtinAggregate?: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct'`
on a measure column. It is present exactly when the dataset measure behind the
column declares an `aggregate` and **no** `label` — the producer then has nothing
but the aggregate to name the column by, so it says which aggregate that is. It is
absent whenever the author declared a label (a plain string or an inline locale
map, even one with no entry for the request locale: an author's text is never
re-labelled by a consumer), and absent on dimension columns and derived measures.
The vocabulary is `AggregationFunction` (`data/query.zod.ts`), the one closed
aggregate enum — no second spelling. `AnalyticsResultResponseSchema`
(`api/analytics.zod.ts`) mirrors the member, refusing a spelling outside the enum.

**Why.** An AI-built dashboard's "count of customers by status" chart showed the
English axis title "Count" on a Chinese UI. The renderer (objectui
`buildChartSeries()` / `labelOf()`) treats `fields[].label` as resolved author
content and passes it through verbatim — correctly, since a real custom label
("Tasks") must survive. What it could not tell apart was an author's text from
the server's built-in default for a bare `count`. Guessing from the label text
was refused (it would catch an author who really named a field `Count`, and break
the moment the default is spelled in another language); translating on the
server was not taken (it copies the front end's language decision into the
producer and leaves nothing for a per-widget override). The ruling (2026-09-02,
option B) is a structured discriminator on the contract: the consumer prefers a
locale lookup keyed by `builtinAggregate` — mirroring its existing
`report.aggregate.*` keys — and falls back to `label`, then `name`.

**Producer-side changes.**

- `@objectstack/service-analytics` — `queryDataset`'s measure enrichment sets
  `builtinAggregate` from the dataset measure's own `aggregate` when the measure
  has no authored `label`. Judged on the authored key, never on the resolved
  string.
- `@objectstack/spec` — the `dataset` create seed (`metadata-create-seeds.ts`)
  drops its hardcoded `label: 'Count'` from the seeded `count` measure, so a
  dataset created from Studio is a built-in default (wire: `builtinAggregate:
  'count'`) instead of an authored English literal. `getMeta()` for such a
  dataset now titles the metric by its name (`count`) rather than `Count`;
  `CubeMeta.measures[].type` already carried the aggregate there.

Purely additive: no key is removed or renamed, no authorable schema changes shape,
and a consumer that ignores the member sees exactly the response it saw before.
