---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): a `min` / `max` over a date or datetime field reads as the field's cell in a grouped grid's header and in the column footer, never `NaN`

Clause-②: yes (widening) — the exported `AggregationResult` gains an optional `display` string; `value` keeps its `number | null` type, and for a date-family `min` / `max` it is now the extreme's instant in epoch milliseconds instead of `NaN` (server-grouped) or `0` (grouped in hand). `ColumnSummaryResult` keeps its shape: `label` carries the formatted time and `value` the same instant, where it carried the parsed year.
Metadata-protocol: none

- **Group header.** `aggregations: [{ field: 'created_at', type: 'max' }]` on a grouped grid now draws the latest time in each group exactly as the `created_at` cell draws it (the field's `format`, the display locale), on both the server-grouped and the in-hand path. It drew `max: NaN` when the header query answered the stored text.
- **Column footer.** A `min` / `max` summary on a date or datetime column draws the time as its cell does. It drew the year (`Max: 2,026`).
- **`sum` / `avg` over a date or datetime field** is no figure: the grid drops it before it computes or asks for it, so the header and the footer draw nothing for it. A numeric aggregate whose answer is not a number is left out, and a group header draws a dash for a value that is not a finite number.
- **`useGroupedData` without a grid.** The published hook knows no field types, so a server aggregate answered as something other than a number (a `min` / `max` over a date field answers its stored text) is left out rather than drawn as `NaN`. Rows grouped in hand compute as before.
