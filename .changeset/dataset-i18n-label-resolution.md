---
"@objectstack/service-analytics": patch
---

fix(service-analytics): a dataset `label` written as an inline locale map reaches the wire resolved, instead of being dropped (#6761)

`I18nLabelSchema` has authorized two forms of a display label since #5728: a
plain string, and an inline locale map `{ en: 'Owner', 'zh-CN': '负责人' }`. The
analytics producer only understood the first one, so a dataset written the way
the schema documents came back with **no label at all**:

| dataset declares | `fields[]` carried, before |
|---|---|
| `label: 'Owner'` | `label: 'Owner'` |
| `label: { en: 'Owner', 'zh-CN': '负责人' }` | *(no `label` key)* |
| *(no label)* | *(no `label` key)* |

Measured identically on both strategies. All three renderers that read
`fields[].label` first — `DatasetWidget`, `DatasetPreview`,
`DatasetReportRenderer` — then fell back to humanizing the raw key, so a Chinese
deployment authoring exactly what the spec documents got English-ish machine
names for its column headers.

One layer earlier, `dataset-compiler` substituted the machine **name** for the
same map (`typeof d.label === 'string' ? d.label : d.name`), which additionally
made `/analytics/meta` publish `title: 'owner'` as a *display title* — a face
that lied rather than one that was merely bare.

Both are fixed by calling the shared `I18nLabel → string` resolver
(`resolveI18nLabel`, `@objectstack/spec`, #6765), which is pinned in its own
package to rule parity with objectui's `pickLocalized`. Nothing is
re-implemented here: the maintainer's ruling on #6761 chose one shared resolver
precisely so the two ends cannot answer the same authored map differently.

**The wire is unchanged.** `AnalyticsResult.fields[].label` is still
`string | undefined` on both ends — this resolves *to* a string rather than
widening the contract, so no consumer changes and no map can reach a renderer
that would print `[object Object]`.

**Which locale each site uses:**

* `queryDataset`'s two field-enrichment sites resolve at
  `ExecutionContext.locale` — the per-request BCP-47 tag derived from the
  caller's `Accept-Language`, falling back to the workspace `localization`
  setting. Both sites read one hoisted value, so a single response cannot mix
  two audiences.
* `dataset-compiler` resolves with **no** locale, i.e. the resolver's documented
  nullish answer `en`. A compiled Cube is a registry artifact shared by every
  later reader, and `getMeta()` — the `/analytics/meta` face — takes no
  execution context at all; baking a request locale there would make
  `/analytics/meta` answer whoever queried last.

**Nothing is invented on a miss.** A label the resolver cannot resolve (an
absent label, or an empty map) writes no `label` key on the wire at all — a
placeholder would permanently pre-empt the real label under the downstream
`if (field.label == null)` guard. In the compiler, where `Metric.label` /
`Dimension.label` are required strings, the machine-name fallback is unchanged
from before; it never reaches `fields[]`, so it cannot pre-empt anything either.
