---
'@object-ui/app-shell': patch
---

fix(app-shell): the full-page record form's save toast names the saved record

Clause-②: no
Metadata-protocol: none

Saving a record on the full-page form route (`/new` and `/record/ID/edit`, used by objects whose form opens as a page) showed "Task updated successfully". The record-form dialog paths already named the record. The page now does the same: `Task "Quarterly review" created` and `Task "Quarterly review" updated`. It uses the same display-name resolver, the same rule for a record with no name, and the same `form.createdNamed` / `form.updatedNamed` strings as the dialog. A record with nothing nameable (the resolver would only answer `Record #ID`) keeps the object-label toast it showed before. No strings are added or changed.
