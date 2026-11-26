---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): New on a list opened from a related list's "View all" seeds the relationship lookup's `dependsOn` fields, as the related tab's New does

Clause-②: no
Metadata-protocol: none

A related list's "View all" opens the child list under the parent record (the record trail). Its New opened the child's create form with the parent link alone, so a relationship lookup that declares `dependsOn` (an order `dependsOn` the account) drew gated ("Select Account first") with the parent hidden, or was emptied by a `lookupAutofill`. It now opens with the same seed the related tab's New writes (`relatedCreateSeedOf`): the parent pair first, then one `formLink` pair per `dependsOn` field, valued from the parent record. The trail holds the parent's id alone, so the page reads the parent record once, and only when the relationship lookup declares a `dependsOn`; a lookup without one, or a parent that cannot be read, opens with the parent link alone, as before. While the parent is read, New is disabled; a read that has not answered within 5 seconds opens the form with the parent link alone, and a read that answers after the page moved on (another filter, another page) opens nothing.
