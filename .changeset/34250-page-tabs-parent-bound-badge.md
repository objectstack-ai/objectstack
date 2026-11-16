---
'@object-ui/components': patch
'@object-ui/plugin-detail': patch
'@object-ui/console': patch
---

fix(components): a `page:tabs` tab holding a related list bound by `parentDataSource` shows its count badge before it is opened, on an app page too

Clause-②: no
Metadata-protocol: none

The tab strip counts a `record:related_list` by probing it against the record the page is about. An app page has no such record, so a tab whose related list reads its parent through `parentDataSource` (a team page listing members and invitations of the current organization, say) drew no badge: the number showed only inside the opened tab. On a record page the same list was probed against the page's record, which is not its parent.

Such a list now says how many records it holds to its tab, the same number its own header shows, and the strip keeps that tab mounted while inactive so the badge is there before the tab is opened. A create or delete on the listed object re-reads the list and moves the badge. Lists whose parent is the page's record are counted by the strip's own probe exactly as before, and an authored `count` on a tab still wins.
