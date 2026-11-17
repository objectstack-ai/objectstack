---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): the notification bell opens a full-height panel on the right, with pending approvals on top and decidable in place

Clause-②: yes (widening) — two new locale keys in the `notifications` namespace of every `@object-ui/i18n` pack (`needsYou`, `viewApprovalDetails`); nothing that worked before is refused
Metadata-protocol: none

The bell in the console header (and the `global:notifications` page block) used to open a 384 px popover whose lists stopped at 320 px, about three rows. It now opens a panel the full height of the window on the right, 440 px wide, and the lists take all the height the header and tabs leave.

- **The page stays usable.** The panel has no overlay, and a click in the page does not close it. Opening a notification takes the page to its record while the panel stays open on the next one. The panel closes from its close button, Escape or the bell, and it gives way when the record drawer opens, so the two never stack on the right.
- **Approvals come first.** The Notifications tab opens with "Needs your action": the pending approval requests the bell counts, each with its approve and reject buttons and "View details". The buttons are the request's own declared actions (`approval_approve`, `approval_reject` at `list_item`), run through the same declared-actions bar the request's record page uses. So a viewer sees a button only when its `visible` rule passes, a request that needs decision fields collects them in the action's dialog, and the request sent is the declared one. A decided request leaves the list and the badge at once, and the approvals are read again. The Approvals tab lists the same requests.
- **"Mark read" is an icon** that shows when a row is hovered or focused, instead of a column on every row. "Mark all read" and "View all notifications" stay.
- **On a phone the panel fills the screen**, and following a link closes it.

The notification data, its grouping and the three tabs are unchanged.
