---
'@object-ui/console': patch
'@object-ui/plugin-detail': patch
---

fix(console, plugin-detail): an approval request opens in the app that owns its record, its record card opens the record, the record page's copy never throws, and the decision comment is on the request page

Clause-②: no
Metadata-protocol: none

- An approval request opened from Home's "Awaiting approval", from a notification, or from the Approvals inbox now opens under the app whose navigation lists the request's record: the app it was opened from when that app lists the record's object, otherwise the first app that does, otherwise Setup. It used to open under whichever app it was asked from, with that app's sidebar, even when that app never names the record.
- The record card on an approval request's page now links its title to the record, under the same app. The page's own record links reach only the objects that page loads, which never included the request's record, so the card's title was plain text.
- A record page's click-to-copy (`DetailSection`) no longer throws or leaves a rejected promise when the browser has no clipboard API or refuses the write; the copy then does nothing.
- A rejected, returned or approved request's page shows the comment its deciding action was recorded with, and who recorded it, above the tabs. It was only on the Timeline tab.
