---
'@object-ui/plugin-dashboard': patch
---

fix(plugin-dashboard): a dataset-bound `metric` tile captions its value with the widget's `description`, falling back to the measure label

Clause-②: no
Metadata-protocol: none

A `metric` dashboard tile drew the measure's label (for example "Total Amount") under its value, and the widget's `description`, which says what the number counts, only in the title's tooltip. When a widget declares a `description`, the tile now draws it as the caption under the value, in the measure label's place. A widget with no description (or an empty one) keeps the measure label as its caption. The measure label still rides in the title's tooltip, under the description, so it stays reachable at every tile width.

Both dashboard surfaces (`DashboardRenderer` and `DashboardGridLayout`) show the same caption. The tile keeps its two lines of text, and no new metadata key is read: `description` is the existing widget-level key of `DashboardWidgetSchema`.
