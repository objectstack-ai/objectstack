---
'@object-ui/i18n': patch
---

fix(app-shell): the dashboard's Add-widget menu and the widget Type select offer every widget type the spec accepts, from one registry

Clause-②: no
Metadata-protocol: none

Studio's two dashboard widget-type pickers kept their own lists and disagreed with each other and with the spec: the Add-widget menu offered 11 types, the inspector's Type select 10 (no `scatter`), and `ChartTypeSchema` accepts 20, all of which a dashboard draws. Both pickers now read one registry derived from `ChartTypeSchema`, so they offer the same 20 types and follow the spec when it changes.

- The `studio` namespace gains the names of the newly offered types: `engine.inspector.widget.type.*` for `column`, `scatter`, `treemap`, `sankey`, `combo`, `gauge`, `solidGauge`, `kpi`, `bullet` and `radar`, and `engine.widgetPicker.type.*` for the same types except `scatter`, in en and zh.
- `engine.inspector.widget.datasetHint` no longer mentions an "inline object query above", which the widget inspector has not had since ADR-0021; it describes the dataset, dimension and measure controls the inspector shows.
