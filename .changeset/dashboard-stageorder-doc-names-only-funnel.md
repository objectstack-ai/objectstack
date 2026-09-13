---
"@objectstack/spec": patch
---

docs(spec): `options.stageOrder` no longer documents a chart type that cannot be built, and says plainly that only `funnel` reads it (#17344)

`DashboardWidgetOptionsSchema.stageOrder` is an ungated member of the open widget `options` bag, so its one sentence of prose is the whole author-time surface: nothing warns, nothing refuses, and a widget carrying the key renders with the authored order simply absent. That sentence said *"Explicit category order for ordered-sequence charts — `funnel` / `pyramid` stages above all"*, and it was wrong twice over.

- **`pyramid` is not a widget type.** It was removed from `ChartTypeSchema` as a variant that only ever rendered as `funnel`, and `chart.test.ts` pins that refusal alongside its fallback-only siblings — so the headline example in the option's own documentation could not be authored at all.
- **The plural framing promised more than the renderer delivers.** "ordered-sequence charts" and "stages above all" read as a statement about ordered marks generally. It is not one: `funnel` is the only type whose branch consults the forwarded order, measured against this repo's pinned objectui renderer.

The corrected JSDoc and `.describe()` name `funnel` only, state outright that no other widget type reads the key, and send the other types to `sortBy` / `sortOrder`, which lower into the dataset query itself. The generated reference page (`content/docs/references/ui/dashboard.mdx`) is regenerated from the new `.describe()`.

No schema shape changes: `stageOrder` still parses exactly as before, on every widget type. Whether the key should be *gated* to the type that honours it is ADR-0049 enforce-or-remove on an accepted key — a published-surface narrowing, and deliberately not this change; it stays open on #17344 together with the locale-dependent order/colour drop, which lives in the objectui renderer rather than here.
