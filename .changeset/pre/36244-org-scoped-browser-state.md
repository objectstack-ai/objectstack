---
'@object-ui/app-shell': patch
---

fix(console): favorites, recent items, the last app and the pinned list view are kept per organization in the browser

Clause-②: no
Metadata-protocol: none

A person's favorites, recent items, last app and flow palette recents are saved on the server per organization, but the console's browser copy of them was kept per user only. A person in two organizations who switched from A to B saw A's favorites, recent items and last app on B's first paint, and the nav pins set in A were merged into B's saved favorites. The browser copy is now kept per user and organization, under the organization the console stamps on its requests, so B paints and saves only B's own lists.

The pinned list view of an object (the 📌 in the list title's view switcher) was one browser slot per object, so a view pinned in A, which may be a personal view that exists only in A, was read in B and pinned over by B. It is now kept per organization as well: a pin set in A is still there on return to A, and B holds its own. The other per-browser list preferences (column widths, row height, tab order) are unchanged.

Nothing a person has is lost: the first organization that reads its copy takes over the copy kept before this change (once, after which the old copy is removed), so a person in a single organization keeps their favorites, recents, last app and pins as they were. A deployment without organizations keeps the per-user copy it always had.
