---
'@objectstack/core': patch
---

fix(core): the fellow-org peer list keeps every member the first membership read returned, even when the completion read sees fewer

Clause-②: no
Metadata-protocol: none

In an organization of 1,000 members or more, the resolver reads the membership twice: a first read bounded at 1,000 rows, then a completion read in id order. The completion's rows used to replace the first read's, so a completion that saw fewer members than the first read (an older snapshot on another connection) left `org_user_ids` shorter than the first read alone would have, and those members vanished from ordinary members' `sys_user` reads with no signal. The two reads are now unioned. Both are filtered to the active organization, so the union cannot add anyone outside it. No read is added or changed.
