---
'@object-ui/types': minor
'@object-ui/components': minor
'@object-ui/plugin-grid': minor
'@object-ui/app-shell': minor
'@objectstack/spec': minor
---

feat(ui): the grid's staged edit model retires with its interface, so every editable grid selects a cell first and saves each cell on its own

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered data-table-staged-edit-retired -->

**BREAKING** accept-set narrowing on the grid's host interface: `ObjectGrid`'s `cellSelection` prop and `onBatchSave` prop (`@object-ui/plugin-grid`), and `DataTableSchema.onBatchSave` and `DataTableSchema.singleClickEdit` (`@object-ui/types`). The staged model behind them goes in the same release (`@object-ui/components`).

- **Now.** There is one way to edit a grid. A grid that renders editable selects a cell on a click; double-click, Enter, F2 or typing opens its editor; Esc cancels; and each committed cell is saved at once as one update for its record, through the host's `onRowSave` or, when there is none, the grid's own `dataSource.update`. The pending-changes bar, its "Save All" and "Cancel All" buttons, the per-row save/cancel column and the amber "modified" tints are gone everywhere. A grid that renders read-only keeps its click-to-open row, and a host may still pass `cellSelection={true}` to ask for the select-first model on a read-only grid.
- **A bare `data-table`.** An editable `data-table` edits only inside a select-first host (`GridCellSelection`) that also passes `onRowSave`. Without both it renders read-only and logs one console warning naming what is missing, instead of staging edits it has nowhere to save. Render an `object-grid`, which mounts both and writes through its data source.
- **Unchanged.** Who may edit what: `editable`, the object's inline-edit affordance, the reader's `update` grant, per-field write grants, the record-grained verdict and approval locks all narrow editing exactly as before.

| FROM | TO |
|:--|:--|
| `<ObjectGrid cellSelection={false}>` to keep click-to-edit and the "Save All" bar | drop the prop; an editable grid is select-first, and a read-only one opens a record on a click |
| `<ObjectGrid onBatchSave={…}>` | pass `onRowSave(rowIndex, changes, row)` to own the write record by record, or pass nothing and let the grid save through its own `dataSource.update` |
| `data-table` schema `onBatchSave: (changes) => …` | `onRowSave` inside a `GridCellSelectionProvider` host, or render `object-grid` |
| `data-table` schema `singleClickEdit` | delete the key; a click selects the cell and double-click, Enter, F2 or typing opens its editor |
| an editable `data-table` with no `GridCellSelectionProvider` host or no `onRowSave` | mount `GridCellSelectionProvider` and pass `onRowSave`, or render `object-grid`; until then it renders read-only and warns |

The one-line fix: delete `cellSelection={false}`, `onBatchSave` and `singleClickEdit` wherever a host writes them, and pass `onRowSave` where a batch handler did the write. Passing `cellSelection={false}`, `onBatchSave` or `singleClickEdit` after upgrade fails `tsc` (`cellSelection` accepts only `true`, `onBatchSave` is `never`, `singleClickEdit` is no longer declared), and the `data-table` mirror refuses `onBatchSave` by name as retired. None of these is authorable metadata, so `os migrate meta` has nothing to rewrite; its D3 entry `data-table-staged-edit-retired` names what the upgrade still owes: host code that relied on one transaction per Save All, and help text and tests that describe the old gestures.

The retirement kit:

- **`@object-ui/types`**: `DataTableSchema.onBatchSave` is `?: never` on the TS face and a `retired` handler-key refusal on the zod mirror; `DataTableSchema.singleClickEdit` is removed; the `editable`, `onRowSave` and `onCellChange` docs say a commit is the save. The parity ledgers drop both keys.
- **`@object-ui/components`**: `data-table` loses the staged arm (pending-changes bar, Save All / Cancel All, row save/cancel buttons, edit-only column, click-to-edit, the amber tints) and its fallback copy rows (`table.saveAll`, `table.cancelAll`, `table.modified`, `table.saveRow`, `table.cancelChanges`). An editable table without a select-first host and `onRowSave` renders read-only with a `[ObjectUI] DataTable editable:` console warning.
- **`@object-ui/plugin-grid`**: `cellSelection` accepts only `true`; `onBatchSave` and the default batch save are removed, and the default cell save keeps its rule check, `If-Match` guard, conflict dialog, Undo and toast. `keyboardNavigation`'s describe drops its staged sentence.
- **`@object-ui/app-shell`**: the metadata resource list stops passing `cellSelection={false}`; it is read-only, so it keeps click-to-open.
