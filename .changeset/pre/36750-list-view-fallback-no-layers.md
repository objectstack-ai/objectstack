---
'@object-ui/app-shell': patch
---

fix(studio): opening an object with no default list view no longer asks the server for a view that does not exist

Clause-②: no
Metadata-protocol: none

With no view of an object flagged default, Studio's list-view panel edits `OBJECT.default`, the name its first edit creates the view under. Until then nothing is published under that name, but the panel still read its published layer (`GET /api/v1/meta/view/OBJECT.default/layers`) on every open, and the browser logged the server's 404. The panel now skips that read when the id is the fallback: no view of the object's merged `listViews`, and none of the package's drafted list views, is held under it, read only once the shell's objects and the package's view drafts have answered. The Customize door's served-override read on a read-only base skips the same read and answers as its 404 did. What the panel shows and saves is unchanged. No props or exports change outside `@object-ui/app-shell`'s internal Studio modules.
