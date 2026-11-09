---
'@object-ui/plugin-detail': patch
---

refactor(plugin-detail): the record timeline stream pairs audit entries with activity rows by the spec's `RECORD_TIMELINE_FOLDED_ACTIVITY_TYPES`

Clause-②: no
Metadata-protocol: none

The 动态 stream used to keep its own copy of the audit action to activity type pairs (`create`/`created`, `update`/`updated`, `delete`/`deleted`). It now reads `RECORD_TIMELINE_FOLDED_ACTIVITY_TYPES` from `@objectstack/spec/api`, the same set the server's `timeline` count steps aside, so the badge and the drawn rows cannot fold different types. No behaviour change: the same three pairs fold, and any other audit action (`restore`, an unknown action) pairs with no activity row.
