---
'@objectstack/scenarios': patch
---

Clause-②: no
Metadata-protocol: none

`asked-back:no-figure` no longer reads an option list's numbering as stated figures when markdown wraps the marker at a line's start: `**1.** Claimed amount`, `**1. Claimed amount**`, `1.**Claimed amount**`, `> 1.` and `### 1.` are numbering, as a bare `1.` already was. A figure after the marker (`**1.** 1,234 claims`) still reads as a figure, and so does a number inside a sentence (`… 1. claimed amount or 2. estimated spend?`). `asked-back` is now at rule revision 4 (`DATASET_GRADER_REVISIONS`), so its grades carry `revision: 4` and the `Run · datasets` row reads `asked-back rev 4 k/N`; a round graded at revision 3 is not compared like for like with one graded now.
