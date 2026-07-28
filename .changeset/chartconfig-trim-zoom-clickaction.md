---
'@objectstack/spec': minor
---

**BREAKING** `ChartInteraction` drops `zoom` and `clickAction`; `stepSize` / `description` / `height` are delivered (issue #3752)

The tail of the declared-≠-delivered sweep from #3729. Five `ChartConfig` props
reached the renderer and did nothing; each got the ADR-0078 call — honor it, or
remove it. Three were honored (objectui#2885), two are removed here.

**Removed — `ChartInteraction.zoom` and `ChartInteraction.clickAction`.** Both
were redundant against something the platform already delivers, which is why
neither had a consumer anywhere in the framework, the console, the showcase, or
the skill corpus:

- `zoom` had no renderer primitive behind it, and `brush` already narrows a
  range. **Migration:** `interaction: { brush: true }`.
- `clickAction` competed with two click owners that *do* work — `drillDown`
  (opens the filtered records, which is what a segment click is almost always
  for) and, in the react tier, the host's own `onSegmentClick`. A third, silent
  owner only invited authors to wire a click that never fired.
  **Migration:** `drillDown`, or handle the click in React.

`ChartInteraction` is now `{ tooltips, brush }` — both honored. This follows the
#1475 precedent: trim what cannot be cleanly delivered, implement the rest, and
leave nothing declared-but-inert in between.

**Delivered — `ChartAxis.stepSize`, `ChartConfig.description`, `ChartConfig.height`**
(objectui#2885). `description` and `height` join `<ObjectChart>`'s published
`dataProps` now that they do something; `stepSize` rides along inside
`xAxis`/`yAxis`. Their schema descriptions say what they actually do rather than
restating their names.

Breaking, but shipped as `minor` per the launch-window convention (see
`scripts/check-changeset-no-major.mjs`). Off-spec `zoom`/`clickAction` keys are
stripped by Zod rather than rejected, so no stored metadata fails to parse — the
break is at the TypeScript type level for anyone constructing a
`ChartInteraction` in code.
