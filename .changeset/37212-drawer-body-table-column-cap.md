---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a related table in the record preview drawer draws instead of failing with "Maximum update depth exceeded"

Clause-②: no
Metadata-protocol: none

A record's related table drawn in the details of the record preview drawer (for example an opportunity's line items) could fail with `Component "data-table" failed to render` and React error #185, while the record's full page drew the same table. The table leaves out the columns that do not fit whole in its column, and re-reads that choice when it changes. The re-read measured the table still drawn for the previous choice, because the table adopts a new set of columns a render later. In the drawer's narrow details column that read changed its answer on every render: one column, then two, then one again. The read now skips the table while it still draws the columns it was handed before, and reads again when the table draws the new ones. A column the reader hid from the table's header menu does not stop the read, so a later narrowing still leaves columns out and shows the overflow cue. A table wide enough for every column, as on the full page, is unchanged.
