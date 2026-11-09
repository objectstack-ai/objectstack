---
'@object-ui/app-shell': patch
---

fix(app-shell): in Studio Interfaces, a draft-only object's nav entry opens the object's drafted default list view, not a non-existent "Default view"

Clause-②: no
Metadata-protocol: none

An object that is still only a draft in the package is absent from the shell's published metadata, so a nav entry for it with no `viewName` used to open `<object>.default`, a view that does not exist. The view switcher listed that "Default view" beside the view the author had drafted as the default, and the first edit in the panel created a second default list view in the package. The entry's default list view is now resolved against the published views and the package's drafted list views together, so it opens the drafted default view, the switcher lists only the views that exist, and an edit writes to that view. Until the package's drafts have been read, a default view that no published view flags is not loaded or listed, so no edit can be made against the wrong view. A published object with no default list view still opens `<object>.default`, created by the first edit, as before.
