---
'@object-ui/app-shell': patch
---

fix(app-shell): a stored list sort or filter on a deleted or unreadable field is dropped when the list opens

Clause-②: no
Metadata-protocol: none

A user's stored sort and Filter panel conditions for a list view now pass the same field check a list link already passes. A sort level or a filter condition naming a field the object no longer declares, or one the user can no longer read, is dropped when the list opens, at any nesting of filter groups. Everything else the user stored still applies, so the list opens with rows instead of failing on a field that is gone. When every stored sort level is dropped, the view's own sort applies; when every condition is dropped, the list opens unfiltered.

Opening the list does not rewrite the stored row: the dropped part stays stored, so a field whose read access comes back applies again. The user's next sort or filter change replaces that part with what the list shows. Field-level read permissions are applied once they have loaded, the same rule the list's columns and a list link follow.
