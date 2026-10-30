---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): the list-view panel switches between an object's list views

Clause-②: no
Metadata-protocol: none

In Studio › Interfaces, the list-view panel of an object now has a view picker above its settings when the object has more than one list view. It lists the object's list views by label: the published ones, and the ones drafted in this package, marked as drafts, so a view made with "Add view" can be opened again after the author has left it. A pick shows that view's settings in the panel and on the canvas, and an edit there saves to that view's draft. The nav entry's own view is still the one the panel opens with, and the nav entry is not changed.

Switching sends a pending edit to the view it was made on first. An edit that cannot be sent (one held for a missing required setting, or one whose save was refused) asks before it is dropped, as leaving the item does. "Back to …" switches the same way. An object with one list view shows no picker.
