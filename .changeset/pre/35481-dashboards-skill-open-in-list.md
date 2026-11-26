---
'@objectstack/skills': patch
---

docs(skills): the dashboards rule says a drill on a relationship-path dimension offers no "Open in list" link today

Clause-②: no
Metadata-protocol: none

objectstack-ui's `rules/dashboards.md`, Drilldown: the **Escape hatch — "Open in list →"** bullet said the drill drawer's header always links to the object's full list page. It now adds the exception: today a dimension whose field is a relationship path (`account.industry`) drills into the drawer only, with no link. The drawer still lists the records and a row still opens its record. The list page's `filter[...]` URL has no spelling for a condition on a related record, so the console offers no list destination for that drill instead of a wider list.

The Reports paragraph of the same section loses its closing clause ("peek the records, click a row to open one, or "Open in list →" for the full list page"). It restated the three bullets above it and repeated the same promise; the paragraph still says reports drill the same way through the identical drawer. Removing it pays for the new sentence: the file is 2 bytes smaller.

`content/docs/ui/dashboards.mdx` states the same exception in its Drill-down section and in the renderer note below it. No code path changes.
