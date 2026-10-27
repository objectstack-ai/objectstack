---
'@object-ui/app-shell': patch
---

fix(app-shell): on a narrow window, a toast raised beside the record drawer no longer covers the record's Edit and ⋯ buttons

Clause-②: no
Metadata-protocol: none

When a right-edge drawer is open and the window is too narrow for a toast beside it (a 720px record drawer on a 1024px window, a split screen, a phone), the console's toaster drops below the drawer's header. It cleared only the drawer's own header, so the success toast raised by creating a record sat on the record header's Edit button and ⋯ menu for its whole four seconds. The toast now also drops below the drawer's first row of controls, measured from the drawer's layout, so it clears the record's actions row for any drawer content. Wide windows keep the toast in the strip beside the drawer, as before.

What to do: nothing.
