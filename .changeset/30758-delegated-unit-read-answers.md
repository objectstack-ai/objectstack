---
'@objectstack/plugin-security': patch
---

fix(plugin-security): `canReadObject`, `getReadFilter` and `security/explain` answer a delegated administrator's read of the business units its scope covers as the read door does

Clause-②: no
Metadata-protocol: none

A delegated administrator reads the business units its admin scopes cover (ADR-0090 D12), and the read door already admitted that read for `find`, `findOne`, `count` and `aggregate`. The answers outside the door did not: `canReadObject('sys_business_unit')` answered `false`, so a unit picker or a door that compiles its own statement refused units the delegate can read, and `security/explain` reported the read as denied. All three now ask the read door's own judgment. `canReadObject` answers `true`, `getReadFilter` confines the read to the covered units (an `id` `$in` filter over them), and `security/explain` reports the read as allowed with the same confinement in its `readFilter`, and a unit outside the scope as not visible. Nothing the door refuses is admitted: a unit outside the scope, a read on behalf of another user, an export and every write stay refused, and a caller with no admin scope is answered as before.
