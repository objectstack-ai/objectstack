---
'@objectstack/cloud-connection': minor
---

feat(cloud-connection): the install-local door carries a declared rename instead of refusing it `501`

Clause-②: no
Metadata-protocol: semantic

An upgrade whose version declares `renamedFrom` on a field no longer answers `501 NOT_IMPLEMENTED`. Before any write, each declaration is read against the physical table by the driver's own rule; one that cannot be carried answers `422 VALIDATION_ERROR` with `details.refusals` (object, field, old key, reason), and a table that cannot be read answers `503`. The door's own refusals: an extension's field naming a key its own package never contributed to that object (`outside_package`), a renamed field turned to a type that stores no column (`destructive_type`), and a driver that renames no column while a rename is pending (`transport`). The carry runs right before the new version registers; a carry that fails puts back the tables already carried (`500`), and a register that fails puts them back too. The success answer lists each carry in `renamesCarried` (`object`, `table`, `from`, `to`), omitted when there is none.
