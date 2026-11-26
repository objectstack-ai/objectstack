---
'@object-ui/app-shell': patch
---

fix(app-shell): on a phone, a long page on the bottom bar's home or approvals page scrolls its last row out from under the bar

Clause-②: no
Metadata-protocol: none

While the phone's bottom bar is drawn, the console inset keeps the bar's height as end padding. A scroll container's end padding only follows its in-flow content, and the route slot was a fixed `h-full` box: a page taller than the inset (the phone app home with a long menu, a long approvals inbox) overflowed the slot, the scroll ended at the page's own bottom, and its last rows stayed under the bar. On the bar's home and approvals pages the route slot now grows with its page, never shorter than the inset, so scrolling to the end brings the last row above the bar and the safe area. A short page or an empty state still fills the inset as before. The inbox list, an object list that bounds itself and scrolls its rows in its own box, keeps the fixed slot, and so does every route without the bar and every route from 768 px up.
