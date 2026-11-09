---
'@object-ui/app-shell': patch
---

fix(app-shell): a record's 动态 stream is read again after a save, so its count and rows hold the change without a reload

Clause-②: no
Metadata-protocol: none

- **The record feed follows the record's invalidation.** A save through the edit dialog (or an action, an undo, a ⟳) put the record on the data-invalidation bus, and the page read the record again, but the 动态 feed kept the rows and the count the page payload answered when it opened. The feed now reads again on the same change, on the record page and in the drawer.
- **The re-read asks what the open asked.** Once the record changed after the open, the feed asks the record page route for the streams the open asked, and only those (the discussion, the activity rows, the stream's count), so the new activity row and the server's count land in place. The activity row a save writes exists before the save answers, so one ask after the save sees it; nothing polls.
- **The field changes follow the same change**, so on an object with `enable.trackHistory` the stream's field-change entries are read again too.
