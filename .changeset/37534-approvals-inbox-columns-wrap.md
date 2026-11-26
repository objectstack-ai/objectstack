---
'@object-ui/console': patch
---

fix(console): the approvals inbox's pinned Approve / Reject column no longer covers the Submitted column, and record names read in full at common desktop widths

Clause-②: no
Metadata-protocol: none

In the approvals inbox's desktop table the Request, Record and Requester columns now wrap their text instead of holding it on one line. Before, a one-line request label and requester name set minimum widths that, with the fixed Status and Submitted widths and the pinned Approve / Reject buttons, were wider than a 928 px or 1102 px card: the table overflowed, the pinned column sat over the Submitted column at rest, and the record name was cut to a few words.

From a 928 px card up the table now fits, so the pinned column covers no other column; narrower, the table still scrolls sideways under the pinned column. A record name wraps to two lines and is clamped after that, with its full text in the hover tooltip as before. A requester's "You submitted this" badge moves under the name when the column is narrow. Nothing to migrate.
