---
'@object-ui/plugin-list': patch
'@object-ui/app-shell': patch
---

fix(plugin-list, app-shell): "Reset to view default" clears the user's stored list setting instead of storing the view's value as their choice

Clause-②: yes (widening)
Metadata-protocol: none

In the console, a list's density, hidden fields and sort are the signed-in user's own preference. The Display control's "Reset to view default" and the sort popover's "Reset to view default" used to write the view's values back through the controls, so the console stored them as the user's choice: the user stayed on the old value after the view's author changed it, and the header ⋯ kept offering "Reset view".

- **`ListView` gains `onRestoreViewDefaults(parts)`**, a host prop. When a host wires it, those two resets call it with the parts they returned to the view's own (`'sort'`, `'hiddenFields'`, `'rowHeight'`) and no longer call `onSortChange`, `onHiddenFieldsChange` or `schema.onDensityChange` for them. The list shows the view's sort and hidden fields at once; the density follows `schema.rowHeight` once the host clears it. Without the prop, the resets write through the controls exactly as before.
- **`viewDefaults` gains `sort`.** A host that lays the user's own sort over the view's in `schema` hands the view's here, and the sort popover's reset compares against it and returns to it. As with the other two members, an absent `sort` in a passed `viewDefaults` means the view declares none.
- **The console clears the stored parts.** The object page wires both: a reset removes those parts from the user's stored entry for the view (and the sort from the URL), and a view left with nothing is removed, so "Reset view" disappears with it. A deliberate choice is unchanged: removing every sort level (`sort: []`) or showing every column (`hiddenFields: []`) is still stored.
- **Unchanged:** the other Display settings (layout, grouping, row color, row numbers, inline edit, gallery card size) reset as before.
