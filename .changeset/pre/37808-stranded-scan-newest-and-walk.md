---
'@objectstack/plugin-approvals': patch
---

fix(approvals): the stranded-request inspection keeps finding new strands past 500 decided requests

Clause-②: no
Metadata-protocol: none

The read-only inspection that rides the approvals sweep (every five minutes) names decided requests (`approved`, `rejected`, `returned`) whose flow run can no longer advance. It read up to 500 decided requests with no order and no cursor, so once a deployment held more than 500, the page it read was whatever the database handed back, and a request stranded today could stay unseen on every sweep.

Each sweep now reads two ordered windows of at most 500 rows, both filtered and ordered by the database:

- the most recently decided requests (by `updated_at`), so a decision whose run could not advance is named on the next sweep;
- the next 500 of a walk over every decided request by id, which resumes where the previous sweep stopped and starts again once it reaches the end. Every decided request is read at least once every ceil(decided / 500) sweeps, which also covers more than 500 decisions between two sweeps.

A sweep reads at most 1,000 rows instead of 500. The walk's position is kept in memory, so after a restart it starts again from the first id. The inspection still only reports, in the same log line and the same result; nothing is rewritten.
