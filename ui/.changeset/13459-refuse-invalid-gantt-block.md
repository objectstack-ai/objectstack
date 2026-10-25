---
"@object-ui/plugin-gantt": patch
"@object-ui/app-shell": patch
---

Clause-②: no
Metadata-protocol: narrowed

An invalid `gantt` block is refused instead of drawn (objectui#13459). `ObjectGantt` used to log `Invalid gantt configuration` and render the block anyway, so a block with a misspelt or missing key still drew a chart. It now renders a refusal that names each `GanttConfigSchema` issue by its path in the block (`gantt.endDateField: …`); a valid block and the flat ObjectView / ListView spelling render as before.

The Studio designers' spec derivations (`dashboard`, `package`, `page`, `report` and `view` schemas in `metadata-admin`) no longer catch a failed derivation and return `undefined`, which rendered a designer form silently missing fields. Their only input is the bundled spec, so a failure is a build-time fact that fails their tests; at runtime it reaches the route's error boundary.
