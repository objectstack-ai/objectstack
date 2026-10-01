---
'@objectstack/spec': patch
---

docs(spec): the `DashboardWidgetOptionsSchema` doc comment states which widget `options` keys a renderer reads, instead of naming presentation extras (`icon`, `trend`, `columns`, `striped`, `density`) it called renderer-understood

Clause-②: no — no key is declared and no value is typed, so the accept set is unchanged.

`options` still parses any key. A widget always binds a `dataset`, so it renders through
objectui's dataset-bound path, and that path reads only the five declared keys
(`dateGranularity`, `sortBy`, `sortOrder`, `limit`, `stageOrder`) and the `description`
sub-caption. Any other key parses and renders nothing. To format a number, set `format` and
`currency` on the dataset measure. To accent a tile, set the widget's `colorVariant`. To style
a chart, set the widget's `chartConfig`.
