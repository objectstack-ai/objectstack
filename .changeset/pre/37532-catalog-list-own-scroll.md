---
'@object-ui/app-shell': patch
---

fix(app-shell): a pick far down a Setup catalog list no longer leaves its section out of view

Clause-②: no
Metadata-protocol: none

- Setup → Recycle Bin lists the objects on the left and the chosen object's deleted records on the right, in the page's one scroll. With a long list (38 objects, about 2000 px, in the app measured) an administrator scrolled down to an object near the end, chose it, and its records, its Restore buttons and its Empty button were above the visible area: the right side read blank, as if the bin were empty.
- On two columns the list now stays in view and scrolls on its own, so the section beside it stays at the top of the visible area whatever is chosen. On one column (a phone), a pick whose section is out of view brings it into view. A link that opens an item by name leaves the scroll where the page starts it.
- The layout is the one Setup's catalog pages share, so Position holders and Permission set assignments get the same behaviour.
