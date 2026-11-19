---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): an approval request opened from an app's inbox stays in that app, and the record breadcrumb never shows a raw id

Clause-②: no
Metadata-protocol: none

Opening a request from the approvals inbox an app mounts (「待我审批」, `approvals:inbox`, or the inbox under the app's `system/approvals`) now opens it inside that app: the app name, the sidebar and the path stay the app's (`/apps/APP/sys_approval_request/record/ID`). It used to open under whichever app listed the request's record object, else the Setup app, so a business user lost their app after every decision. "Open the next one" after a decision stays in the same app, and the last decision returns to that app's inbox. The record card on the request page still opens the record in the app that owns it. Requests opened from no app (Home's 我的工作, a notification, an email link) are unchanged: they still open under the app that owns the record, else Setup.

A record page's breadcrumb (「OBJECT › RECORD」) drew the record's raw id (`#areq_9e5…`) for as long as the record's read took, then swapped in its title. It now names the record by its object's label while the read is in flight (「审批请求」 for an approval request, 「Lead」 for a lead), then by its title once the read lands, in the same render. A loaded record with nothing to be named by still shows its short id. Every object's record page gets this.

The page also stays mounted when it steps to another record (the counter's ↓ ↑, `j` / `k`, and the approvals queue's 「open the next one」 after a decision), and its title used to be held across the step: while the next record was read, the breadcrumb named it with the previous record's title, and its favourite label, its "Recently Accessed" entry and the pane bar's title were briefly written with that title too. A title is now read back only for the record it was resolved for, so during the read the breadcrumb names the object, and nothing is written under the wrong record. No locale keys, props or exports change.
