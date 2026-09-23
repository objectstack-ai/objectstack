---
"@objectstack/platform-objects": patch
---

fix(platform-objects): decide the `dataset` panel en-echoes per leaf, and derive the panel pin (#19403)

The `dataset` metadata form — the ADR-0021 analytics semantic-layer editor — shipped its English
source in `zh-CN`, `ja-JP` and `es-ES` on 24 string leaves: the type display pair, all four section
headings, and both string leaves of its seven non-repeater fields. An author working in one of those
locales read English on the whole panel while the thirteen repeater row properties inside it, and the
`report` editor next to it, were translated.

Each leaf was decided on its own evidence, not translated wholesale: the verdicts, their per-leaf
reasons and the `en` source each was judged against are recorded in
`dataset-panel-echo-decisions.test.ts`, which also derives the panel population from the `en` catalog
so a key added to this form is caught rather than missed.

Two groups of tokens stay **English**, on an authored precedent rather than by habit:

- the strict-enum values the measures section names — `sum/avg/count/…` (`AggregationFunction`) and
  `ratio/sum/difference/product` (`DerivedMeasureOp`), both `z.enum` inside a `strictObject`. Rendering
  them as words would tell an author in their own language to write a token the schema refuses. The
  precedent is `report.fields.type.helpText`, which keeps `tabular/summary/matrix/joined` verbatim in
  all three locales;
- the machine tokens an author types — `lookup` / `master_detail`, `relationship.field`, the worked
  example `account.region`, and the `FROM` / `ON` SQL keywords the prose names. The precedent is
  `object.fields.fields.reference.helpText`, which keeps `tree` and `lookup` verbatim inside otherwise
  translated prose.

Catalog values only. No key is added, renamed or removed in any bundle (24 insertions / 24 deletions
per translated bundle, a pure value replacement), no schema or export moves, and the three
`*.source-hashes.generated.ts` provenance tables lose exactly the 24 rows per locale that recorded
these leaves as unauthored extractor fills.

Why `patch` rather than `skip-changeset`: `@objectstack/platform-objects` is not private and ships
`files: ["dist", …]`, and `src/metadata-translations/index.ts` imports all three translated bundles, so
the new leaves are published — measured on the built output rather than assumed.
