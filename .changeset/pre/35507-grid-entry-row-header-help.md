---
'@object-ui/fields': patch
'@object-ui/plugin-form': patch
---

fix(fields): the inline line grid draws no blank entry row beside "Add line", and each column header shows its field's help

Clause-②: no
Metadata-protocol: none

The inline line grid of a master-detail form always drew an empty line under the lines, directly above the "Add line" button. It had no copy or remove action and was never saved, so users read it as a broken line they could not delete. The grid no longer draws it: a grid with lines shows exactly its lines, and an empty grid says "No items yet — click "Add line" to begin." The keyboard path that line carried stays: "Add line" moves focus into the line it adds, and Enter in the last line adds a line and moves to the same column in it. An empty required grid that the form refused still draws one entry line, so the field's failure stays on the cells a user types into.

Each column header now shows its field's help as an info icon beside the label. The help appears on hover and on keyboard focus, and it is the icon's accessible name. The text is what the record form shows under the same field: `inlineHelpText`, else `description`, from the child object's definition as the server serves it, so help written by another package's `objectExtensions.fieldPatches` and the reader's language both apply. `GridField` takes the texts as a new `columnHelp` prop, and `columnHelpByField` builds them from a child object's fields. The master-detail form, the line-items panel and the record-body table editor pass them.

What does not change: what a save sends, the `allowAdd` / `allowDelete` / `maxRows` behaviour, and every metadata key, value and default. A master-detail entry whose relationship and every column type are authored loads no child schema, so its headers show no help, as it has no lookup autofill.
