---
'@object-ui/console': patch
---

fix(console): an approval request opened with no source app stays in an app instead of landing in Setup

Clause-②: no
Metadata-protocol: none

An approval request opened from Home's My work, from the bell outside an app, from a notification or from the e-mail link used to open under the app whose navigation lists the request's record, and otherwise under Setup. It now opens in this order: the app that lists the record's object, then the current app, then the app the person last used, then the first app they can open. Setup is the answer only when it is the current or the last used app. The server's `/system/approvals?request=ID` link, which forwards through `/apps/setup/system/approvals`, moves on to that app too, and so does the approvals inbox opened there without a request.

On the request page reached this way, the close button and the phone's back link return to the approvals inbox of that app, not to the raw approval request list. A request opened from Home or from the bell is handed the pending queue they list, so the page counts through it and "Open next after deciding" moves on to the next request. The e-mail link and a notification carry only the way back.

`/apps/com.objectstack.setup/system/approvals`, Setup's own address, is unchanged.
