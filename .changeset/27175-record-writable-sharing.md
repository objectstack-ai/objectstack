---
'@objectstack/plugin-sharing': minor
---

feat(plugin-sharing): `SharingService.admitsByIdWrite` — the by-id write gate the middleware refuses on

Clause-②: yes (widening)
Metadata-protocol: added

The sharing middleware's by-id `update` / `delete` gate is now one service method, `admitsByIdWrite(object, recordId, verb, context)`, and the middleware refuses exactly when it answers `false`. The same calls run in the same order: `canEdit` / `canDelete`, the delegator's gate for an on-behalf-of write, then the authored-row-write deferral. `byIdWriteGateInstalled` says whether the middleware is installed (`false` under `enforce: false`). `plugin-security` asks the method for the record field-access answer's `writable`, so that verdict is the sharing gate's own. Refusals, their messages and their log lines are unchanged.
