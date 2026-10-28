---
'@object-ui/components': patch
'@object-ui/plugin-detail': patch
---

Clause-②: no
Metadata-protocol: none

On a phone, the record header title and the record path's stage labels no longer run off the right edge. Below the `sm` breakpoint, `page:header`'s record title column now takes the header's width, so a long title ellipsises as it does on desktop instead of being cut mid-word. The `record:path` phone row now gives every stage an equal share of the row (with a 2.5rem floor, past which it still scrolls): an ordinary stage label ellipsises and keeps its full text in `title`, and a terminal stage label wraps, as on the desktop rail.
