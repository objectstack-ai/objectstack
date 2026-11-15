---
'@object-ui/app-shell': patch
---

fix(app-shell): a deleted record leaves the recently-accessed list that the command palette and Home show

Clause-②: no
Metadata-protocol: none

Deleting a record left its entry in the recents, so the ⌘K palette's "Recent" group and Home's "recently accessed" still offered it, and opening it landed on a record that no longer exists. The connected shell now listens to the data source's delete events once and drops the deleted record's entry from the list, from localStorage and from the saved `ui.recent` preference. One listener covers every delete that reports its record: the record page's header, a list row, an action. Undoing the delete brings the record back, and the visit that follows lists it again. A bulk delete reports only its object, not its records, so it drops nothing.
