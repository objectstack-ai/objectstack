---
'@object-ui/app-shell': patch
---

fix(record-page): the breadcrumb names the object while the record is read, never its raw id

Clause-②: no
Metadata-protocol: none

A record page's breadcrumb (「OBJECT › RECORD」) drew the record's raw id (`#areq_9e5…`) for as long as the record's read took, then swapped in its title. It now names the record by its object's label while the read is in flight (「审批请求」 for an approval request, 「Lead」 for a lead), then by its title once the read lands, in the same render. A loaded record with nothing to be named by still shows its short id. Every object's record page gets this.

The page also stays mounted when it steps to another record (the counter's ↓ ↑, `j` / `k`, and the approvals queue's 「open the next one」 after a decision), and its title used to be held across the step: while the next record was read, the breadcrumb named it with the previous record's title, and its favourite label, its "Recently Accessed" entry and the pane bar's title were briefly written with that title too. A title is now read back only for the record it was resolved for, so during the read the breadcrumb names the object, and nothing is written under the wrong record. No locale keys, props or exports change.
