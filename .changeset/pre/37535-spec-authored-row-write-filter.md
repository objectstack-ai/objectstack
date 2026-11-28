---
'@objectstack/spec': patch
---

feat(spec): `ISecurityService.getAuthoredRowWriteFilter`, the optional filter-shaped twin of `checkAuthoredRowWrite`

Clause-②: yes
Metadata-protocol: none

The security service contract gains one optional member: `getAuthoredRowWriteFilter(object, operation, context)` answers the rows the caller's app-authored row-level policies admit for `update` or `delete`, with the platform ownership floor taken out, as a filter for a write that names no row. A row matches it exactly when `checkAuthoredRowWrite` admits that row. `undefined` widens nothing and is the answer on absence, abstention and failure; consumers feature-detect it. An implementation that predates it keeps satisfying the contract. Nothing to migrate.
