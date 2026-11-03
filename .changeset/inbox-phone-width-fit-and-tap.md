---
'@object-ui/app-shell': patch
---

fix(app-shell): the inbox popover fits a 375 px phone, and its controls and the account menu's notification switches are 44 px tap targets below `md`

Clause-②: no
Metadata-protocol: none

The mobile app hosts the Console, so below `md` these are phone screens.

- **The inbox popover fits.** It stays `w-96` on desktop, but is never wider than the viewport less 0.5 rem on each side, and keeps that gutter from the edges. At 375 px it was 384 px wide and its right 9 px were cut off, which hid the Activity tab, "Mark all read" and the per-group "Mark read".
- **Its controls are 44 px tall below `md`:** "Mark all read", the three tabs, the Unread and All filters, "View all notifications", "View approvals", "Open Approvals Inbox" and "View all activity". They measured 16 to 36 px. Below `md` the tabs also drop their icons and share the strip by content width, so all three fit.
- **Each notification switch in the account menu is now the control of its whole row.** The rows are "In-app alerts" and "Desktop notifications". A tap anywhere on the row toggles the switch, and below `md` the row is 44 px tall. The switch alone is 44 × 24. A blocked desktop switch stays off whatever is tapped, and turning it on still asks for permission from that tap.

Desktop sizes do not change.
