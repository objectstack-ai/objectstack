---
'@objectstack/service-record-context': patch
'@objectstack/spec': minor
---

feat(service-record-context): get_record_context lists a long body's outline in pages, so every heading's anchor is issued however many the body holds

Clause-②: yes (widening)
Metadata-protocol: added

ADR-0160 D3 "The body". No pack key and no error code changes. The tool's published input widens by one optional member, `outlineFrom`, and its body answer by one, `outlineNext`.

- **The outline comes in pages.** An outline is still held to 80 entries and to the body bound per answer. Where a body has more headings than one answer lists, the answer's body carries `outlineNext`, and calling `get_record_context` again with the same arguments and `outlineFrom` set to it lists the next page. The pages run through every heading shallowest level first, then in body order, and each page lists its headings in body order: a nested body's first page is its top levels, as before; a body of many headings at one level is listed in runs. Before, a body whose headings all sat at one level issued no anchor for any heading past the first 80, so those sections could not be read.
- **The `outline_truncated` note now says how many headings the page lists, how many it does not, and the `outlineFrom` that lists the next page** (or that no later page lists more). It no longer says that a listed section's text holds the headings left out, which was false when every heading sat at one level.
- **A heading too long to list by itself no longer empties the outline.** No page lists it, the pages pass over it, and the note counts it; the other headings are listed. A body whose only headings are such headings is carried to the bound and marked truncated, as before.
- An `outlineFrom` past the last page, or on a body that is not an outline, is refused `RESOURCE_NOT_FOUND` (404), as an unresolved `anchor` is. A call naming both `anchor` and `outlineFrom` is refused `VALIDATION_ERROR` (400) before anything is read.
