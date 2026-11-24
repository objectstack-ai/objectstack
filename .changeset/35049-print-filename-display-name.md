---
'@objectstack/service-print': patch
---

fix(print): a print with no `filename` names the PDF from the record's display name

Clause-②: no
Metadata-protocol: none

`printRecordToFile` (and `POST /api/v1/print/records`) used to archive every PDF without an explicit `filename` as `<page>-<recordId>.pdf`, which tells the reader nothing about which record it is. It now names the file from the record's display name (ADR-0079: the object's `nameField`, or the title field derived from its fields), read from the row the caller's own read answered, plus `.pdf` — printing quote `Q-2026-0042` attaches `Q-2026-0042.pdf`.

- The name is made a safe file name: `/ \ : * ? " < > |` become `_`, control characters and whitespace runs become one space, leading dots are dropped, a trailing `.pdf` is not doubled, and it is cut to 100 characters.
- A record with no display value (no title field, an empty value, or one the caller's field-level security leaves out) keeps `<page>-<recordId>.pdf`, never the `Record #<id>` floor.
- An explicit `filename` is used exactly as given, as before.
- Printing a record twice attaches two files of the same name; neither replaces the other.

Visible change: a print with no explicit filename now attaches `<display name>.pdf` instead of `<page>-<recordId>.pdf`. Nothing to migrate; pass `filename` to keep a fixed name.
