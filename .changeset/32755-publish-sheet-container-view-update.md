---
'@object-ui/app-shell': patch
---

fix(app-shell): the publish sheet marks an edit to a published view stored as a view container as Update, not New

Clause-②: no
Metadata-protocol: none

The pending-changes sheet decided New or Update from the published list of each type. The view list names what a stored view container expands to (`<object>.form`, `<object>.<key>`) and never the container's own name, so a view stored as a container, such as `<object>.default` carrying a `form`, was published yet missing from the list. Its next draft read "New · publishing adds this item" and its drill-in showed no changed keys. A view draft the list does not name now asks the by-name published read, which serves the container, so it reads Update and lists what changes (here the form). A view that was never published still reads New, a view the list names still costs no extra read, and a by-name read that fails leaves the entry unmarked.
