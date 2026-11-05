---
'@object-ui/plugin-detail': patch
---

fix(record page): one action reads as one timeline row, and every row of the timeline panel names who acted

Clause-②: no
Metadata-protocol: none

- **One row per action.** When one action wrote both an activity row and an audit-log entry (same record, matching kind: create and created, update and updated, delete and deleted; same actor; stamped within `TIMELINE_PAIR_WINDOW_MS`, 5 seconds), the record page's timeline draws it once: the activity row keeps its actor and summary and shows the field changes, before and after, on the same row. A reader who cannot read the audit log sees the same single row without them. The Changes chip, and the panel's `changes_only`, still show each audit entry on its own. Rows that pair with nothing draw as before.
- **The 动态 panel's peek rows name the actor**, beside the time.
- The record page's 动态 count still comes from the server's `timeline` count, which the spec defines as an upper bound: for a record created with field history on it can still read one more than the rows drawn.
