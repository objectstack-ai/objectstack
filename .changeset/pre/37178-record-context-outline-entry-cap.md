---
'@objectstack/service-record-context': patch
'@objectstack/spec': patch
---

feat(ai): `get_record_context` caps a body outline's entries and states the cut

Clause-②: yes (widening)
Metadata-protocol: none

A long body comes back as an outline of its headings. That outline had no cap, so a long body that is mostly headings made an outline answer as big as the body. The outline is now bounded whatever the body holds.

- **`RECORD_CONTEXT_OUTLINE_MAX_ENTRIES` (80), new export of `@objectstack/service-record-context`.** An outline lists at most 80 headings, and its listing, serialized, stays within `RECORD_CONTEXT_BODY_MAX_CHARS` (8000). When a body has more, the outline keeps the shallowest levels first and lists them in body order, so a listed section's text holds the headings left out under it. Every heading's `anchor` still reads its section, listed or not, and a listed anchor is the same whether or not the outline was cut.
- **New note kind `outline_truncated`** on `RecordContextNoteKind` in `@objectstack/spec/ai`. When the cap cuts, the answer carries one such note beside `body_outline`, and its sentence says how many headings are not listed. A consumer that switches over note kinds exhaustively must handle the new value.
- A body whose only heading is too long to list within the bound is carried as text up to the bound and marked `truncated`, the same as a long body with no headings.
