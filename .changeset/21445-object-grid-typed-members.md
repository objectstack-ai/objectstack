---
'@objectstack/spec': minor
---

feat(spec)!: an `object-grid` page block's props type the seven members the grid reads with a fixed shape, and the legacy `resizableColumns` spelling is retired in favour of `resizable` (#21445)

Clause-②: yes (narrowing)

<!-- adr-0087: registered object-grid-resizable-columns-removed, object-grid-resizable-columns-retired, ui-object-grid-row-members-typed -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. What reads the row: the component-props gate on `objectstack validate`, `objectstack build` and `objectstack lint`, which reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` finding. A stored page still saves and loads, because a page component's `properties` is not parsed on the metadata save or load path.

**`@objectstack/spec`**

- **Seven members of `ComponentPropsMap['object-grid']` are typed.** Each was `z.unknown()` (`bulkActionDefs` an array of it), although the console's `ObjectGrid` reads each with one shape. Any value passed, and the grid answered an off-shape one with a silent default: `rowHeight: 42` rendered as a compact grid, and an aggregation with an unknown function drew a zero nothing computed, or no number at all. Each member now takes the shape the grid reads:
  - `rowHeight` is the list view's `RowHeightSchema`: `compact`, `short`, `medium`, `tall` or `extra_tall`. These are exactly the five values the grid admits.
  - `rowColor` is the list view's `RowColorConfigSchema`, `{ field, colors }`.
  - `navigation` is the list view's `NavigationConfigSchema`, the same carrier `object-kanban`, `object-calendar` and `object-timeline` take.
  - `conditionalFormatting` is the list view's own member, `[{ condition, style }]`, with a CEL `condition` and a CSS `style` map.
  - `bulkActionDefs` is an array of the list view's `BulkActionDefSchema`.
  - `aggregations` is `[{ field, type }]`, with `type` drawn from the query AST's aggregation functions (`count`, `sum`, `avg`, `min`, `max`, `count_distinct`). No list-view schema declares this member, so the shape is the one the grid's grouping reads.
  - `operations` is `{ create?, update?, delete?, export? }`, the four booleans a grid read point names. `read` and `import` are refused with the reason: no grid read point reads either.
- **`resizableColumns` is retired.** It was the legacy second spelling of `resizable`, read only when `resizable` was absent, so a grid authoring both silently ignored it. It is now a `retiredKey()` tombstone: writing it fails `tsc` (the input type is `never`) and fails the parse with a prescription naming `resizable`. Nothing in either repository wrote it.
- **`ObjectGridProps`** (and `ObjectGridPropsParsed`) carry those types instead of `unknown`, and `resizableColumns` is `never`.

## FROM → TO

| you wrote on an `object-grid` | write instead |
|:--|:--|
| `resizableColumns: false` | `resizable: false` — the same boolean |
| `resizableColumns: true` beside `resizable: false` | `resizable: false` — the grid has always followed `resizable` |
| `rowHeight: 42`, `rowHeight: 'comfortable'` | `rowHeight: 'medium'`, or another of `compact` / `short` / `tall` / `extra_tall` |
| `rowColor: 'red'` | `rowColor: { field: 'status', colors: { overdue: 'red' } }` |
| `navigation: 'drawer'` | `navigation: { mode: 'drawer' }` |
| `conditionalFormatting: [{ field: 'status', operator: 'equals', value: 'late', backgroundColor: '#fee2e2' }]` | `conditionalFormatting: [{ condition: "record.status == 'late'", style: { backgroundColor: '#fee2e2' } }]` |
| `aggregations: [{ field: 'amount', type: 'median' }]` | a function the grid computes: `count`, `sum`, `avg`, `min`, `max` or `count_distinct` |
| `operations: { create: true, read: true, import: false }` | `operations: { create: true }` — delete `read` and `import`; nothing reads them |

The one-line fix: rename `resizableColumns` to `resizable`, and write each of the seven members in the shape the list view declares for the same key (`aggregations` as `[{ field, type }]`, `operations` as four booleans). `os migrate meta --from 17` lists the mechanical `resizableColumns` edits for existing sources.

## The retirement kit

- **Tombstone.** `resizableColumns` is a `retiredKey()` on `ObjectGridPropsSchema`; its authorable-surface line carries `[RETIRED]`.
- **Conversion.** `object-grid-resizable-columns-removed` (protocol 18, retired from the load path) follows the renderer's own precedence. It moves the value to `resizable` when `resizable` is absent, and deletes the key as a lossless strip when `resizable` holds a value. Its D3 record is the semantic entry `object-grid-resizable-columns-retired`, which carries the judgment for a grid that authored both keys with different values.
- **Registration.** `RETIRED_KEYS_BY_MAJOR[18]` carries `ui/ObjectGridProps:resizableColumns`.
- **The typed members** have the D3 entry `ui-object-grid-row-members-typed` and no conversion. Nothing on the load path refuses their shapes, and an off-shape value has no rewrite that keeps what the grid shows while honouring what the author wrote.

## Who is affected, measured

- **objectstack.** Measured on `origin/main` `53fd35e3e3`: zero `object-grid` blocks author any of the seven members or `resizableColumns` in the examples, `@objectstack/platform-objects`, the spec tests, the documentation and the published skills. The control: the same census finds the two showcase grids' `columns`.
- **objectui.** Measured at the `.objectui-sha` pin, over 76 `object-grid` property bags in its sources, tests and documentation (23 of them in parsed JSON documents). One documentation example, the repository README's data grid, authors `operations.read: true`, which this row now refuses. No other bag authors a refused shape. The control: the same census finds `columns` in 46 bags.
- **Deployed metadata** was not measured.
