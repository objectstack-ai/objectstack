---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): the approval decision panel's record summary is headed "As submitted" (#27502)

Clause-②: yes (widening)
Metadata-protocol: none

The summary the approval request page's decision panel (`record:approval_decision`) draws comes from the request's record snapshot: the target record as it was submitted, kept as the request's evidence of what was submitted. After a decision the request's status, which the page's highlights show, moves on while the snapshot keeps the submitted values, so the summary read as the record's current state and the page contradicted itself. The summary is now a section headed "As submitted", in the muted label style of the panel's "Waiting on", and that heading is its accessible name. A pending request carries the heading too, and a summary that draws nothing draws no heading. The values, the rows and the reads are unchanged: the panel still reads no record, and the record's current values stay on the Details tab's record card.

New language-pack key in all ten packs: `approvalsInbox.snapshotAsSubmitted`.
