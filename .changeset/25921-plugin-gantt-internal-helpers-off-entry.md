---
'@object-ui/plugin-gantt': patch
---

refactor(plugin-gantt)!: retire nineteen zero-consumer exports (the quick-filter bar, the resource-workload grid, the workload math and the shift-band helpers)

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/plugin-gantt#QuickFilterBar, @object-ui/plugin-gantt#QuickFilterBarProps, @object-ui/plugin-gantt#QuickFilterField, @object-ui/plugin-gantt#QuickFilterOption, @object-ui/plugin-gantt#QuickFilterLabels, @object-ui/plugin-gantt#QuickFilterDef, @object-ui/plugin-gantt#ResourceWorkload, @object-ui/plugin-gantt#ResourceWorkloadProps, @object-ui/plugin-gantt#computeWorkload, @object-ui/plugin-gantt#WorkloadColumn, @object-ui/plugin-gantt#WorkloadOptions, @object-ui/plugin-gantt#ResourceCell, @object-ui/plugin-gantt#ResourceLoad, @object-ui/plugin-gantt#normalizeDependencies, @object-ui/plugin-gantt#normalizeShiftSegments, @object-ui/plugin-gantt#shiftDayStart, @object-ui/plugin-gantt#bandAt, @object-ui/plugin-gantt#ShiftSegmentsConfig, @object-ui/plugin-gantt#ShiftBandConfig) the retired operands are React components, helper functions and their TypeScript types in a published ui package's entry that nothing in the workspace or in hotcrm imported; no packages/spec schema, registered node type, ADR-0087 conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these nineteen names from `@object-ui/plugin-gantt`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected. Every module stays in the package (`ObjectGantt` still renders the quick-filter bar, the resource view and the shift bands from them); only the entry stops publishing them. `ObjectGantt`, `ObjectGanttRenderer`, `GanttView`, the task, dependency, link and marker types, `normalizeTaskType`, `parseHHMM` and the `NormShiftSegments` / `NormShiftBand` types that `GanttViewProps.shiftSegments` takes stay exported unchanged.

What leaves, and what to write instead (none has a replacement export):

- FROM `QuickFilterBar`, `QuickFilterBarProps`, `QuickFilterField`, `QuickFilterOption`, `QuickFilterLabels`, `QuickFilterDef` TO no replacement: declare `gantt.quickFilters` on the `object-gantt` node and let `ObjectGantt` draw the bar.
- FROM `ResourceWorkload`, `ResourceWorkloadProps`, `computeWorkload`, `WorkloadColumn`, `WorkloadOptions`, `ResourceCell`, `ResourceLoad` TO no replacement: set `gantt.resourceView: true` with `assigneeField` (and optionally `effortField` / `capacity`) and let `ObjectGantt` render the workload grid.
- FROM `normalizeShiftSegments`, `shiftDayStart`, `bandAt`, `ShiftSegmentsConfig`, `ShiftBandConfig` TO no replacement: declare `gantt.timeSegments`; to drive `GanttView` directly, pass `shiftSegments` already in the `NormShiftSegments` shape.
- FROM `normalizeDependencies` TO no replacement: give each `GanttTask` you pass to `GanttView` a `dependencies` array of ids or `{ id, type }` objects (`GanttDependency[]`).
