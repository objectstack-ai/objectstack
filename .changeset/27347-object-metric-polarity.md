---
'@objectstack/spec': minor
'@object-ui/plugin-dashboard': minor
'@objectstack/skills': patch
---

feat(spec): an inline `object-metric` tile declares `polarity`, so a lower-is-better KPI draws a rise red

Clause-②: yes (widening)
Metadata-protocol: added (object-metric polarity)

A dataset measure has declared `polarity` since the dataset-bound KPI tile learned to colour its delta by it, but a page-level `object-metric` tile aggregates a field, not a dataset measure, so it had nothing to attach to and coloured its trend badge by direction alone: an average turnaround that rose 23% was drawn green.

- **Spec.** `ObjectMetricPropsSchema` (`ComponentPropsMap['object-metric']`) declares an optional top-level `polarity`, the dataset measure's own `DatasetMeasurePolarity` by reference: `higher`, `lower` or `neutral`. Any other value is refused at the key. `betterWhen`, `goodDirection` and `trendDirection` are pointed at `polarity`; a top-level `direction` is answered with both keys it could mean (`trend.direction` for the static badge's arrow, `polarity` for good news); `higherIsBetter` / `lowerIsBetter` get the three values.
- **Renderer.** `ObjectMetricWidget` forwards `polarity` to `MetricWidget`, which colours the badge it draws, the `compareTo`-derived one or the static `trend`, by the same rule the dataset-bound tile uses (`deltaToneClass`, now one shared helper): `lower` draws a rise red and a fall green, `neutral` draws it muted. The arrow always shows which way the number moved. The `object-metric` registration publishes the input.
- **Undeclared keeps today's colours exactly**: a rise green, a fall red. Nothing infers a polarity from the aggregated field's name.
- **Skills.** `objectstack-ui` `rules/dashboards.md` says an inline `object-metric` declares its own `polarity`.

Nothing to do for existing tiles. To use it, add `polarity: 'lower'` to an `object-metric` node whose number is better when it falls.
