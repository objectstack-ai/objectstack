---
'@objectstack/example-showcase': patch
---

Clause-②: no
Metadata-protocol: none

The showcase's record actions now say which record they changed. Mark Done, Recalculate Estimate,
Recalculate Selection, Archive and Submit for Sign-off name the task's title (or the invoice number)
in their success toast, through a template hole over the dispatched record, so "Task marked done."
becomes "PII access review marked done.". When the dispatch carries no title (a list row whose view
does not show the column), each message falls back to the object wording it used before. The zh-CN
bundle entries for the four task actions carry the same hole, so a zh-CN viewer is told the record too.
