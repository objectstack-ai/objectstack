---
'@object-ui/app-shell': patch
---

fix(app-shell): the inbox bell's accessible name says how many items are waiting, and the console sidebar is a navigation landmark

Clause-②: no
Metadata-protocol: none

- **Inbox bell.** Its accessible name was "Open inbox" whatever the badge showed, so a screen reader never heard the count. It is now "Notifications", followed by each non-zero addend of the badge in the same plural forms as the popover's breakdown: "Notifications, 3 unread topics", "Notifications, 1 unread topic, 2 pending approvals". With nothing waiting it is "Notifications". The badge and the "Inbox" tooltip look the same. Tests or scripts that find the bell by the name "Open inbox" now find it by "Notifications". This applies to the header bell and to the `global:notifications` page block, which draw the same control.
- **Sidebar landmark.** The console sidebar's entries now sit in one `nav` landmark labelled "App navigation" (the existing `console.nav.menuLabel` string), on desktop and inside the phone drawer once it opens, so assistive tech can jump to it. Nothing visible changes.

No new translation strings: both names reuse strings every locale pack already carries.
