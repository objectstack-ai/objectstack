---
'@object-ui/app-shell': patch
'@object-ui/data-objectstack': patch
'@object-ui/react': patch
'@objectstack/platform-objects': patch
---

feat(console): a list's column widths, row height and tab order are kept in this browser only

Clause-②: no
Metadata-protocol: none

On a Console object list, the column widths a reader drags, the row height they pick and the order they give the view tabs are now kept in their own browser only, per signed-in user and object (localStorage `list-layout:<user id>:<object>`). Nothing is sent to the server: the Console no longer reads or writes the per-user list preference row `sys_user_preference` `ui.list.<object>`, and its boot read of the reader's preferences no longer asks for that key family. A list opens at once, without waiting for that read.

- Another browser or device opens the list on its view's own widths, row height and tab order until the reader changes them there.
- Signing out clears these entries with the rest of this browser's Console state, as before.
- With nobody signed in, nothing is kept.
- The record page's "show empty fields" choice (`ui.record.<object>`) is unchanged and still follows the reader.

Upgrade note: what an earlier Console kept for a reader's lists is not carried over. The `ui.list.<object>` rows are no longer read, so every reader's lists open on their views' own widths, row height and tab order until they change them again. This browser's old copies (`list-state:*`, `list-filters:*` and `viewOrder:*` in localStorage) are removed on the first list the Console opens. The server rows stay where they are, unread; leaving them does no harm.

`@object-ui/data-objectstack`, `@object-ui/react` and `@objectstack/platform-objects` change only comments and a README example that named the retired key. No metadata key, value or default changes.
