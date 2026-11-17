---
'@object-ui/plugin-form': patch
---

feat(plugin-form): the form dialog's header has a maximize / restore button, like the record drawer's, and remembers the choice per object

Clause-②: no
Metadata-protocol: none

A create or edit dialog could not be made bigger: a long form, or a form with line items, stayed in a dialog capped at 90% of the window height. The dialog header now has the record drawer's maximize button (the same icon, size and labels, "Maximize" / "Restore size"), just before the close (X) button.

- **Maximize** widens the dialog to the `full` size (95% of the window width) and makes it fill 95% of the window height. The form body scrolls inside the dialog.
- **Restore size** puts the dialog back to its declared or inferred size.
- The form stays open the whole time. Typed values, the unsaved-changes prompt on close, and line items added in a form with `subforms` are all kept.
- Both dialog kinds have the button: a plain form and a form with `subforms` (line items).
- A maximized dialog with no declared `columns` uses the `full` column count, so a form with sixteen or more fields shows four per row.
- The choice is remembered per object in the browser's local storage. The next dialog for that object opens the same way. Other objects are not affected.
- On a phone the dialog already fills the screen, so the button is shown from the `sm` breakpoint up only.

No metadata changes. An authored `modalSize` is still the size the dialog opens with until the user maximizes it.
