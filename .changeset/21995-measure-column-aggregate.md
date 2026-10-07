---
"@objectstack/spec": minor
"@objectstack/service-analytics": minor
---

feat(spec,analytics): a dataset answer's measure column states its aggregate, labelled or not (`fields[].aggregate`)

Clause-②: yes (widening)

- **What a renderer can now read.** Each measure column of a dataset answer (`POST /analytics/dataset/query`) carries `fields[].aggregate`: the aggregate its dataset measure declares, in the closed `AggregationFunction` vocabulary (`count`, `sum`, `avg`, `min`, `max`, `count_distinct`). It is there whether or not the author gave the measure a `label`. So a chart can tell a count from a sum, for example to draw whole-number axis ticks for a count instead of 0.75 / 1.5 / 2.25.
- **What was missing.** The only aggregate on the wire was `builtinAggregate`, and it is present only when the measure has no `label`. A labelled measure, such as a `count` named "Tasks", reached the wire as `{ name, type: 'number', label }`, with nothing to say what kind of number it was.
- **Where it is set.** `AnalyticsService` writes it in the one step that describes a dataset answer's columns from the dataset's own measures. That step runs for both the live query and the draft-data preview, so the two answers agree. A measure's `__compare` column carries the same aggregate.
- **Where it is absent.** Dimension columns. Derived measures, which combine other measures and have no single aggregate (a stray `aggregate` written beside `derived` is ignored when the dataset compiles, so it is not stated here either). And a cube query answer (`POST /analytics/query`), which does not run through the dataset column step.
- **Unchanged.** `builtinAggregate` keeps its meaning: present only on a label-less measure column, to mark a header that is the server's default. No authoring key is added; `aggregate` is a response member only. `AnalyticsResultResponseSchema` and the `AnalyticsResult` contract declare the member, and the REST route relays it as it does every other column key.
