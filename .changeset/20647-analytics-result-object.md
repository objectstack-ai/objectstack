---
'@objectstack/spec': minor
---

feat(spec): a dataset answer declares its base object as `object` (#20647)

Clause-②: yes (widening)

`AnalyticsResult` (`@objectstack/spec/contracts`) gains one optional member,
`object?: string`, and `AnalyticsResultResponseSchema` (`@objectstack/spec/api`)
mirrors it on `data`. It is the base object of the dataset the answer was
computed from, by machine name. Nothing is removed or renamed, and no existing
member changes meaning.

**For a consumer.** Code typed against `AnalyticsResult` can read `object` from a
`queryDataset` answer without a cast, and a parse with
`AnalyticsResultResponseSchema` keeps `data.object` where it used to strip it. The
contract asks every dataset answer to carry it, whatever dimensions are selected
and whether or not rows came back. A cube query answer has no dataset behind it
and carries none.

**Producers.** This release declares the member. `@objectstack/service-analytics`
sets it on every dataset answer once #20644 lands.
