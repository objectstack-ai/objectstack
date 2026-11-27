---
'@object-ui/core': patch
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a related list's bulk delete with refused rows says why, not only "2 deleted, 1 failed"

Clause-②: no
Metadata-protocol: none

The related list on a record page deletes the selected rows in one batch call, or row by row, and its outcome line gave only the two counts. The count stays, and under it each distinct reason now gets one line, led by the names of the rows it refused, by the same rule as the list page's bulk delete: up to three names, then `+N`, and at most three reasons, then "And N more". The reasons come from the ids a batch delete names, from an error that refuses the whole batch (given for every row), or from each rejected row delete. A batch that names no reason keeps the bare count. `@object-ui/core` exports the rule as `bulkDeleteRefusalLines`, which the list page's summary toast now also builds on.
