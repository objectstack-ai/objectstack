---
'@object-ui/plugin-dashboard': patch
---

fix(plugin-dashboard): a dashboard tile whose data the viewer may not read is left out, not drawn as a permission error

Clause-②: no
Metadata-protocol: none

A viewer who may not read the data behind one dataset tile used to see that tile draw "You don't have permission to view the data behind this widget" among tiles that answered. Outside design mode, `DashboardRenderer` now leaves such a tile out of the layout, frame and title included, once the server refuses its query as a read refusal (403 / `PERMISSION_DENIED`), and the remaining tiles reflow. The server's refusal stays the only verdict: every tile is still queried, and nothing is hidden on a guess.

- In design mode the tile stays and draws the no-access state, so an author can still see and select it.
- A failure that is not a read refusal keeps the tile and its error, as before.
- The editable grid layout (`DashboardGridLayout`) keeps the tile and its no-access state, unchanged.
