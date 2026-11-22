---
'@objectstack/spec': minor
'@object-ui/types': minor
'@object-ui/plugin-grid': minor
'@object-ui/plugin-view': minor
---

feat(spec,ui)!: every grid that renders editable selects a cell first and saves each cell on its own, and `object-grid`'s `singleClickEdit` is retired

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered object-grid-single-click-edit-removed, object-grid-single-click-edit-retired -->

**BREAKING** accept-set narrowing on the `object-grid` page block (`@objectstack/spec`, `ComponentPropsMap['object-grid'].singleClickEdit`) and on `@object-ui/types` (`ObjectGridSchema.singleClickEdit`, and the `object-view` `table` slot that relayed it), with the grids following it in the same release.

- **Now.** A grid that renders editable (`editable` set and the viewer allowed to edit the object) uses the list page's select-first cell model wherever it is drawn: the grid an `object-view` draws itself (the Studio's view preview, a page that places an `object-view`) and an authored `object-grid` node. A click selects a cell; double-click, Enter, F2 or typing opens its editor; Esc cancels; and each committed cell is saved at once as one update for its record. The pending-changes bar, its "Save All" and "Cancel All" buttons and the per-row save column are no longer drawn there. On a touch screen a tap on these grids opens the record, and a touch never edits a cell in place.
- **Unchanged.** A grid that renders read-only keeps its click-to-open row. Neither `editable` nor a view's `inlineEdit` can open editing that the object or the reader's `update` grant refuses, and a refused cell now says why when it is asked to edit, as on the list page. A React host that draws `ObjectGrid` itself can still pass `cellSelection={false}` to keep the staged model with its Save All bar.
- **`keyboardNavigation` narrowed to what is enforced.** On a grid that renders editable the arrow-key navigation is always on, because the selection moves with those keys; `false` no longer turns it off there. On a read-only grid `true` still turns it on.

| FROM | TO |
|:--|:--|
| `object-grid` `properties.singleClickEdit: true` (or absent: the old default) | delete the key; a click selects the cell and double-click, Enter, F2 or typing opens its editor |
| `object-grid` `properties.singleClickEdit: false` | delete the key; double-click still opens the editor |
| `object-view` `table.singleClickEdit` | delete the key |
| a React host passing `ObjectGrid` `onBatchSave` alone (no `onRowSave`, no `cellSelection`) on an editable grid: "Save All" called it | each cell now saves through `onRowSave`, or through the grid's own `dataSource.update` when there is none, and `onBatchSave` is never called. Pass `onRowSave` to own the write per cell, or pass `cellSelection={false}` to keep the staged model, where `onBatchSave` is still called. The prop is marked `@deprecated` |

The one-line fix: delete `singleClickEdit` wherever it is written; `os migrate meta --from 17 --write` deletes it from page sources. Writing it after upgrade fails `tsc` (the input type is `never`) and fails the parse with that prescription.

The retirement kit:

- **`@objectstack/spec`**: `singleClickEdit` is a `retiredKey()` tombstone on `ObjectGridPropsSchema`, registered in `RETIRED_KEYS_BY_MAJOR[18]` as `ui/ObjectGridProps:singleClickEdit`. The D2 conversion `object-grid-single-click-edit-removed` deletes it from `object-grid` components (top-level regions, nested `children` and named slots), whatever its value, and the D3 entry `object-grid-single-click-edit-retired` names what the upgrade still owes: help text and tests that describe the old gestures. `keyboardNavigation`'s describe says what is enforced. The liveness ledger records the retirement and the narrowed read.
- **`@object-ui/types`**: `ObjectGridSchema.singleClickEdit` is `?: never` with a `retirementTombstone()` twin, and the `object-view` `table` slot inherits it. `DataTableSchema.singleClickEdit`, a flag a host sets in code, is unchanged.
- **`@object-ui/plugin-grid`**: `ObjectGrid` turns the select-first model on wherever the grid renders editable (a host's `cellSelection` still wins), and no longer reads `singleClickEdit`. The `object-grid` inputs no longer list it. `ObjectGridComponentProps.onBatchSave` is `@deprecated`: it is called only under the staged model.
- **`@object-ui/plugin-view`**: `table.singleClickEdit` is no longer relayed to the grid.
