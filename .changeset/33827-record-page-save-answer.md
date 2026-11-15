---
'@object-ui/app-shell': patch
---

fix(app-shell): the record page shows a save's new values as soon as the save succeeds

Clause-②: no
Metadata-protocol: none

After a save through the edit dialog (or any other update of the record), the record page and the record drawer kept showing the old field values until the page read the record again, a read that goes out beside the page's other post-save reads and could take seconds, while the "updated" toast was already on screen. The page now lays the save's own answer, the record as the server holds it after the write, over the record it shows, in the same moment the write lands, so the new values are on screen when the toast appears. The re-read still runs and then replaces the record as before. A related record the page shows by name keeps its name when the save did not change it; one the save changed shows its new value at once and its name when the re-read answers.
