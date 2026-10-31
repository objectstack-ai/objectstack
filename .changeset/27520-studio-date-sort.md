---
'@object-ui/app-shell': patch
---

fix(app-shell): a Studio list view's sort on a date field reads Oldest → Newest

Clause-②: no
Metadata-protocol: none

The list-view panel in Studio now hands the sort builder each field's type, as the console list already does. A sort row on a `date` or `datetime` field names its direction "Oldest → Newest" / "Newest → Oldest" instead of "A → Z" / "Z → A". Text and other fields read as before; what is saved is unchanged.
