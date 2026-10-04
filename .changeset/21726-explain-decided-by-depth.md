---
'@objectstack/plugin-security': patch
---

`POST /api/v1/security/explain` with `{ object, operation: 'read', recordId }` now credits read depth for a row that only the caller's read depth admits.

Clause-②: no

- **Before.** The object's OWD is private. The caller's read depth is wider than `own` (`own_and_reports`, `unit`, `unit_and_below` or `org`). The caller reads a row they do not own and hold no share on. Explain answered `decidedBy: 'sharing'` for that row, with the sharing layer `admitted` and the detail "0 share(s) attached; access is granted for this record." No share granted anything; the read depth did. `depth` is a member of the published `decidedBy` enum, and no answer ever produced it.
- **Now.** That row answers `decidedBy: 'depth'`. The `depth` layer carries a `record` block: `admitted`, naming the depth and, below `org`, the owner it reached. The sharing layer is `not_evaluated`, and its detail says that no share grants the row and that read depth already admits it.
- **The sharing detail names a grant only when one exists**, meaning a share that names the caller. A filter that admits a row with no such share now says which part of the sharing service let the row through.
- **A row a share admits keeps `decidedBy: 'sharing'`** and its "N share(s) attached; access is granted for this record." detail, also when the read depth admits it too. Of the two layers that admit it, sharing comes last in the pipeline, and the `decidedBy` contract names the last layer to admit.
- **No access decision changes.** `visible` is the same for every record; only the layer the report credits moves. No key is added. `depth` and `not_evaluated` are existing values.
- **The `depth` layer's `record` block is new on every record-grained request.** On a write it is `not_evaluated`, because the write depth is judged inside the sharing service's per-record write gate together with ownership and shares, and this report does not separate them.
