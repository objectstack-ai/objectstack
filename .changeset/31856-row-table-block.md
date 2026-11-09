---
'@object-ui/types': minor
'@object-ui/app-shell': patch
'@object-ui/cli': patch
---

feat(app-shell): a `row-table` page block lists the rows a page `api` binding answers, as a table

Clause-②: yes (widening)
Metadata-protocol: added

- **`@object-ui/app-shell`: the `row-table` block**, the sixth product-page block beside `hero`, `stat`, `usage-bar`, `checklist` and `tile-grid`, registered under the `app-shell` namespace with the bare `row-table` as its authorable key. `rows` is a list, or one whole `${…}` hole naming a list in the bound `data` (`rows: '${data.actors}'`); every row is drawn, with no cap. `columns` declares, in order, `{ path, label, format?, enum? }`: `path` is a dotted path into one row, `label` a string or an inline locale map, and `format` is `text` (the default, drawn as written), `datetime` (an instant in the viewer's display locale and time zone, through the `datetime` field cell's `formatDateTime`) or `enum` (the label `enum: { value: label }` names; a value the map does not name is drawn as written). A field the row lacks, `null` or empty draws `—`. An empty list draws `emptyLabel`, else the bundle's "No rows to display". A `rows` hole that resolves to anything but a list, or a column the block cannot draw, draws the binding's error panel, never the empty state.
- **`@object-ui/types`: its arm**, `RowTableBlockSchema` with `RowTableColumnSchema` (and the TS twins `RowTableBlockSchema`, `RowTableBlockProps`, `RowTableColumn`), a member of `ProductBlockComponentSchema`, so `objectui validate` claims the type. The arm is strict: an unknown `format`, an `enum` column with no label map, a label map on a column that is not `enum`, a `path` that is not a dotted path, an undeclared key and an empty `columns` are refused. The `dataSource` is the spec's `ElementApiDataSourceSchema`, by reference.
- **`@object-ui/cli`:** `known-schema-types.ts` regenerated with `row-table` and `app-shell:row-table`.

No `@objectstack/spec` change: the type parses through `PageComponentSchema.type`'s open string arm, and `component-type-unknown` claims only colon namespaces. The SDUI manifest does not move (`@object-ui/app-shell` is not one of its registry modules).
