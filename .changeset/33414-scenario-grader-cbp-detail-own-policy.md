---
'@objectstack/scenarios': patch
---

fix(scenarios): a controlled-by-parent detail its own read policy narrows counts as kept to the persona's rows

Clause-②: no
Metadata-protocol: none

The `access-security.row-level-security` build check followed the master for every `controlled_by_parent` detail, so a detail whose master every persona reads in full (`public_read`) failed with "no read policy on SET narrows MASTER", even when the persona's own permission set carries a read policy on the detail itself. The engine ANDs that policy with the filter it derives from the master, so such a detail is kept to the persona's rows.

The grader now passes a detail when the persona's read policies on it narrow it on their own: at least one applies, none admits every row, and each lowers to a query filter (the same reading it already gave any other object's policies). When they do not, it follows the master as before. A detail with no policy of its own, or one that admits every row, under a public master still fails, and so does a detail policy that does not lower to a filter.
