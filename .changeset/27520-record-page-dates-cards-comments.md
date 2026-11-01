---
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
---

fix(record-page): one date format per record page, appended cards line up with the page's own, and comment text reads in the foreground colour

Clause-②: no
Metadata-protocol: none

Three record-page readability fixes from the 18.3.0 RC walkthrough:

- **One date format.** A `record:details` section row now writes the year on a current-year date, as the highlights strip above it already does. A project page read "End Date Dec 31, 2026" in the strip and "Start Date Oct 2" in a section; both now read with the year. Grid cells keep the face that drops the current year.
- **Aligned cards.** The panels the record page appends after an authored page (the Attachments and Approvals fallbacks, and the "Created … Updated …" footer) take the same horizontal inset as the page body, so they no longer draw wider than the page's own cards.
- **Comment contrast.** A feed entry's body text uses the foreground colour, as a reply's body already did. The actor, the timestamp and the other meta text stay muted.
