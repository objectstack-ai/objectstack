---
"@objectstack/spec": minor
"@objectstack/lint": patch
---

feat(spec): `ChartAggregateSchema` / `ChartGroupBySchema` reject unknown keys instead of dropping them (#5583, #4001 批 15's last two sites)

`<ObjectChart aggregate={{ … }}>` is the react tier's object-bound chart binding,
and until now a key it did not declare was **silently stripped by the parse**.
`groupby` for `groupBy` degraded the chart to a single ungrouped point, `fn` for
`function` fell back to the default, `dateGranularty` for `dateGranularity`
turned off date bucketing — each with `os build` / `os validate` fully green.
That is #4001's founding failure mode, on the surface an AI page author is most
likely to write.

Both object shapes are `strictObject` now, so an undeclared key is a named
rejection carrying the surface, the offending key and a rename:

```
Unrecognized key(s) on this chart aggregate: `groupby`.
Did you mean `groupby` → `groupBy`? Until #5583 an undeclared aggregate key was
dropped at parse — …
```

Curated beyond edit distance where the near-miss is semantic rather than a typo:
`fn` / `agg` / `aggregation` → `function`, `measure` → `field`, and the ADR-0021
dataset vocabulary an author carries over from the other binding mode
(`dimension` / `category` → `groupBy`). Wrong-LAYER keys get a prescription
instead of a rename — `dateGranularity` written *beside* `groupBy` did nothing at
all and now says where it belongs; `alias`, `filter`, `objectName` and a
`measures` array are pointed at the surface that owns them.

**Why this took two issues.** `.strict()` is a property of a PARSE, and until
#5020 nothing parsed these schemas: the react-page publish gate re-derived the
vocabulary by hand. Closing them first would have shipped a precisely-validated
door with nothing behind it (#4583). #5020 wired the parse; this is the posture.

**The zod-4 union collapse is load-bearing here.** `groupBy` is a union, so the
`unrecognized_keys` its strict arm raises never reaches `error.issues` — zod
reports one `invalid_union` whose own message is the bare string `"Invalid
input"`. What carries the named rejection to the author is `packages/lint`'s
`describeIssue` arm unpacking, pinned end to end on both sides.

**`groupBy` stays REQUIRED — the product question this pair raised is answered,
and the answer does not move the schema.** An ungrouped single-value chart is
not a supported `<ObjectChart>` shape: the single-value need is served by the
separate `object-metric` block, the example corpus authors zero ungrouped
`<ObjectChart>` aggregates, and objectui's `schema.aggregate?.groupBy ||
schema.xAxisKey` reads are optional-chained on `aggregate` itself — they serve
charts with **no aggregate at all**, not ungrouped ones. #5020's `warning`-level
tolerance for an absent `groupBy` therefore stays a tolerance rather than
becoming a blessing; its hint now states the ruling.

**Upgrading:** if a chart aggregate carried a key this schema does not declare,
it was already being ignored — the rejection names it and prescribes the fix. No
legal declaration changes meaning.
