---
'@object-ui/plugin-dashboard': patch
---

fix(plugin-dashboard): a KPI tile drops a subtitle that repeats its title, and draws a long figure whole on a data screen

Clause-②: no
Metadata-protocol: none

- **No repeated subtitle.** Every metric tile in the package (the dataset-bound tile on a dashboard, `MetricWidget` and through it every `object-metric` block, and `MetricCard`) now picks its subtitle through one rule, `metricTileSubtitle`: the first candidate whose localized text is not the localized title (compared after trimming, collapsing spaces and folding case). The Chart Gallery's "Avg Progress / 47.0 / Avg Progress" now reads "Avg Progress / 47.0": a measure label equal to the title draws no caption, a description equal to the title gives way to the measure label or the trend label, and a distinct subtitle is drawn as before. The title's tooltip no longer repeats a line.
- **A long figure on a data screen.** The `bare` face (`variant: 'bare'`, the big number data screens draw) now scales a long value before it clips, against the tile's own box, through the same size ladder the card tiles use (`METRIC_TILE_BARE_VALUE_LADDER`, 14 px up to the 32 px face), with the full figure as its tooltip. The Command Center's budget, `$1,090,000.00` in a 166 px tile, drew "$1,090,0…" at 32 px and now draws whole at 20 px; a short value keeps the 32 px face, and the value's line box stays 32 px so labels line up.

No metadata, server or `@objectstack/spec` change; an app that authors a description equal to its title needs no edit.
