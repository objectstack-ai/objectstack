---
'@object-ui/console': patch
---

fix(console): the Approvals Inbox shows each row's Approve and Reject by default, with their words

Clause-②: no
Metadata-protocol: none

On a desktop-width Approvals Inbox, the Approve and Reject buttons at the right end of each pending row appeared only while the pointer rested on that row or keyboard focus reached it, so a reviewer opening the inbox saw no way to decide from the list. They were also bare icons, named only for screen readers.

- Both buttons are now always shown on every row the viewer can decide, each with its word ("Approve", "Reject", translated) beside its icon. The word is also the button's accessible name. The Actions column grows to fit the two labelled buttons and stays pinned to the right edge.
- A request whose step collects decision outputs is still decided only on its own page: both buttons stay disabled, and hovering them shows why ("This approval collects decision outputs — open it to decide."). Screen readers read that reason as the buttons' description.

Unchanged: the confirmation dialogs, bulk approve and reject, the keyboard shortcuts (J / K to move, A to approve, R to reject, Enter to open) and the phone-width cards.
