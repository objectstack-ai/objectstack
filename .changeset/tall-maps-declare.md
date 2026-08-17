---
'@objectstack/spec': minor
---

Add the `map` visualization config block to `ListViewSchema` — the eighth
per-visualization block, alongside kanban / calendar / gantt / gallery /
timeline / chart / tree. `ListMapConfigSchema` (named like
`ListChartConfigSchema`, because the automation `map` flow node already exports
`MapConfigSchema`) declares the map renderer's documented read surface:
`latitudeField`, `longitudeField`, `locationField`, `titleField`,
`descriptionField`, `zoom` (1-20), `center` (`[latitude, longitude]`). All keys
are optional and none carries a default — when no camera is declared the
renderer fits the camera to the queried records. Before this block a
`type: 'map'` list view could not declare its field mapping at all
(`ListViewSchema` is strict), so a marker title field other than the renderer
default `name` was unreachable — the showcase task map rendered every marker
title as `undefined`. The showcase task map view now declares
`map: { titleField: 'title', locationField: 'location' }`.
