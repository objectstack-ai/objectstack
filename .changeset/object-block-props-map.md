---
"@objectstack/spec": minor
---

feat(spec): the `object-*` block family enters `ComponentPropsMap` — a typo'd key inside a data-bound block's `properties` is now caught at authoring time (#7751)

A misspelled key inside a page component's `properties` used to be accepted in
silence for exactly the block family that carries the platform's data-bound
authoring surface: `object-grid`, `object-metric`, `object-kanban`,
`object-calendar`, `object-form` and `object-master-detail-form` had no entry in
`ComponentPropsMap`, so the ADR-0078 / #5068 authoring gate
(`validate-component-props`) had no schema to dispatch and skipped the node. The
live specimen was #7750: an `object-grid` authored `filters:` (plural) where the
renderer reads `filter` — the wire carried no `$filter` and a personal work
queue listed every row, with a success receipt.

Per the maintainer's ruling on #7751 (2026-08-12, direction A), the six blocks
above now carry props schemas in `ComponentPropsMap`:

- **Key sets are derived from the objectui renderers' own read points**
  (per-key citations in the section header), never from the designer palette or
  registry `inputs` alone — both have published keys with zero read points, and
  re-declaring one would recreate the declared-but-inert trap this closes.
  Read legacy fallbacks stay honoured (`defaultFilters` on the grid is read;
  only the plural `filters` has zero read points anywhere).
- **The typo class is rejected by name with the fix in the message**:
  `filters` → `filter` on every block that reads `filter`, and the designer's
  dead `groupField` spelling → the `groupBy` the kanban board actually reads.
- **Findings stay warning-tier.** The gate's warning→error upgrade remains
  gated on the #5068 inventory; this change does not move that gate.
- **spec↔objectui parity rides the existing `check:react-declaration-parity`
  machinery** — the gate now compares the `object-*` map entries against the
  registry manifest under the same baseline ratchet (no new gate).
- `object-chart` is deliberately not registered: its authored vocabulary is
  two-layered (`chartType` vs `ChartConfigSchema.type`) and not derivable with
  the same confidence, so it stays a silently-skipped unregistered type rather
  than a partial schema that warns on working keys.

New exports: `ObjectGridPropsSchema`, `ObjectMetricPropsSchema`,
`ObjectKanbanPropsSchema`, `ObjectCalendarPropsSchema`, `ObjectFormPropsSchema`,
`ObjectMasterDetailFormPropsSchema`.
