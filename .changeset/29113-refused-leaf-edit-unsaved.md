---
'@object-ui/app-shell': patch
---

fix(studio): an Interfaces edit whose save the server refused counts as unsaved, so leaving or reloading asks first

Clause-②: no
Metadata-protocol: none

When the server refused a report's, dashboard's or page's autosave (a 422, say), the edit stayed on screen but Studio's leave guards did not see it: a reload, a pillar or Home link, or opening another item in the Interfaces rail dropped it with no question. The Interfaces pillar now reports such an edit as unsaved work beside its navigation edits, so the browser's "leave site?" prompt, the Studio header and the shell's link guard ask, and the rail and the New dialog ask before another item replaces it. The same holds for an object item's list-view edit whose save was refused. An edit whose save lands, or the load of another item, clears it; an item you have not edited never asks.
