---
'@object-ui/fields': patch
'@object-ui/plugin-form': patch
---

perf(fields): the line-item grid's body loads on first use, and the console's first load no longer carries it

Clause-②: yes (widening)
Metadata-protocol: none

The line-item grid (the `grid` field and the line items of a master-detail form) was the largest field widget in the console's first-load bytes, though only a form with line items draws it. Its body now loads the first time a grid is drawn, or earlier, when a form that draws line items mounts.

- **The same two components.** `GridField` and `LineItemsField` keep their names and their props. They now render the grid's body once it has loaded; a grid mounted before that shows a small busy placeholder until it arrives. A grid mounted after the body loaded renders it directly, and a grid that showed the placeholder keeps its rows and the focused cell when the body arrives.
- **One new export, `preloadGridField()`.** It starts loading the body ahead of the first grid. It is safe to call often, its promise settles once the body has loaded, and it never rejects: a failed load is reported by the grid that needs it, through the nearest error boundary.
- **The record forms wait for it.** `MasterDetailForm` and the record page's line-item editor derive a grid's columns from the child object's schema, and now show those columns only once the body has loaded as well, so on a form's first open the grid never shows the placeholder. `LineItemsPanel` starts the load when it mounts.
- **The helpers stay where they were.** `evalArith`, `computeRow`, `lookupAutofillPatch`, `columnHelpByField`, `UNTOUCHED_NEW_ROW`, `isUntouchedNewRow` and the `GridColumn`, `ColumnCurrencies` and `ColumnHelp` types are exported as before and load with the package.

A host that renders `GridField` or `LineItemsField` itself and needs the grid in its first render calls `preloadGridField()` earlier and waits for it, as the record forms do. No metadata key, value or default changes.
