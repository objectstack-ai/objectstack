---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the bell opens a full-page inbox from 768 px up

Clause-②: no
Metadata-protocol: none

From 768 px up, the sidebar's bell no longer opens the right-hand panel: it opens the inbox page at `/apps/APP/inbox` (`/inbox/approvals`, `/inbox/activity`, with `?item=ID` for the selected row), inside the current app's shell, so it can be bookmarked and the browser's Back leaves it. A list on the left, the selected item on the right:

- **Approvals** — the request's own page, embedded: its fields, approval progress, the applicant's note and the request's declared decision actions, with the same visibility rules and parameter dialogs. A decision moves the selection to the next request and the badge drops with it.
- **Notifications** — the record the notification is about, embedded, comments included; selecting a notification marks it read. Repeats stay coalesced into one row by topic and title, with every occurrence listed on the right. «Unread only», «Mark all read», and «Load earlier notifications» page beyond the 20 rows the bell badges from.
- **Activity** — the record each activity row happened on.

J / K move through the list. The phone keeps its panel, and the `global:notifications` page block keeps the panel at every width. The data, the coalescing rule, the badge count and the decision actions are unchanged.
