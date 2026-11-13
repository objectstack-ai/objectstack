---
'@object-ui/app-shell': patch
---

fix(app-shell): an approval request's "As submitted" summary draws the submitted file fields, and each file opens

Clause-②: no
Metadata-protocol: none

The summary used to leave out every field whose value is an object or a list, so a `file` field with `multiple: true` (an expense claim's e-invoices) never showed, and the approver could not see the files they were approving. Now a field whose type is in the spec's media family (`file`, single or `multiple`, `image`, `avatar`, `video`, `audio`) is drawn through its own field cell after the business rows: each file is a link to the platform's download endpoint, each image a thumbnail that opens. These attachment rows are not counted against the six-row cap. Every other object or list value (an address, a location, `json`, a composite, a repeater, a multi-value option list or reference) is still left out, by a rule stated in `RecordSnapshotSummary.tsx`'s header. The scalar rows are unchanged.
