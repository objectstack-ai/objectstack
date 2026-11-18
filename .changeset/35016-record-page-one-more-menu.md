---
'@object-ui/app-shell': patch
---

fix(app-shell): a record page pending your approval shows one `⋯` menu, and a phone's bottom bar never leads with a locked Edit

Clause-②: no
Metadata-protocol: none

On a record waiting for the reader's approval, the approval band and the record header each drew a `⋯` menu on the same screen, so the reader had to open both to learn which held what. The band's menu entry is now named: it reads "More approval actions" (更多审批操作) with a disclosure chevron, at every width, and holds the band's other approval levers as before. The record header keeps the page's one `⋯`. Approve and Reject are unchanged.

On a phone, an approval-locked record put its greyed Edit in the bottom bar's first slot, ahead of every action the reader could press. Under the approval lock, Edit now moves into the bar's `⋯`, still drawn and still off, and the first usable action takes the slot. The approval band already states the lock. The desktop header keeps Edit greyed in place, and a record with no approval lock is unchanged.
