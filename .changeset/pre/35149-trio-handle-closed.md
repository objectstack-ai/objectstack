---
'@objectstack/objectql': patch
---

fix(objectql): a trio transaction handle that committed or rolled back reads as closed, as a closed `transaction()` unit handle does

Clause-②: no
Metadata-protocol: none

`ScopedContext`'s discrete `beginTransaction` / `commitTransaction` / `rollbackTransaction` trio (the sandbox runner's `ctx.api.transaction`) now marks its handle closed when it commits or rolls it back, instead of only dropping the handle's owner record. The engine's closed-handle check answers `true` for it, so work that still carries the handle afterwards runs outside any transaction, on its own connection, exactly as late work carrying a closed `transaction()` unit handle already did. Before, such a handle read as an unattributed one: a late write routed to another datasource was handed the dead foreign handle, and a late write on the same datasource was handed the finished handle. `openTransactionKind` answers `'none'` for a closed trio handle, where it answered `'separate'`. A driver that hands out the same handle object on a later `beginTransaction` gets it back open.
