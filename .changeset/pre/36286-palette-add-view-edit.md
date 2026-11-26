---
'@object-ui/app-shell': patch
---

feat(console): the ⌘K palette's "Current page" group offers the list's "Add view" and the record's "Edit"

Clause-②: no
Metadata-protocol: none

Opened with nothing typed, the command palette's "Current page" group now carries the page's own main entry beside its favorites row:

- **On an object's list**: "Add view", listed exactly where the view switcher offers "Add view". Enter opens the switcher on its in-place create card, or, for a host that offers only the Create View dialog, opens that dialog.
- **On a record page**: "Edit", the header's own Edit. It runs what the header button runs (the record form, or the page's edit state), and it is off exactly when the button is off: a `userActions.edit.disabledWhen` that holds, the state lock, or a live inline draft the header greys Edit for, with the header's reason under it. A record an approval locks, a record already in its edit state and a record shown in a drawer or pane over a list offer no Edit row.

The footer names what Enter does ("Add view ↵", "Edit ↵"), in the controls' own words. Nothing is recomputed in the palette: the list and the record page publish the command beside the control while they draw it. No locale keys, props or package exports change.
