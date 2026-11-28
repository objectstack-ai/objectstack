---
'@objectstack/plugin-security': patch
---

feat(plugin-security): the security service answers the app-authored row-write scope as a filter, so a predicate write reaches the rows an authored update or delete policy admits

Clause-②: yes
Metadata-protocol: none

The `security` service gains `getAuthoredRowWriteFilter(object, operation, context)`, the filter-shaped twin of `checkAuthoredRowWrite`. It answers the rows the caller's app-authored `using` policies admit for `update` or `delete`, with the platform ownership floor (`owner_only_writes` / `owner_only_deletes`) taken out and the tenant wall kept. A row matches the filter exactly when `checkAuthoredRowWrite` answers `admit` for it: both are read off one resolution of the authored scope.

It answers `undefined`, which widens nothing, when the caller holds no authored `using` policy for that verb, when a check-only policy is all they hold, for a principal-less or on-behalf-of context, and on any failure. It is evidence, not authorization: object permissions, the tenant wall, the caller's readable rows and row-level security (floor OR authored policies) still decide the write. Nothing to migrate.
